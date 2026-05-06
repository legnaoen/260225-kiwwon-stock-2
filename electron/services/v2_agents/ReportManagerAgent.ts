/**
 * ReportManagerAgent (Phase 2 - 운용 AI)
 * ─────────────────────────────────────────────────────────────────
 * [역할] Scout가 가져온 신규 후보 5개 + 기존 보유 종목(최대 10개)을
 *        통합 심사하여 최종 포트폴리오를 결정하는 서바이벌 리밸런싱 AI.
 *
 * [실행 트리거]
 *   - ReportScoutAgent.run() 완료 직후 자동 연계 실행 (ScoutResult 수신)
 *   - 수동 IPC: 'report-tracker:run-rebalance'
 *
 * [리밸런싱 룰 (2단계)]
 *   1단계 절대 평가: 추세 이탈(고가대비 -15% 이상) + 외인/기관 3일 연속 매도 → 무조건 Drop
 *   2단계 상대 평가: 절대 평가 통과 후 10개 초과 시에만 하위 밀어내기
 *      - Switching Penalty: 신규 종목이 기존 종목 대비 점수가 +20 이상 우위일 때만 교체
 *
 * [토큰 최적화]
 *   - 기존 보유 종목: 원본 분석 재실행 없이 현재 수익률/수급 다이제스트만 갱신
 *   - OHLCV 20일 데이터를 "추세 다이제스트" 형식으로 가공하여 주입
 *   - 수급: 20일/5일/3일 누적으로 묶어 가속도 파악
 */

import { DatabaseService } from '../DatabaseService';
import { AiExecutionQueue } from '../AiExecutionQueue';
import { KiwoomService } from '../KiwoomService';
import { getKstDate } from '../../utils/DateUtils';
import { ScoutCandidate, ScoutResult } from './ReportScoutAgent';

// ── 상수 ───────────────────────────────────────────────────────
const MAX_PORTFOLIO = 10;
const ABSOLUTE_DROP_RETURN_THRESHOLD = -15; // -15% 이하 절대 탈락
const SWITCHING_PENALTY_THRESHOLD = 20;     // 기존 종목보다 +20점 이상일 때만 교체 승인
const OHLCV_DAYS = 20;                       // 차트 분석 기준 일수

// ── 타입 ───────────────────────────────────────────────────────
interface HoldingDigest {
    stock_code: string;
    stock_name: string;
    holding_days: number;
    entry_price: number;
    current_price: number;
    current_return: number;
    peak_return: number | null;
    target_return_pct: number;
    target_days: number;
    ai_entry_reason: string;       // 최초 편입 사유 (재분석 생략)
    chart_digest: string;          // 추세 다이제스트
    supply_digest: string;         // 수급 다이제스트
}

interface ManagerDecision {
    action: 'KEEP' | 'DROP' | 'NEW';
    stock_code: string;
    stock_name: string;
    final_score: number;
    reason: string;
    exit_type?: 'DROPPED' | 'TARGET_HIT' | 'STOP_LOSS';
}

interface ManagerResult {
    success: boolean;
    runDate: string;
    logText: string;
    kept: ManagerDecision[];
    dropped: ManagerDecision[];
    added: ManagerDecision[];
    error?: string;
}

