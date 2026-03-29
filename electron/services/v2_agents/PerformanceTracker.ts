/**
 * Market Condition Agent — Performance Tracker
 * 
 * 에이전트의 이전 예측 명세(agent_predictions)에 대해 실제 KODEX 200 / 인버스 종목의 
 * OHLC(시가/고가/저가/종가) 데이터를 수집하여 T+1, T+5, T+20 성과를 기록하고,
 * 오답일 경우 AiService를 통해 Self-Review(자가학습)를 수행하여 agent_rules에 기록합니다.
 * 
 * ═══ Entry Price & T+1 평가 기준 (핵심 규칙) ═══
 * Cycle A (장전 08:50 예측):
 *   - entry_price = 당일 시가 (open)     ← 예측 시점에는 전일 종가 뿐이므로 15:35에 backfill
 *   - T+1 final  = 당일 종가 (close)    ← 같은 날 마감 기준 평가
 * 
 * Cycle B (마감 15:10 예측):
 *   - entry_price = 당일 종가 (close)    ← 15:35에 backfill
 *   - T+1 final  = 익일 시가 (open)     ← 다음 영업일에 평가 가능
 */

import { DatabaseService } from '../DatabaseService'
import { KiwoomService } from '../KiwoomService'
import { AiService } from '../AiService'
import { AgentPrediction, AgentCycle } from './types/AgentTypes'
import { eventBus, SystemEvent } from '../../utils/EventBus'

interface ParsedCandle {
    date: string   // YYYY-MM-DD
    open: number
    high: number
    low: number
    close: number
}

export class PerformanceTracker {
    private static instance: PerformanceTracker
    private db: DatabaseService
    private kiwoom: KiwoomService
    private ai: AiService

    // 추가: 실시간 가격 추적용 메모리 저장소
    private latestPrices: Record<string, { price: number, open: number }> = {}
    private evalTimeout: NodeJS.Timeout | null = null

