import { useEffect, useRef } from 'react'
import { useSignalStore } from '../store/useSignalStore'
import { useBackgroundSignalFetcher } from './useBackgroundSignalFetcher'

export function useGlobalSignalMonitor() {
    const { previous19DaysSum } = useSignalStore()
    const { enqueueSymbols } = useBackgroundSignalFetcher()
    const notifiedSlumpRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        // 1. Initial and Periodic Watchlist/Holdings symbol registration
        const registerSymbols = async () => {
            if (!window.electronAPI) return

            try {
                // Get Watchlist symbols
                const watchlistSymbols = await window.electronAPI.getWatchlistSymbols()

                // Get Holdings symbols (from any available account)
                const accountsResult = await window.electronAPI.getAccountList()
                let holdingSymbols: string[] = []

                if (accountsResult.success && accountsResult.data.length > 0) {
                    const accountNo = accountsResult.data[0] // Just use the first one for background check
                    const holdingsResult = await window.electronAPI.getHoldings({ accountNo })
                    if (holdingsResult.success) {
                        const hBody = holdingsResult.data?.Body || holdingsResult.data
                        const listData = hBody?.acnt_evlt_remn_indv_tot || hBody?.output1 || hBody?.list || hBody?.grid || []
                        const list = Array.isArray(listData) ? listData : [listData].filter(Boolean)
                        holdingSymbols = list.map((item: any) => item.stk_cd || item.pdno || '').filter(Boolean)
                    }
                }

                const allSymbols = Array.from(new Set([...watchlistSymbols, ...holdingSymbols]))
                if (allSymbols.length > 0) {
                    // Register for Real-time WS if not already
                    window.electronAPI.wsRegister(allSymbols)
                    // Enqueue for 20-day MA calculation
                    enqueueSymbols(allSymbols)
                }
            } catch (err) {
                console.error('[GlobalSignalMonitor] Registration failed:', err)
            }
        }

        registerSymbols()
        const interval = setInterval(registerSymbols, 10 * 60 * 1000) // Re-sync every 10 mins

        // 2. Real-time Slump Detection
        const cleanup = window.electronAPI.onRealTimeData((wsData: any) => {
            if (!wsData.stk_cd || !wsData.cur_prc) return

            const numericCode = wsData.stk_cd.replace(/[^0-9]/g, '')
            const currentPrice = Math.abs(Number(wsData.cur_prc))
            const sum19 = previous19DaysSum[numericCode]

            if (sum19 !== undefined && sum19 > 0) {
                const ma20 = (sum19 + currentPrice) / 20
                const disparity = (currentPrice / ma20) * 100

                // Threshold: 95%
                if (disparity < 95) {
                    // Avoid duplicate notifications in same session
                    if (!notifiedSlumpRef.current.has(numericCode)) {
                        notifiedSlumpRef.current.add(numericCode)
                        const stockName = wsData.stk_nm || numericCode
                        const changeRate = wsData.prdy_ctrt ? Number(wsData.prdy_ctrt) : 0;
                        window.electronAPI.notifyDisparitySlump({
                            code: numericCode,
                            name: stockName,
                            disparity: disparity !== undefined && disparity !== null ? Number(disparity.toFixed(2)) : 0,
                            changeRate
                        })
                    }
                } else if (disparity > 96) {
                    // Reset notification flag if it recovers slightly
                    notifiedSlumpRef.current.delete(numericCode)
                }
            }
        })

        return () => {
            cleanup()
            clearInterval(interval)
        }
    }, [previous19DaysSum, enqueueSymbols])
}
