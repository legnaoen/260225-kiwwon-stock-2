/**
 * Central News Hub - 설정 타입 정의
 * Store Key: 'news_hub_settings'
 */

export interface NewsHubKeywordSlot {
    keyword: string;
    enabled: boolean;
    maxResults: number;
    source: 'open_api';
}

export interface NewsHubScheduleSlot {
    time: string;        // "HH:MM"
    enabled: boolean;
    label: string;
}

export interface NewsHubSettings {
    enabled: boolean;

    // ── 운영 요일 (1=월 ~ 5=금)
    operatingDays: string[];

    // ── 수집 실행 시간 슬롯
    scheduleSlots: NewsHubScheduleSlot[];

    // ── Open API 키워드 목록
    keywords: NewsHubKeywordSlot[];

    // ── 네이버 증권 JSON 카테고리 수집 여부
    useJsonApi: boolean;
    jsonApiCategories: string[];

    // ── 캐시 및 보존 정책
    ttlMinutes: number;
    retentionDays: number;

    // ── AI 크론 시각 목록 (타임라인 검증용)
    aiCronTimes: string[];
}

export const DEFAULT_NEWS_HUB_SETTINGS: NewsHubSettings = {
    enabled: true,
    operatingDays: ['1', '2', '3', '4', '5'],
    scheduleSlots: [
        { time: '08:45', enabled: true,  label: '장전 MCA (A) 준비' },
        { time: '09:25', enabled: true,  label: '개장 직후 MCA (P) 준비' },
        { time: '10:00', enabled: true,  label: '오전 중반' },
        { time: '11:00', enabled: true,  label: '오전 후반' },
        { time: '12:00', enabled: false, label: '점심 (비활성)' },
        { time: '13:05', enabled: true,  label: '오후 개장 직후' },
        { time: '14:00', enabled: true,  label: '오후 마감 전' },
        { time: '15:05', enabled: true,  label: '장마감 전 MCA (B) 준비' }
    ],
    keywords: [
        { keyword: '코스피 코스닥 시황', enabled: true, maxResults: 10, source: 'open_api' },
        { keyword: '뉴욕증시 마감',       enabled: true, maxResults: 10, source: 'open_api' },
        { keyword: '미국 금리 환율',      enabled: true, maxResults: 10, source: 'open_api' },
        { keyword: '반도체 AI 주식',      enabled: true, maxResults: 10, source: 'open_api' },
        { keyword: '외국인 기관 매수',    enabled: true, maxResults: 10, source: 'open_api' },
    ],
    useJsonApi: true,
    jsonApiCategories: ['MAJOR', 'GLOBAL', 'STOCK_ANALYSIS', 'GLOBAL_MARKET'],
    ttlMinutes: 55,
    retentionDays: 30,
    aiCronTimes: ['08:50', '09:30', '15:10'],
}

/**
 * Hub 슬롯이 AI 크론보다 너무 늦거나 역전되었는지 검증
 * @returns warnings: 문제가 있는 슬롯에 대한 경고 메시지 배열
 */
export function validateHubTimeline(settings: NewsHubSettings): { valid: boolean; warnings: string[] } {
    const warnings: string[] = []

    const toMinutes = (t: string) => {
        const [h, m] = t.split(':').map(Number)
        return h * 60 + m
    }
    const aiMinutes = settings.aiCronTimes.map(toMinutes)

    for (const slot of settings.scheduleSlots) {
        if (!slot.enabled) continue
        const slotMin = toMinutes(slot.time)

        for (const aiMin of aiMinutes) {
            // Hub 슬롯이 AI 크론보다 5분 미만 앞이거나 이후면 경고
            if (slotMin > aiMin - 5 && slotMin <= aiMin) {
                const aiStr = `${String(Math.floor(aiMin / 60)).padStart(2, '0')}:${String(aiMin % 60).padStart(2, '0')}`
                warnings.push(`[${slot.time}] "${slot.label}" 슬롯이 AI 실행 시각 [${aiStr}]보다 5분 미만 앞에 있습니다.`)
            }
        }
    }

    return { valid: warnings.length === 0, warnings }
}