// ── System Prompt ───────────────────────────────────────────────
const SYSTEM_PROMPT = `당신은 최정예 포트폴리오 매니저(Portfolio Manager)입니다.
리포트 기반 1차 발굴 AI(Scout)가 추천한 신규 후보와 기존 보유 종목을 통합 심사하여
최종 포트폴리오를 결정합니다. 전체 포트의 기대 수익을 최대화하는 것이 목표입니다.

[2단계 심사 프로세스]
1단계 절대 평가 (썩은 사과 먼저 제거):
  - 모든 기존 보유 종목에 대해 먼저 검토
  - 아래 조건 중 하나라도 해당하면 → action: "DROP" (순위 무관 무조건 탈락)
    a) 수급 악화: 외인/기관 3일 누적 모두 음수 (집중 이탈)
    b) 추세 붕괴: 20일 고가 대비 현재 -12% 이상 하락 중이면서 저점 계속 낮아지는 패턴
    c) 목표보유일을 이미 초과했고 수익률이 마이너스인 경우

2단계 상대 평가 (정원 초과 시에만):
  - 1단계 통과 종목 수가 10 이하 → 모두 KEEP/NEW (추가 드랍 없음)
  - 10개 초과 시에만 → final_score 기준 하위 밀어내기
  - Switching Penalty: 기존 보유 종목의 final_score에 +10 가산 (무지성 교체 방지)
  - 즉, 신규 종목은 기존 종목 대비 최소 +20점 이상 우위여야 교체 가능

[응답 규칙]
- 반드시 아래 JSON 형식만 반환 (마크다운 코드블록 없이)
- final_score: 0~100 (기대 수익성, 리포트 강도, 차트 추세, 수급 가속도 종합)
- reason: 한국어로 2~3문장

{
  "decisions": [
    {
      "action": "KEEP",
      "stock_code": "005930",
      "stock_name": "삼성전자",
      "final_score": 82,
      "reason": "외인 3일 연속 순매수 가속화. 20일 고가 대비 -3% 수준으로 추세 양호. 목표 수익률 15% 도달까지 여유 있음."
    },
    {
      "action": "DROP",
      "stock_code": "035720",
      "stock_name": "카카오",
      "final_score": 30,
      "reason": "기관 3일 연속 대규모 매도. 20일 고가 대비 -18% 추세 붕괴 확인.",
      "exit_type": "DROPPED"
    },
    {
      "action": "NEW",
      "stock_code": "000660",
      "stock_name": "SK하이닉스",
      "final_score": 85,
      "reason": "HBM 실적 개선 리포트 3일 연속 1위. 외인 5일 연속 매수 가속. 현재 20일 추세 저점 대비 +8% 상승 중."
    }
  ]
}`;

export class ReportManagerAgent {
    private static instance: ReportManagerAgent;
    private db = DatabaseService.getInstance();
    private aiQueue = AiExecutionQueue.getInstance();
    private kiwoom = KiwoomService.getInstance();

    private constructor() {}

    public static getInstance(): ReportManagerAgent {
        if (!ReportManagerAgent.instance) {
            ReportManagerAgent.instance = new ReportManagerAgent();
        }
        return ReportManagerAgent.instance;
    }

