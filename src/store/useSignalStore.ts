import { create } from 'zustand'

interface SignalStoreState {
    // Key: string (stock code), Value: number (sum of previous 19 days' close prices)
    previous19DaysSum: Record<string, number>
    setPrevious19DaysSum: (code: string, sum: number) => void
}

export const useSignalStore = create<SignalStoreState>((set) => ({
    previous19DaysSum: {},
    setPrevious19DaysSum: (code, sum) => set((state) => ({
        previous19DaysSum: {
            ...state.previous19DaysSum,
            [code]: sum
        }
    })),
}))
