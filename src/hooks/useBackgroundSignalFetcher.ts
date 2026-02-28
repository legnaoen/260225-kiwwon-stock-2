import { useSignalStore } from '../store/useSignalStore'

// Module-level global queue and state to act as a singleton across all components
const backgroundQueue = new Set<string>()
let isBackgroundFetching = false

// Helper queue for fetching chart data one by one with a delay
export function useBackgroundSignalFetcher() {
    const { previous19DaysSum, setPrevious19DaysSum } = useSignalStore()

    const processQueue = async () => {
        if (isBackgroundFetching || backgroundQueue.size === 0) return
        isBackgroundFetching = true

        const symbolsToFetch = Array.from(backgroundQueue)

        for (const code of symbolsToFetch) {
            // Check again if it was loaded during the process
            if (previous19DaysSum[code] !== undefined) {
                backgroundQueue.delete(code)
                continue
            }

            try {
                // Fetch the chart data (daily)
                const result = await window.electronAPI.getChartData({ stk_cd: code })
                if (result.success) {
                    const rawData = result.data?.stk_dt_pole_chart_qry || result.data?.output2 || result.data?.Body || result.data?.list || []

                    if (rawData.length >= 20) {
                        let sum = 0
                        let validDaysCount = 0

                        // We sum index 1 to 19 (which are the 19 days BEFORE today).
                        for (let i = 1; i <= 19; i++) {
                            const day = rawData[i]
                            if (day) {
                                const close = Number(day.cur_prc || day.stck_clpr || day.clpr || day.stck_clsprc || day.cls_prc || day.close || 0)
                                sum += close
                                validDaysCount++
                            }
                        }

                        if (validDaysCount === 19) {
                            // Update the global store state
                            useSignalStore.getState().setPrevious19DaysSum(code, sum)
                        } else {
                            // If not enough data (e.g. newly listed stock), we save an invalid marker so we don't fetch it again
                            useSignalStore.getState().setPrevious19DaysSum(code, -1)
                        }
                    } else {
                        // Not enough data
                        useSignalStore.getState().setPrevious19DaysSum(code, -1)
                    }
                }

                // Remove from queue
                backgroundQueue.delete(code)

                // Wait 1.5 seconds before next fetch to avoid 429 Too Many Requests
                await new Promise(resolve => setTimeout(resolve, 1500))

            } catch (err) {
                console.error(`Background fetch failed for ${code}:`, err)
                backgroundQueue.delete(code)
                await new Promise(resolve => setTimeout(resolve, 1500))
            }
        }

        isBackgroundFetching = false
    }

    const enqueueSymbols = (symbols: string[]) => {
        let added = false

        // Also get the latest state without relying on stale hook closures
        const currentState = useSignalStore.getState()

        symbols.forEach(sym => {
            const code = sym.replace(/[^0-9]/g, '') // Extract numeric code
            if (!code || code.length !== 6) return

            // If we don't have the sum cached and it's not already in the queue, add it
            if (currentState.previous19DaysSum[code] === undefined && !backgroundQueue.has(code)) {
                backgroundQueue.add(code)
                added = true
            }
        })

        if (added) {
            processQueue()
        }
    }

    return { enqueueSymbols }
}