    /**
     * Manager 메인 실행: 기존 포트폴리오 + 신규 후보 통합 심사
     */
    public async run(scoutResult: ScoutResult): Promise<ManagerResult> {
        const runDate = getKstDate();
        console.log(`[ReportManagerAgent] ⚖️ Manager 리밸런싱 시작 (${runDate})`);

        try {
            // Step 1: 기존 보유 종목 조회
            const currentPortfolio = this.db.getReportPortfolio();
            const holdingCodes = new Set(currentPortfolio.map(p => p.stock_code));
            
            // 신규 후보 중 이미 보유 중인 종목 제외 (중복 추천 방지)
            const filteredCandidates = scoutResult.candidates.filter(c => !holdingCodes.has(c.stock_code));
            
            console.log(`[ReportManagerAgent] 기존 보유 ${currentPortfolio.length}개 + 신규 후보 ${filteredCandidates.length}개 (중복 ${scoutResult.candidates.length - filteredCandidates.length}개 제외) = 총 ${currentPortfolio.length + filteredCandidates.length}개 심사`);

            if (currentPortfolio.length === 0 && filteredCandidates.length === 0) {
                return { success: false, runDate, logText: '심사할 종목 없음', kept: [], dropped: [], added: [] };
            }

            // Step 2: 기존 보유 종목 다이제스트 생성 (차트 + 수급)
            const holdingDigests = await this.buildHoldingDigests(currentPortfolio);

            // Step 3: 통합 심사 프롬프트 구성
            const prompt = this.buildManagerPrompt(holdingDigests, filteredCandidates, runDate);

            // Step 4: Gemini AI 호출
            const rawResponse = await this.aiQueue.enqueue({
                agentId: 'ReportManagerAgent',
                agentName: 'Report Manager',
                triggerType: 'CRON',
                prompt,
                systemInstruction: SYSTEM_PROMPT,
            });

            // Step 5: 결정 파싱
            const decisions = this.parseDecisions(rawResponse);

            // Step 6: DB 반영 (Drop, New 처리)
            const result = await this.applyDecisions(decisions, currentPortfolio, filteredCandidates, runDate);

            // Step 7: 리밸런싱 로그 저장
            this.db.upsertReportRebalanceLog(runDate, result.logText);

            console.log(`[ReportManagerAgent] ✅ 리밸런싱 완료 | 유지:${result.kept.length} 탈락:${result.dropped.length} 신규편입:${result.added.length}`);
            
            // Step 8: 텔레그램 알림 발송
            try {
                if (result.added.length > 0 || result.dropped.length > 0) {
                    const { TelegramService } = await import('../TelegramService');
                    const tgSvc = TelegramService.getInstance();
                    let tgMsg = `🎯 *[리포트 매매 AI 리밸런싱 완료]* (${runDate})\n\n`;
                    
                    if (result.added.length > 0) {
                        tgMsg += `*🆕 신규 편입 (${result.added.length}종목)*\n`;
                        result.added.forEach((a, idx) => {
                            tgMsg += `${idx + 1}. ${a.stock_name} (AI점수: ${a.final_score})\n  - ${a.reason.replace(/[*_`]/g, '')}\n`;
                        });
                        tgMsg += `\n`;
                    }
                    if (result.dropped.length > 0) {
                        tgMsg += `*🔴 탈락 (${result.dropped.length}종목)*\n`;
                        result.dropped.forEach((d, idx) => {
                            tgMsg += `${idx + 1}. ${d.stock_name}\n  - ${d.reason.replace(/[*_`]/g, '')}\n`;
                        });
                        tgMsg += `\n`;
                    }
                    tgMsg += `💡 현재 포트폴리오 잔고는 대시보드 [리포트 매매] 탭에서 확인하세요.`;
                    await tgSvc.sendMessage(tgMsg);
                }
            } catch (tgErr: any) {
                console.error('[ReportManagerAgent] 텔레그램 발송 실패:', tgErr.message);
            }

            return result;

        } catch (e: any) {
            console.error('[ReportManagerAgent] ❌ Manager 실패:', e.message);
            return { success: false, runDate, logText: `오류: ${e.message}`, kept: [], dropped: [], added: [], error: e.message };
        }
    }

    /**
     * 기존 보유 종목 다이제스트 생성 (차트 + 수급 토큰 최적화)
     */
    private async buildHoldingDigests(portfolio: any[]): Promise<HoldingDigest[]> {
        const digests: HoldingDigest[] = [];
        const rawDb = (this.db as any).db;

        for (const item of portfolio) {
            try {
                // OHLCV 20일 데이터 조회
                const ohlcvRows = rawDb.prepare(`
                    SELECT date, open, high, low, close, volume,
                           change_rate,
                           foreigner_net_buy, institution_net_buy
                    FROM market_ohlcv_history
                    WHERE stock_code = ?
                    ORDER BY date DESC
                    LIMIT ${OHLCV_DAYS}
                `).all(item.stock_code) as any[];

                const currentPrice = ohlcvRows.length > 0 ? ohlcvRows[0].close : item.current_price;
                const currentReturn = item.entry_price > 0
                    ? parseFloat((((currentPrice - item.entry_price) / item.entry_price) * 100).toFixed(2))
                    : 0;

                // 차트 다이제스트: 20일 고가/저가 위치 + 추세
                const chartDigest = this.buildChartDigest(ohlcvRows, currentPrice);

                // 수급 다이제스트: 20/5/3일 누적
                const supplyDigest = this.buildSupplyDigest(ohlcvRows);

                // 현재가 DB 갱신
                this.db.updateReportPortfolioPrice(item.stock_code, currentPrice, currentReturn);

                digests.push({
                    stock_code: item.stock_code,
                    stock_name: item.stock_name,
                    holding_days: item.holding_days,
                    entry_price: item.entry_price,
                    current_price: currentPrice,
                    current_return: currentReturn,
                    peak_return: item.peak_return,
                    target_return_pct: item.target_return_pct,
                    target_days: item.target_days,
                    ai_entry_reason: (item.ai_entry_reason || '').slice(0, 100),
                    chart_digest: chartDigest,
                    supply_digest: supplyDigest,
                });
            } catch (e: any) {
                console.warn(`[ReportManagerAgent] ${item.stock_code} 다이제스트 생성 실패:`, e.message);
                digests.push({
                    stock_code: item.stock_code,
                    stock_name: item.stock_name,
                    holding_days: item.holding_days,
                    entry_price: item.entry_price,
                    current_price: item.current_price,
                    current_return: 0,
                    peak_return: item.peak_return,
                    target_return_pct: item.target_return_pct,
                    target_days: item.target_days,
                    ai_entry_reason: (item.ai_entry_reason || '').slice(0, 100),
                    chart_digest: '데이터 없음',
                    supply_digest: '데이터 없음',
                });
            }
        }
        return digests;
    }

