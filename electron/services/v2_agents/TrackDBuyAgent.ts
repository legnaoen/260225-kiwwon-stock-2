/**
 * TrackDBuyAgent
 * ─────────────────────────────────────────────────────────────────
 * [역할] 모의매매 AI 매수 후보 선정 에이전트 (4단계 파이프라인)
 *
 * [실행 트리거]
 *   - SchedulerService → 15:05 CRON (전 종목 수집 완료 직후)
 *   - 수동 IPC: 'track-b:run-buy-agent'
 *
 * [데이터 흐름]
 *   Phase 1: CrossPeriodAnalyzer → 후보 필터링 (카테고리 + 상한가 제외)
 *   Phase 2: enrichCandidateNews() → 뉴스 부족 종목 NaverSearchCollector 온디맨드 수집
 *   Phase 3: runStockResearch()    → Gemma 4 종목별 심층 분석 + 1차 BUY/WATCH 판단
 *                                    → stock_research_reports 저장 (로데이터 3종 포함)
 *   Phase 4: runAiAnalysis()       → Gemini 1회, 24개 팩트시트 기반 포트폴리오 최종 선발
 *   → track_d_buy_picks 저장 (PENDING 상태)
 *   → 15:30 장 마감 후 entry_price = 당일 종가로 자동 업데이트 (ACTIVE)
 *
 * [필터 규칙]
 *   매수 대상: EMERGING_STAR, PULLBACK_REBOUND, PULLBACK_DIP
 *   제외 조건:
 *     1. 상한가 종목 (당일 high == close AND changeRate >= 29.5%)
 *     2. 당일 이미 pick된 종목 (UNIQUE 제약)
 *   목표: Top 10 선정, 5영업일 보유, +15% 목표수익
 */

import fs from 'fs';
import path from 'path';
import { DatabaseService } from '../DatabaseService';
import { CrossPeriodAnalyzer, CrossPeriodCandidate } from '../v2_pipeline/CrossPeriodAnalyzer';
import { AiExecutionQueue } from '../AiExecutionQueue';
import { NaverSearchCollector } from '../v2_pipeline/collectors/NaverSearchCollector';
import { DEFAULT_PEAKOUT_SETTINGS } from '../v2_pipeline/MarketLeaderDiscoveryService';
import { getKstDate } from '../../utils/DateUtils';

// ── 상수 ───────────────────────────────────────────────────────
const BUY_CATEGORIES = ['INTRADAY_SURGE'];
const TARGET_PICKS = 5;
const TARGET_DAYS = 10;
const TARGET_RETURN_PCT = 15.0;

// 상한가 임계값 (코스피/코스닥 공통 30%)
const UPPER_LIMIT_THRESHOLD = 29.5;

// Phase 3 최소 점수 컷오프 (Gemini 자동 제외 기준)
const GEMMA_MIN_SCORE_CUTOFF = 40;

// ── 타입 ───────────────────────────────────────────────────────
interface AiBuyPick {
    stock_code: string;
    stock_name: string;
    rank: number;            // 1~10
    buy_score: number;       // 0~100
    reason: string;          // AI 추천 이유
    risk: string;            // AI 리스크 경고
    theme_lifespan: string;  // 'SHORT' | 'MEDIUM' | 'LONG' | 'UNKNOWN'
    decision: 'BUY' | 'WATCH';
}

interface TodayOhlcv {
    stock_code: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    change_rate: number;
}

/** Gemma 4 종목별 분석 결과 */
interface GemmaStockReport {
    stock_code: string;
    stock_name: string;
    market_theme_link: string;
    theme_durability: string;
    catalyst_summary: string;
    price_action_analysis: string;
    risk_factors: string;
    upside_probability: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
    buy_score: number;
    preliminary_decision: 'BUY' | 'WATCH';
    reasoning: string;
    // 메타 (DB 저장용)
    _injected_context?: string;
    _system_prompt?: string;
    _raw_response?: string;
}

