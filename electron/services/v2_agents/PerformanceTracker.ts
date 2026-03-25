/**
 * Market Condition Agent — Performance Tracker
 * 
 * 에이전트의 이전 예측 명세(agent_predictions)에 대해 실제 KODEX 200 / 인버스 종목의 
 * OHLC(시가/고가/저가/종가) 데이터를 수집하여 T+1, T+5, T+20 성과를 기록하고,
 * 오답일 경우 AiService를 통해 Self-Review(자가학습)를 수행하여 agent_rules에 기록합니다.
 */

import { DatabaseService } from '../DatabaseService'
import { KiwoomService } from '../KiwoomService'
import { AiService } from '../AiService'
import { AgentPrediction, AgentCycle } from './types/AgentTypes'
import { eventBus } from '../../utils/EventBus'

export class PerformanceTracker {
    private static instance: PerformanceTracker
    private db: DatabaseService
    private kiwoom: KiwoomService
    private ai: AiService

    private constructor() {
        this.db = DatabaseService.getInstance()
        this.kiwoom = KiwoomService.getInstance()
        this.ai = AiService.getInstance()
    }

    public static getInstance(): PerformanceTracker {
        if (!PerformanceTracker.instance) {
            PerformanceTracker.instance = new PerformanceTracker()
        }
        return PerformanceTracker.instance
    }

    /**
     * 매일 15:35에 호출되어 미평가된 수익률을 업데이트합니다.
     */
    public async runDailyTracking() {
        console.log('[MCA-Tracker] ═══ 일일 성과 기록 / 자가학습 파이프라인 시작 ═══')
        
        try {
            await this.updatePendingPerformance()
            await this.runSelfReviewForFailures()
        } catch (error) {
            console.error('[MCA-Tracker] 에러 발생:', error)
        }
        
        console.log('[MCA-Tracker] ═══ 파이프라인 완료 ═══')
    }

    /**
     * T+1, T+5, T+20이 비어있는 과거 진행 건들에 대해 수익률 계산
     */
    private async updatePendingPerformance() {
        const rawDb = (this.db as any).db
        
        // 평가 대기중인 목록 가져오기 (t20_final이 NULL이고 결과가 나뉘어야 할 것들)
        const pendingRows = rawDb.prepare(`
            SELECT * FROM agent_predictions 
            WHERE predict != 'HOLD' AND t20_final IS NULL
            ORDER BY date ASC
        `).all() as AgentPrediction[]

        if (pendingRows.length === 0) {
            console.log('[MCA-Tracker] 평가 대기중인 예측 내역이 없습니다.')
            return
        }

        // KODEX 200, KODEX 인버스 차트 데이터 조회 (캐싱 목적 포함)
        const chartK200 = await this.fetchParsedChart('069500') // KODEX 200 (LONG)
        const chartInv = await this.fetchParsedChart('114800')  // KODEX 인버스 (SHORT)

        if (chartK200.length === 0 || chartInv.length === 0) {
            console.error('[MCA-Tracker] ETF 차트 데이터를 불러올 수 없어 성과 계산을 중단합니다.')
            return
        }

        let updatedCount = 0

        for (const row of pendingRows) {
            const chartData = row.predict === 'LONG' ? chartK200 : chartInv
            
            // row.date가 배열상 몇 번째 인덱스인지 찾음 (chartData는 내림차순이라고 가정)
            const todayIdx = chartData.findIndex(candle => candle.date === row.date)
            
            if (todayIdx === -1) continue // 데이터가 차트에 없으면 스킵

            const updates: any = {}

            // Entry Price 추정: Cycle A(장전)면 당일 시가, Cycle B(장후)면 내일 시가 (또는 당일 종가)
            let entryPrice = row.entry_price
            if (!entryPrice) {
                if (row.cycle === 'A') {
                    entryPrice = chartData[todayIdx].open
                } else {
                    // Cycle B (15:10 판단) -> 진입은 당일 15:20 또는 15:30. 여기선 당일 종가로 간주.
                    entryPrice = chartData[todayIdx].close
                }
                updates.entry_price = entryPrice
            }

            if (!entryPrice || entryPrice <= 0) continue

            // --- T+1 (단기 목표 달성 여부) ---
            if (row.t1_final === null) {
                if (row.cycle === 'A') {
                    // 오전 08:50 판단: 당일 시가 진입 -> 당일 종가 청산
                    const todayCandle = chartData[todayIdx]
                    updates.t1_peak = ((todayCandle.high - entryPrice) / entryPrice) * 100
                    updates.t1_final = ((todayCandle.close - entryPrice) / entryPrice) * 100
                } else if (row.cycle === 'B' && todayIdx >= 1) {
                    // 오후 15:10 판단: 당일 종가 진입 -> 다음날 시가 청산
                    const t1Candle = chartData[todayIdx - 1] // 다음 영업일 캔들
                    updates.t1_peak = ((t1Candle.high - entryPrice) / entryPrice) * 100 // T+1 중 최고점 기록용
                    updates.t1_final = ((t1Candle.open - entryPrice) / entryPrice) * 100 // 최종 성과는 다음날 시가 기준 판별
                }
            }

            // --- T+5 (5영업일 후) ---
            if (row.t5_final === null && todayIdx >= 5) {
                // 1~5일 동안의 최대 고가
                let maxHigh = 0
                for (let i = todayIdx - 1; i >= todayIdx - 5; i--) {
                    if (chartData[i].high > maxHigh) maxHigh = chartData[i].high
                }
                updates.t5_peak = ((maxHigh - entryPrice) / entryPrice) * 100
                updates.t5_final = ((chartData[todayIdx - 5].close - entryPrice) / entryPrice) * 100
            }

            // --- T+20 (20영업일 후) ---
            if (row.t20_final === null && todayIdx >= 20) {
                let maxHigh = 0
                for (let i = todayIdx - 1; i >= todayIdx - 20; i--) {
                    if (chartData[i].high > maxHigh) maxHigh = chartData[i].high
                }
                updates.t20_peak = ((maxHigh - entryPrice) / entryPrice) * 100
                updates.t20_final = ((chartData[todayIdx - 20].close - entryPrice) / entryPrice) * 100
            }

            if (Object.keys(updates).length > 0) {
                this.updatePredictionDb(row.id, updates)
                updatedCount++
            }
        }

        if (updatedCount > 0) {
            console.log(`[MCA-Tracker] ${updatedCount}건의 성과가 업데이트 되었습니다.`)
            eventBus.emit('MARKET_AGENT_PERFORMANCE_UPDATED' as any, null)
        }
    }

