/**
 * TrackBBuyAgent
 * ─────────────────────────────────────────────────────────────────
 * [역할] 모의매매 AI 매수 후보 선정 에이전트
 *
 * [실행 트리거]
 *   - SchedulerService → 15:05 CRON (전 종목 수집 완료 직후)
 *   - 수동 IPC: 'track-b:run-buy-agent'
 *
 * [데이터 흐름]
 *   CrossPeriodAnalyzer.getCrossPeriodProfile()
 *   → 매수 후보 필터링 (카테고리 + 상한가 제외)
 *   → 뉴스/테마 컨텍스트 조립 (기존 DB 조회 + 없으면 WATCH)
 *   → AiExecutionQueue → Gemini 배치 분석
 *   → track_b_buy_picks 저장 (PENDING 상태)
 *   → 15:30 장 마감 후 entry_price = 당일 종가로 자동 업데이트 (ACTIVE)
 *
 * [필터 규칙]
 *   매수 대상: EMERGING_STAR, PULLBACK_REBOUND, PULLBACK_DIP
 *   제외 조건:
 *     1. 상한가 종목 (당일 high == close AND changeRate >= 29.5%)
 *     2. 당일 이미 pick된 종목 (UNIQUE 제약)
 *   목표: Top 10 선정, 5영업일 보유, +15% 목표수익
 */

import { DatabaseService } from '../DatabaseService';
import { CrossPeriodAnalyzer, CrossPeriodCandidate } from '../v2_pipeline/CrossPeriodAnalyzer';
import { AiExecutionQueue } from '../AiExecutionQueue';
import { DEFAULT_PEAKOUT_SETTINGS } from '../v2_pipeline/MarketLeaderDiscoveryService';
import { getKstDate } from '../../utils/DateUtils';

// ── 상수 ───────────────────────────────────────────────────────
const BUY_CATEGORIES = ['EMERGING_STAR', 'PULLBACK_REBOUND', 'PULLBACK_DIP'];
const TARGET_PICKS = 10;
const TARGET_DAYS = 5;
const TARGET_RETURN_PCT = 15.0;

// 상한가 임계값 (코스피/코스닥 공통 30%)
const UPPER_LIMIT_THRESHOLD = 29.5;

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
    change_rate: number; // ((close - prev_close) / prev_close) * 100
}

