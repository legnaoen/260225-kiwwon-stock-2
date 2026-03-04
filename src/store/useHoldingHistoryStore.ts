import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface HoldingHistoryState {
    // Records the first seen date of a stock in holdings: { "005930": "2024-03-03" }
    history: Record<string, string>
    setFirstSeenDate: (code: string, date: string) => void
    removeHistory: (code: string) => void
    syncHistory: (currentCodes: string[]) => void
}

export const useHoldingHistoryStore = create<HoldingHistoryState>()(
    persist(
        (set) => ({
            history: {},

            setFirstSeenDate: (code, date) =>
                set((state) => ({
                    history: { ...state.history, [code]: date }
                })),

            removeHistory: (code) =>
                set((state) => {
                    const newHistory = { ...state.history }
                    delete newHistory[code]
                    return { history: newHistory }
                }),

            syncHistory: (currentCodes) =>
                set((state) => {
                    const newHistory = { ...state.history }
                    const today = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD

                    let hasChanged = false

                    // 1. Add new stocks
                    currentCodes.forEach(code => {
                        if (!newHistory[code]) {
                            newHistory[code] = today
                            hasChanged = true
                        }
                    })

                    // 2. Remove stocks no longer in holdings (to support re-buy date tracking)
                    // Note: This logic means "first seen" is reset when quantity becomes zero.
                    Object.keys(newHistory).forEach(code => {
                        if (!currentCodes.includes(code)) {
                            delete newHistory[code]
                            hasChanged = true
                        }
                    })

                    return hasChanged ? { history: newHistory } : state
                })
        }),
        {
            name: 'kiwoom-holding-history',
        }
    )
)
