import Store from 'electron-store'

const store = new Store()
const STORE_KEY = 'pm_strategy_profiles'

export interface StrategyProfile {
    strategy: 'DAYTRADING' | 'SWING' | 'POSITION' | 'LONGTERM' | 'THEME' | 'MOMENTUM' | 'PULLBACK' | 'REPORT'
    
    // 하드룰 (🔴)
    hardTakeProfit: number
    hardStopLoss: number
    trailingStopPct: number
    maxHoldDays: number
    forceCloseTime: string
    
    // AI 파라미터 (🟡/⚪)
    defaultTargetPct: number
    reviewFrequency: 'DAILY' | 'WEEKLY' | 'ON_REVIEW'
    minConviction: number
    extensionDays: number
    
    // 메타
    managementMode: 'HARD_RULE' | 'AI_DRIVEN'
}

export const DEFAULT_PROFILES: Record<string, StrategyProfile> = {
    DAYTRADING: {
        strategy: 'DAYTRADING',
        hardTakeProfit: 3,
        hardStopLoss: -2,
        trailingStopPct: 0,
        maxHoldDays: 1,
        forceCloseTime: '15:20',
        defaultTargetPct: 3,
        reviewFrequency: 'DAILY',
        minConviction: 0,
        extensionDays: 0,
        managementMode: 'HARD_RULE',
    },
    SWING: {
        strategy: 'SWING',
        hardTakeProfit: 8,
        hardStopLoss: -4,
        trailingStopPct: -3,
        maxHoldDays: 10,
        forceCloseTime: '',
        defaultTargetPct: 8,
        reviewFrequency: 'DAILY',
        minConviction: 50,
        extensionDays: 5,
        managementMode: 'HARD_RULE',
    },
    POSITION: {
        strategy: 'POSITION',
        hardTakeProfit: 0,
        hardStopLoss: -7,
        trailingStopPct: 0,
        maxHoldDays: 0,
        forceCloseTime: '',
        defaultTargetPct: 15,
        reviewFrequency: 'DAILY',
        minConviction: 40,
        extensionDays: 0,
        managementMode: 'AI_DRIVEN',
    },
    LONGTERM: {
        strategy: 'LONGTERM',
        hardTakeProfit: 0,
        hardStopLoss: -10,
        trailingStopPct: 0,
        maxHoldDays: 0,
        forceCloseTime: '',
        defaultTargetPct: 30,
        reviewFrequency: 'WEEKLY',
        minConviction: 30,
        extensionDays: 0,
        managementMode: 'AI_DRIVEN',
    },
}

// ─── AI 종목 매니저(PM2) 전용 프로파일 ───
// hardTakeProfit: 0 → 알고리즘 강제 익절 없음, PM2 AI가 매도 결정
// managementMode: AI_DRIVEN → 보유기간 초과 시 AI 재심사 (강제청산 X)
const AI_CATEGORY_PROFILE_BASE: Omit<StrategyProfile, 'strategy'> = {
    hardTakeProfit: 0,       // 익절 없음 (AI 판단)
    hardStopLoss: -7,        // 손절 -7% (완충 충분)
    trailingStopPct: 0,      // 트레일링 없음 (AI 보유 결정)
    maxHoldDays: 20,         // 최대 20일 (초과 시 AI 재심사)
    forceCloseTime: '',
    defaultTargetPct: 0,
    reviewFrequency: 'DAILY',
    minConviction: 40,       // conviction 40 이하 시 AI 재심사
    extensionDays: 10,       // 보유기간 연장 10일
    managementMode: 'AI_DRIVEN',
};

export const AI_CATEGORY_PROFILES: Record<string, StrategyProfile> = {
    THEME:    { ...AI_CATEGORY_PROFILE_BASE, strategy: 'THEME' as any },
    MOMENTUM: { ...AI_CATEGORY_PROFILE_BASE, strategy: 'MOMENTUM' as any },
    PULLBACK: { ...AI_CATEGORY_PROFILE_BASE, strategy: 'PULLBACK' as any },
    REPORT:   { ...AI_CATEGORY_PROFILE_BASE, strategy: 'REPORT' as any },
};

export class StrategyProfileService {
    private static instance: StrategyProfileService

    private constructor() {}

    public static getInstance(): StrategyProfileService {
        if (!StrategyProfileService.instance) {
            StrategyProfileService.instance = new StrategyProfileService()
        }
        return StrategyProfileService.instance
    }

    /** 전체 프로파일 조회 (저장된 값 없으면 기본값) */
    public getProfiles(): Record<string, StrategyProfile> {
        const saved = store.get(STORE_KEY) as Record<string, StrategyProfile> | undefined
        if (!saved) return { ...DEFAULT_PROFILES }
        // 기본값 병합 (새 필드 추가 시에도 안전)
        const merged: Record<string, StrategyProfile> = {}
        for (const key of Object.keys(DEFAULT_PROFILES)) {
            merged[key] = { ...DEFAULT_PROFILES[key], ...(saved[key] || {}) }
        }
        return merged
    }

    /** 특정 전략 프로파일 조회
     * - THEME/MOMENTUM/PULLBACK/REPORT → AI_CATEGORY_PROFILES (hardTakeProfit:0, AI_DRIVEN)
     * - DAYTRADING/SWING/POSITION/LONGTERM → DEFAULT_PROFILES
     * - 미지의 전략 → AI_CATEGORY_PROFILE (안전한 AI_DRIVEN 폴백)
     */
    public getProfile(strategy: string): StrategyProfile {
        // 1순위: AI 종목 매니저 카테고리
        if (AI_CATEGORY_PROFILES[strategy]) {
            return AI_CATEGORY_PROFILES[strategy];
        }
        // 2순위: 기존 레거시 전략
        const profiles = this.getProfiles()
        if (profiles[strategy]) {
            return profiles[strategy];
        }
        // 3순위 폴백: 안전한 AI_DRIVEN (기존 SWING 폴백에서 변경)
        return AI_CATEGORY_PROFILES.MOMENTUM;
    }

    /** 프로파일 저장 (사용자가 UI에서 수정) */
    public saveProfiles(profiles: Record<string, StrategyProfile>): void {
        store.set(STORE_KEY, profiles)
        console.log('[StrategyProfile] Profiles saved')
    }

    /** 기본값으로 초기화 */
    public resetToDefaults(): Record<string, StrategyProfile> {
        store.set(STORE_KEY, DEFAULT_PROFILES)
        console.log('[StrategyProfile] Reset to defaults')
        return { ...DEFAULT_PROFILES }
    }

    /** PM 리뷰 스케줄 설정 조회 */
    public getReviewSchedule(): { intradayTime: string, closingTime: string, autoEnabled: boolean } {
        const saved = store.get('pm_review_schedule') as any
        return saved || { intradayTime: '14:50', closingTime: '15:45', autoEnabled: false }
    }

    /** PM 리뷰 스케줄 설정 저장 */
    public saveReviewSchedule(schedule: { intradayTime: string, closingTime: string, autoEnabled: boolean }): void {
        store.set('pm_review_schedule', schedule)
        console.log('[StrategyProfile] Review schedule saved:', schedule)
    }
}
