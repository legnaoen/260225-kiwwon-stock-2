/**
 * PortfolioRetrospectiveAgent
 *
 * 성적표(maiis_portfolio, was_held=1) 기반으로 PM1/PM2 알고리즘 개선안을 AI가 자동 작성하는 에이전트.
 *
 * 3단계 실행:
 *   Phase A: 데이터 수집 → TradeCaseCard[] + AggregatedStats 구조화
 *   Phase B: 3-Step AI 분석 (개별진단 → 패턴종합 → PM 개선안)
 *   Phase C: 결과 DB 저장
 */

import { DatabaseService } from '../DatabaseService';
import { AiExecutionQueue } from '../AiExecutionQueue';

// ─── 타입 정의 ────────────────────────────────────────────────────────────────

interface TradeCaseCard {
    stock_code: string;
    stock_name: string;
    strategy: string;
    original_analysts: string[];
    original_reasons: string[];
    pm2_buy_reason: string;
    pm2_conviction_at_buy: number;
    entry_date: string;
    entry_price: number;
    exit_date: string;
    exit_price: number;
    holding_days: number;
    planned_lifespan: number;
    final_return_pct: number;
    peak_return_pct: number;
    trough_return_pct: number;
    exit_reason: string;
    outcome: 'BIG_WIN' | 'SMALL_WIN' | 'BREAKEVEN' | 'SMALL_LOSS' | 'BIG_LOSS';
    related_themes: string[];
    entry_vs_ma5_pct: number;
    entry_vs_ma20_pct: number;
}

interface AggregatedStats {
    total_trades: number;
    win_count: number;
    win_rate: number;
    avg_return: number;
    avg_holding_days: number;
    avg_peak_return: number;
    by_strategy: Record<string, { count: number; win_rate: number; avg_return: number; best_trade: string; worst_trade: string }>;
    by_analyst: Record<string, { count: number; win_rate: number; avg_return: number }>;
    high_disparity_entries: { count: number; avg_return: number; win_rate: number };
    low_disparity_entries: { count: number; avg_return: number; win_rate: number };
    missed_profit_trades: { count: number; avg_peak: number; avg_final: number; examples: string[] };
    outcome_distribution: Record<string, number>;
}

// ─── 메인 에이전트 ─────────────────────────────────────────────────────────────

