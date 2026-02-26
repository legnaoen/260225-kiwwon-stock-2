import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface LayoutState {
    chartHeight: number
    setChartHeight: (height: number) => void
}

export const useLayoutStore = create<LayoutState>()(
    persist(
        (set) => ({
            chartHeight: 350,
            setChartHeight: (height) => set({ chartHeight: height }),
        }),
        {
            name: 'kiwoom-layout-storage',
        }
    )
)