    private constructor() {
        this.db = DatabaseService.getInstance()
        this.kiwoom = KiwoomService.getInstance()
        this.ai = AiService.getInstance()

        // 실시간 장중 평가를 위한 ETF 실시간 가격 구독 (KODEX 200, KODEX 인버스)
        this.kiwoom.wsRegister(['069500', '114800'])

        // 실시간 장중 평가를 위한 WebSocket 갱신 리스너
        eventBus.on(SystemEvent.PRICE_UPDATE, (data: any) => this.handleRealtimePriceUpdate(data))
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
        console.log('[MCA-Tracker] ═══ 일일 성과 기록 파이프라인 시작 ═══')
        
        try {
            // [1회성 교정] 잘못 기록된 -100% 값 초기화
            const rawDb = (this.db as any).db
            const corrupted = rawDb.prepare(
                `SELECT id FROM agent_predictions WHERE t1_final <= -99`
            ).all()
            if (corrupted.length > 0) {
                console.log(`[MCA-Tracker] -100% 오류 데이터 ${corrupted.length}건 초기화`)
                rawDb.prepare(
                    `UPDATE agent_predictions SET t1_peak = NULL, t1_final = NULL, entry_price = NULL WHERE t1_final <= -99`
                ).run()
            }

            await this.updatePendingPerformance()
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
        
        // 최근 45일 내의 예측이거나 아직 t20_final이 완료되지 않은(과거 오류로 남은) 대상
        const pendingRows = rawDb.prepare(`
            SELECT * FROM agent_predictions 
            WHERE predict != 'HOLD' AND (t20_final IS NULL OR date >= date('now', 'localtime', '-45 days'))
            ORDER BY date ASC
        `).all() as AgentPrediction[]

        if (pendingRows.length === 0) {
            console.log('[MCA-Tracker] 평가 대기중인 예측 내역이 없습니다.')
            return
        }

        // KODEX 200, KODEX 인버스 차트 데이터 조회
        const chartK200 = await this.fetchParsedChart('069500') // KODEX 200 (LONG)
        const chartInv = await this.fetchParsedChart('114800')  // KODEX 인버스 (SHORT)

        if (chartK200.length === 0 || chartInv.length === 0) {
            console.error('[MCA-Tracker] ETF 차트 데이터를 불러올 수 없어 성과 계산을 중단합니다.')
            return
        }

        // [진단 로그] 날짜 포맷 확인
        console.log(`[MCA-Tracker] 차트 최신 날짜 - K200: ${chartK200[0]?.date}, INV: ${chartInv[0]?.date}`)
        console.log(`[MCA-Tracker] 평가 대기 건수: ${pendingRows.length}`)
        pendingRows.forEach(r => console.log(`[MCA-Tracker]  → 대기중: id=${r.id}, date=${r.date}, cycle=${r.cycle}, entry_price=${(r as any).entry_price || 'null'}`))

        let updatedCount = 0

        for (const row of pendingRows) {
            const chartData = row.predict === 'LONG' ? chartK200 : chartInv
            
            // row.date가 배열상 몇 번째 인덱스인지 찾음 (chartData는 내림차순 = [0]이 최신)
            const rowDateNorm = this.normalizeDate(row.date)
            const todayIdx = chartData.findIndex(candle => candle.date === rowDateNorm)
            
            if (todayIdx === -1) {
                console.warn(`[MCA-Tracker] row.date('${row.date}' → '${rowDateNorm}')가 차트에서 발견되지 않음. 스킵.`)
                continue
            }

            const todayCandle = chartData[todayIdx]
            const updates: any = {}

            // ═══ Step 1: Entry Price backfill (핵심 수정) ═══
            let entryPrice = (row as any).entry_price
            if (!entryPrice || entryPrice <= 0) {
                if (row.cycle === 'A') {
                    // Cycle A(장전 08:50): 진입가 = 당일 시가
                    entryPrice = todayCandle.open
                } else {
                    // Cycle B(마감 15:10): 진입가 = 당일 종가
                    entryPrice = todayCandle.close
                }
                updates.entry_price = entryPrice
                console.log(`[MCA-Tracker] entry_price backfill: ${row.id} → cycle=${row.cycle}, price=${entryPrice}`)
            }

            if (!entryPrice || entryPrice <= 0) continue

            const isTodayCycleA = row.cycle === 'A' && todayIdx === 0;

            // ═══ Step 2: T+1 평가 ═══
            if ((row as any).t1_final === null || (row as any).t1_final === undefined || isTodayCycleA) {
                if (row.cycle === 'A') {
                    // Cycle A: 당일 시가 진입 → 당일 종가 청산
                    updates.t1_peak = ((todayCandle.high - entryPrice) / entryPrice) * 100
                    updates.t1_final = ((todayCandle.close - entryPrice) / entryPrice) * 100
                    console.log(`[MCA-Tracker] T+1 Cycle A: entry(open)=${entryPrice}, close=${todayCandle.close}, return=${updates.t1_final?.toFixed(2)}%`)
                } else if (row.cycle === 'B') {
                    // Cycle B: 당일 종가 진입 → 익일 시가 청산
                    // 내림차순이므로 todayIdx - 1이 다음 영업일
                    if (todayIdx >= 1) {
                        const nextDayCandle = chartData[todayIdx - 1]
                        updates.t1_peak = ((nextDayCandle.high - entryPrice) / entryPrice) * 100
                        updates.t1_final = ((nextDayCandle.open - entryPrice) / entryPrice) * 100
                        console.log(`[MCA-Tracker] T+1 Cycle B: entry(close)=${entryPrice}, next_open=${nextDayCandle.open}, return=${updates.t1_final?.toFixed(2)}%`)
                    } else {
                        console.log(`[MCA-Tracker] T+1 Cycle B: 익일 데이터 미도착 (${row.id}). 다음 트래킹에서 평가.`)
                    }
                }
            }

            // ═══ Step 3 & 4: T+5, T+20 다이나믹 트래킹 ═══
            const calcT = (targetDays: number) => {
                if (todayIdx < targetDays) {
                    // 진행 중 (아직 목표일 도달 안됨) -> 가장 최신(0) 캔들 종가로 현재까지의 수익률 계산
                    let maxHigh = 0
                    for (let i = todayIdx - 1; i >= 0; i--) {
                        if (chartData[i]?.high > maxHigh) maxHigh = chartData[i].high
                    }
                    const peak = maxHigh > 0 ? ((maxHigh - entryPrice) / entryPrice) * 100 : null
                    const final = ((chartData[0].close - entryPrice) / entryPrice) * 100
                    return { peak, final }
                } else {
                    // 목표일 경과 안착 -> 목표일 인덱스(todayIdx - targetDays)의 확정 종가로 계산
                    let maxHigh = 0
                    for (let i = todayIdx - 1; i >= todayIdx - targetDays; i--) {
                        if (chartData[i]?.high > maxHigh) maxHigh = chartData[i].high
                    }
                    const peak = maxHigh > 0 ? ((maxHigh - entryPrice) / entryPrice) * 100 : null
                    const final = ((chartData[todayIdx - targetDays].close - entryPrice) / entryPrice) * 100
                    return { peak, final }
                }
            }

            const t5 = calcT(5)
            if ((row as any).t5_peak !== t5.peak || (row as any).t5_final !== t5.final) {
                updates.t5_peak = t5.peak
                updates.t5_final = t5.final
            }

            const t20 = calcT(20)
            if ((row as any).t20_peak !== t20.peak || (row as any).t20_final !== t20.final) {
                updates.t20_peak = t20.peak
                updates.t20_final = t20.final
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
     * 날짜 문자열을 YYYY-MM-DD 형태로 정규화
     */
    private normalizeDate(d: string): string {
        const clean = String(d || '').trim().replace(/\s+/g, '')
        if (clean.length === 8 && !clean.includes('-')) {
            return `${clean.substring(0, 4)}-${clean.substring(4, 6)}-${clean.substring(6, 8)}`
        }
        return clean
    }

    /**
     * 통일된 캔들 맵으로 파싱
     * Kiwoom ka10081 응답 필드: dt, opn_prc, hg_prc, lw_prc, cur_prc
     */
    private async fetchParsedChart(stk_cd: string): Promise<ParsedCandle[]> {
        const list = await this.kiwoom.getDailyChartData(stk_cd)

        // [진단] 실제 API 응답 필드명 덤프 (첫 항목)
        if (list.length > 0) {
            const sampleKeys = Object.keys(list[0])
            console.log(`[MCA-Tracker] RAW KEYS for ${stk_cd}: [${sampleKeys.join(', ')}]`)
            console.log(`[MCA-Tracker] RAW SAMPLE for ${stk_cd}:`, JSON.stringify(list[0]))
        }

        // Kiwoom 데이터는 보통 최신이 0번 인덱스 (내림차순)
        const parsed = list.map(item => {
            const rawDate = String(item.dt || item.stck_bsop_date || item.date || item.trd_dt || '')
            const fmtDate = this.normalizeDate(rawDate)
            
            // Kiwoom ka10081 실제 필드: open_pric, high_pric, low_pric, cur_prc
            const open = Math.abs(Number(
                item.open_pric || item.opn_prc || item.stck_oprc || item.open_prc || item.oprc || item.open || 0
            ))
            const high = Math.abs(Number(
                item.high_pric || item.hg_prc || item.stck_hgpr || item.high_prc || item.hgprc || item.high || 0
            ))
            const low = Math.abs(Number(
                item.low_pric || item.lw_prc || item.stck_lwpr || item.low_prc || item.lwprc || item.low || 0
            ))
            const close = Math.abs(Number(
                item.cur_prc || item.stck_clpr || item.clprc || item.close || 0
            ))
            
            return { date: fmtDate, open, high, low, close }
        })

        // 파싱 결과 검증 로그 (첫 3건)
        if (parsed.length > 0) {
            console.log(`[MCA-Tracker] fetchParsedChart(${stk_cd}): ${parsed.length}건 파싱됨.`)
            parsed.slice(0, 3).forEach((c, i) => 
                console.log(`  [${i}] date=${c.date}, O=${c.open}, H=${c.high}, L=${c.low}, C=${c.close}`)
            )
        }

        return parsed
    }

    /**
     * WebSocket 가격 변동 이벤트 수신 핸들러
     */
    private handleRealtimePriceUpdate(data: any) {
        const code = String(data.code).replace(/[^0-9]/g, '')
        if (code === '069500' || code === '114800') {
            const currentPrice = Number(data.price)
            const openPrice = Number(data.open || 0)
            
            if (currentPrice > 0) {
                this.latestPrices[code] = { price: currentPrice, open: openPrice }
                
                // 디바운스 처리 (1초에 한 번만 평가)
                if (this.evalTimeout) clearTimeout(this.evalTimeout)
                this.evalTimeout = setTimeout(() => {
                    this.evaluateIntradayRealtime()
                }, 1000)
            }
        }
    }

    /**
     * WebSocket 실시간 메모리 데이터만 사용하여 장중 수익률 즉시 갱신 (DB부하 최소화)
     */
    private evaluateIntradayRealtime() {
        // 둘 다 없으면 조기 반환 (하나라도 있으면 가능)
        if (!this.latestPrices['069500'] && !this.latestPrices['114800']) return

        const rawDb = (this.db as any).db
        const today = new Date()
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

        const pending = rawDb.prepare(
            `SELECT * FROM intraday_predictions WHERE date = ?`
        ).all(dateStr) as any[]

        if (pending.length === 0) return

        let evaluated = 0
        for (const row of pending) {
            const position = row.predict === 'UP' ? 'KODEX 200' : row.predict === 'DOWN' ? 'KODEX 인버스' : null
            const etfData = row.predict === 'UP' ? this.latestPrices['069500'] : row.predict === 'DOWN' ? this.latestPrices['114800'] : null

            if (!position || !etfData || etfData.open <= 0) continue

            // 기존 엔트리 가격이 있으면 유지, 없으면 최신 실시간 데이터의 시가 사용
            const entryPrice = row.entry_price && row.entry_price > 0 ? row.entry_price : etfData.open
            const closePrice = etfData.price
            const returnPct = ((closePrice - entryPrice) / entryPrice) * 100

            let result: string
            if (returnPct > 0) result = 'HIT'
            else if (returnPct < 0) result = 'MISS'
            else result = 'HOLD'

            rawDb.prepare(`
                UPDATE intraday_predictions 
                SET position = ?, entry_price = ?, close_price = ?, return_pct = ?, result = ?
                WHERE id = ?
            `).run(position, entryPrice, closePrice, returnPct, result, row.id)
            evaluated++

            // 페르소나 개별 성적 기록
            this.trackPersonaPerformance(row, returnPct)
        }

        // Daily Predictions (장전 예측 Cycle A) 실시간 갱신 적용
        const dailyPending = rawDb.prepare(
            `SELECT * FROM agent_predictions WHERE date = ? AND cycle = 'A' AND predict != 'HOLD'`
        ).all(dateStr) as any[]
        
        for (const row of dailyPending) {
            const etfData = row.predict === 'LONG' ? this.latestPrices['069500'] : row.predict === 'SHORT' ? this.latestPrices['114800'] : null
            if (!etfData || etfData.open <= 0) continue

            const entryPrice = row.entry_price && row.entry_price > 0 ? row.entry_price : etfData.open
            const returnPct = ((etfData.price - entryPrice) / entryPrice) * 100
            
            rawDb.prepare(`
                UPDATE agent_predictions 
                SET entry_price = ?, t1_final = ?
                WHERE id = ?
            `).run(entryPrice, returnPct, row.id)
            evaluated++
        }

        if (evaluated > 0) {
            eventBus.emit('INTRADAY_PREDICTION_UPDATED' as any, null)
        }
    }

    private updatePredictionDb(id: string, updates: Record<string, number>) {
        const rawDb = (this.db as any).db;
        const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ')
        const values = Object.values(updates)
        values.push(id as any)

        const stmt = rawDb.prepare(`UPDATE agent_predictions SET ${setClauses} WHERE id = ?`)
        stmt.run(...values)
    }

    /**
     * 장중 예측(intraday_predictions) 평가
     * - 15:35에 호출
     * - 장전·마감 예측과 동일하게 KODEX 200 / KODEX 인버스 ETF 수익률 기준 평가
     * - UP → KODEX 200, DOWN → KODEX 인버스
     * - entry = 당일 시가, exit = 당일 종가
     */
    public async evaluateIntraday() {
        console.log('[MCA-Tracker] ═══ 장중 예측 평가 시작 ═══')
        const rawDb = (this.db as any).db
        const today = new Date()
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

        // 오늘 장중 예측 전체 (장중에는 가격이 변하므로 매번 재평가)
        const pending = rawDb.prepare(
            `SELECT * FROM intraday_predictions WHERE date = ?`
        ).all(dateStr) as any[]

        if (pending.length === 0) {
            console.log('[MCA-Tracker] 장중 평가 대상 없음')
            return
        }

        // KODEX 200, KODEX 인버스 차트 (장전·마감 예측과 동일 상품)
        const chartK200 = await this.fetchParsedChart('069500')
        const chartInv = await this.fetchParsedChart('114800')

        const todayK200 = chartK200.find(c => c.date === dateStr) || chartK200[0]
        const todayInv = chartInv.find(c => c.date === dateStr) || chartInv[0]

        if (!todayK200 || !todayInv) {
            console.error('[MCA-Tracker] 장중 평가: 오늘 ETF 데이터 없음')
            return
        }

        console.log(`[MCA-Tracker] 장중 평가 ETF - K200: O=${todayK200.open} C=${todayK200.close} | INV: O=${todayInv.open} C=${todayInv.close}`)

        let evaluated = 0
        for (const row of pending) {
            // UP → KODEX 200, DOWN → KODEX 인버스
            const position = row.predict === 'UP' ? 'KODEX 200' : row.predict === 'DOWN' ? 'KODEX 인버스' : null
            const etfCandle = row.predict === 'UP' ? todayK200 : row.predict === 'DOWN' ? todayInv : null

            if (!position || !etfCandle || etfCandle.open <= 0) {
                // HOLD 예측이거나 데이터 없음
                rawDb.prepare(`UPDATE intraday_predictions SET position = 'HOLD', result = 'HOLD', close_kospi = ? WHERE id = ?`)
                    .run(todayK200.close, row.id)
                evaluated++
                continue
            }

            const entryPrice = etfCandle.open   // 당일 시가
            const closePrice = etfCandle.close   // 당일 종가
            const returnPct = ((closePrice - entryPrice) / entryPrice) * 100

            // 적중 판정: 수익률 > 0이면 HIT
            const THRESHOLD = 0.0 // ETF 기준이므로 방향만 맞으면 OK
            let result: string
            if (returnPct > THRESHOLD) {
                result = 'HIT'
            } else if (returnPct < -THRESHOLD) {
                result = 'MISS'
            } else {
                result = 'HOLD'
            }

            rawDb.prepare(`
                UPDATE intraday_predictions 
                SET position = ?, entry_price = ?, close_price = ?, return_pct = ?, 
                    close_kospi = ?, result = ?
                WHERE id = ?
            `).run(position, entryPrice, closePrice, returnPct, todayK200.close, result, row.id)

            console.log(`[MCA-Tracker] 장중 ${row.time_slot}: ${position} entry=${entryPrice} close=${closePrice} return=${returnPct.toFixed(2)}% → ${result}`)
            evaluated++

            // 페르소나 개별 성적 기록
            this.trackPersonaPerformance(row, returnPct)
        }
        
        if (evaluated > 0) {
            console.log(`[MCA-Tracker] 장중 예측 ${evaluated}건 평가 완료`)
            eventBus.emit('INTRADAY_PREDICTION_UPDATED' as any, null)
        }
    }

    /**
     * 메인 예측 평가 시점에 개별 페르소나의 댓글들도 모아서 채점.
     * @param row intraday_predictions DB row
     * @param masterReturnPct 선택된 포지션 KODEX의 최종 수익률
     */
    private trackPersonaPerformance(row: any, masterReturnPct: number) {
        if (!row.comments_json) return;
        
        try {
            const comments = JSON.parse(row.comments_json);
            const rawDb = (this.db as any).db;
            
            for (const c of comments) {
                if (!c.id || !c.predict) continue;

                // 마스터가 UP 예측하여 KODEX 200 수익률이 returnPct이 된 경우:
                // 페르소나가 동일하게 UP이면 수익률 그대로 사용, 반대면 역산 필요.
                // 직관적으로 방향이 맞았는지(returnPct > 0인지)로 판별.
                let pResult = 'HOLD';
                let pIsHit = 0;

                // 마스터 방향에 맞춘 수익률(masterReturnPct)을 이용해 현재 시장이 상승장인지 하락장인지 유추:
                // row.predict === 'UP' -> 마스터가 매수함. masterReturnPct > 0 이면 주가 올랐음(UP Hit).
                // row.predict === 'DOWN' -> 마스터가 인버스 매수함. masterReturnPct > 0 이면 주가 내렸음(DOWN Hit).
                const marketWentUp = (row.predict === 'UP' && masterReturnPct > 0) || (row.predict === 'DOWN' && masterReturnPct < 0);
                const marketWentDown = (row.predict === 'DOWN' && masterReturnPct > 0) || (row.predict === 'UP' && masterReturnPct < 0);

                if (c.predict === 'UP') {
                    pResult = marketWentUp ? 'HIT' : 'MISS';
                    pIsHit = marketWentUp ? 1 : 0;
                } else if (c.predict === 'DOWN') {
                    pResult = marketWentDown ? 'HIT' : 'MISS';
                    pIsHit = marketWentDown ? 1 : 0;
                } else {
                    // HOLD는 타율에서 제외하거나 중립
                    pResult = 'HOLD';
                    pIsHit = 0;
                }

                rawDb.prepare(`
                    INSERT OR REPLACE INTO persona_performance 
                    (date, time_slot, persona_id, predict, actual_result, is_hit, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                `).run(row.date, row.time_slot, c.id, c.predict, pResult, pIsHit);
            }
        } catch (error: any) {
            console.error('[MCA-Tracker] 페르소나 성적 업데이트 에러:', error.message);
        }
    }

    /**
     * Phase 3: 페르소나별 적중률 (입김/Weight) 추출
     * 최근 N개의 예측 기록을 기반으로 각자 승률을 계산하여 가중치 맵 반환 (기본값 1.0)
     */
    public getPersonaWeights(): Record<string, { winRate: number, weight: number, hits: number, total: number }> {
        const rawDb = (this.db as any).db;
        const weights: Record<string, { winRate: number, weight: number, hits: number, total: number }> = {};
        
        try {
            // 최근 30일(또는 30건)만 평가
            const records = rawDb.prepare(`
                SELECT persona_id, is_hit, predict
                FROM persona_performance
                WHERE date >= date('now', 'localtime', '-30 days')
                AND predict != 'HOLD'
            `).all() as any[];

            const stats: Record<string, { hits: number, total: number }> = {};
            for (const r of records) {
                if (!stats[r.persona_id]) stats[r.persona_id] = { hits: 0, total: 0 };
                stats[r.persona_id].total++;
                if (r.is_hit === 1) stats[r.persona_id].hits++;
            }

            for (const personaId in stats) {
                const total = stats[personaId].total;
                const hits = stats[personaId].hits;
                const winRate = total > 0 ? (hits / total) * 100 : 50;
                
                // 가중치(Weight) 공식: 50%를 1.0으로 기준.
                // 70%면 1.4배의 입김 (또는 특정 배수 공식 적용 가능)
                let weight = 1.0;
                if (total >= 5) { // 최소 5건 이상이어야 신뢰도 부여
                    weight = Math.max(0.5, winRate / 50.0);
                }
                
                weights[personaId] = {
                    winRate: Math.round(winRate),
                    weight: Number(weight.toFixed(2)),
                    hits,
                    total
                };
            }
        } catch(e) {}

        return weights;
    }
}