export class PortfolioRetrospectiveAgent {
    private static instance: PortfolioRetrospectiveAgent;
    private db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): PortfolioRetrospectiveAgent {
        if (!PortfolioRetrospectiveAgent.instance) {
            PortfolioRetrospectiveAgent.instance = new PortfolioRetrospectiveAgent();
        }
        return PortfolioRetrospectiveAgent.instance;
    }

    /**
     * 메인 실행 진입점
     * @returns 분석 리포트 요약 또는 에러
     */
    public async run(): Promise<{ success: boolean; reportId?: number; totalTrades?: number; error?: string }> {
        console.log('[PortfolioRetrospectiveAgent] 실행 시작...');

        // ── Phase A: 데이터 수집 & 카드 구조화 ──
        let cards: TradeCaseCard[];
        let stats: AggregatedStats;
        try {
            cards = await this.buildTradeCaseCards();
            console.log(`[PortfolioRetrospectiveAgent] TradeCaseCard ${cards.length}건 구조화 완료`);

            if (cards.length < 5) {
                return { success: false, error: `분석 가능한 매매 이력이 부족합니다. (현재 ${cards.length}건, 최소 5건 필요)` };
            }

            stats = this.computeAggregatedStats(cards);
            console.log(`[PortfolioRetrospectiveAgent] 집계 통계 계산 완료 (승률: ${stats.win_rate.toFixed(1)}%)`);
        } catch (e: any) {
            return { success: false, error: `데이터 수집 실패: ${e.message}` };
        }

        // ── Phase B: 3-Step AI 분석 ──
        let step1Result = '';
        let step2Result = '';
        let step3Result = '';
        try {
            step1Result = await this.runStep1_IndividualDiagnosis(cards);
            step2Result = await this.runStep2_PatternAnalysis(step1Result, stats);
            step3Result = await this.runStep3_ImprovementReport(step2Result, stats);
        } catch (e: any) {
            return { success: false, error: `AI 분석 실패: ${e.message}` };
        }

        // ── Phase C: 결과 파싱 & DB 저장 ──
        try {
            const diagnoses = this.safeParseJson(step1Result, 'diagnoses');
            const patterns = this.safeParseJson(step2Result, 'patterns');
            const improvements = this.safeParseJson(step3Result, 'improvements');

            const reportId = this.db.saveRetrospectiveReport({
                created_date: this.db.getKstDate(),
                total_trades: stats.total_trades,
                win_rate: stats.win_rate,
                avg_return: stats.avg_return,
                diagnoses_json: JSON.stringify(diagnoses.diagnoses || []),
                failure_patterns_json: JSON.stringify(patterns.failure_patterns || []),
                success_patterns_json: JSON.stringify(patterns.success_patterns || []),
                pm1_improvements_json: JSON.stringify(improvements.pm1_improvements || []),
                pm2_improvements_json: JSON.stringify(improvements.pm2_prompt_improvements || []),
                sell_improvements_json: JSON.stringify(improvements.sell_logic_improvements || []),
                aggregated_stats_json: JSON.stringify(stats),
                raw_ai_step1: step1Result,
                raw_ai_step2: step2Result,
                raw_ai_step3: step3Result,
            });

            console.log(`[PortfolioRetrospectiveAgent] 분석 완료. 리포트 ID: ${reportId}`);
            return { success: true, reportId, totalTrades: stats.total_trades };
        } catch (e: any) {
            return { success: false, error: `결과 저장 실패: ${e.message}` };
        }
    }

    // ─── Phase A: 데이터 수집 ────────────────────────────────────────────────────

    private async buildTradeCaseCards(): Promise<TradeCaseCard[]> {
        // 매도 완료된 종목(성적표) 조회 — was_held=1인 DROPPED/HIT만 대상
        const historyRows = this.db.getPortfolioHistory() as any[];

        const cards: TradeCaseCard[] = [];

        for (const row of historyRows) {
            try {
                const entryDate = row.entry_date || row.created_at?.substring(0, 10) || '';
                const exitDate = row.updated_at?.substring(0, 10) || '';
                const entryPrice = Number(row.entry_price) || 0;
                const exitPrice = Number(row.current_price) || entryPrice;
                const finalReturn = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : Number(row.profit_rate) || 0;

                // OHLCV에서 peak/trough + MA 이격도 계산
                const ohlcvData = (entryDate && exitDate && entryPrice > 0)
                    ? this.db.getHistoricalPeakTrough(row.stock_code, entryDate, exitDate, entryPrice)
                    : { peak_return_pct: 0, trough_return_pct: 0, entry_vs_ma5_pct: 0, entry_vs_ma20_pct: 0 };

                // 이벤트 로그에서 BUY_UPGRADED 시점 이유 조회
                const eventLogs = this.db.getPortfolioEventLogs(row.stock_code) as any[];
                const buyEvent = eventLogs.find((e: any) => e.event_type === 'BUY_UPGRADED' || e.new_status === 'HELD');
                const pm2BuyReason = buyEvent?.reason || row.last_signal_reason || '';

                // 원래 추천 근거 조회 — getAnalystPicksForStock 메서드가 없으면 빈 배열로 처리
                const analystPicks: any[] = (this.db as any).getAnalystPicksForStock
                    ? (this.db as any).getAnalystPicksForStock(row.stock_code, entryDate || undefined)
                    : [];

                const originalAnalysts = analystPicks.map((p: any) => p.agent_type);
                const originalReasons = analystPicks.map((p: any) => p.reason || '');

                // 테마 파싱
                let relatedThemes: string[] = [];
                try {
                    const tags = typeof row.analysts_json === 'string' ? JSON.parse(row.analysts_json) : (row.analysts_json || []);
                    if (Array.isArray(tags)) relatedThemes = tags;
                } catch {}
                if (row.theme) relatedThemes.push(row.theme);

                const card: TradeCaseCard = {
                    stock_code: row.stock_code,
                    stock_name: row.stock_name,
                    strategy: row.strategy || 'SWING',
                    original_analysts: originalAnalysts,
                    original_reasons: originalReasons,
                    pm2_buy_reason: pm2BuyReason,
                    pm2_conviction_at_buy: Number(row.conviction_score) || 0,
                    entry_date: entryDate,
                    entry_price: entryPrice,
                    exit_date: exitDate,
                    exit_price: exitPrice,
                    holding_days: Number(row.days_held) || 0,
                    planned_lifespan: Number(row.lifespan_days) || 20,
                    final_return_pct: finalReturn,
                    peak_return_pct: ohlcvData.peak_return_pct,
                    trough_return_pct: ohlcvData.trough_return_pct,
                    exit_reason: row.last_signal_reason || '',
                    outcome: this.classifyOutcome(ohlcvData.peak_return_pct, finalReturn),
                    related_themes: [...new Set(relatedThemes)],
                    entry_vs_ma5_pct: ohlcvData.entry_vs_ma5_pct,
                    entry_vs_ma20_pct: ohlcvData.entry_vs_ma20_pct,
                };

                cards.push(card);
            } catch (e: any) {
                console.error(`[PortfolioRetrospectiveAgent] 카드 생성 오류 (${row.stock_name}):`, e.message);
            }
        }

        return cards;
    }

    private classifyOutcome(peakReturn: number, finalReturn: number): TradeCaseCard['outcome'] {
        if (peakReturn >= 20) return 'BIG_WIN';
        if (peakReturn >= 5) return 'SMALL_WIN';
        if (finalReturn >= -2) return 'BREAKEVEN';
        if (finalReturn >= -10) return 'SMALL_LOSS';
        return 'BIG_LOSS';
    }

    // ─── Phase A: 집계 통계 ──────────────────────────────────────────────────────

    private computeAggregatedStats(cards: TradeCaseCard[]): AggregatedStats {
        const total = cards.length;
        const wins = cards.filter(c => c.outcome === 'BIG_WIN' || c.outcome === 'SMALL_WIN');

        const avgReturn = total > 0 ? cards.reduce((s, c) => s + c.final_return_pct, 0) / total : 0;
        const avgHolding = total > 0 ? cards.reduce((s, c) => s + c.holding_days, 0) / total : 0;
        const avgPeak = total > 0 ? cards.reduce((s, c) => s + c.peak_return_pct, 0) / total : 0;

        // 전략별 집계
        const byStrategy: AggregatedStats['by_strategy'] = {};
        for (const c of cards) {
            if (!byStrategy[c.strategy]) byStrategy[c.strategy] = { count: 0, win_rate: 0, avg_return: 0, best_trade: '', worst_trade: '' };
            byStrategy[c.strategy].count++;
            byStrategy[c.strategy].avg_return += c.final_return_pct;
        }
        for (const strategy of Object.keys(byStrategy)) {
            const group = cards.filter(c => c.strategy === strategy);
            const groupWins = group.filter(c => c.outcome === 'BIG_WIN' || c.outcome === 'SMALL_WIN');
            byStrategy[strategy].win_rate = group.length > 0 ? (groupWins.length / group.length) * 100 : 0;
            byStrategy[strategy].avg_return = group.length > 0 ? group.reduce((s, c) => s + c.final_return_pct, 0) / group.length : 0;
            const best = group.reduce((b, c) => c.final_return_pct > b.final_return_pct ? c : b, group[0]);
            const worst = group.reduce((w, c) => c.final_return_pct < w.final_return_pct ? c : w, group[0]);
            byStrategy[strategy].best_trade = best?.stock_name || '';
            byStrategy[strategy].worst_trade = worst?.stock_name || '';
        }

        // AI(애널리스트)별 집계
        const byAnalyst: AggregatedStats['by_analyst'] = {};
        for (const c of cards) {
            for (const analyst of c.original_analysts) {
                if (!byAnalyst[analyst]) byAnalyst[analyst] = { count: 0, win_rate: 0, avg_return: 0 };
                byAnalyst[analyst].count++;
                byAnalyst[analyst].avg_return += c.final_return_pct;
            }
        }
        for (const analyst of Object.keys(byAnalyst)) {
            const group = cards.filter(c => c.original_analysts.includes(analyst));
            const groupWins = group.filter(c => c.outcome === 'BIG_WIN' || c.outcome === 'SMALL_WIN');
            byAnalyst[analyst].win_rate = group.length > 0 ? (groupWins.length / group.length) * 100 : 0;
            byAnalyst[analyst].avg_return = group.length > 0 ? group.reduce((s, c) => s + c.final_return_pct, 0) / group.length : 0;
        }

        // 5일선 이격도 vs 성과
        const highDisp = cards.filter(c => c.entry_vs_ma5_pct >= 5);
        const lowDisp = cards.filter(c => c.entry_vs_ma5_pct < 2);
        const hdWins = highDisp.filter(c => c.outcome === 'BIG_WIN' || c.outcome === 'SMALL_WIN');
        const ldWins = lowDisp.filter(c => c.outcome === 'BIG_WIN' || c.outcome === 'SMALL_WIN');

        // 고점 놓침 패턴
        const missedProfit = cards.filter(c => c.peak_return_pct >= 10 && c.final_return_pct < 0);

        // Outcome 분포
        const outcomeDist: Record<string, number> = { BIG_WIN: 0, SMALL_WIN: 0, BREAKEVEN: 0, SMALL_LOSS: 0, BIG_LOSS: 0 };
        for (const c of cards) outcomeDist[c.outcome] = (outcomeDist[c.outcome] || 0) + 1;

        return {
            total_trades: total,
            win_count: wins.length,
            win_rate: total > 0 ? (wins.length / total) * 100 : 0,
            avg_return: avgReturn,
            avg_holding_days: avgHolding,
            avg_peak_return: avgPeak,
            by_strategy: byStrategy,
            by_analyst: byAnalyst,
            high_disparity_entries: {
                count: highDisp.length,
                avg_return: highDisp.length > 0 ? highDisp.reduce((s, c) => s + c.final_return_pct, 0) / highDisp.length : 0,
                win_rate: highDisp.length > 0 ? (hdWins.length / highDisp.length) * 100 : 0,
            },
            low_disparity_entries: {
                count: lowDisp.length,
                avg_return: lowDisp.length > 0 ? lowDisp.reduce((s, c) => s + c.final_return_pct, 0) / lowDisp.length : 0,
                win_rate: lowDisp.length > 0 ? (ldWins.length / lowDisp.length) * 100 : 0,
            },
            missed_profit_trades: {
                count: missedProfit.length,
                avg_peak: missedProfit.length > 0 ? missedProfit.reduce((s, c) => s + c.peak_return_pct, 0) / missedProfit.length : 0,
                avg_final: missedProfit.length > 0 ? missedProfit.reduce((s, c) => s + c.final_return_pct, 0) / missedProfit.length : 0,
                examples: missedProfit.slice(0, 5).map(c => c.stock_name),
            },
            outcome_distribution: outcomeDist,
        };
    }

    // ─── Phase B: 3-Step AI 분석 ─────────────────────────────────────────────────

    private async runStep1_IndividualDiagnosis(cards: TradeCaseCard[]): Promise<string> {
        console.log('[PortfolioRetrospectiveAgent] Step 1: 개별 사건 진단 시작...');

        // 최대 20건으로 제한 (토큰 비용 관리)
        const targetCards = cards.slice(0, 20);

        const cardsText = targetCards.map(c => `
- 종목: ${c.stock_name}(${c.stock_code}) | 전략: ${c.strategy}
  매수일: ${c.entry_date} | 진입가: ${c.entry_price.toLocaleString()}원 | 매도일: ${c.exit_date}
  보유: ${c.holding_days}일 (계획: ${c.planned_lifespan}일)
  결과: 최고수익 ${c.peak_return_pct.toFixed(1)}% / 최저 ${c.trough_return_pct.toFixed(1)}% / 최종 ${c.final_return_pct.toFixed(1)}%
  5일선 이격도(진입시점): ${c.entry_vs_ma5_pct.toFixed(1)}% | 20일선: ${c.entry_vs_ma20_pct.toFixed(1)}%
  PM2 매수 판단: "${c.pm2_buy_reason.substring(0, 150)}"
  추천 AI: ${c.original_analysts.join(', ') || '없음'}
  매도 사유: "${c.exit_reason.substring(0, 100)}"
`).join('');

        const prompt = `
너는 헤지펀드의 '트레이딩 감사관(Post-Trade Auditor)'이다.
아래에 우리 AI 포트폴리오 매니저가 실제 매수→매도까지 완료한 종목들의 투자 사건 카드가 제공된다.

[투자 사건 카드 목록]
${cardsText}

각 사건 카드를 읽고 다음 형식의 JSON으로만 응답하라:
{
  "diagnoses": [
    {
      "stock_name": "종목명",
      "entry_quality": "GOOD | FAIR | POOR",
      "exit_quality": "GOOD | FAIR | POOR",
      "one_line": "진단 내용 (1~2줄)",
      "root_cause_tag": "LATE_EXIT | CHASING_HIGH | THEME_EXHAUSTED | WRONG_THESIS | MARKET_SHOCK | EARLY_STOP | PERFECT_TRADE"
    }
  ]
}

반드시 JSON만 응답하고 다른 텍스트는 포함하지 말 것.
`;

        const result = await AiExecutionQueue.getInstance().enqueue({
            agentId: 'PORTFOLIO_RETRO_STEP1',
            agentName: '성적표 분석 Step1',
            triggerType: 'MANUAL',
            prompt,
        });

        return result || '{}';
    }

    private async runStep2_PatternAnalysis(step1Result: string, stats: AggregatedStats): Promise<string> {
        console.log('[PortfolioRetrospectiveAgent] Step 2: 패턴 종합 분석 시작...');

        const statsText = `
[집계 통계]
- 총 매매: ${stats.total_trades}건 | 승률: ${stats.win_rate.toFixed(1)}% | 평균수익: ${stats.avg_return.toFixed(2)}%
- 평균 보유일: ${stats.avg_holding_days.toFixed(1)}일 | 평균 최고수익: ${stats.avg_peak_return.toFixed(2)}%
- Outcome 분포: ${JSON.stringify(stats.outcome_distribution)}

[전략별 성적]
${Object.entries(stats.by_strategy).map(([s, v]) => `  ${s}: ${v.count}건, 승률 ${v.win_rate.toFixed(1)}%, 평균수익 ${v.avg_return.toFixed(2)}%`).join('\n')}

[추천 AI별 공헌]
${Object.entries(stats.by_analyst).map(([a, v]) => `  ${a}: ${v.count}건, 승률 ${v.win_rate.toFixed(1)}%, 평균수익 ${v.avg_return.toFixed(2)}%`).join('\n')}

[5일선 이격도 분류]
- 이격도 5%+ 진입: ${stats.high_disparity_entries.count}건, 승률 ${stats.high_disparity_entries.win_rate.toFixed(1)}%, 평균수익 ${stats.high_disparity_entries.avg_return.toFixed(2)}%
- 이격도 2% 미만 진입: ${stats.low_disparity_entries.count}건, 승률 ${stats.low_disparity_entries.win_rate.toFixed(1)}%, 평균수익 ${stats.low_disparity_entries.avg_return.toFixed(2)}%

[고점 놓친 종목]
- 최고수익 +10% 이상 달성 후 마이너스 마감: ${stats.missed_profit_trades.count}건
- 평균 최고수익: ${stats.missed_profit_trades.avg_peak.toFixed(2)}% → 평균 최종: ${stats.missed_profit_trades.avg_final.toFixed(2)}%
- 해당 종목: ${stats.missed_profit_trades.examples.join(', ') || '없음'}
`;

        const prompt = `
너는 퀀트 전략 리서치 디렉터이다.
아래에 1) 최근 매매의 개별 진단 결과(Step1), 2) 전략별/AI별 집계 통계가 제공된다.

[Step1 개별 진단 결과]
${step1Result.substring(0, 3000)}

${statsText}

아래 형식의 JSON으로만 응답하라:
{
  "failure_patterns": [
    {
      "pattern_name": "패턴 이름",
      "frequency": "N건/M건 (X%)",
      "description": "구체적 설명",
      "severity": "HIGH | MEDIUM | LOW"
    }
  ],
  "success_patterns": [
    {
      "pattern_name": "성공 패턴 이름",
      "frequency": "N건",
      "description": "구체적 설명"
    }
  ],
  "strategy_assessment": "전략별 성과 종합 평가 (2~3줄)",
  "analyst_ranking": "추천 AI별 정확도 평가 (2~3줄)"
}

반드시 JSON만 응답하고 다른 텍스트는 포함하지 말 것.
`;

        const result = await AiExecutionQueue.getInstance().enqueue({
            agentId: 'PORTFOLIO_RETRO_STEP2',
            agentName: '성적표 분석 Step2',
            triggerType: 'MANUAL',
            prompt,
        });

        return result || '{}';
    }

    private async runStep3_ImprovementReport(step2Result: string, stats: AggregatedStats): Promise<string> {
        console.log('[PortfolioRetrospectiveAgent] Step 3: PM 개선안 작성 시작...');

        const prompt = `
너는 AI 트레이딩 시스템 아키텍트이다.
아래에 1) 패턴 분석 결과(Step2), 2) 집계 통계 요약이 제공된다.

[Step2 패턴 분석 결과]
${step2Result.substring(0, 3000)}

[현재 PM 시스템 구조 요약]
- PM1 (스크리닝): AI 애널리스트(테마/수급/리포트) 추천 종목을 confidence 점수로 정렬 후 상위 N개를 PM2로 전달
- PM2 (리밸런싱): Gemini가 각 종목의 차트 다이제스트, 테마 상황, 애널리스트 근거를 종합해 BUY/WATCHING/SELL 판정

[집계 요약]
총 ${stats.total_trades}건 매매, 승률 ${stats.win_rate.toFixed(1)}%, 평균수익 ${stats.avg_return.toFixed(2)}%

아래 형식의 JSON으로만 응답하라. 각 항목은 "구체적이고 실행 가능한" 수정 제안이어야 한다:
{
  "pm1_improvements": [
    {
      "target": "PM1에서 수정해야 할 대상",
      "problem": "현재 문제점",
      "proposed_change": "구체적 변경 내용",
      "expected_impact": "기대 효과",
      "priority": "HIGH | MEDIUM | LOW"
    }
  ],
  "pm2_prompt_improvements": [
    {
      "target": "PM2 프롬프트에서 수정해야 할 섹션",
      "problem": "현재 문제점",
      "proposed_addition": "추가해야 할 구체적 지침 텍스트",
      "priority": "HIGH | MEDIUM | LOW"
    }
  ],
  "sell_logic_improvements": [
    {
      "problem": "매도 타이밍 문제",
      "proposed_change": "구체적 변경 내용",
      "priority": "HIGH | MEDIUM | LOW"
    }
  ],
  "overall_assessment": "전체 시스템에 대한 총평 (3~5줄)"
}

반드시 JSON만 응답하고 다른 텍스트는 포함하지 말 것.
`;

        const result = await AiExecutionQueue.getInstance().enqueue({
            agentId: 'PORTFOLIO_RETRO_STEP3',
            agentName: '성적표 분석 Step3',
            triggerType: 'MANUAL',
            prompt,
        });

        return result || '{}';
    }

    // ─── 유틸리티 ─────────────────────────────────────────────────────────────────

    private safeParseJson(text: string, context: string): any {
        try {
            // JSON 블록만 추출 (```json ... ``` 포맷 처리)
            const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
            const jsonStr = match ? match[1] : text;
            return JSON.parse(jsonStr.trim());
        } catch (e) {
            console.warn(`[PortfolioRetrospectiveAgent] JSON 파싱 실패 (${context}):`, e);
            return {};
        }
    }
}