    /**
     * 오답(손실)으로 확정된 예측 건에 대해 Gemini 복기를 수행합니다.
     */
    private async runSelfReviewForFailures() {
        const rawDb = (this.db as any).db

        // 피드백이 기록 안됐고 T1결과가 마이너스(잘못 짚음)인 것
        const failureRows = rawDb.prepare(`
            SELECT * FROM agent_predictions 
            WHERE predict != 'HOLD' AND t1_final IS NOT NULL AND t1_final < 0 AND feedback IS NULL
            ORDER BY date ASC
        `).all() as AgentPrediction[]

        if (failureRows.length === 0) return

        console.log(`[MCA-Tracker] 오답 예측 ${failureRows.length}건에 대한 자가복기(Self-Review) 진행...`)

        for (const row of failureRows) {
            try {
                const prompt = `
과거 KOSPI 방향성을 예측했으나 틀렸습니다. (수익률 ${row.t1_final?.toFixed(2)}%)
아래는 당시 당신이 내린 판단 내역입니다:
- 날짜: ${row.date}
- 사이클: ${row.cycle}
- 예측: ${row.predict}
- 당시 근거(Rationale): ${row.rationale}
- 주요 참고 지표: ${row.indicators_json}

왜 방향성을 틀렸는지 2문장으로 반성(Self-Review)하고, 같은 실수를 반복하지 않기 위해 
시스템에 추가해야 할 교훈 1가지를 "RULE: 당월 옵션만기일 주간은 VIX가 튀어도 하락 베팅을 자제한다" 형식으로 1줄 작성해 주세요.

## 출력 (엄격한 JSON):
{
  "feedback_text": "왜 틀렸는지 반성문 (마크다운 포맷)",
  "new_rule": "RULE: ... (없으면 빈 문자열)"
}
`
                const rawResponse = await this.ai.askGemini(prompt, "너는 엄격한 자기 복기를 수행하는 트레이더다.")
                
                let jsonStr = rawResponse
                const codeBlockMatch = rawResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
                if (codeBlockMatch) {
                    jsonStr = codeBlockMatch[1]
                }
                
                const parsed = JSON.parse(jsonStr)
                const rule = parsed.new_rule || ''
                const feedbackText = parsed.feedback_text || ''

                // DB 기록
                const updateStmt = rawDb.prepare(`UPDATE agent_predictions SET feedback = ? WHERE id = ?`)
                updateStmt.run(feedbackText, row.id)

                if (rule.trim()) {
                    const insertRule = rawDb.prepare(`
                        INSERT INTO agent_rules (agent_type, rule_text, source_prediction_id, is_active, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    `)
                    insertRule.run('market_condition', rule.trim(), row.id, 1, this.db.getKstTimestamp())
                    console.log(`[MCA-Tracker] 신규 학습 룰 등록 완료: ${rule}`)
                }

            } catch (e: any) {
                console.error(`[MCA-Tracker] 리뷰 실패 (${row.id}):`, e.message)
            }
        }
    }

    /**
     * 통일된 캔들 맵으로 파싱
     */
    private async fetchParsedChart(stk_cd: string) {
        const list = await this.kiwoom.getDailyChartData(stk_cd)
        // Kiwoom 데이터는 보통 최신이 0번 인덱스 (내림차순)
        return list.map(item => {
            const dateStr = String(item.dt || item.stck_bsop_date || item.date || item.trd_dt)
            const fmtDate = dateStr.length === 8 ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}` : dateStr
            
            // Kiwoom 값은 양/음 부호가 붙어있을 수 있으므로 Math.abs 처리
            const open = Math.abs(Number(item.opn_prc || item.oprc || item.open || 0))
            const high = Math.abs(Number(item.hg_prc || item.hgprc || item.high || 0))
            const low = Math.abs(Number(item.lw_prc || item.lwprc || item.low || 0))
            const close = Math.abs(Number(item.cur_prc || item.clprc || item.close || 0))
            
            return { date: fmtDate, open, high, low, close }
        })
    }

    private updatePredictionDb(id: string, updates: Record<string, number>) {
        const rawDb = (this.db as any).db;
        const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ')
        const values = Object.values(updates)
        values.push(id)

        const stmt = rawDb.prepare(`UPDATE agent_predictions SET ${setClauses} WHERE id = ?`)
        stmt.run(...values)
    }
}