    /**
     * 20일 OHLCV → 차트 추세 다이제스트
     * "20일 최고가 85,000 (D-5), 최저가 72,000 (D-15), 현재 82,000 (+9% from low, -3% from high)"
     */
    private buildChartDigest(ohlcvRows: any[], currentPrice: number): string {
        if (ohlcvRows.length < 3) return '데이터 부족';

        const prices = ohlcvRows.map(r => r.close);
        const highs = ohlcvRows.map(r => r.high);
        const lows = ohlcvRows.map(r => r.low);

        const maxHigh = Math.max(...highs);
        const minLow = Math.min(...lows);
        const maxHighIdx = highs.indexOf(maxHigh);  // 0 = 오늘
        const minLowIdx = lows.indexOf(minLow);

        const fromHigh = maxHigh > 0 ? parseFloat((((currentPrice - maxHigh) / maxHigh) * 100).toFixed(1)) : 0;
        const fromLow = minLow > 0 ? parseFloat((((currentPrice - minLow) / minLow) * 100).toFixed(1)) : 0;

        // 최근 5일 방향성
        const recent5 = prices.slice(0, 5);
        const trend5d = recent5.length >= 2
            ? (recent5[0] > recent5[recent5.length - 1] ? '상승' : '하락')
            : '-';

        return `20일고가 ${maxHigh.toLocaleString()}(D-${maxHighIdx}일전), 20일저가 ${minLow.toLocaleString()}(D-${minLowIdx}일전), 현재 ${currentPrice.toLocaleString()} [고가대비${fromHigh}%, 저가대비+${fromLow}%], 5일추세:${trend5d}`;
    }

    /**
     * 수급 데이터 → 20/5/3일 누적 가속도 다이제스트
     * "외인: 20일+23.4억 / 5일+8.1억 / 3일+5.2억 (가속), 기관: 20일-5억 / 5일-2억 / 3일-1.5억"
     */
    private buildSupplyDigest(ohlcvRows: any[]): string {
        if (ohlcvRows.length < 3) return '수급 데이터 없음';

        const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
        const fmt = (v: number) => (v >= 0 ? '+' : '') + (v / 100000000).toFixed(1) + '억';
        const trend = (s20: number, s5: number, s3: number) => {
            // 3일 가속도: 3일 평균 > 20일 평균이면 가속
            const avg20 = s20 / 20;
            const avg3 = s3 / 3;
            return avg3 > avg20 ? '▲가속' : avg3 < avg20 * 0.5 ? '▼둔화' : '→유지';
        };

        const fNet = ohlcvRows.map(r => r.foreigner_net_buy || 0);
        const iNet = ohlcvRows.map(r => r.institution_net_buy || 0);

        const f20 = sum(fNet.slice(0, 20));
        const f5 = sum(fNet.slice(0, 5));
        const f3 = sum(fNet.slice(0, 3));
        const i20 = sum(iNet.slice(0, 20));
        const i5 = sum(iNet.slice(0, 5));
        const i3 = sum(iNet.slice(0, 3));

        return `외인: 20일${fmt(f20)} / 5일${fmt(f5)} / 3일${fmt(f3)} [${trend(f20, f5, f3)}], 기관: 20일${fmt(i20)} / 5일${fmt(i5)} / 3일${fmt(i3)} [${trend(i20, i5, i3)}]`;
    }

