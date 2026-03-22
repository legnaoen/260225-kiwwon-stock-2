import Store from 'electron-store'

const store = new Store()
const STORE_KEY = 'pm_strategy_profiles'

export interface StrategyProfile {
    strategy: 'DAYTRADING' | 'SWING' | 'POSITION' | 'LONGTERM'
    
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

    /** 특정 전략 프로파일 조회 */
    public getProfile(strategy: string): StrategyProfile {
        const profiles = this.getProfiles()
        return profiles[strategy] || DEFAULT_PROFILES.SWING
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
