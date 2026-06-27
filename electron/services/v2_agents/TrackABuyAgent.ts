/**
 * TrackABuyAgent
 * ─────────────────────────────────────────────────────────────────
 * [역할] 모의매매 AI 매수 후보 선정 에이전트 (4단계 파이프라인)
 *
 * [실행 트리거]
 *   - SchedulerService → 15:05 CRON (전 종목 수집 완료 직후)
 *   - 수동 IPC: 'track-a:run-buy-agent'
 *
 * [데이터 흐름]
 *   Phase 1: CrossPeriodAnalyzer → 후보 필터링 (카테고리 + 상한가 제외)
 *   Phase 2: enrichCandidateNews() → 뉴스 부족 종목 NaverSearchCollector 온디맨드 수집
 *   Phase 3: runStockResearch()    → Gemma 4 종목별 심층 분석 + 1차 BUY/WATCH 판단
 *                                    → stock_research_reports 저장 (로데이터 3종 포함)
 *   Phase 4: runAiAnalysis()       → Gemini 1회, 24개 팩트시트 기반 포트폴리오 최종 선발
 *   → track_a_buy_picks 저장 (PENDING 상태)
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
import { getDynamicCutoffConfig } from './types/AgentTypes';

// ── 상수 ───────────────────────────────────────────────────────
const BUY_CATEGORIES = ['TRUE_LEADER'];
const TARGET_PICKS = 5;
const TARGET_DAYS = 20;
const TARGET_RETURN_PCT = 20.0;

// Gemma 투입 시 최대 종목 수 (리소스 최적화: 시간/API 부하 제어)
// convictionScore 내림순으로 정렬된 후 상위 N개만 뉴스 수집
const MAX_GEMMA_POOL = 20;

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
    price_action_analysis: string;  // 피크아웃 감별 분석 (알고리즘 지표 기반)
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
export class TrackABuyAgent {
    private static instance: TrackABuyAgent;
    private db: DatabaseService;
    private isRunning = false;
    private naverCollector = new NaverSearchCollector();

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): TrackABuyAgent {
        if (!TrackABuyAgent.instance) {
            TrackABuyAgent.instance = new TrackABuyAgent();
        }
        return TrackABuyAgent.instance;
    }

    // ─────────────────────────────────────────────────────────
    // PUBLIC: 메인 실행 진입점 (4단계 파이프라인)
    // ─────────────────────────────────────────────────────────
    public async run(pickDate?: string): Promise<{ success: boolean; saved: number; skipped: number; error?: string }> {
        if (this.isRunning) {
            console.log('[TrackABuyAgent] 이미 실행 중. 중복 실행 방지.');
            return { success: false, saved: 0, skipped: 0, error: 'Already running' };
        }

        this.isRunning = true;
        const today = pickDate || getKstDate();
        console.log(`[TrackABuyAgent] ▶ 4단계 모의매매 AI 파이프라인 시작: ${today}`);

        try {
            // ── Phase 1: 후보 선별 ──────────────────────────────
            const profile = CrossPeriodAnalyzer.getInstance().getCrossPeriodProfile(80, DEFAULT_PEAKOUT_SETTINGS);
            if (!profile.success || profile.candidates.length === 0) {
                console.log('[TrackABuyAgent] CrossPeriod 후보 없음. 종료.');
                return { success: false, saved: 0, skipped: 0, error: 'No cross-period candidates' };
            }

            const categoryFiltered = profile.candidates.filter(c => BUY_CATEGORIES.includes(c.category));
            console.log(`[TrackABuyAgent] Phase1 카테고리 필터 후: ${categoryFiltered.length}개`);

            const todayOhlcv = this.loadTodayOhlcv(today);
            const { filtered: buyableListAll, skipped } = this.filterUpperLimit(categoryFiltered, todayOhlcv);

            // convictionScore 내림순 정렬 후 상위 MAX_GEMMA_POOL개로 캔선 (이미 정렬 완료됨)
            const buyableList = buyableListAll.slice(0, MAX_GEMMA_POOL);
            console.log(`[TrackABuyAgent] Phase1 상한가 제외 후: ${buyableListAll.length}개 | Gemma 투입: ${buyableList.length}개 (제외: ${skipped.length}개`);

            if (buyableList.length === 0) {
                return { success: false, saved: 0, skipped: skipped.length, error: 'All candidates filtered (upper limit)' };
            }

            // ── Phase 2: 뉴스 온디맨드 리서치 ─────────────────
            console.log(`[TrackABuyAgent] Phase2 뉴스 리서치 시작...`);
            await this.enrichCandidateNews(buyableList, today);

            // ── Phase 3: Gemma 4 종목별 심층 분석 ─────────────
            console.log(`[TrackABuyAgent] Phase3 Gemma4 종목별 분석 시작 (${buyableList.length}개)...`);
            const gemmaReports = await this.runStockResearch(buyableList, today);
            console.log(`[TrackABuyAgent] Phase3 완료: ${gemmaReports.length}개 분석됨`);

            // ── Phase 4: Gemini 최종 포트폴리오 선발 ──────────
            console.log(`[TrackABuyAgent] Phase4 Gemini 최종 선발 시작...`);
            const aiPicks = await this.runAiAnalysis(buyableList, gemmaReports, today);
            if (!aiPicks || aiPicks.length === 0) {
                console.log('[TrackABuyAgent] AI 분석 결과 없음. 종료.');
                return { success: false, saved: 0, skipped: skipped.length, error: 'AI analysis returned no picks' };
            }

            // ── 저장 ──────────────────────────────────────────
            const buyPicks = aiPicks.filter(p => p.decision === 'BUY').slice(0, TARGET_PICKS);
            const saved = this.savePicks(buyPicks, buyableList, gemmaReports, today);

            this.updateEntryPrices(today);
            console.log(`[TrackABuyAgent] ✅ 파이프라인 완료: ${saved}개 저장`);
            return { success: true, saved, skipped: skipped.length };

        } catch (err: any) {
            console.error('[TrackABuyAgent] 에러:', err);
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
            SELECT id, stock_code FROM track_a_buy_picks
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
                UPDATE track_a_buy_picks
                SET entry_price = ?,
                    current_price = ?,
                    status = 'ACTIVE',
                    entry_date = ?,
                    updated_at = ?
                WHERE id = ?
            `).run(ohlcv.close, ohlcv.close, today, new Date().toISOString(), pick.id);

            updated++;
        }

        console.log(`[TrackABuyAgent] entry_price 업데이트: ${updated}/${pendingPicks.length}개`);
        return updated;
    }

    // ─────────────────────────────────────────────────────────
    // PUBLIC: 일일 성과 채점
    // ─────────────────────────────────────────────────────────
    public scoreDailyPerformance(date?: string): { updated: number; closed: number } {
        const today = date || getKstDate();
        const rawDb = (this.db as any).db;

        const activePicks = rawDb.prepare(`
            SELECT * FROM track_a_buy_picks WHERE status = 'ACTIVE'
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
                    UPDATE track_a_buy_picks
                    SET entry_price = ?, current_price = ?, updated_at = ?
                    WHERE id = ?
                `).run(ohlcv.close, ohlcv.close, new Date().toISOString(), pick.id);
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
                    UPDATE track_a_buy_picks
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
                    UPDATE track_a_buy_picks
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

        console.log(`[TrackABuyAgent] 성과 채점: 갱신 ${updated}개, 청산 ${closed}개`);
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
                    console.log(`[TrackABuyAgent] 상한가 제외: ${c.stockName}(${c.stockCode}) +${ohlcv.change_rate.toFixed(1)}%`);
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
                console.log(`[TrackABuyAgent] Phase2 뉴스 수집: ${c.stockName} → ${articles.length}건`);

                // API Rate Limit 방어 (200ms 딜레이)
                await new Promise(r => setTimeout(r, 200));

            } catch (e: any) {
                console.warn(`[TrackABuyAgent] Phase2 뉴스 수집 실패 (${c.stockName}): ${e.message}`);
            }
        }

        console.log(`[TrackABuyAgent] Phase2 완료: ${fetched}개 종목 신규 뉴스 수집`);
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
            const guidelinePath = path.join(process.cwd(), 'guidelines', 'track_a_phase1.md');
            if (fs.existsSync(guidelinePath)) {
                guidelineContent = fs.readFileSync(guidelinePath, 'utf-8');
            }
        } catch (e) {
            console.warn('[TrackA] Failed to load guideline document:', e);
        }

        const systemPrompt = `${guidelineContent || '당신은 대한민국 코스피/코스닥 개별 종목 리서치 전담 애널리스트입니다.'}

[응답 형식] 반드시 다음 JSON 객체만 출력하십시오. 설명 없이 JSON만:
{
  "stock_code": "종목코드",
  "stock_name": "종목명",
  "market_theme_link": "[Step 1] 대장주 자격 검증 (진성 대장 여부)",
  "theme_durability": "[Step 2] 재료 지속성 평가 (모멘텀이 살아있는가)",
  "catalyst_summary": "[Step 3] 20% 추가 상승을 만들 핵심 촉매",
  "price_action_analysis": "[Step 2] 피크아웃 vs 눌림목 판별 (알고리즘 지표 해석 + 일봉 차트 종합 분석)",
  "risk_factors": "설거지/피크아웃 위험 및 주요 하방 리스크",
  "upside_probability": "HIGH|MEDIUM|LOW|VERY_LOW",
  "buy_score": 0,
  "preliminary_decision": "BUY|WATCH",
  "reasoning": "종합 판단 근거 (2~3문장)"
}`;

        const Store = require('electron-store');
        const store = new Store();
        const aiSettings = store.get('ai_settings') || {};
        const isBypass = Array.isArray(aiSettings.lightweightCloudAgents) && aiSettings.lightweightCloudAgents.some((id: string) => 'TRACK_A_GEMMA_RESEARCH'.includes(id) || 'TRACK_A_GEMMA_RESEARCH'.startsWith(id));

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

            // ── 피크아웃 감별 지표 사전 계산 (알고리즘) ──
            const peakoutSection = this.buildPeakoutIndicators(c.stockCode, date);

            const userPrompt = `[분석 대상 종목]
종목코드: ${c.stockCode}
종목명: ${c.stockName}
카테고리: ${c.category}
확신도: ${Math.round(c.convictionScore)}
관련 테마: ${c.relatedThemes.slice(0, 3).join(', ') || '없음'}

[종목 관련 최근 뉴스 (최대 5건)]
${newsSection}
${peakoutSection}
${marketContext}

위 정보를 바탕으로 이 종목의 1개월(20영업일) 내 +20% 이상 달성 가능성을 분석하십시오.`;

            try {
                const rawResponse = await AiExecutionQueue.getInstance().enqueue({
                    agentId: 'TRACK_A_GEMMA_RESEARCH',
                    agentName: `모의매매 Gemma 리서치 (${c.stockName})`,
                    triggerType: 'CRON',
                    targetType: 'local',
                    prompt: userPrompt,
                    systemInstruction: systemPrompt,
                });

                // JSON 파싱
                const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    console.warn(`[TrackABuyAgent] Phase3 JSON 파싱 실패 (${c.stockName})`);
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
                        date,
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

                console.log(`[TrackABuyAgent] Phase3 분석: ${c.stockName} → 점수:${parsed.buy_score} / ${parsed.preliminary_decision}`);

            } catch (e: any) {
                console.warn(`[TrackABuyAgent] Phase3 Gemma 호출 실패 (${c.stockName}): ${e.message}`);
                // 오류 시 기본 WATCH 처리
                const fallback: GemmaStockReport = {
                    stock_code: c.stockCode,
                    stock_name: c.stockName,
                    market_theme_link: '로컬AI 오류',
                    theme_durability: 'UNKNOWN',
                    catalyst_summary: '로컬AI 오류',
                    price_action_analysis: '로컬AI 오류',
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
            console.log(`[TrackABuyAgent] ☁️ 클라우드 전환 감지 -> ${candidates.length}개 종목 병렬 리서치 시작`);
            import('../TelegramService').then(m => m.TelegramService.getInstance().sendMessage(`[TrackA] ☁️ 클라우드 쾌속 분석 모드 (병렬 ${candidates.length}개) 작동 중...`));
            await Promise.all(candidates.map(c => processCandidate(c)));
        } else {
            console.log(`[TrackABuyAgent] 🖥️ 로컬 처리 감지 -> 순차 리서치 시작`);
            for (const c of candidates) {
                await processCandidate(c);
            }
        }

        return reports;
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE: 피크아웃 감별 지표 알고리즘 계산
    // 거래대금 추세, 연속 음봉, 고점 낙폭을 사전 계산 → Gemma 부담 경감
    // ─────────────────────────────────────────────────────────
    private buildPeakoutIndicators(stockCode: string, date: string): string {
        const rawDb = (this.db as any).db;
        try {
            // 최근 30 영업일 일봉 조회 (내림차순)
            const rows: any[] = rawDb.prepare(`
                SELECT date, open, high, low, close, trading_value
                FROM market_ohlcv_history
                WHERE stock_code = ? AND date <= ?
                ORDER BY date DESC
                LIMIT 30
            `).all(stockCode, date);

            if (!rows || rows.length < 5) return '';

            // 오름차순 정렬 (과거 → 현재)
            const daily = [...rows].reverse();
            const latest = daily[daily.length - 1];

            // ① 거래대금 추세: 최근 5일 평균 vs 직전 5일 평균
            const recent5 = daily.slice(-5);
            const prev5 = daily.slice(-10, -5);
            const recentAvg = recent5.reduce((s, r) => s + (r.trading_value || 0), 0) / recent5.length;
            const prevAvg = prev5.length > 0
                ? prev5.reduce((s, r) => s + (r.trading_value || 0), 0) / prev5.length
                : recentAvg;
            const tvChangeRate = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg) * 100 : 0;

            // ② 연속 음봉 카운트 (최신부터 역순, 음봉 = 종가 < 시가)
            let consecutiveRed = 0;
            for (let i = daily.length - 1; i >= 0; i--) {
                if (daily[i].close < daily[i].open) {
                    consecutiveRed++;
                } else {
                    break;
                }
            }

            // ③ 최근 30일 고점 대비 현재 낙폭
            const highRow = daily.reduce((max, r) => r.high > max.high ? r : max, daily[0]);
            const drawdown = highRow.high > 0
                ? ((latest.close - highRow.high) / highRow.high) * 100
                : 0;

            // ④ 피크아웃 의심 플래그 판정
            const volumeDecreasing = tvChangeRate <= -20;
            const hasConsecutiveRed = consecutiveRed >= 3;
            const significantDrawdown = drawdown <= -10;
            const flagCount = [volumeDecreasing, hasConsecutiveRed, significantDrawdown].filter(Boolean).length;
            const riskLevel = flagCount >= 3 ? 'HIGH' : flagCount >= 2 ? 'MEDIUM' : 'LOW';

            const recentAvgBil = Math.round(recentAvg / 100000000);
            const prevAvgBil = Math.round(prevAvg / 100000000);

            let text = `\n[📊 알고리즘 사전 계산 결과 (피크아웃 감별 지표)]\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            text += `① 거래대금 추세:\n`;
            text += `   - 최근 5일 평균: ${recentAvgBil}억 | 직전 5일 평균: ${prevAvgBil}억\n`;
            text += `   - 변화율: ${tvChangeRate >= 0 ? '▲' : '▼'} ${Math.abs(tvChangeRate).toFixed(1)}% (${tvChangeRate >= 0 ? '증가' : '감소'})\n`;
            text += `② 연속 음봉: ${consecutiveRed}일 연속 (종가 < 시가 기준)\n`;
            text += `③ 최근 30일 고점(${highRow.date}, ${highRow.high}원) 대비 현재 낙폭: ${drawdown >= 0 ? '▲' : '▼'} ${Math.abs(drawdown).toFixed(1)}%\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            text += `⚠️ 피크아웃 의심도: ${riskLevel === 'HIGH' ? '🔴 높음' : riskLevel === 'MEDIUM' ? '🟡 중간' : '🟢 낮음'} (${flagCount}/3 조건 충족)\n`;
            text += `   ${volumeDecreasing ? '✅' : '❌'} 거래대금 20% 이상 감소\n`;
            text += `   ${hasConsecutiveRed ? '✅' : '❌'} 연속 음봉 3일 이상\n`;
            text += `   ${significantDrawdown ? '✅' : '❌'} 고점 대비 낙폭 10% 이상\n`;

            // 최근 25일 일봉 원본 테이블 (AI 맥락 해석용)
            const recent25 = daily.slice(-25);
            text += `\n[📈 최근 ${recent25.length}일 일봉 원본 데이터]\n`;
            text += `날짜 | 시가 | 고가 | 저가 | 종가 | 등락 | 거래대금(억)\n`;
            text += `---|---|---|---|---|---|---\n`;
            for (const r of recent25) {
                const tv = Math.round((r.trading_value || 0) / 100000000);
                const candle = r.close >= r.open ? '양봉↑' : '음봉↓';
                text += `${r.date} | ${r.open} | ${r.high} | ${r.low} | ${r.close} | ${candle} | ${tv}억\n`;
            }
            text += `\n`;

            return text;
        } catch (err: any) {
            console.warn(`[TrackABuyAgent] buildPeakoutIndicators 실패 (${stockCode}): ${err.message}`);
            return '';
        }
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

        // 시황 리스크 점수 로딩 & Null 폴백 세이프티 가드
        const { IssueLedgerDB } = await import('./IssueLedgerDB');
        const briefing = IssueLedgerDB.getInstance().getLatestBriefing();
        const riskScore = briefing ? briefing.risk_score : 30;
        const cutoffConfig = getDynamicCutoffConfig(riskScore);

        console.log(`[TrackABuyAgent] ⚖️ 동적 컷오프 적용: 리스크 ${riskScore}점 -> ${cutoffConfig.description}`);

        // Gemma 점수 컷오프 적용 (시황 리스크에 맞춰 격상됨)
        const eligibleCandidates = candidates.filter(c => {
            const r = reportMap.get(c.stockCode);
            return !r || (r.buy_score >= cutoffConfig.gemmaMinScore);
        });

        console.log(`[TrackABuyAgent] Phase4 대상: ${eligibleCandidates.length}개 (Gemma 1차 컷오프 ${cutoffConfig.gemmaMinScore}점 미만 제외)`);

        // 테마 밀집도(Tally) 산출
        const themeTally = new Map<string, number>();
        eligibleCandidates.forEach(c => {
            if (c.relatedThemes && c.relatedThemes.length > 0) {
                // 핵심 테마 1~2개 정도만 반영
                c.relatedThemes.slice(0, 2).forEach(t => {
                    themeTally.set(t, (themeTally.get(t) || 0) + 1);
                });
            }
        });

        const sortedThemes = Array.from(themeTally.entries())
            .filter(([, count]) => count > 1) // 2개 이상인 테마만 표시
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        let themeDensityText = '';
        if (sortedThemes.length > 0) {
            themeDensityText = `[현재 시장 진성 대장주 섹터 밀집도 현황]\n` +
                sortedThemes.map((t, idx) => `${['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][idx] || '-'} ${t[0]} (${t[1]}개)`).join('\n') +
                `\n*제공된 리스트는 살아남은 진성 대장주들의 전체 목록입니다.\n최종 종목을 추천할 때 위의 대장주 섹터 밀집도(주도 테마 순위) 현황을 적극 참고하여 제안하십시오.*\n\n`;
        }

        const { ChunkUtils } = await import('../utils/ChunkUtils');
        const chunks = ChunkUtils.createBalancedChunks(eligibleCandidates, 15);
        const allPicks: AiBuyPick[] = [];

        // 2차 가이드라인 로드
        let phase2Guideline = '';
        try {
            const guidelinePath = path.join(process.cwd(), 'guidelines', 'track_a_phase2.md');
            if (fs.existsSync(guidelinePath)) {
                phase2Guideline = fs.readFileSync(guidelinePath, 'utf-8');
            }
        } catch (e) {
            console.warn('[TrackA] Failed to load phase2 guideline:', e);
        }

        const systemInstruction = `당신은 대한민국 코스피/코스닥 알파 수익률 전문 투자심의위원회 위원장입니다.
Gemma AI가 종목별로 작성한 팩트시트와 1차 판단을 검토하여 최종 Top ${TARGET_PICKS}개를 선발합니다.

${phase2Guideline || '[추가 판단 기준]\n1. 촉매 타이밍\n2. 포트폴리오 분산\n3. 리스크 필터링'}

[최종 BUY 판정 커트라인]
오늘의 시장 리스크 점수는 ${riskScore}/100 점입니다.
따라서 오늘 최종 'BUY' 판정을 내리기 위한 종합 합격 점수 커트라인은 **${cutoffConfig.geminiPassScore}점 이상**입니다.
- 팩트시트를 검토하여 이 기준 점수를 넘지 못하는 종목은 고민하지 말고 무조건 'decision': 'WATCH'로 분류하십시오.
- 모든 후보 종목이 커트라인에 미달할 경우, 단 하나의 종목도 BUY로 추천하지 않고 전부 WATCH로 처리(0개 추천)하는 것이 올바른 결정입니다.

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

        await Promise.all(chunks.map(async (chunkCandidates, chunkIndex) => {
            const factSheets = chunkCandidates.map((c, i) => {
                const r = reportMap.get(c.stockCode);
                if (!r) {
                    return `${i + 1}. [${c.stockCode}] ${c.stockName} | ${c.category} | Gemma 분석 없음`;
                }
                return `${i + 1}. [${c.stockCode}] ${c.stockName} | ${c.category} | 확신도:${Math.round(c.convictionScore)}
   Gemma 점수: ${r.buy_score} / 상승확률: ${r.upside_probability} / 1차판단: ${r.preliminary_decision}
   테마 연관: ${r.market_theme_link}
   핵심 호재: ${r.catalyst_summary}
   [차트/피크아웃 분석]: ${r.price_action_analysis || 'Gemma 피크아웃 분석 누락'}
   리스크: ${r.risk_factors}
   근거: ${r.reasoning}`;
            }).join('\n\n');

            const userPrompt = `[오늘 날짜: ${date}]
[분석 대상: ${chunkCandidates.length}개 진성 대장주 종목 (그룹 ${chunkIndex + 1}/${chunks.length})]

${themeDensityText}${factSheets}

---
위 팩트시트를 기반으로 1개월(20영업일) 내 +20% 이상 달성 가능성 기준으로
최종 Top ${TARGET_PICKS}개를 BUY로 선정하고, 나머지는 WATCH로 처리하십시오.`;

            try {
                const result = await AiExecutionQueue.getInstance().enqueue({
                    agentId: 'TRACK_A_BUY_AGENT',
                    agentName: `모의매매 매수 선정 AI (그룹 ${chunkIndex + 1})`,
                    triggerType: 'CRON',
                    prompt: userPrompt,
                    systemInstruction,
                });

                if (!result) {
                    console.error(`[TrackABuyAgent] Phase4 AI 응답 없음 (그룹 ${chunkIndex + 1})`);
                    return;
                }

                const jsonMatch = result.match(/\[[\s\S]*\]/);
                if (!jsonMatch) {
                    console.error(`[TrackABuyAgent] Phase4 JSON 추출 실패 (그룹 ${chunkIndex + 1}):`, result.slice(0, 200));
                    return;
                }

                const picks: AiBuyPick[] = JSON.parse(jsonMatch[0]);
                allPicks.push(...picks);

            } catch (err: any) {
                console.error(`[TrackABuyAgent] Phase4 AI 분석 오류 (그룹 ${chunkIndex + 1}):`, err.message);
            }
        }));

        console.log(`[TrackABuyAgent] Phase4 통합 결과: BUY ${allPicks.filter(p => p.decision === 'BUY').length}개, WATCH ${allPicks.filter(p => p.decision === 'WATCH').length}개`);

        // 최종 2차 코드 세이프티 필터: Gemini가 지침을 위반하고 합격선 미달인 종목에 BUY 판정을 내린 경우 기계적으로 WATCH로 격하 처리
        const filteredPicks = allPicks.map(p => {
            if (p.decision === 'BUY' && p.buy_score < cutoffConfig.geminiPassScore) {
                console.log(`[TrackABuyAgent] 🚨 AI 오작동 필터링: ${p.stock_name}(${p.stock_code}) 점수 ${p.buy_score}점이 합격선 ${cutoffConfig.geminiPassScore}점 미만이므로 WATCH로 격하 처리.`);
                return { ...p, decision: 'WATCH' as const };
            }
            return p;
        });

        return filteredPicks;
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
            INSERT OR IGNORE INTO track_a_buy_picks (
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
                console.error(`[TrackABuyAgent] 저장 실패 (${pick.stock_code}):`, e.message);
            }
        }

        return saved;
    }
}