// ──────────────────────────────────────────────────────────────
export class TrackBBuyAgent {
    private static instance: TrackBBuyAgent;
    private db: DatabaseService;
    private isRunning = false;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): TrackBBuyAgent {
        if (!TrackBBuyAgent.instance) {
            TrackBBuyAgent.instance = new TrackBBuyAgent();
        }
        return TrackBBuyAgent.instance;
    }

    // ─────────────────────────────────────────────────────────
    // PUBLIC: 메인 실행 진입점
    // ─────────────────────────────────────────────────────────
    public async run(pickDate?: string): Promise<{ success: boolean; saved: number; skipped: number; error?: string }> {
        if (this.isRunning) {
            console.log('[TrackBBuyAgent] 이미 실행 중. 중복 실행 방지.');
            return { success: false, saved: 0, skipped: 0, error: 'Already running' };
        }

        this.isRunning = true;
        const today = pickDate || getKstDate();
        console.log(`[TrackBBuyAgent] 모의매매 AI 분석 시작: ${today}`);

        try {
            // ① CrossPeriodAnalyzer에서 전체 후보 조회
            const profile = CrossPeriodAnalyzer.getInstance().getCrossPeriodProfile(80, DEFAULT_PEAKOUT_SETTINGS);
            if (!profile.success || profile.candidates.length === 0) {
                console.log('[TrackBBuyAgent] CrossPeriod 후보 없음. 종료.');
                return { success: false, saved: 0, skipped: 0, error: 'No cross-period candidates' };
            }

            // ② 매수 후보 카테고리 필터링
            const categoryFiltered = profile.candidates.filter(
                c => BUY_CATEGORIES.includes(c.category)
            );
            console.log(`[TrackBBuyAgent] 카테고리 필터 후: ${categoryFiltered.length}개 (${BUY_CATEGORIES.join(', ')})`);

            // ③ 상한가 종목 제외
            const todayOhlcv = this.loadTodayOhlcv(today);
            const { filtered: buyableList, skipped } = this.filterUpperLimit(categoryFiltered, todayOhlcv);
            console.log(`[TrackBBuyAgent] 상한가 제외 후: ${buyableList.length}개 (제외: ${skipped.length}개 → ${skipped.map(s => s.stockName).join(', ')})`);

            if (buyableList.length === 0) {
                console.log('[TrackBBuyAgent] 매수 가능한 후보 없음. 종료.');
                return { success: false, saved: 0, skipped: skipped.length, error: 'All candidates filtered (upper limit)' };
            }

            // ④ 테마/뉴스 컨텍스트 조립
            const context = this.buildContext(buyableList, today);

            // ⑤ AI 배치 분석 (AiExecutionQueue 필수)
            const aiPicks = await this.runAiAnalysis(buyableList, context, today);
            if (!aiPicks || aiPicks.length === 0) {
                console.log('[TrackBBuyAgent] AI 분석 결과 없음. 종료.');
                return { success: false, saved: 0, skipped: skipped.length, error: 'AI analysis returned no picks' };
            }

            // ⑥ TOP 10만 DB 저장 (PENDING 상태, entry_price는 장 마감 후 업데이트)
            const buyPicks = aiPicks.filter(p => p.decision === 'BUY').slice(0, TARGET_PICKS);
            const saved = this.savePicks(buyPicks, buyableList, today);

            console.log(`[TrackBBuyAgent] 완료: ${saved}개 저장, 상한가 제외 ${skipped.length}개`);
            return { success: true, saved, skipped: skipped.length };

        } catch (err: any) {
            console.error('[TrackBBuyAgent] 에러:', err);
            return { success: false, saved: 0, skipped: 0, error: err.message };
        } finally {
            this.isRunning = false;
        }
    }

    // ─────────────────────────────────────────────────────────
    // PUBLIC: 장 마감 후 entry_price 업데이트 (15:30 이후 실행)
    // PENDING → ACTIVE, entry_price = 당일 종가
    // ─────────────────────────────────────────────────────────
    public updateEntryPrices(date?: string): number {
        const today = date || getKstDate();
        const rawDb = (this.db as any).db;

        // PENDING 상태 + 오늘 날짜 종목 조회
        const pendingPicks = rawDb.prepare(`
            SELECT id, stock_code FROM track_b_buy_picks
            WHERE pick_date = ? AND status = 'PENDING'
        `).all(today) as { id: number; stock_code: string }[];

        if (pendingPicks.length === 0) return 0;

        let updated = 0;
        for (const pick of pendingPicks) {
            // 오늘 종가 조회 (market_ohlcv_history)
            const ohlcv = rawDb.prepare(`
                SELECT close FROM market_ohlcv_history
                WHERE stock_code = ? AND date = ?
            `).get(pick.stock_code, today) as { close: number } | undefined;

            if (!ohlcv || !ohlcv.close) continue;

            rawDb.prepare(`
                UPDATE track_b_buy_picks
                SET entry_price = ?,
                    current_price = ?,
                    status = 'ACTIVE',
                    entry_date = ?,
                    updated_at = ?
                WHERE id = ?
            `).run(ohlcv.close, ohlcv.close, today, new Date().toISOString(), pick.id);

            updated++;
        }

        console.log(`[TrackBBuyAgent] entry_price 업데이트: ${updated}/${pendingPicks.length}개`);
        return updated;
    }

    // ─────────────────────────────────────────────────────────
    // PUBLIC: 일일 성과 채점 (PortfolioJudgeScheduler에서 호출)
    // ACTIVE 종목의 current_price, peak_return, holding_days 갱신
    // 5영업일 경과 → CLOSED + 최종 수익률 산출
    // ─────────────────────────────────────────────────────────
    public scoreDailyPerformance(date?: string): { updated: number; closed: number } {
        const today = date || getKstDate();
        const rawDb = (this.db as any).db;

        const activePicks = rawDb.prepare(`
            SELECT * FROM track_b_buy_picks WHERE status = 'ACTIVE'
        `).all() as any[];

        let updated = 0;
        let closed = 0;

        for (const pick of activePicks) {
            const ohlcv = rawDb.prepare(`
                SELECT close FROM market_ohlcv_history
                WHERE stock_code = ? AND date = ?
            `).get(pick.stock_code, today) as { close: number } | undefined;

            if (!ohlcv || !ohlcv.close || pick.entry_price <= 0) continue;

            const currentReturn = ((ohlcv.close - pick.entry_price) / pick.entry_price) * 100;
            const newPeakReturn = Math.max(pick.peak_return ?? currentReturn, currentReturn);
            const newHoldingDays = pick.holding_days + 1;

            if (newHoldingDays >= pick.target_days) {
                // 5영업일 경과 → 청산
                const result = currentReturn >= pick.target_return_pct
                    ? 'HIT'
                    : currentReturn >= 0 ? 'PARTIAL' : 'LOSS';

                rawDb.prepare(`
                    UPDATE track_b_buy_picks
                    SET current_price = ?,
                        exit_price = ?,
                        holding_days = ?,
                        peak_return = ?,
                        final_return = ?,
                        status = 'CLOSED',
                        result = ?,
                        exit_date = ?,
                        updated_at = ?
                    WHERE id = ?
                `).run(
                    ohlcv.close, ohlcv.close, newHoldingDays,
                    newPeakReturn, currentReturn, result,
                    today, new Date().toISOString(), pick.id
                );
                closed++;
            } else {
                // 진행 중 갱신
                rawDb.prepare(`
                    UPDATE track_b_buy_picks
                    SET current_price = ?,
                        holding_days = ?,
                        peak_return = ?,
                        updated_at = ?
                    WHERE id = ?
                `).run(
                    ohlcv.close, newHoldingDays,
                    newPeakReturn, new Date().toISOString(), pick.id
                );
                updated++;
            }
        }

        console.log(`[TrackBBuyAgent] 성과 채점: 갱신 ${updated}개, 청산 ${closed}개`);
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
    // 상한가 조건: changeRate >= 29.5% (실제 장중 데이터 기반)
    // 동시호가 주문을 미리 넣는 모의매매 특성상,
    // 상한가 마감 종목은 체결 불가능하므로 제외
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
                    ohlcv.high === ohlcv.close; // 종가 = 고가: 상한가에 마감

                if (isUpperLimit) {
                    console.log(`[TrackBBuyAgent] 상한가 제외: ${c.stockName}(${c.stockCode}) +${ohlcv.change_rate.toFixed(1)}%`);
                    skipped.push(c);
                    continue;
                }
            }
            // OHLCV 데이터 없으면 일단 포함 (장 마감 전 15:05 기준이므로)
            filtered.push(c);
        }

        return { filtered, skipped };
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE: 컨텍스트 조립
    // 기존 DB의 테마/뉴스 데이터를 조회, 없으면 빈 컨텍스트
    // ─────────────────────────────────────────────────────────
    private buildContext(candidates: CrossPeriodCandidate[], date: string): string {
        const rawDb = (this.db as any).db;

        const contextLines: string[] = [];

        for (const c of candidates) {
            const themes = c.relatedThemes.slice(0, 3).join(', ') || '테마 정보 없음';

            // 최근 뉴스 조회 (naver_news_flow)
            const news: any[] = rawDb.prepare(`
                SELECT title FROM naver_news_flow
                WHERE (search_keyword IN (${c.relatedThemes.slice(0, 2).map(() => '?').join(',')})
                    OR title LIKE ?)
                AND date >= date(?, '-3 days')
                ORDER BY collected_at DESC
                LIMIT 2
            `).all(
                ...c.relatedThemes.slice(0, 2),
                `%${c.stockName}%`,
                date
            );

            const newsText = news.length > 0
                ? news.map((n: any) => n.title).join(' | ')
                : '관련 뉴스 없음';

            // 테마 인텔리전스 조회
            let themeStatus = '테마 AI 분석 없음';
            const topThemes = c.relatedThemes.slice(0, 2);
            if (topThemes.length > 0) {
                try {
                    const placeholders = topThemes.map(() => '?').join(',');
                    const themeIntel: any = rawDb.prepare(`
                        SELECT reason, lifespan_type FROM theme_intelligence
                        WHERE name IN (${placeholders})
                        ORDER BY date DESC, created_at DESC LIMIT 1
                    `).get(...topThemes);

                    if (themeIntel) {
                        themeStatus = `테마 국면: ${themeIntel.lifespan_type ?? 'N/A'} / ${themeIntel.reason?.slice(0, 50) ?? ''}`;
                    }
                } catch (e) {
                    // fall through
                }
            }

            contextLines.push(
                `[${c.stockCode}] ${c.stockName} | 카테고리: ${c.category} | 확신도: ${Math.round(c.convictionScore)} | 테마: ${themes} | ${themeStatus} | 뉴스: ${newsText}`
            );
        }

        return contextLines.join('\n');
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE: AI 배치 분석 (AiExecutionQueue 경유 필수)
    // ─────────────────────────────────────────────────────────
    private async runAiAnalysis(
        candidates: CrossPeriodCandidate[],
        context: string,
        date: string
    ): Promise<AiBuyPick[]> {
        const systemInstruction = `당신은 대한민국 코스피/코스닥 알파 수익률 전문 AI 트레이더입니다.
오늘(${date}) 장 마감 직후 제공된 주도주 후보 리스트에서,
향후 5영업일(1주일) 내 +15% 이상 수익률 달성 가능성이 높은 Top 10 종목을 엄선해야 합니다.

[분석 기준]
1. 테마 지속성: 해당 테마/이슈가 최소 5영업일 이상 지속될 수 있는가?
2. 카테고리 우선순위: PULLBACK_REBOUND > PULLBACK_DIP > EMERGING_STAR 순으로 안전 마진 고려
3. 뉴스/이슈 신선도: 오래된 뉴스보다 당일 또는 2~3일 내 신규 이슈 우선
4. 이미 상승 과열된 종목은 제외 (오늘 급등 후 추격 불가 판단)
5. 정보가 부족하면 WATCH 처리하여 BUY를 무리하게 늘리지 말 것

[응답 형식] 반드시 다음 JSON 배열만 출력하십시오. 설명 없이 JSON만:
[
  {
    "stock_code": "005930",
    "stock_name": "삼성전자",
    "rank": 1,
    "buy_score": 85,
    "decision": "BUY",
    "reason": "2줄 이내 추천 근거",
    "risk": "1줄 리스크 경고",
    "theme_lifespan": "MEDIUM"
  },
  ...
]
decision: "BUY" | "WATCH"
theme_lifespan: "SHORT"(3일 미만) | "MEDIUM"(1~2주) | "LONG"(1달+) | "UNKNOWN"`;

        const userPrompt = `[오늘 날짜: ${date}]
[매수 후보 종목 리스트: ${candidates.length}개]
${context}

위 종목 중 5영업일 내 +15% 달성 가능성 기준으로 Top ${TARGET_PICKS}개를 BUY로 선정하고, 나머지는 WATCH로 처리하십시오.`;

        try {
            const result = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'TRACK_B_BUY_AGENT',
                agentName: '모의매매 매수 선정 AI',
                triggerType: 'CRON',
                prompt: userPrompt,
                systemInstruction,
            });

            if (!result) {
                console.error('[TrackBBuyAgent] AI 응답 없음');
                return [];
            }

            // JSON 파싱
            const jsonMatch = result.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                console.error('[TrackBBuyAgent] AI 응답에서 JSON 추출 실패:', result.slice(0, 200));
                return [];
            }

            const picks: AiBuyPick[] = JSON.parse(jsonMatch[0]);
            console.log(`[TrackBBuyAgent] AI 응답: BUY ${picks.filter(p => p.decision === 'BUY').length}개, WATCH ${picks.filter(p => p.decision === 'WATCH').length}개`);
            return picks;

        } catch (err: any) {
            console.error('[TrackBBuyAgent] AI 분석 오류:', err.message);
            return [];
        }
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE: DB 저장
    // ─────────────────────────────────────────────────────────
    private savePicks(aiPicks: AiBuyPick[], candidates: CrossPeriodCandidate[], date: string): number {
        const rawDb = (this.db as any).db;
        const now = new Date().toISOString();
        const candidateMap = new Map(candidates.map(c => [c.stockCode, c]));

        let saved = 0;

        const insertStmt = rawDb.prepare(`
            INSERT OR IGNORE INTO track_b_buy_picks (
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

            try {
                const info = insertStmt.run(
                    date,
                    pick.rank,
                    pick.stock_code,
                    pick.stock_name,
                    candidate.category,
                    candidate.signals.length > 0 ? JSON.stringify(candidate.signals) : null,
                    pick.buy_score,
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
                console.error(`[TrackBBuyAgent] 저장 실패 (${pick.stock_code}):`, e.message);
            }
        }

        return saved;
    }
}