    /**
     * Manager AI에 주입할 통합 심사 프롬프트 구성
     */
    private buildManagerPrompt(holdings: HoldingDigest[], newCandidates: ScoutCandidate[], runDate: string): string {
        const lines: string[] = [`[심사일: ${runDate}] 최대 보유 종목 수: ${MAX_PORTFOLIO}개\n`];

        // 기존 보유 종목
        if (holdings.length > 0) {
            lines.push('=== [기존 보유 종목] ===');
            holdings.forEach((h, i) => {
                lines.push(`${i + 1}. ${h.stock_name}(${h.stock_code})`);
                lines.push(`   보유일: ${h.holding_days}일 / 목표: ${h.target_return_pct}%/${h.target_days}일`);
                lines.push(`   진입가: ${h.entry_price.toLocaleString()} | 현재가: ${h.current_price.toLocaleString()} | 현재수익률: ${h.current_return}% (최고: ${h.peak_return ?? '-'}%)`);
                lines.push(`   [차트] ${h.chart_digest}`);
                lines.push(`   [수급] ${h.supply_digest}`);
                lines.push(`   [편입사유] ${h.ai_entry_reason}`);
                lines.push('');
            });
        }

        // 신규 후보 종목 (Scout 결과)
        if (newCandidates.length > 0) {
            lines.push('=== [신규 후보 종목 (Scout AI 추천)] ===');
            newCandidates.forEach((c, i) => {
                lines.push(`${i + 1}. ${c.stock_name}(${c.stock_code || '코드미상'}) | Scout점수: ${c.ai_score}`);
                lines.push(`   산업: ${c.industry_name} | 발간사: ${c.report_source}`);
                lines.push(`   Scout목표: ${c.target_return_pct}%/${c.target_days}일`);
                lines.push(`   [편입근거] ${c.ai_reason}`);
                lines.push(`   [원본리포트] ${c.raw_report_title}`);
                lines.push('');
            });
        }

        lines.push(`\n[지시사항]`);
        lines.push(`- 위 전체 종목을 2단계 심사 룰에 따라 평가하여 decisions 배열로 반환하세요.`);
        lines.push(`- Switching Penalty: 기존 보유 종목의 final_score에 +${SWITCHING_PENALTY_THRESHOLD}점 가산 후 비교하세요.`);
        lines.push(`- 총 보유 종목이 ${MAX_PORTFOLIO}개 이하가 되도록 결정하세요.`);
        lines.push(`- 확신 없는 신규 후보는 NEW 대신 KEEP(기존 유지) 우선하세요.`);

        return lines.join('\n');
    }

    /**
     * AI 응답 JSON 파싱
     */
    private parseDecisions(raw: string): ManagerDecision[] {
        try {
            const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const jsonStart = cleaned.indexOf('{');
            const jsonEnd = cleaned.lastIndexOf('}');
            if (jsonStart === -1 || jsonEnd === -1) throw new Error('JSON 구조 없음');

            const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
            return (parsed.decisions || []).map((d: any) => ({
                action: d.action as 'KEEP' | 'DROP' | 'NEW',
                stock_code: String(d.stock_code || '').replace(/\D/g, '').slice(0, 6),
                stock_name: String(d.stock_name || ''),
                final_score: Math.min(100, Math.max(0, Number(d.final_score) || 0)),
                reason: String(d.reason || ''),
                exit_type: d.exit_type || 'DROPPED',
            }));
        } catch (e: any) {
            console.error('[ReportManagerAgent] JSON 파싱 실패:', e.message);
            return [];
        }
    }

