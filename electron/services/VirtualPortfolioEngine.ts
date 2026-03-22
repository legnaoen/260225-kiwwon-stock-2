import { DatabaseService } from './DatabaseService'

/**
 * VirtualPortfolioEngine
 * 
 * NAV(순자산가치) 기반 가상 포트폴리오 엔진.
 * PM AI의 BUY/SELL 시그널에 따라 가상 매수/매도를 실행하고,
 * 일별 NAV 스냅샷을 기록하여 KOSPI 대비 수익률을 추적한다.
 * 
 * 설계 원칙:
 * - 가상 원금 10,000,000원 (초기 전액 현금)
 * - BUY: 현금에서 (가용현금 / 활성종목수) 배분, 매수 주수 계산
 * - SELL: 보유 주수 × 매도가 → 현금 회수
 * - 일별: NAV = 현금 + Σ(보유주수 × 종가), KOSPI 대비 Alpha 계산
 * - 리밸런싱 없음 (신규 편입 시 현금에서만 배분)
 */
export class VirtualPortfolioEngine {
    private static instance: VirtualPortfolioEngine
    private db = DatabaseService.getInstance()
    private readonly INITIAL_CAPITAL = 10_000_000

    private constructor() {}

    public static getInstance(): VirtualPortfolioEngine {
        if (!VirtualPortfolioEngine.instance) {
            VirtualPortfolioEngine.instance = new VirtualPortfolioEngine()
        }
        return VirtualPortfolioEngine.instance
    }

    /**
     * 현재 가용 현금 계산
     * latest snapshot의 cash 값을 사용하거나, 없으면 초기자본에서 invested 차감
     */
    public getCurrentCash(): number {
        const latestSnap = this.db.getLatestDailySnapshot()
        if (latestSnap) return latestSnap.cash

        // 스냅샷이 없으면 maiis_portfolio에서 투자금 합산하여 계산
        const active = this.db.getActivePortfolio()
        const totalInvested = active.reduce((sum: number, item: any) => sum + (item.invested_amount || 0), 0)
        return this.INITIAL_CAPITAL - totalInvested
    }

    /**
     * 매수 실행 (가상)
     * 
     * @param stockCode 종목코드
     * @param stockName 종목명
     * @param price 매수 단가 (장중=현재가, 비장중=다음 거래일 시가)
     * @param isMarketOpen 현재 장중인지 여부
     * @returns 매수 결과 (주수, 투자금, 잔여 현금)
     */
    public executeBuy(stockCode: string, stockName: string, price: number, isMarketOpen: boolean): {
        success: boolean
        shares: number
        investedAmount: number
        remainingCash: number
        pending: boolean
    } {
        if (price <= 0) {
            console.warn(`[VPE] Invalid price for ${stockCode}: ${price}`)
            return { success: false, shares: 0, investedAmount: 0, remainingCash: this.getCurrentCash(), pending: false }
        }

        const cash = this.getCurrentCash()
        const active = this.db.getActivePortfolio()
        // 자신을 포함한 활성 종목 수 (이미 존재하는 종목이면 +0, 아니면 +1)
        const alreadyExists = active.some((a: any) => a.stock_code === stockCode)
        const activeCount = alreadyExists ? active.length : active.length + 1
        
        if (activeCount <= 0) {
            return { success: false, shares: 0, investedAmount: 0, remainingCash: cash, pending: false }
        }

        const allocAmount = cash / activeCount
        const minAmount = 100_000 // 최소 10만원
        
        if (allocAmount < minAmount) {
            console.warn(`[VPE] Insufficient cash for ${stockCode}. Cash: ${cash}, Alloc: ${allocAmount}`)
            return { success: false, shares: 0, investedAmount: 0, remainingCash: cash, pending: false }
        }

        if (!isMarketOpen) {
            // 비장중: pending 상태로 등록, 다음 거래일 시가로 확정 예정
            console.log(`[VPE] ${stockCode} → PENDING_ENTRY (next trading day open price)`)
            return { success: true, shares: 0, investedAmount: 0, remainingCash: cash, pending: true }
        }

        // 장중: 즉시 매수 확정
        const shares = Math.floor(allocAmount / price)
        if (shares <= 0) {
            return { success: false, shares: 0, investedAmount: 0, remainingCash: cash, pending: false }
        }

        const investedAmount = shares * price
        const remainingCash = cash - investedAmount

        console.log(`[VPE] BUY ${stockCode} (${stockName}): ${shares}주 × ₩${price} = ₩${investedAmount.toLocaleString()}`)
        
        return { success: true, shares, investedAmount, remainingCash, pending: false }
    }

