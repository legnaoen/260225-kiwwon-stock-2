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

    // ── 폴링 최적화: "할 일 없음" 캐시 ──
    // true이면 오늘 더 이상 채울 pending 행이 없으므로 DB 쿼리 생략
    private _noPendingIntraday = false
    private _noPendingDaily    = false
    private _cacheDate         = ''   // 날짜가 바뀌면 캐시 리셋

    private constructor() {
        this.db = DatabaseService.getInstance()
        this.kiwoom = KiwoomService.getInstance()
        this.ai = AiService.getInstance()

        // 실시간 장중 평가를 위한 ETF 실시간 가격 구독 (KODEX 200, KODEX 인버스)
        this.kiwoom.wsRegister(['069500', '114800'])

        // 실시간 장중 평가를 위한 WebSocket 갱신 리스너
        eventBus.on(SystemEvent.PRICE_UPDATE, (data: any) => this.handleRealtimePriceUpdate(data))

        // 앱 시작 시, 전날 15:35에 앱이 꺼져 있어서 누락되었거나 값 교정이 필요한 과거 데이터를 즉각 보정합니다.
        setTimeout(() => {
            this.runDailyTracking()
                .then(() => this.evaluateIntraday())
                .catch(e => console.error('Tracker Boot Sync Error:', e))
        }, 10000)
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
            WHERE (t20_final IS NULL OR date >= date('now', 'localtime', '-45 days'))
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
            const chartData = (row.predict === 'LONG' || row.predict === 'UP') ? chartK200 : (row.predict === 'SHORT' || row.predict === 'DOWN') ? chartInv : chartK200;
            
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
            // 실시간 저장된 가승인 진입가를, 공식 API 차트의 시가/종가로 정확하게 교정(Overwrite)
            let entryPrice = (row as any).entry_price
            
            if (row.cycle !== 'P') {
                const correctEntryPrice = row.cycle === 'A' ? todayCandle.open : todayCandle.close;
                
                if (entryPrice !== correctEntryPrice) {
                    entryPrice = correctEntryPrice
                    updates.entry_price = entryPrice
                    console.log(`[MCA-Tracker] entry_price correction: ${row.id} → cycle=${row.cycle}, price=${entryPrice}`)
                }
            } else {
                // Cycle P (장중)의 경우 저장된 당일 타임스탬프 당시의 예측 진입가격(entry_price)를 불변으로 유지
                if (!entryPrice || entryPrice <= 0) {
                     // 단, 예측 당시 가격 정보가 수집되지 않아(소켓 갱신 등) 비어있다면 아쉬운대로 당일 시가로 보정
                     entryPrice = todayCandle.open;
                     updates.entry_price = entryPrice;
                }
            }

            if (!entryPrice || entryPrice <= 0) continue

            const isTodayCycleA = (row.cycle === 'A' || row.cycle === 'P') && todayIdx === 0;

            // ═══ Step 2: T+1 평가 ═══
            // t1_final이 아직 없거나, 당일 Cycle A거나, 우리가 방금 entry_price를 교정(Overwrite)했다면 다시 채점!
            // Cycle B의 경우 익일 일봉 데이터가 존재(todayIdx >= 1)하면 WebSocket 임시 0.0 데이터를 덮어쓰기 위해 채점 진행
            const isFinishedCycleB = row.cycle === 'B' && todayIdx >= 1;
            if ((row as any).t1_final === null || (row as any).t1_final === undefined || isTodayCycleA || isFinishedCycleB || updates.entry_price !== undefined) {
                if (row.cycle === 'A' || row.cycle === 'P') {
                    // Cycle A / Cycle P: 당일 시가(또는 장중 실시간 진입가) 진입 → 당일 종가 청산
                    updates.t1_peak = ((todayCandle.high - entryPrice) / entryPrice) * 100
                    updates.t1_final = ((todayCandle.close - entryPrice) / entryPrice) * 100
                    console.log(`[MCA-Tracker] T+1 Cycle ${row.cycle}: entry=${entryPrice}, close=${todayCandle.close}, return=${updates.t1_final?.toFixed(2)}%`)
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
            const calcTHorizon = (targetDays: number, targetPredict: string | null) => {
                if (!targetPredict || !['LONG', 'SHORT', 'UP', 'DOWN'].includes(targetPredict)) return { peak: null, final: null };
                
                const myChart = (targetPredict === 'LONG' || targetPredict === 'UP') ? chartK200 : chartInv;
                const myIdx = myChart.findIndex(candle => candle.date === rowDateNorm);
                
                if (myIdx === -1) return { peak: null, final: null };
                
                const myTodayCandle = myChart[myIdx];
                const myEntryPrice = row.cycle === 'A' ? myTodayCandle.open : myTodayCandle.close;
                
                if (!myEntryPrice || myEntryPrice <= 0) return { peak: null, final: null };
                
                if (myIdx < targetDays) {
                    // 진행 중 (아직 목표일 도달 안됨) -> 가장 최신(0) 캔들 종가로 현재까지의 수익률 계산
                    let maxHigh = 0
                    for (let i = myIdx - 1; i >= 0; i--) {
                        if (myChart[i]?.high > maxHigh) maxHigh = myChart[i].high
                    }
                    const peak = maxHigh > 0 ? ((maxHigh - myEntryPrice) / myEntryPrice) * 100 : null
                    const final = ((myChart[0].close - myEntryPrice) / myEntryPrice) * 100
                    return { peak, final }
                } else {
                    // 목표일 경과 안착 -> 목표일 인덱스(myIdx - targetDays)의 확정 종가로 계산
                    let maxHigh = 0
                    for (let i = myIdx - 1; i >= myIdx - targetDays; i--) {
                        if (myChart[i]?.high > maxHigh) maxHigh = myChart[i].high
                    }
                    const peak = maxHigh > 0 ? ((maxHigh - myEntryPrice) / myEntryPrice) * 100 : null
                    const final = ((myChart[myIdx - targetDays].close - myEntryPrice) / myEntryPrice) * 100
                    return { peak, final }
                }
            }

            const t5 = calcTHorizon(5, (row as any).t5_predict)
            if ((row as any).t5_peak !== t5.peak || (row as any).t5_final !== t5.final) {
                updates.t5_peak = t5.peak
                updates.t5_final = t5.final
            }

            const t20 = calcTHorizon(20, (row as any).t20_predict)
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
     * KST 기준 장중 시간(09:00~15:40)인지 확인
     */
    private isMarketHours(): boolean {
        const now = new Date()
        const kstHour   = (now.getUTCHours() + 9) % 24
        const kstMinute = now.getUTCMinutes()
        const kstTime   = kstHour * 100 + kstMinute
        return kstTime >= 900 && kstTime <= 1540
    }

    /**
     * 날짜 캐시 리셋 (날짜가 바뀌면 pending 캐시 초기화)
     */
    private refreshDateCache(): string {
        const today = new Date()
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
        if (this._cacheDate !== dateStr) {
            this._cacheDate         = dateStr
            this._noPendingIntraday = false
            this._noPendingDaily    = false
        }
        return dateStr
    }

    /**
     * 외부(새 예측 저장 시)에서 호출해 캐시를 리셋
     */
    public invalidatePendingCache() {
        this._noPendingIntraday = false
        this._noPendingDaily    = false
    }

    /**
     * WebSocket 가격 변동 이벤트 수신 핸들러
     */
    private handleRealtimePriceUpdate(data: any) {
        // ── Guard 1: 장 외 시간이면 스킵 (초당 수십 회 틱 방지) ──
        if (!this.isMarketHours()) return

        // ── Guard 2: 두 캐시가 모두 "할 일 없음"이면 스킵 ──
        if (this._noPendingIntraday && this._noPendingDaily) return

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
     * WebSocket 실시간 메모리 데이터만 사용하여 장중/장전 수익률 즉시 갱신 (DB부하 최소화)
     */
    private async evaluateIntradayRealtime() {
        // 둘 다 실시간 데이터가 수집되지 않았으면 조기 반환
        if (!this.latestPrices['069500'] && !this.latestPrices['114800']) return

        const rawDb  = (this.db as any).db
        const dateStr = this.refreshDateCache()   // 날짜 변경 시 캐시 자동 리셋

        // ── Guard: 두 캐시가 모두 "할 일 없음"이면 DB 접근 자체를 생략 ──
        if (this._noPendingIntraday && this._noPendingDaily) return

        let evaluated = 0

        // 시가(Open) 결측치 보정 (WebSocket이 시가를 안 주면 일봉 API에서 1회 펌핑)
        for (const code of ['069500', '114800']) {
            if (this.latestPrices[code] && this.latestPrices[code].open <= 0) {
                try {
                    const chart = await this.kiwoom.getDailyChartData(code);
                    if (chart && chart.length > 0) {
                        const todayChart = chart.find(c => this.normalizeDate(c.date || c.stck_bsop_date || c.dt || '') === dateStr) || chart[0];
                        this.latestPrices[code].open = Math.abs(Number(todayChart.open_pric || todayChart.opn_prc || todayChart.open || 0));
                    }
                } catch (e) { console.error('Failed to fill ETF Open price', e); }
            }
        }

        // ── 1. 장중 예측(intraday_predictions): 진입가 없는 행 채우기 ──
        if (!this._noPendingIntraday) {
            const pendingIntraday = rawDb.prepare(
                `SELECT id, predict FROM intraday_predictions WHERE date = ? AND (entry_price IS NULL OR entry_price <= 0) AND predict IN ('UP', 'DOWN', 'HOLD')`
            ).all(dateStr) as any[]

            if (pendingIntraday.length === 0) {
                this._noPendingIntraday = true  // 오늘은 더 이상 체크 불필요
            } else {
                for (const row of pendingIntraday) {
                    const etfData = row.predict === 'UP' ? this.latestPrices['069500'] : row.predict === 'DOWN' ? this.latestPrices['114800'] : this.latestPrices['069500']
                    if (!etfData || etfData.price <= 0) continue
                    rawDb.prepare(`UPDATE intraday_predictions SET entry_price = ? WHERE id = ?`).run(etfData.price, row.id)
                    evaluated++
                }
            }
        }

        // ── 2. 일별 예측(agent_predictions): 최근 3일 + entry_price/t1_final 미완성 행 채우기 ──
        // [개선] WHERE절에 날짜 범위 추가 → 전체 테이블 스캔 방지
        if (!this._noPendingDaily) {
            const pendingDaily = rawDb.prepare(`
                SELECT id, date, predict, cycle, entry_price FROM agent_predictions
                WHERE date >= date('now', 'localtime', '-3 days')
                  AND (t1_final IS NULL OR entry_price IS NULL OR entry_price <= 0)
                  AND predict IN ('LONG', 'SHORT', 'UP', 'DOWN', 'HOLD')
            `).all() as any[]

            if (pendingDaily.length === 0) {
                this._noPendingDaily = true  // 최근 3일치 모두 완료됨
            } else {
                for (const row of pendingDaily) {
                    const etfData = (row.predict === 'LONG' || row.predict === 'UP') ? this.latestPrices['069500'] : (row.predict === 'SHORT' || row.predict === 'DOWN') ? this.latestPrices['114800'] : this.latestPrices['069500']
                    // 시가가 없으면 안전하게 통과 (0으로 나누기 방지)
                    if (!etfData || etfData.open <= 0) continue

                    let rowEntryPrice = row.entry_price

                    if (!rowEntryPrice || rowEntryPrice <= 0) {
                        rowEntryPrice = row.cycle === 'A' ? etfData.open : etfData.price;
                        rawDb.prepare(`UPDATE agent_predictions SET entry_price = ? WHERE id = ?`).run(rowEntryPrice, row.id)
                        evaluated++
                    }

                    // [마감(B) 예측 당일 아침 즉각 채점]
                    if (row.cycle === 'B' && rowEntryPrice > 0 && row.date < dateStr) {
                        const finalReturn = ((etfData.open - rowEntryPrice) / rowEntryPrice) * 100;
                        rawDb.prepare(`UPDATE agent_predictions SET t1_final = ?, t1_peak = ? WHERE id = ?`).run(finalReturn, finalReturn, row.id)
                        evaluated++
                        console.log(`[MCA-Tracker] Cycle B 익일 장전 즉각 평가 확정: ${row.id} return=${finalReturn.toFixed(2)}%`)
                    }
                }
            }
        }

        // 변경사항(최초 진입가 세팅)이 있었을 때만 UI 새로고침 이벤트 발송
        if (evaluated > 0) {
            eventBus.emit('INTRADAY_PREDICTION_UPDATED' as any, null)
            eventBus.emit('MARKET_CONDITION_COMPLETE' as any, null)
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
        const rawDb = (this.db as any).db;

        // --- 임시 DB 클리닝 로직 (잘못 저장된 포지션 원상복구) ---
        try {
            rawDb.prepare(`UPDATE intraday_predictions SET position = 'KODEX 200' WHERE position LIKE '%HOLD(KODEX 200 기준)%' AND time_slot IN ('09:45', '10:15')`).run();
            rawDb.prepare(`UPDATE intraday_predictions SET position = 'HOLD' WHERE position LIKE '%HOLD(KODEX 200 기준)%' OR position = '- HOLD'`).run();
        } catch (e) {
            console.error('[MCA-Tracker] DB 클리닝 에러:', e);
        }
        // -------------------------------------------------------------

        const today = new Date()
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

        // 최근 5일 중 max_price가 없는 것들을 소급 평가 (과거 날짜 포함)
        const pending = rawDb.prepare(`
            SELECT * FROM intraday_predictions 
            WHERE date >= date('now', 'localtime', '-5 days')
              AND predict IN ('UP', 'DOWN', 'HOLD')
            ORDER BY date ASC, time_slot ASC
        `).all() as any[]

        if (pending.length === 0) {
            console.log('[MCA-Tracker] 장중 평가 대상 없음 (최근 5일 내 미평가 데이터 없음)')
            return
        }
        console.log(`[MCA-Tracker] 소급 평가 대상: ${pending.length}건`)

        // 일봉 데이터 (모든 날짜의 종가/고가 조회용 - 80봉 충분)
        const chartK200Daily = await this.fetchParsedChart('069500')
        const chartInvDaily = await this.fetchParsedChart('114800')

        // 5분봉 3일치 로드 (오늘 + 전일 포함하여 날짜별로 진입시간 이후 고점 계산)
        let chartK200_5m: any[] = []
        let chartInv_5m: any[] = []
        try {
            chartK200_5m = await KiwoomService.getInstance().getOhlcv5m('069500', 3)
            chartInv_5m = await KiwoomService.getInstance().getOhlcv5m('114800', 3)
            console.log(`[MCA-Tracker] 5분봉 로드(3일치): K200=${chartK200_5m.length}봉, INV=${chartInv_5m.length}봉`)
        } catch (e: any) {
            console.warn('[MCA-Tracker] 5분봉 로드 실패, 일봉 고가로 대체:', e.message)
        }

        const todayK200Info = chartK200Daily.find((c: any) => c.date === dateStr) || chartK200Daily[0]

        let evaluated = 0
        for (const row of pending) {
            // 사용자의 요청: 스웜 기준(predict)이 아닌 포지션 기준(position)으로 평가
            const actualPosition = (row.position || row.predict || '').toUpperCase();
            
            // "UP", "LONG", "KODEX 200" 등은 상방. "DOWN", "SHORT", "인버스" 등은 하방. 
            // 둘 다 아니면 (주로 "HOLD") 관망.
            const isUpPos = actualPosition.includes('UP') || actualPosition.includes('LONG') || (actualPosition.includes('200') && !actualPosition.includes('HOLD') && !actualPosition.includes('인버스'));
            const isDownPos = actualPosition.includes('DOWN') || actualPosition.includes('SHORT') || (actualPosition.includes('인버스') && !actualPosition.includes('HOLD'));
            const isHoldPos = !isUpPos && !isDownPos;

            // 해당 날짜의 ETF 일봉 데이터 조회 (하방일 때만 인버스)
            const etfDailyArr = isDownPos ? chartInvDaily : chartK200Daily;
            const rowEtfDaily = etfDailyArr.find((c: any) => c.date === row.date);

            if (!rowEtfDaily) {
                console.warn(`[MCA-Tracker] ${row.date} ETF 일봉 없음, 스킵: ${row.id}`);
                continue;
            }

            // 진입가 보호 (기존 진입가가 있으면 사용, 없으면 시가)
            const entryPrice = (row.entry_price > 0) ? row.entry_price : rowEtfDaily.open;
            const closePrice = rowEtfDaily.close;
            // 종가 기준 수익률
            const returnPct = ((closePrice - entryPrice) / entryPrice) * 100;

            // 고점: 5분봉에서 해당 날짜 + 진입시간 이후 캔들만 필터해서 MAX(high)
            let maxHigh = rowEtfDaily.high; // fallback
            const candles5m = isDownPos ? chartInv_5m : chartK200_5m;
            
            if (candles5m.length > 0 && row.time_slot) {
                const hmMatch = row.time_slot.match(/(\d{2}):(\d{2})/);
                if (hmMatch) {
                    const [year, month, day] = row.date.split('-').map(Number);
                    const entryEpoch = new Date(year, month - 1, day, parseInt(hmMatch[1]), parseInt(hmMatch[2]), 0).getTime() / 1000;
                    const dayEndEpoch = new Date(year, month - 1, day, 23, 59, 59).getTime() / 1000;
                    const afterEntry = candles5m.filter((c: any) => c.time >= entryEpoch && c.time <= dayEndEpoch);
                    if (afterEntry.length > 0) {
                        maxHigh = Math.max(...afterEntry.map((c: any) => c.high));
                    }
                }
            }
            const maxReturnPct = ((maxHigh - entryPrice) / entryPrice) * 100;

            // ═══ 정량 평가 및 횡보(Sideways)/추세(Trend) 판별 ═══
            // 추세장(Trend) 기준: 종가 변동성 절대값 0.5% 이상 OR 최대 변동성 1.0% 이상
            const isTrend = Math.abs(returnPct) >= 0.5 || maxReturnPct >= 1.0;

            let result: string;
            if (isUpPos || isDownPos) {
                if (isTrend) {
                    // 추세가 터졌을 때 내 방향으로 터졌는가 (내 포지션 수익이 >0.5% or Max >1.0%)
                    if (returnPct >= 0.5 || maxReturnPct >= 1.0) {
                        result = 'HIT';
                    } else {
                        result = 'MISS';
                    }
                } else {
                    // 횡보장인데 억지 방향 베팅 -> 수수료 등 패배로 산정
                    result = 'MISS';
                }
            } else { 
                // HOLD (관망)
                if (isTrend) {
                    // 크게 오르거나 내렸는데 HOLD 하고 기회를 날림 -> MISS
                    result = 'MISS';
                } else {
                    // 잔파도/횡보장이었으므로 베팅하지 않은 것이 올바른 결정 -> 방어 성공(HIT)
                    result = 'HIT';
                }
            }

            const rowK200Info = chartK200Daily.find((c: any) => c.date === row.date) || todayK200Info;
            const isToday = (row.date === dateStr);

            // 주의: 사용자의 position 기록을 이 과정에서 덮어쓰지 않게 필드 제외
            rawDb.prepare(`
                UPDATE intraday_predictions 
                SET entry_price = ?, close_price = ?, return_pct = ?, 
                    max_price = ?, max_return_pct = ?,
                    close_kospi = ?, result = ?
                WHERE id = ?
            `).run(entryPrice, closePrice, returnPct, maxHigh, maxReturnPct, rowK200Info?.close ?? 0, result, row.id);

            console.log(`[MCA-Tracker] 장중평가${isToday ? '' : '(소급)'} [${row.date}] ${row.time_slot}: ${actualPosition} entry=${entryPrice} 고점=${maxHigh} close=${closePrice} | 결과:${result} (Trend:${isTrend}, 변동:${maxReturnPct.toFixed(2)}%, 종가:${returnPct.toFixed(2)}%)`);
            evaluated++;

            this.trackPersonaPerformance(row, returnPct, isTrend)
        }
        
        if (evaluated > 0) {
            console.log(`[MCA-Tracker] 장중 예측 ${evaluated}건 평가 완료 (소급 포함)`)
            eventBus.emit('INTRADAY_PREDICTION_UPDATED' as any, null)
        }
    }

    /**
     * 메인 예측 평가 시점에 개별 페르소나의 댓글들도 모아서 채점.
     * @param row intraday_predictions DB row
     * @param masterReturnPct 선택된 포지션 KODEX의 최종 수익률
     */
    private trackPersonaPerformance(row: any, masterReturnPct: number, isTrend: boolean) {
        if (!row.comments_json) return;
        
        try {
            const comments = JSON.parse(row.comments_json);
            const rawDb = (this.db as any).db;
            
            for (const c of comments) {
                if (!c.id || !c.predict) continue;

                let pResult = 'HOLD';
                let pIsHit = 0;

                // 마스터의 수익률을 바탕으로 시장의 상승/하락을 유추
                // row.predict가 UP/HOLD면 masterReturnPct은 KODEX200 수익률
                const isK200Assumed = row.predict === 'UP' || row.predict === 'HOLD';
                const marketWentUp = isK200Assumed ? masterReturnPct > 0 : masterReturnPct < 0;
                const marketWentDown = isK200Assumed ? masterReturnPct < 0 : masterReturnPct > 0;

                if (c.predict === 'UP') {
                    if (isTrend) {
                        pIsHit = marketWentUp ? 1 : 0;
                        pResult = marketWentUp ? 'HIT' : 'MISS';
                    } else {
                        pIsHit = 0; pResult = 'MISS'; 
                    }
                } else if (c.predict === 'DOWN') {
                    if (isTrend) {
                        pIsHit = marketWentDown ? 1 : 0;
                        pResult = marketWentDown ? 'HIT' : 'MISS';
                    } else {
                        pIsHit = 0; pResult = 'MISS';
                    }
                } else if (c.predict === 'HOLD') {
                    if (isTrend) {
                        pIsHit = 0; pResult = 'MISS'; // 방관에 따른 기회비용 상실
                    } else {
                        pIsHit = 1; pResult = 'HIT'; // 불확실성 방어
                    }
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
    public getPersonaWeights(): Record<string, { winRate: number, recent10Rate: number, weight: number, hits: number, total: number, todayRate: number | null }> {
        const rawDb = (this.db as any).db;
        const weights: Record<string, { winRate: number, recent10Rate: number, weight: number, hits: number, total: number, todayRate: number | null }> = {};
        
        try {
            // 오늘 날짜(KST 기준)
            const kstDate = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); // YYYY-MM-DD

            // 최근 30일 이력 가져오기 (가장 최근 순으로 정렬)
            const records = rawDb.prepare(`
                SELECT persona_id, is_hit, predict, date
                FROM persona_performance
                WHERE date >= date('now', 'localtime', '-30 days')
                ORDER BY created_at DESC
            `).all() as any[];

            // 페르소나별 분리
            const personaRecords: Record<string, any[]> = {};
            for (const r of records) {
                if (!personaRecords[r.persona_id]) personaRecords[r.persona_id] = [];
                personaRecords[r.persona_id].push(r);
            }

            for (const personaId in personaRecords) {
                const myRecords = personaRecords[personaId];
                const total = myRecords.length;
                const hits = myRecords.filter(r => r.is_hit === 1).length;
                const winRate = total > 0 ? (hits / total) * 100 : 50;
                
                // 최근 10회 승률 (records가 이미 DESC 정렬됨)
                const recent10 = myRecords.slice(0, 10);
                const recent10Hits = recent10.filter(r => r.is_hit === 1).length;
                const recent10Total = recent10.length;
                const recent10Rate = recent10Total > 0 ? (recent10Hits / recent10Total) * 100 : 50;

                // 가중치(Weight) 공식: 전체 승률 30% + 최근 10회 승률 70%
                const combinedScore = (winRate * 0.3) + (recent10Rate * 0.7);
                let weight = 1.0;

                if (total >= 5) {
                    weight = Math.max(0.0, combinedScore / 50.0);
                    // 도태 시스템: combinedScore가 30 미만이면 발언권 박탈
                    if (combinedScore < 30) weight = 0.0;
                }
                
                // 오늘 승률 구하기
                const todayRecords = myRecords.filter(r => r.date === kstDate);
                let todayRate: number | null = null;
                if (todayRecords.length > 0) {
                    const todayHits = todayRecords.filter(r => r.is_hit === 1).length;
                    todayRate = Math.round((todayHits / todayRecords.length) * 100);
                }
                
                weights[personaId] = {
                    winRate: Math.round(winRate),
                    recent10Rate: Math.round(recent10Rate),
                    weight: Number(weight.toFixed(2)),
                    hits,
                    total,
                    todayRate
                };
            }
        } catch(e) {
            console.error('[PerformanceTracker] 페르소나 가중치 계산 오류:', e);
        }

        return weights;
    }
}
