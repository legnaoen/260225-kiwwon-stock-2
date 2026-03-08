import { create } from 'zustand'

interface HoldingHistoryState {
    history: Record<string, string>; // { '005930': '2024-03-01' }
    fetchHistory: () => Promise<void>;
}

export const useHoldingHistoryStore = create<HoldingHistoryState>((set) => ({
    history: {},
    fetchHistory: async () => {
        try {
            const history = await window.electronAPI.getHoldingHistory();
            set({ history });
        } catch (error) {
            console.error('Failed to fetch holding history from DB:', error);
        }
    }
}))
