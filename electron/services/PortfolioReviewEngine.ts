import { DatabaseService } from './DatabaseService'
import { VirtualPortfolioEngine } from './VirtualPortfolioEngine'
import { StrategyProfileService, StrategyProfile } from './StrategyProfileService'
import { eventBus, SystemEvent } from '../utils/EventBus'

export interface HardRuleResult {
    action: 'FORCE_SELL' | 'AI_REVIEW'
    reason: string
    ruleType: 'STOP_LOSS' | 'TAKE_PROFIT' | 'TRAILING_STOP' | 'FORCE_CLOSE' | 'HOLD_LIMIT'
    item: any
    profitRate: number
}

/**
 * 포트폴리오 리뷰 엔진
 * 
 * 장 마감 후(PM_CLOSING) 또는 장중(PM_INTRADAY) 실행되어
 * 전략 프로파일의 하드룰을 체크하고 강제 청산 또는 AI 재심사를 트리거합니다.
 */
export class PortfolioReviewEngine {
    private static instance: PortfolioReviewEngine
    private db = DatabaseService.getInstance()
    private vpe = VirtualPortfolioEngine.getInstance()
    private profileService = StrategyProfileService.getInstance()

    private constructor() {}

    public static getInstance(): PortfolioReviewEngine {
        if (!PortfolioReviewEngine.instance) {
            PortfolioReviewEngine.instance = new PortfolioReviewEngine()
        }
        return PortfolioReviewEngine.instance
    }

    /**
     * 하드룰 체크 (모든 보유종목 대상)
     * @param mode INTRADAY(14:50) 또는 CLOSING(15:45)
     * @returns 강제 청산된 종목 + AI 재심사 대상 종목
     */
    public checkHardRules(mode: 'INTRADAY' | 'CLOSING'): {
        forceSells: HardRuleResult[]
        aiReviews: HardRuleResult[]
    } {
        const active = this.db.getActivePortfolio()
        const forceSells: HardRuleResult[] = []
        const aiReviews: HardRuleResult[] = []

        for (const item of active) {
            if ((item.entry_shares || 0) <= 0) continue // 가상 매수 미확정 종목 skip

            const profile = this.profileService.getProfile(item.strategy || 'SWING')
            const profitRate = item.profit_rate || 0
            const daysHeld = item.days_held || 0

            // ─── 1. 비상 손절 (모든 전략, 최우선) ───
            if (profitRate <= profile.hardStopLoss) {
                forceSells.push({
                    action: 'FORCE_SELL',
                    reason: `하드 손절 (${profitRate.toFixed(1)}% ≤ ${profile.hardStopLoss}%)`,
                    ruleType: 'STOP_LOSS',
                    item,
                    profitRate,
                })
                continue
            }

            // ─── 2. 하드 익절 (Track A만, hardTakeProfit > 0) ───
            if (profile.hardTakeProfit > 0 && profitRate >= profile.hardTakeProfit) {
                forceSells.push({
                    action: 'FORCE_SELL',
                    reason: `하드 익절 (${profitRate.toFixed(1)}% ≥ +${profile.hardTakeProfit}%)`,
                    ruleType: 'TAKE_PROFIT',
                    item,
                    profitRate,
                })
                continue
            }

            // ─── 3. 트레일링 스탑 (SWING) ───
            if (profile.trailingStopPct < 0) {
                const highPrice = item.high_price || item.actual_entry_price || item.entry_price || 0
                const currentPrice = item.current_price || 0
                if (highPrice > 0 && currentPrice > 0) {
                    const dropFromHigh = ((currentPrice / highPrice) - 1) * 100
                    if (dropFromHigh <= profile.trailingStopPct) {
                        forceSells.push({
                            action: 'FORCE_SELL',
                            reason: `트레일링 스탑 (고점 대비 ${dropFromHigh.toFixed(1)}% ≤ ${profile.trailingStopPct}%)`,
                            ruleType: 'TRAILING_STOP',
                            item,
                            profitRate,
                        })
                        continue
                    }
                }
            }

            // ─── 4. DAYTRADING 강제청산 (장중 INTRADAY에서만) ───
            if (profile.forceCloseTime && mode === 'INTRADAY') {
                if (item.strategy === 'DAYTRADING') {
                    const now = this.getCurrentKstTime()
                    if (now >= profile.forceCloseTime) {
                        forceSells.push({
                            action: 'FORCE_SELL',
                            reason: `장마감 강제청산 (${profile.forceCloseTime} 도과)`,
                            ruleType: 'FORCE_CLOSE',
                            item,
                            profitRate,
                        })
                        continue
                    }
                }
            }

            // ─── 5. 보유기간 초과 → AI 재심사 대상 ───
            if (profile.maxHoldDays > 0) {
                const extensionUsed = item.extension_used || 0
                const deadline = profile.maxHoldDays + (extensionUsed ? profile.extensionDays : 0)
                if (daysHeld >= deadline) {
                    aiReviews.push({
                        action: 'AI_REVIEW',
                        reason: `보유기간 초과 (${daysHeld}일 ≥ ${deadline}일)`,
                        ruleType: 'HOLD_LIMIT',
                        item,
                        profitRate,
                    })
                }
            }

            // ─── 6. Track B conviction 하락 → AI 재심사 대상 ───
            if (profile.managementMode === 'AI_DRIVEN' && profile.minConviction > 0) {
                if ((item.conviction_score || 100) <= profile.minConviction) {
                    aiReviews.push({
                        action: 'AI_REVIEW',
                        reason: `conviction 하락 (${item.conviction_score} ≤ ${profile.minConviction})`,
                        ruleType: 'HOLD_LIMIT',
                        item,
                        profitRate,
                    })
                }
            }
        }

        return { forceSells, aiReviews }
    }

