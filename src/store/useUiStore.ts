import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FontSizeTier = 'small' | 'medium' | 'large' | 'xlarge';

interface UiState {
    fontSizeTier: FontSizeTier;
    setFontSizeTier: (tier: FontSizeTier) => void;
}

// Root(html tag) Font Size Mapping
const FONT_SIZE_MAP: Record<FontSizeTier, string> = {
    'small': '14px',
    'medium': '16px', // Tailwind Base default
    'large': '18px',
    'xlarge': '20px'
};

export const useUiStore = create<UiState>()(
    persist(
        (set) => ({
            fontSizeTier: 'medium',
            setFontSizeTier: (tier) => {
                // 상위 html root 폰트 사이즈를 직접 건드려 rem 스케일 전체 앱 일괄 조정
                document.documentElement.style.fontSize = FONT_SIZE_MAP[tier];
                set({ fontSizeTier: tier });
            },
        }),
        {
            name: 'kiwoom-ui-storage',
            onRehydrateStorage: () => (state) => {
                // 앱 새로고침/init 시 로컬스토리지 저장 정보 기반으로 바로 폰트 렌더링
                if (state) {
                    document.documentElement.style.fontSize = FONT_SIZE_MAP[state.fontSizeTier] || '16px';
                }
            }
        }
    )
);