    /**
     * Pending 종목의 매수 확정 (다음 거래일 시가 수신 시)
     */
    public confirmPendingEntry(stockCode: string, openPrice: number): {
        success: boolean
        shares: number
        investedAmount: number
    } {
        const cash = this.getCurrentCash()
        const active = this.db.getActivePortfolio()
        const activeCount = active.length

        const allocAmount = cash / Math.max(activeCount, 1)
        const shares = Math.floor(allocAmount / openPrice)
        
        if (shares <= 0) {
            return { success: false, shares: 0, investedAmount: 0 }
        }

        const investedAmount = shares * openPrice
        console.log(`[VPE] CONFIRM ${stockCode}: ${shares}주 × ₩${openPrice} = ₩${investedAmount.toLocaleString()}`)
        
        return { success: true, shares, investedAmount }
    }

    /**
     * 매도 실행 (가상)
     */
    public executeSell(stockCode: string, sellPrice: number): {
        success: boolean
        returnedCash: number
        profitRate: number
        profit: number
    } {
        const item = this.db.getPortfolioItem(stockCode)
        if (!item) {
            console.warn(`[VPE] Portfolio item not found: ${stockCode}`)
            return { success: false, returnedCash: 0, profitRate: 0, profit: 0 }
        }

        const shares = item.entry_shares || 0
        const entryPrice = item.actual_entry_price || item.entry_price || 0
        
        if (shares <= 0 || entryPrice <= 0) {
            console.warn(`[VPE] Invalid position for ${stockCode}: shares=${shares}, entryPrice=${entryPrice}`)
            return { success: false, returnedCash: 0, profitRate: 0, profit: 0 }
        }

        const returnedCash = shares * sellPrice
        const investedAmount = shares * entryPrice
        const profit = returnedCash - investedAmount
        const profitRate = ((sellPrice / entryPrice) - 1) * 100

        console.log(`[VPE] SELL ${stockCode} (${item.stock_name}): ${shares}주 × ₩${sellPrice} = ₩${returnedCash.toLocaleString()} (${profitRate > 0 ? '+' : ''}${profitRate.toFixed(1)}%)`)
        
        return { success: true, returnedCash, profitRate, profit }
    }