    /**
     * 하드룰에 의한 강제 청산 실행
     */
    public executeForceSells(forceSells: HardRuleResult[]): number {
        let executed = 0
        const today = this.db.getKstDate().replace(/-/g, '')

        for (const result of forceSells) {
            const item = result.item
            const sellPrice = item.current_price || 0
            if (sellPrice <= 0) continue

            // VPE 매도
            const sellResult = this.vpe.executeSell(item.stock_code, sellPrice)
            if (sellResult.success) {
                // DB 청산 기록
                this.db.closePortfolioItem(item.stock_code, sellPrice, today)
                executed++

                const log = `[하드룰] ${result.ruleType}: ${item.stock_name}(${item.stock_code}) ${result.reason} → 청산 (${sellResult.profitRate > 0 ? '+' : ''}${sellResult.profitRate.toFixed(1)}%)`
                console.log(log)
                eventBus.emit(SystemEvent.AUTO_TRADE_LOG, {
                    time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                    message: log,
                    level: sellResult.profitRate >= 0 ? 'SUCCESS' : 'WARNING',
                })
            }
        }

        return executed
    }

    /**
     * 보유 중 최고가 갱신 (트레일링 스탑용)
     * 장 마감 후 호출
     */
    public updateHighPrices(): void {
        const active = this.db.getActivePortfolio()
        for (const item of active) {
            const currentPrice = item.current_price || 0
            const highPrice = item.high_price || 0
            if (currentPrice > highPrice) {
                this.db.getDb().prepare(
                    'UPDATE maiis_portfolio SET high_price = ? WHERE stock_code = ?'
                ).run(currentPrice, item.stock_code)
            }
        }
    }

    /**
     * 전체 리뷰 루프 실행 (PM_INTRADAY 또는 PM_CLOSING 시 호출)
     */
    public async runReviewLoop(mode: 'INTRADAY' | 'CLOSING'): Promise<{
        forceSellCount: number
        aiReviewCount: number
        forceSells: HardRuleResult[]
        aiReviews: HardRuleResult[]
    }> {
        console.log(`[ReviewEngine] === ${mode} Review 시작 ===`)

        // 1. 하드룰 체크
        const { forceSells, aiReviews } = this.checkHardRules(mode)

        // 2. 강제 청산 실행
        const forceSellCount = this.executeForceSells(forceSells)

        // 3. high_price 갱신 (CLOSING일 때)
        if (mode === 'CLOSING') {
            this.updateHighPrices()
        }

        console.log(`[ReviewEngine] === ${mode} Review 완료: 강제청산 ${forceSellCount}건, AI재심사 ${aiReviews.length}건 ===`)

        return {
            forceSellCount,
            aiReviewCount: aiReviews.length,
            forceSells,
            aiReviews,
        }
    }