    /**
     * Manager 결정을 DB에 반영
     */
    private async applyDecisions(
        decisions: ManagerDecision[],
        currentPortfolio: any[],
        newCandidates: ScoutCandidate[],
        runDate: string
    ): Promise<ManagerResult> {
        const kept: ManagerDecision[] = [];
        const dropped: ManagerDecision[] = [];
        const added: ManagerDecision[] = [];
        const logLines: string[] = [`[${runDate}] 리밸런싱 회의록`];

        // 현재가 조회 (DB Fallback)
        const rawDb = (this.db as any).db;
        const getFallbackPrice = (stockCode: string): number => {
            if (!stockCode) return 0;
            const row = rawDb.prepare(
                `SELECT close FROM market_ohlcv_history WHERE stock_code = ? ORDER BY date DESC LIMIT 1`
            ).get(stockCode) as any;
            return row?.close ?? 0;
        };

        for (const d of decisions) {
            if (d.action === 'DROP') {
                const exitPrice = getFallbackPrice(d.stock_code);
                const dropped_ok = this.db.dropReportPortfolioItem(d.stock_code, exitPrice, d.reason, d.exit_type || 'DROPPED');
                if (dropped_ok) {
                    dropped.push(d);
                    logLines.push(`🔴 [탈락] ${d.stock_name}(${d.stock_code}) | 점수:${d.final_score} | 사유: ${d.reason}`);
                }
            } else if (d.action === 'KEEP') {
                kept.push(d);
                logLines.push(`🟢 [유지] ${d.stock_name}(${d.stock_code}) | 점수:${d.final_score}`);
            } else if (d.action === 'NEW') {
                // Scout 후보에서 매칭하여 DB 편입
                const candidate = newCandidates.find(
                    c => c.stock_code === d.stock_code || c.stock_name === d.stock_name
                );
                if (!candidate) {
                    logLines.push(`⚠️ [NEW 스킵] ${d.stock_name} — Scout 후보 매칭 실패`);
                    continue;
                }

                // 키움 실시간 시가 조회 (1초 대기)
                let entryPrice = 0;
                try {
                    const candles = await this.kiwoom.getOhlcvDaily(candidate.stock_code, 2);
                    if (candles && candles.length > 0) {
                        entryPrice = candles[candles.length - 1].close;
                    } else {
                        entryPrice = getFallbackPrice(candidate.stock_code);
                    }
                    // 트래픽 폭주 방어 (TPS 제어)
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (e: any) {
                    console.warn(`[ReportManagerAgent] 실시간 진입가 조회 실패 (${candidate.stock_name}):`, e.message);
                    entryPrice = getFallbackPrice(candidate.stock_code);
                }

                const ok = this.db.insertReportPortfolioItem({
                    stock_code: candidate.stock_code,
                    stock_name: candidate.stock_name,
                    entry_price: entryPrice,
                    current_price: entryPrice,
                    entry_date: runDate,
                    target_return_pct: candidate.target_return_pct,
                    target_days: candidate.target_days,
                    report_source: candidate.report_source,
                    industry_name: candidate.industry_name,
                    ai_entry_reason: candidate.ai_reason,
                    ai_score: d.final_score,
                    scout_candidates_json: JSON.stringify(candidate),
                });
                if (ok) {
                    added.push(d);
                    logLines.push(`🆕 [신규편입] ${d.stock_name}(${d.stock_code}) | 점수:${d.final_score} | 진입가:${entryPrice.toLocaleString()} | 사유: ${d.reason}`);
                }
            }
        }

        // 결과 요약
        logLines.push('');
        logLines.push(`📊 결과: 유지 ${kept.length}개 | 탈락 ${dropped.length}개 | 신규편입 ${added.length}개`);
        const finalPortfolio = this.db.getReportPortfolio();
        logLines.push(`현재 포트폴리오: ${finalPortfolio.length}개 / 최대 ${MAX_PORTFOLIO}개`);

        return {
            success: true,
            runDate,
            logText: logLines.join('\n'),
            kept,
            dropped,
            added,
        };
    }
}