    /**
     * 일별 NAV 스냅샷 기록
     * 장 마감 후 호출. 각 보유 종목의 종가와 KOSPI 종가를 받아 NAV를 계산.
     * 
     * @param closingPrices Map<stockCode, 종가>
     * @param kospiClose 오늘 KOSPI 종가
     * @param date 날짜 ('YYYYMMDD')
     */
    public recordDailySnapshot(
        closingPrices: Map<string, number>,
        kospiClose: number,
        date: string
    ): void {
        const active = this.db.getActivePortfolio()
        const closed = this.db.getClosedPortfolio()

        // 현금 계산: 이전 스냅샷 cash - 이후 투자금 + 이후 회수금
        const prevSnap = this.db.getLatestDailySnapshot()
        let cash = prevSnap ? prevSnap.cash : this.INITIAL_CAPITAL

        // 활성 종목 평가액 계산
        let invested = 0
        const positionDetails: any[] = []

        for (const item of active) {
            const shares = item.entry_shares || 0
            const entryPrice = item.actual_entry_price || item.entry_price || 0
            
            if (shares <= 0) continue

            const currentPrice = closingPrices.get(item.stock_code) || item.current_price || entryPrice
            const positionValue = shares * currentPrice
            const positionProfit = entryPrice > 0 ? ((currentPrice / entryPrice) - 1) * 100 : 0
            
            invested += positionValue

            // 종목별 current_price, profit_rate 업데이트
            this.db.getDb().prepare(`
                UPDATE maiis_portfolio SET current_price = ?, profit_rate = ?, updated_at = ?
                WHERE stock_code = ?
            `).run(currentPrice, Math.round(positionProfit * 10) / 10, new Date().toISOString(), item.stock_code)

            positionDetails.push({
                code: item.stock_code,
                name: item.stock_name,
                shares,
                price: currentPrice,
                value: positionValue,
                profit: Math.round(positionProfit * 10) / 10
            })
        }

        // NAV (현재 현금이 활성화된 매수/매도로 변동됨)
        // 실제 현금 = 초기자본 - 투입금 합계 + 회수금 합계
        const totalInvestedCost = active.reduce((sum: number, a: any) => sum + (a.invested_amount || 0), 0)
        const totalReturnedCash = closed.reduce((sum: number, c: any) => {
            const shares = c.entry_shares || 0
            const closedPrice = c.closed_price || 0
            return sum + (shares * closedPrice)
        }, 0)
        cash = this.INITIAL_CAPITAL - totalInvestedCost + totalReturnedCash
        
        const nav = cash + invested
        const portfolioReturn = ((nav / this.INITIAL_CAPITAL) - 1) * 100
        
        // 전일 대비 수익률
        const prevNav = prevSnap?.nav || this.INITIAL_CAPITAL
        const dailyReturn = ((nav / prevNav) - 1) * 100

        // KOSPI 기준가 (첫 스냅샷의 kospi_close를 사용)
        const allSnapshots = this.db.getDailySnapshots(1) // oldest first
        const kospiBase = (allSnapshots.length > 0 && allSnapshots[0].kospi_base > 0)
            ? allSnapshots[0].kospi_base
            : kospiClose // 첫 기록이면 오늘이 기준
        const kospiReturn = kospiBase > 0 ? ((kospiClose / kospiBase) - 1) * 100 : 0
        const alpha = portfolioReturn - kospiReturn

        // 승/패 집계
        const wins = closed.filter((c: any) => (c.closed_profit_rate || 0) > 0).length
        const losses = closed.filter((c: any) => (c.closed_profit_rate || 0) <= 0).length

        const snapshot = {
            date,
            nav: Math.round(nav),
            cash: Math.round(cash),
            invested: Math.round(invested),
            portfolio_return: Math.round(portfolioReturn * 100) / 100,
            daily_return: Math.round(dailyReturn * 100) / 100,
            kospi_close: kospiClose,
            kospi_base: kospiBase,
            kospi_return: Math.round(kospiReturn * 100) / 100,
            alpha: Math.round(alpha * 100) / 100,
            active_count: active.filter((a: any) => (a.entry_shares || 0) > 0).length,
            total_trades: closed.length,
            win_count: wins,
            lose_count: losses,
            snapshot_json: JSON.stringify(positionDetails),
        }

        this.db.upsertDailySnapshot(snapshot)
        console.log(`[VPE] Daily snapshot ${date}: NAV=₩${nav.toLocaleString()}, Return=${portfolioReturn.toFixed(1)}%, Alpha=${alpha.toFixed(1)}%p`)
    }

    /**
     * 장중 여부 판별
     */
    public isMarketOpen(): boolean {
        const now = new Date()
        const kstOffset = 9 * 60
        const kst = new Date(now.getTime() + (now.getTimezoneOffset() + kstOffset) * 60000)
        const day = kst.getDay()
        const hours = kst.getHours()
        const minutes = kst.getMinutes()
        const time = hours * 100 + minutes
        return day >= 1 && day <= 5 && time >= 900 && time <= 1530
    }
}