// ──────────────────────────────────────────────────────────────
export class TrackDBuyAgent {
    private static instance: TrackDBuyAgent;
    private db: DatabaseService;
    private isRunning = false;
    private naverCollector = new NaverSearchCollector();

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): TrackDBuyAgent {
        if (!TrackDBuyAgent.instance) {
            TrackDBuyAgent.instance = new TrackDBuyAgent();
        }
        return TrackDBuyAgent.instance;
    }

    // ─────────────────────────────────────────────────────────
    // PUBLIC: 메인 실행 진입점 (4단계 파이프라인)
    // ─────────────────────────────────────────────────────────
    public async run(pickDate?: string): Promise<{ success: boolean; saved: number; skipped: number; error?: string }> {
        if (this.isRunning) {
            console.log('[TrackDBuyAgent] 이미 실행 중. 중복 실행 방지.');
            return { success: false, saved: 0, skipped: 0, error: 'Already running' };
        }

        this.isRunning = true;
        const today = pickDate || getKstDate();
        console.log(`[TrackDBuyAgent] ▶ 4단계 모의매매 AI 파이프라인 시작: ${today}`);

        try {
            // ── Phase 1: 후보 선별 ──────────────────────────────
            const profile = CrossPeriodAnalyzer.getInstance().getCrossPeriodProfile(80, DEFAULT_PEAKOUT_SETTINGS);
            if (!profile.success || profile.candidates.length === 0) {
                console.log('[TrackDBuyAgent] CrossPeriod 후보 없음. 종료.');
                return { success: false, saved: 0, skipped: 0, error: 'No cross-period candidates' };
            }

            const categoryFiltered = profile.candidates.filter(c => BUY_CATEGORIES.includes(c.category));
            console.log(`[TrackDBuyAgent] Phase1 카테고리 필터 후: ${categoryFiltered.length}개`);

            const todayOhlcv = this.loadTodayOhlcv(today);
            const { filtered: buyableList, skipped } = this.filterUpperLimit(categoryFiltered, todayOhlcv);
            console.log(`[TrackDBuyAgent] Phase1 상한가 제외 후: ${buyableList.length}개 (제외: ${skipped.length}개)`);

            // ── Phase 1.5: 폭증 방지 (상승률 기준 Top 15 캡 적용) ──────────────
            buyableList.sort((a, b) => {
                const aPct = todayOhlcv.get(a.stockCode)?.change_rate || 0;
                const bPct = todayOhlcv.get(b.stockCode)?.change_rate || 0;
                return bPct - aPct;
            });
            const cappedBuyableList = buyableList.slice(0, 15);
            console.log(`[TrackDBuyAgent] Phase1.5 상승률 Top 15 캡 적용 후: ${cappedBuyableList.length}개`);

            if (cappedBuyableList.length === 0) {
                return { success: false, saved: 0, skipped: skipped.length, error: 'All candidates filtered (upper limit)' };
            }

            // ── Phase 2: 뉴스 온디맨드 리서치 ─────────────────
            console.log(`[TrackDBuyAgent] Phase2 뉴스 리서치 시작...`);
            await this.enrichCandidateNews(cappedBuyableList, today);

            // ── Phase 3: Gemma 4 종목별 심층 분석 ─────────────
            console.log(`[TrackDBuyAgent] Phase3 Gemma4 종목별 분석 시작 (${cappedBuyableList.length}개)...`);
            const gemmaReports = await this.runStockResearch(cappedBuyableList, today);
            console.log(`[TrackDBuyAgent] Phase3 완료: ${gemmaReports.length}개 분석됨`);

            // ── Phase 4: Gemini 최종 포트폴리오 선발 ──────────
            console.log(`[TrackDBuyAgent] Phase4 Gemini 최종 선발 시작...`);
            const aiPicks = await this.runAiAnalysis(cappedBuyableList, gemmaReports, today);
            if (!aiPicks || aiPicks.length === 0) {
                console.log('[TrackDBuyAgent] AI 분석 결과 없음. 종료.');
                return { success: false, saved: 0, skipped: skipped.length, error: 'AI analysis returned no picks' };
            }

            // ── 저장 ──────────────────────────────────────────
            const buyPicks = aiPicks.filter(p => p.decision === 'BUY').slice(0, TARGET_PICKS);
            const saved = this.savePicks(buyPicks, cappedBuyableList, gemmaReports, today);

            this.updateEntryPrices(today);
            console.log(`[TrackDBuyAgent] ✅ 파이프라인 완료: ${saved}개 저장`);
            return { success: true, saved, skipped: skipped.length };

        } catch (err: any) {
            console.error('[TrackDBuyAgent] 에러:', err);
            return { success: false, saved: 0, skipped: 0, error: err.message };
        } finally {
            this.isRunning = false;
        }
    }

    // ─────────────────────────────────────────────────────────
    // PUBLIC: 장 마감 후 entry_price 업데이트 (15:30 이후)
    // ─────────────────────────────────────────────────────────
    public updateEntryPrices(date?: string): number {
        const today = date || getKstDate();
        const rawDb = (this.db as any).db;

        const pendingPicks = rawDb.prepare(`
            SELECT id, stock_code FROM track_d_buy_picks
            WHERE pick_date = ? AND status = 'PENDING'
        `).all(today) as { id: number; stock_code: string }[];

        if (pendingPicks.length === 0) return 0;

        let updated = 0;
        for (const pick of pendingPicks) {
            const ohlcv = rawDb.prepare(`
                SELECT close FROM market_ohlcv_history
                WHERE stock_code = ? AND date = ?
            `).get(pick.stock_code, today) as { close: number } | undefined;

            if (!ohlcv || !ohlcv.close) continue;

            rawDb.prepare(`
                UPDATE track_d_buy_picks
                SET entry_price = ?,
                    current_price = ?,
                    status = 'ACTIVE',
                    entry_date = ?,
                    updated_at = ?
                WHERE id = ?
            `).run(ohlcv.close, ohlcv.close, today, new Date().toISOString(), pick.id);

            updated++;
        }

        console.log(`[TrackDBuyAgent] entry_price 업데이트: ${updated}/${pendingPicks.length}개`);
        return updated;
    }

    // ─────────────────────────────────────────────────────────
    // PUBLIC: 일일 성과 채점
    // ─────────────────────────────────────────────────────────
    public scoreDailyPerformance(date?: string): { updated: number; closed: number } {
        const today = date || getKstDate();
        const rawDb = (this.db as any).db;

        const activePicks = rawDb.prepare(`
            SELECT * FROM track_d_buy_picks WHERE status = 'ACTIVE'
        `).all() as any[];

        let updated = 0;
        let closed = 0;

        for (const pick of activePicks) {
            const ohlcv = rawDb.prepare(`
                SELECT high, close FROM market_ohlcv_history
                WHERE stock_code = ? AND date = ?
            `).get(pick.stock_code, today) as { high: number; close: number } | undefined;

            if (!ohlcv || !ohlcv.close || pick.entry_price <= 0) continue;

            // ─── 당일 편입 종목 처리 ───────────────────────────────
            // 동시호가 종가로 매수한 당일은 peak_return/holding_days 갱신 불가
            // (당일 고가는 매수 전 가격이므로 수익률 기준 왜곡 발생)
            // current_price만 최신 종가로 갱신하고 다음 영업일부터 채점 시작
            if (pick.entry_date === today) {
                rawDb.prepare(`
                    UPDATE track_d_buy_picks
                    SET current_price = ?, updated_at = ?
                    WHERE id = ?
                `).run(ohlcv.close, new Date().toISOString(), pick.id);
                continue;
            }

            const currentReturn = ((ohlcv.close - pick.entry_price) / pick.entry_price) * 100;
            const dailyHighReturn = ((ohlcv.high - pick.entry_price) / pick.entry_price) * 100;

            let newPeakReturn = pick.peak_return;
            let newPeakDate = pick.peak_date;
            if (pick.peak_return == null || dailyHighReturn > pick.peak_return) {
                newPeakReturn = dailyHighReturn;
                newPeakDate = today;
            }

            const newHoldingDays = pick.holding_days + 1;

            if (newHoldingDays >= pick.target_days) {
                const result = currentReturn >= pick.target_return_pct
                    ? 'HIT'
                    : currentReturn >= 0 ? 'PARTIAL' : 'LOSS';

                rawDb.prepare(`
                    UPDATE track_d_buy_picks
                    SET current_price = ?,
                        exit_price = ?,
                        holding_days = ?,
                        peak_return = ?,
                        peak_date = ?,
                        final_return = ?,
                        status = 'CLOSED',
                        result = ?,
                        exit_date = ?,
                        updated_at = ?
                    WHERE id = ?
                `).run(
                    ohlcv.close, ohlcv.close, newHoldingDays,
                    newPeakReturn, newPeakDate, currentReturn, result,
                    today, new Date().toISOString(), pick.id
                );
                closed++;
            } else {
                rawDb.prepare(`
                    UPDATE track_d_buy_picks
                    SET current_price = ?,
                        holding_days = ?,
                        peak_return = ?,
                        peak_date = ?,
                        updated_at = ?
                    WHERE id = ?
                `).run(
                    ohlcv.close, newHoldingDays,
                    newPeakReturn, newPeakDate, new Date().toISOString(), pick.id
                );
                updated++;
            }
        }

        console.log(`[TrackDBuyAgent] 성과 채점: 갱신 ${updated}개, 청산 ${closed}개`);
        return { updated, closed };
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE: 오늘 OHLCV 로딩
    // ─────────────────────────────────────────────────────────
    private loadTodayOhlcv(date: string): Map<string, TodayOhlcv> {
        const rawDb = (this.db as any).db;
        const rows: any[] = rawDb.prepare(`
            SELECT t.stock_code, t.open, t.high, t.low, t.close, t.volume,
                CASE
                    WHEN p.close > 0 THEN ((t.close - p.close) * 100.0 / p.close)
                    ELSE 0
                END AS change_rate
            FROM market_ohlcv_history t
            LEFT JOIN market_ohlcv_history p
                ON t.stock_code = p.stock_code
                AND p.date = (
                    SELECT MAX(date) FROM market_ohlcv_history
                    WHERE stock_code = t.stock_code AND date < ?
                )
            WHERE t.date = ?
        `).all(date, date);

        const map = new Map<string, TodayOhlcv>();
        for (const r of rows) {
            map.set(r.stock_code, {
                stock_code: r.stock_code,
                open: r.open,
                high: r.high,
                low: r.low,
                close: r.close,
                volume: r.volume,
                change_rate: r.change_rate ?? 0,
            });
        }
        return map;
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE: 상한가 필터
    // ─────────────────────────────────────────────────────────
    private filterUpperLimit(
        candidates: CrossPeriodCandidate[],
        todayOhlcv: Map<string, TodayOhlcv>
    ): { filtered: CrossPeriodCandidate[]; skipped: CrossPeriodCandidate[] } {
        const filtered: CrossPeriodCandidate[] = [];
        const skipped: CrossPeriodCandidate[] = [];

        for (const c of candidates) {
            const ohlcv = todayOhlcv.get(c.stockCode);

            if (ohlcv) {
                const isUpperLimit =
                    ohlcv.change_rate >= UPPER_LIMIT_THRESHOLD &&
                    ohlcv.high > 0 &&
                    ohlcv.close > 0 &&
                    ohlcv.high === ohlcv.close;

                if (isUpperLimit) {
                    console.log(`[TrackDBuyAgent] 상한가 제외: ${c.stockName}(${c.stockCode}) +${ohlcv.change_rate.toFixed(1)}%`);
                    skipped.push(c);
                    continue;
                }
            }
            filtered.push(c);
        }

        return { filtered, skipped };
    }

    // ─────────────────────────────────────────────────────────
    // PHASE 2: 온디맨드 뉴스 리서치
    // DB에 최근 3일 뉴스가 2건 이상 없는 종목만 NaverSearchCollector로 수집
    // ─────────────────────────────────────────────────────────
    private async enrichCandidateNews(candidates: CrossPeriodCandidate[], date: string): Promise<void> {
        const rawDb = (this.db as any).db;
        let fetched = 0;

        for (const c of candidates) {
            // DB에 최근 3일 이내 뉴스가 2건 이상인지 확인 (테마 없는 케이스 방어)
            let existingCount: { cnt: number } = { cnt: 0 };
            try {
                const themes = c.relatedThemes.slice(0, 2);
                if (themes.length > 0) {
                    existingCount = rawDb.prepare(`
                        SELECT COUNT(*) as cnt FROM naver_news_flow
                        WHERE (search_keyword IN (${themes.map(() => '?').join(',')})
                            OR title LIKE ?)
                        AND date >= date(?, '-3 days')
                    `).get(...themes, `%${c.stockName}%`, date) as { cnt: number };
                } else {
                    existingCount = rawDb.prepare(`
                        SELECT COUNT(*) as cnt FROM naver_news_flow
                        WHERE title LIKE ?
                        AND date >= date(?, '-3 days')
                    `).get(`%${c.stockName}%`, date) as { cnt: number };
                }
            } catch (_) { }

            if ((existingCount?.cnt ?? 0) >= 2) {
                continue; // 이미 충분한 뉴스 있음
            }

            // 뉴스 부족 → NaverSearchCollector로 수집
            try {
                const result = await this.naverCollector.collect({ keyword: c.stockName });
                const articles = result?.articles ?? [];

                for (const article of articles) {
                    try {
                        rawDb.prepare(`
                            INSERT OR IGNORE INTO naver_news_flow
                            (date, category, title, body_snippet, source, article_id, url, search_keyword, collected_at)
                            VALUES (?, 'STOCK_TARGET', ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            date,
                            article.title?.replace(/<[^>]+>/g, '') ?? '',
                            article.description?.replace(/<[^>]+>/g, '') ?? null,
                            article.originallink ? new URL(article.originallink).hostname : null,
                            null,
                            article.originallink ?? null,
                            c.stockName,
                            new Date().toISOString()
                        );
                    } catch (_) { /* IGNORE duplicate */ }
                }

                fetched++;
                console.log(`[TrackDBuyAgent] Phase2 뉴스 수집: ${c.stockName} → ${articles.length}건`);

                // API Rate Limit 방어 (200ms 딜레이)
                await new Promise(r => setTimeout(r, 200));

            } catch (e: any) {
                console.warn(`[TrackDBuyAgent] Phase2 뉴스 수집 실패 (${c.stockName}): ${e.message}`);
            }
        }

        console.log(`[TrackDBuyAgent] Phase2 완료: ${fetched}개 종목 신규 뉴스 수집`);
    }

    // ─────────────────────────────────────────────────────────
    // PHASE 3: Gemma 4 종목별 심층 분석
    // 종목당 1회 호출, 시장 전체 맥락(테마/이슈장부/시황) 주입
    // 결과는 stock_research_reports 테이블에 로데이터와 함께 저장
    // ─────────────────────────────────────────────────────────
    private async runStockResearch(candidates: CrossPeriodCandidate[], date: string): Promise<GemmaStockReport[]> {
        const rawDb = (this.db as any).db;
        const reports: GemmaStockReport[] = [];

        // 시장 공통 맥락 조립 (모든 종목에 동일하게 주입)
        const marketContext = this.buildMarketContext(date);

        // 1. 가이드라인 로드
        let guidelineContent = '';
        try {
            const guidelinePath = path.join(process.cwd(), 'guidelines', 'track_d_phase1.md');
            if (fs.existsSync(guidelinePath)) {
                guidelineContent = fs.readFileSync(guidelinePath, 'utf-8');
            }
        } catch (e) {
            console.warn('[TrackB] Failed to load guideline document:', e);
        }

        const systemPrompt = `${guidelineContent || '당신은 대한민국 코스피/코스닥 개별 종목 리서치 전담 애널리스트입니다.'}

[응답 형식] 반드시 다음 JSON 객체만 출력하십시오. 설명 없이 JSON만:
{
  "stock_code": "종목코드",
  "stock_name": "종목명",
  "market_theme_link": "[테마의 힘] 주류 메가 테마 탑승 여부",
  "theme_durability": "LONG|MEDIUM|SHORT",
  "catalyst_summary": "[재료의 질] 급등 트리거 뉴스의 구조적 모멘텀 여부",
  "price_action_analysis": "[수급/차트 종가관리] OHLCV 기반 당일 윗꼬리(매물) 및 거래대금 폭발 분석",
  "risk_factors": "윗꼬리, 단발성 찌라시 등 엑시트(설거지) 리스크",
  "upside_probability": "HIGH|MEDIUM|LOW|VERY_LOW",
  "buy_score": 0~100,
  "preliminary_decision": "BUY|WATCH",
  "reasoning": "이 종목을 내일 종가베팅 대상에 포함해야 하는가? (1줄 요약)"
}`;

        const Store = require('electron-store');
        const store = new Store();
        const aiSettings = store.get('ai_settings') || {};
        const isBypass = Array.isArray(aiSettings.lightweightCloudAgents) && aiSettings.lightweightCloudAgents.some((id: string) => 'TRACK_B_GEMMA_RESEARCH'.includes(id) || 'TRACK_B_GEMMA_RESEARCH'.startsWith(id));

        const processCandidate = async (c: any) => {
            // 종목별 뉴스 조회 (Phase 2에서 수집된 것 포함)
            let news: any[] = [];
            try {
                const themes = c.relatedThemes.slice(0, 2);
                if (themes.length > 0) {
                    news = rawDb.prepare(`
                        SELECT title, body_snippet FROM naver_news_flow
                        WHERE (search_keyword IN (${themes.map(() => '?').join(',')})
                            OR title LIKE ?
                            OR search_keyword = ?)
                        AND date >= date(?, '-3 days')
                        ORDER BY collected_at DESC
                        LIMIT 5
                    `).all(...themes, `%${c.stockName}%`, c.stockName, date);
                } else {
                    news = rawDb.prepare(`
                        SELECT title, body_snippet FROM naver_news_flow
                        WHERE (title LIKE ? OR search_keyword = ?)
                        AND date >= date(?, '-3 days')
                        ORDER BY collected_at DESC
                        LIMIT 5
                    `).all(`%${c.stockName}%`, c.stockName, date);
                }
            } catch (_) { }

            const newsSection = news.length > 0
                ? news.map((n: any) => `- ${n.title}${n.body_snippet ? ' | ' + n.body_snippet.slice(0, 80) : ''}`).join('\n')
                : '- 관련 뉴스 없음';

            // OHLCV 요약표 생성
            let ohlcvSnippet = '관련 차트(OHLCV) 정보 없음';
            try {
                const recentOhlcv = rawDb.prepare(`
                    SELECT date, open, high, low, close, trading_value 
                    FROM market_ohlcv_history
                    WHERE stock_code = ? AND date <= ?
                    ORDER BY date DESC LIMIT 8
                `).all(c.stockCode, date).reverse();

                if (recentOhlcv.length > 0) {
                    ohlcvSnippet = '[최근 8영업일 주가/거래대금 흐름]\n';
                    ohlcvSnippet += '일자 | 시가 | 고가 | 저가 | 종가 | 거래대금(억)\n';
                    recentOhlcv.forEach((row: any) => {
                        const tv = Math.round(row.trading_value / 100000000);
                        ohlcvSnippet += `${row.date} | ${row.open} | ${row.high} | ${row.low} | ${row.close} | ${tv}억\n`;
                    });
                }
            } catch (e) {
                console.warn('[TrackDBuyAgent] OHLCV 조회 실패:', e);
            }

            const userPrompt = `[분석 대상 종목]
종목코드: ${c.stockCode}
종목명: ${c.stockName}
카테고리: ${c.category}
확신도: ${Math.round(c.convictionScore)}
관련 테마: ${c.relatedThemes.slice(0, 3).join(', ') || '없음'}

[종목 관련 최근 뉴스 (최대 5건)]
${newsSection}

${ohlcvSnippet}

${marketContext}

위 정보를 바탕으로 이 종목의 10영업일 내 +15% 달성 가능성을 분석하십시오.`;

            try {
                const rawResponse = await AiExecutionQueue.getInstance().enqueue({
                    agentId: 'TRACK_B_GEMMA_RESEARCH',
                    agentName: `모의매매 Gemma 리서치 (${c.stockName})`,
                    triggerType: 'CRON',
                    targetType: 'local',
                    prompt: userPrompt,
                    systemInstruction: systemPrompt,
                });

                // JSON 파싱
                const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    console.warn(`[TrackDBuyAgent] Phase3 JSON 파싱 실패 (${c.stockName})`);
                    // 파싱 실패 시 기본 리포트 생성
                    const fallback: GemmaStockReport = {
                        stock_code: c.stockCode,
                        stock_name: c.stockName,
                        market_theme_link: '분석 실패',
                        theme_durability: 'UNKNOWN',
                        catalyst_summary: '분석 실패',
                        price_action_analysis: '분석 실패',
                        risk_factors: '분석 실패',
                        upside_probability: 'LOW',
                        buy_score: 30,
                        preliminary_decision: 'WATCH',
                        reasoning: 'Gemma 응답 파싱 실패',
                        _injected_context: userPrompt,
                        _system_prompt: systemPrompt,
                        _raw_response: rawResponse,
                    };
                    reports.push(fallback);
                    this.db.saveStockResearchReport({
                        date, stock_code: c.stockCode, stock_name: c.stockName,
                        ...fallback,
                        injected_context_json: userPrompt,
                        system_prompt: systemPrompt,
                        raw_ai_response: rawResponse,
                    });
                    return;
                }

                const parsed = JSON.parse(jsonMatch[0]) as GemmaStockReport;
                parsed._injected_context = userPrompt;
                parsed._system_prompt = systemPrompt;
                parsed._raw_response = rawResponse;
                parsed.stock_code = c.stockCode; // 코드 보정

                reports.push(parsed);

                // DB 영구 저장 (로데이터 3종 포함)
                this.db.saveStockResearchReport({
                    date,
                    stock_code: c.stockCode,
                    stock_name: c.stockName,
                    market_theme_link: parsed.market_theme_link,
                    theme_durability: parsed.theme_durability,
                    catalyst_summary: parsed.catalyst_summary,
                    price_action_analysis: parsed.price_action_analysis,
                    risk_factors: parsed.risk_factors,
                    upside_probability: parsed.upside_probability,
                    buy_score: parsed.buy_score,
                    preliminary_decision: parsed.preliminary_decision,
                    reasoning: parsed.reasoning,
                    injected_context_json: userPrompt,
                    system_prompt: systemPrompt,
                    raw_ai_response: rawResponse,
                });

                console.log(`[TrackDBuyAgent] Phase3 분석: ${c.stockName} → 점수:${parsed.buy_score} / ${parsed.preliminary_decision}`);

            } catch (e: any) {
                console.warn(`[TrackDBuyAgent] Phase3 Gemma 호출 실패 (${c.stockName}): ${e.message}`);
                // 오류 시 기본 WATCH 처리
                const fallback: GemmaStockReport = {
                    stock_code: c.stockCode,
                    stock_name: c.stockName,
                    market_theme_link: '로컬AI 오류',
                    theme_durability: 'UNKNOWN',
                    catalyst_summary: '로컬AI 오류',
                    risk_factors: e.message,
                    upside_probability: 'LOW',
                    buy_score: 25,
                    preliminary_decision: 'WATCH',
                    reasoning: `Gemma 호출 실패: ${e.message}`,
                };
                reports.push(fallback);
            }
                };

        if (isBypass) {
            console.log(`[TrackDBuyAgent] ☁️ 클라우드 전환 감지 -> ${candidates.length}개 종목 병렬 리서치 시작`);
            this.telegram.sendMessage(`[TrackD] ☁️ 클라우드 쾌속 분석 모드 (병렬 ${candidates.length}개) 작동 중...`);
            await Promise.all(candidates.map(c => processCandidate(c)));
        } else {
            console.log(`[TrackDBuyAgent] 🖥️ 로컬 처리 감지 -> 순차 리서치 시작`);
            for (const c of candidates) {
                await processCandidate(c);
            }
        }

        return reports;
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE: 시장 공통 맥락 조립 (Phase 3 주입용)
    // ─────────────────────────────────────────────────────────
    private buildMarketContext(date: string): string {
        const rawDb = (this.db as any).db;
        const lines: string[] = [];

        // 오늘의 메인 테마 Top 5
        try {
            const themes: any[] = rawDb.prepare(`
                SELECT name, lifespan_type, reason FROM theme_intelligence
                WHERE date = ? ORDER BY created_at DESC LIMIT 5
            `).all(date);
            if (themes.length > 0) {
                lines.push(`[오늘의 시장 메인 테마 Top ${themes.length}]`);
                themes.forEach((t, i) => {
                    lines.push(`${i + 1}. ${t.name} | 생애주기: ${t.lifespan_type ?? 'N/A'} | ${(t.reason ?? '').slice(0, 60)}`);
                });
            }
        } catch (_) { }

        // 시황 AI 최신 투심
        try {
            const intraday: any = rawDb.prepare(`
                SELECT market_direction, consensus, final_confidence, summary
                FROM intraday_predictions
                ORDER BY created_at DESC LIMIT 1
            `).get();
            if (intraday) {
                lines.push(`\n[시황 AI 투심] ${intraday.market_direction ?? ''} | 컨센서스: ${intraday.consensus ?? ''} | 신뢰도: ${intraday.final_confidence ?? ''}%`);
                if (intraday.summary) lines.push(`요약: ${intraday.summary.slice(0, 100)}`);
            }
        } catch (_) { }

        // 증권사 리서치 핵심 (최신 3건)
        try {
            const research: any[] = rawDb.prepare(`
                SELECT title FROM naver_research_flow
                WHERE date >= date(?, '-1 days')
                ORDER BY collected_at DESC LIMIT 3
            `).all(date);
            if (research.length > 0) {
                lines.push(`\n[오늘 증권사 리서치 핵심]`);
                research.forEach(r => lines.push(`- ${r.title}`));
            }
        } catch (_) { }

        return lines.length > 0
            ? `[시장 전체 맥락 — 오늘(${date}) 기준]\n${lines.join('\n')}`
            : `[시장 전체 맥락] 오늘(${date}) 기준 별도 데이터 없음`;
    }

    // ─────────────────────────────────────────────────────────
    // PHASE 4: Gemini 최종 포트폴리오 선발 (심사위원장)
    // Gemma 팩트시트를 입력받아 상대비교 + 집중도 조율 + 최종 순위
    // ─────────────────────────────────────────────────────────
    private async runAiAnalysis(
        candidates: CrossPeriodCandidate[],
        gemmaReports: GemmaStockReport[],
        date: string
    ): Promise<AiBuyPick[]> {
        const reportMap = new Map(gemmaReports.map(r => [r.stock_code, r]));

        // Gemma 점수 컷오프 적용 (40점 미만 자동 제외)
        const eligibleCandidates = candidates.filter(c => {
            const r = reportMap.get(c.stockCode);
            return !r || (r.buy_score >= GEMMA_MIN_SCORE_CUTOFF);
        });

        console.log(`[TrackDBuyAgent] Phase4 대상: ${eligibleCandidates.length}개 (컷오프 ${GEMMA_MIN_SCORE_CUTOFF}점 미만 제외)`);

        // 테마 밀집도(Tally) 산출 (Track C: 조정을 받고 있는 다양한 테마 확인 목적)
        const themeTally = new Map<string, number>();
        eligibleCandidates.forEach(c => {
            if (c.relatedThemes && c.relatedThemes.length > 0) {
                c.relatedThemes.slice(0, 2).forEach(t => {
                    themeTally.set(t, (themeTally.get(t) || 0) + 1);
                });
            }
        });

        const sortedThemes = Array.from(themeTally.entries())
            .filter(([, count]) => count >= 3) // 3개 종목 이상 포진된 핵심 테마만 추려냄
            .sort((a, b) => b[1] - a[1]);

        let themeDensityText = '';
        if (sortedThemes.length > 0) {
            themeDensityText = `[종합 분석 기준 시장 주요 테마 풀(Pool) 현황]\n` +
                sortedThemes.map((t, idx) => `${idx + 1}위 ${t[0]} (${t[1]}개)`).join(' / ') +
                `\n\n*참고사항: 위 풀(Pool) 정보는 참고 데이터일 뿐 주된 의사결정 요인이 되어서는 안 됩니다. 눌림목 선발 시 가장 중요한 기준은 '상승을 이끌었던 호재(Catalyst)가 아직 유효하여 재상승 가능성이 높은가'입니다. 주도 테마 정보를 제공하는 이유는 이 시장 주도 테마에 해당할수록 수급이 몰려 재상승할 확률이 통계적으로 높기 때문입니다. 호재의 유효성을 최우선으로, 테마 가중치를 보조로 활용하십시오.*\n\n`;
        }

        // 팩트시트 텍스트 조립
        const factSheets = eligibleCandidates.map((c, i) => {
            const r = reportMap.get(c.stockCode);
            if (!r) {
                return `${i + 1}. [${c.stockCode}] ${c.stockName} | ${c.category} | Gemma 분석 없음`;
            }
            return `${i + 1}. [${c.stockCode}] ${c.stockName} | ${c.category} | 확신도:${Math.round(c.convictionScore)}
   - 로컬점수: ${r.buy_score}점 (${r.preliminary_decision} / 상승확률: ${r.upside_probability})
   - [테마분석]: ${r.market_theme_link} (수명: ${r.theme_durability})
   - [핵심호재]: ${r.catalyst_summary}
   - [차트수급]: ${r.price_action_analysis || 'Gemma 차트 분석 누락'}
   - [리스크]: ${r.risk_factors}
   - [1차요약]: ${r.reasoning}`;
        }).join('\n\n');

        // 2차 가이드라인 로드
        let phase2Guideline = '';
        try {
            const guidelinePath = path.join(process.cwd(), 'guidelines', 'track_d_phase2.md');
            if (fs.existsSync(guidelinePath)) {
                phase2Guideline = fs.readFileSync(guidelinePath, 'utf-8');
            }
        } catch (e) {
            console.warn('[TrackB] Failed to load phase2 guideline:', e);
        }

        const systemInstruction = `당신은 대한민국 코스피/코스닥 알파 수익률 전문 투자심의위원회 위원장입니다.
Gemma AI가 종목별로 작성한 팩트시트와 1차 판단을 검토하여 최종 Top ${TARGET_PICKS}개를 선발합니다.

${phase2Guideline || '[추가 판단 기준]\n1. 촉매 타이밍\n2. 포트폴리오 분산\n3. 리스크 필터링'}

[응답 형식] 반드시 다음 JSON 배열만 출력하십시오. 설명 없이 JSON만:
[
  {
    "stock_code": "005930",
    "stock_name": "삼성전자",
    "rank": 1,
    "buy_score": 85,
    "decision": "BUY",
    "reason": "2줄 이내 최종 추천 근거",
    "risk": "1줄 리스크 경고",
    "theme_lifespan": "MEDIUM"
  },
  ...
]
decision: "BUY" | "WATCH"
theme_lifespan: "SHORT"(3일 미만) | "MEDIUM"(1~2주) | "LONG"(1달+) | "UNKNOWN"`;

        const userPrompt = `[오늘 날짜: ${date}]
[분석 대상: ${eligibleCandidates.length}개 당일 급등주 종가베팅 후보 종목]

${themeDensityText}${factSheets}

---
위 팩트시트를 기반으로 10영업일 내 +15% 달성 가능성 기준으로
최종 Top ${TARGET_PICKS}개를 BUY로 선정하고, 나머지는 WATCH로 처리하십시오.`;

        try {
            const result = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'TRACK_D_BUY_AGENT',
                agentName: '모의매매 매수 선정 AI',
                triggerType: 'CRON',
                prompt: userPrompt,
                systemInstruction,
            });

            if (!result) {
                console.error('[TrackDBuyAgent] Phase4 AI 응답 없음');
                return [];
            }

            const jsonMatch = result.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                console.error('[TrackDBuyAgent] Phase4 JSON 추출 실패:', result.slice(0, 200));
                return [];
            }

            const picks: AiBuyPick[] = JSON.parse(jsonMatch[0]);
            console.log(`[TrackDBuyAgent] Phase4 결과: BUY ${picks.filter(p => p.decision === 'BUY').length}개, WATCH ${picks.filter(p => p.decision === 'WATCH').length}개`);
            return picks;

        } catch (err: any) {
            console.error('[TrackDBuyAgent] Phase4 AI 분석 오류:', err.message);
            return [];
        }
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE: DB 저장 (Gemma 점수 병합 포함)
    // ─────────────────────────────────────────────────────────
    private savePicks(
        aiPicks: AiBuyPick[],
        candidates: CrossPeriodCandidate[],
        gemmaReports: GemmaStockReport[],
        date: string
    ): number {
        const rawDb = (this.db as any).db;
        const now = new Date().toISOString();
        const candidateMap = new Map(candidates.map(c => [c.stockCode, c]));
        const gemmaMap = new Map(gemmaReports.map(r => [r.stock_code, r]));

        let saved = 0;

        const insertStmt = rawDb.prepare(`
            INSERT OR IGNORE INTO track_d_buy_picks (
                pick_date, pick_rank, stock_code, stock_name,
                category, signals_json, buy_score, reason, risk,
                related_themes_json, theme_lifespan,
                entry_price, exit_price, current_price,
                holding_days, target_days, target_return_pct,
                peak_return, peak_date, final_return,
                status, result, entry_date, exit_date,
                created_at, updated_at
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?,
                0, 0, 0,
                0, ?, ?,
                NULL, NULL, NULL,
                'PENDING', NULL, NULL, NULL,
                ?, ?
            )
        `);

        for (const pick of aiPicks) {
            const candidate = candidateMap.get(pick.stock_code);
            if (!candidate) continue;

            // Gemma 점수가 있으면 Gemini 점수와 가중 평균 (Gemma 40% + Gemini 60%)
            const gemmaReport = gemmaMap.get(pick.stock_code);
            const finalScore = gemmaReport
                ? Math.round(gemmaReport.buy_score * 0.4 + pick.buy_score * 0.6)
                : pick.buy_score;

            try {
                const info = insertStmt.run(
                    date,
                    pick.rank,
                    pick.stock_code,
                    pick.stock_name,
                    candidate.category,
                    candidate.signals.length > 0 ? JSON.stringify(candidate.signals) : null,
                    finalScore,
                    pick.reason,
                    pick.risk,
                    candidate.relatedThemes.length > 0 ? JSON.stringify(candidate.relatedThemes) : null,
                    pick.theme_lifespan,
                    TARGET_DAYS,
                    TARGET_RETURN_PCT,
                    now,
                    now
                );
                if (info.changes > 0) saved++;
            } catch (e: any) {
                console.error(`[TrackDBuyAgent] 저장 실패 (${pick.stock_code}):`, e.message);
            }
        }

        return saved;
    }
}
