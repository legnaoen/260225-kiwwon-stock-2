import { create } from 'zustand'

export interface MarketStatus {
    code: string;
    text: string;
    time: string;
}

interface MarketState {
    marketStatus: MarketStatus;
    currentTime: Date;
    tradingDays: string[];
    setMarketStatus: (status: Partial<MarketStatus>) => void;
    setTradingDays: (days: string[]) => void;
    updateTime: () => void;
}

const getStatusText = (code: string): string => {
    switch (code) {
        case '0': return '장시작전';
        case '3': return '정규장 시작';
        case '2': return '장마감전';
        case '4': return '정규장 종료';
        case '8': return '정규장 마감';
        case '9': return '전체종료';
        case 'a': return '시간외종가';
        case 'b': return '시간외단일가';
        case 'c': return '시간외대량';
        case 'd': return '시간외기타';
        default: return '장종료';
    }
};

export const useMarketStore = create<MarketState>((set) => ({
    marketStatus: {
        code: '-',
        text: '연결대기',
        time: '--:--:--'
    },
    currentTime: new Date(),
    tradingDays: [],
    setMarketStatus: (status) => set((state) => ({
        marketStatus: {
            ...state.marketStatus,
            ...status,
            text: status.code ? getStatusText(status.code) : state.marketStatus.text
        }
    })),
    setTradingDays: (days) => set({ tradingDays: days }),
    updateTime: () => set({ currentTime: new Date() })
}))