    /**
     * 전 보유종목 현재가 일괄 갱신 (하드룰 체크 전 필수 선행)
     * 키움 API를 통해 현재가를 조회하고 maiis_portfolio의 current_price, profit_rate를 업데이트
     */
    public async refreshCurrentPrices(): Promise<number> {
        const active = this.db.getActivePortfolio()
        const validItems = active.filter((item: any) => (item.entry_shares || 0) > 0 && item.stock_code)
        
        if (validItems.length === 0) return 0

        let updated = 0
        try {
            const { KiwoomService } = await import('./KiwoomService')
            const kiwoom = KiwoomService.getInstance()

            for (const item of validItems) {
                try {
                    const priceData = await kiwoom.getCurrentPrice(item.stock_code)
                    // 키움 API 응답에서 현재가 추출 (다양한 응답 형식 대응)
                    const rawPrice = priceData?.cur_prc || priceData?.stck_prpr || priceData?.Body?.cur_prc || 0
                    const currentPrice = Math.abs(Number(rawPrice))

                    if (currentPrice > 0) {
                        const entryPrice = item.actual_entry_price || item.entry_price || 0
                        const profitRate = entryPrice > 0 ? ((currentPrice / entryPrice) - 1) * 100 : 0

                        this.db.getDb().prepare(`
                            UPDATE maiis_portfolio SET current_price = ?, profit_rate = ?, updated_at = ?
                            WHERE stock_code = ?
                        `).run(currentPrice, Math.round(profitRate * 10) / 10, new Date().toISOString(), item.stock_code)

                        // high_price 갱신 (트레일링 스탑용)
                        const highPrice = item.high_price || 0
                        if (currentPrice > highPrice) {
                            this.db.getDb().prepare(
                                'UPDATE maiis_portfolio SET high_price = ? WHERE stock_code = ?'
                            ).run(currentPrice, item.stock_code)
                        }

                        updated++
                    }
                } catch (e) {
                    console.warn(`[ReviewEngine] 현재가 조회 실패: ${item.stock_code} (${item.stock_name})`)
                }
            }
            console.log(`[ReviewEngine] 현재가 갱신 완료: ${updated}/${validItems.length}건`)
        } catch (e) {
            console.error('[ReviewEngine] 현재가 갱신 전체 실패:', e)
        }
        return updated
    }

    /**
     * 장 시작 후 PENDING_ENTRY 종목을 현재가(09:15 기준)로 가상 매수(확정)
     */
    public async processPendingOrders(): Promise<number> {
        const active = this.db.getActivePortfolio()
        const pendingItems = active.filter((item: any) => item.entry_pending === 1 && item.stock_code)
        
        if (pendingItems.length === 0) return 0

        let processedCount = 0
        try {
            const { KiwoomService } = await import('./KiwoomService')
            const kiwoom = KiwoomService.getInstance()

            for (const item of pendingItems) {
                try {
                    const priceData = await kiwoom.getCurrentPrice(item.stock_code)
                    const rawPrice = priceData?.cur_prc || priceData?.stck_prpr || priceData?.Body?.cur_prc || 0
                    const openPrice = Math.abs(Number(rawPrice))

                    if (openPrice > 0) {
                        const result = this.vpe.confirmPendingEntry(item.stock_code, openPrice)
                        if (result.success) {
                            this.db.getDb().prepare(`
                                UPDATE maiis_portfolio 
                                SET status = 'HOLDING', 
                                    entry_pending = 0, 
                                    entry_shares = ?, 
                                    invested_amount = ?, 
                                    actual_entry_price = ?,
                                    current_price = ?,
                                    high_price = ?,
                                    updated_at = ?
                                WHERE stock_code = ?
                            `).run(result.shares, result.investedAmount, openPrice, openPrice, openPrice, new Date().toISOString(), item.stock_code)

                            const logMsg = `[매수확정] ${item.stock_name}(${item.stock_code}) 예약 체결 완료 (${result.shares}주, 매입가: ₩${openPrice.toLocaleString()})`
                            console.log(logMsg)
                            eventBus.emit(SystemEvent.AUTO_TRADE_LOG, {
                                time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                                message: logMsg,
                                level: 'SUCCESS',
                            })
                            processedCount++
                        } else {
                            // 잔고 부족 등 실패 시 취소 처리
                            this.db.getDb().prepare(`
                                UPDATE maiis_portfolio 
                                SET status = 'WATCHLIST', entry_pending = 0, updated_at = ?
                                WHERE stock_code = ?
                            `).run(new Date().toISOString(), item.stock_code)
                            console.log(`[매수취소] 잔고 부족 등으로 예약 매수 취소: ${item.stock_name}`)
                        }
                    }
                } catch (e) {
                    console.warn(`[ReviewEngine] PENDING 종목 매수 실패 (${item.stock_code}):`, e)
                }
            }
        } catch (e) {
            console.error('[ReviewEngine] PENDING 처리 핵심 예외 발생:', e)
        }
        return processedCount
    }

    private getCurrentKstTime(): string {
        const now = new Date()
        const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000)
        return `${String(kst.getHours()).padStart(2, '0')}:${String(kst.getMinutes()).padStart(2, '0')}`
    }
}
