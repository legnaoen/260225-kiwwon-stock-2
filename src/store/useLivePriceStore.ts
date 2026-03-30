import { create } from 'zustand'

interface LivePriceState {
    prices: Record<string, number>
    updatePrice: (code: string, price: number) => void
}

export const useLivePriceStore = create<LivePriceState>((set) => ({
    prices: {},
    updatePrice: (code: string, price: number) => set((state) => ({
        prices: {
            ...state.prices,
            [code]: price
        }
    }))
}))
