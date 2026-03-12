import cron from 'node-cron'
import { RisingStockAnalysisService } from './RisingStockAnalysisService'
import { TelegramService } from './TelegramService'
import { KiwoomService } from './KiwoomService'
import { eventBus, SystemEvent } from '../utils/EventBus'

export class SchedulerService {
    private static instance: SchedulerService
    private risingStockAnalysis = RisingStockAnalysisService.getInstance()
    private telegram = TelegramService.getInstance()
    private kiwoom = KiwoomService.getInstance()

    private scheduledJobs: cron.ScheduledTask[] = []

    private constructor() {
        this.initSchedules()
    }

    public static getInstance(): SchedulerService {
        if (!SchedulerService.instance) {
            SchedulerService.instance = new SchedulerService()
        }
        return SchedulerService.instance
    }

    /**
     * 자동화 스케줄 초기화 (월~금)
     */
    private initSchedules() {
        // 1. 오전 10:00 - 오전 급등주/주도주 분석
        const morningJob = cron.schedule('0 10 * * 1-5', () => {
            console.log('[SchedulerService] Starting automatic morning market analysis (10:00)...')
            this.runManualBatchAnalysis('MORNING')
        }, { timezone: 'Asia/Seoul' })

        // 2. 오후 15:40 - 장 마감 급등주/주도주 및 시장 요약 분석
        const eveningJob = cron.schedule('40 15 * * 1-5', () => {
            console.log('[SchedulerService] Starting automatic evening market analysis (15:40)...')
            this.runManualBatchAnalysis('EVENING')
        }, { timezone: 'Asia/Seoul' })

        this.scheduledJobs.push(morningJob, eveningJob)
        console.log('[SchedulerService] Automated analysis schedules (10:00, 15:40) initialized.')
    }

    /**
     * 일괄 분석 실행 로직 (수동/자동 공용)
     */
    public async runManualBatchAnalysis(label: 'MORNING' | 'EVENING' | 'MANUAL' = 'MANUAL') {
        try {
            const today = new Date().toISOString().slice(0, 10)

            eventBus.emit(SystemEvent.BATCH_PROGRESS, { step: 'STOCKS', current: 0, total: 1, message: '키움 API로부터 종목 리스트 수집 중...' })

            // 1. 데이터 수집 (상승률 상위 50 + 거래대금 상위 50 통합)
            const rawCombinedList = await this.kiwoom.getCombinedTopStocks(50, 50)

            const etfKeywords = ['ETF', 'ETN', 'KODEX', 'TIGER', 'ACE', 'KBSTAR', 'ARIRANG', 'HANARO', 'SOL', 'KOSEF', 'KINDEX', 'KB스타', '스팩', 'SPAC']
            
            // 2. 기본 필터링 (ETF, 우선주, 동전주 등 제거)
            const filteredBase = rawCombinedList.filter(s => {
                const name = s.name.toUpperCase().replace(/\s+/g, '')
                if (etfKeywords.some(kw => name.includes(kw.toUpperCase()))) return false
                if (name.endsWith('우') || name.endsWith('우B') || name.includes('우(')) return false
                if (s.changeRate < 0) return false // 상승 종목만 대상
                return true
            })

            // 3. 우선순위 그룹화
            // 그룹 1: 교집합 (상승률 5% 이상 AND 거래대금 200억 이상)
            const groupIntersection = filteredBase.filter(s => s.source === 'BOTH' && s.changeRate >= 5 && (s.tradingValue || 0) >= 20000)
            
            // 그룹 2: 고상승 (상승률 7% 이상 AND 거래대금 50억 이상, 그룹 1 중복 제외)
            const groupHighRate = filteredBase.filter(s => 
                !groupIntersection.some(g => g.code === s.code) && 
                s.changeRate >= 7 && (s.tradingValue || 0) >= 5000
            ).sort((a, b) => b.changeRate - a.changeRate)

            // 그룹 3: 고거래 (거래대금 500억 이상 AND 상승률 3% 이상, 그룹 1, 2 중복 제외)
            const groupHighVolume = filteredBase.filter(s => 
                !groupIntersection.some(g => g.code === s.code) && 
                !groupHighRate.some(g => g.code === s.code) && 
                (s.tradingValue || 0) >= 50000 && s.changeRate >= 3
            ).sort((a, b) => (b.tradingValue || 0) - (a.tradingValue || 0))

            // 4. 최종 리스트 구성 (최대 30개)
            let resultList = [...groupIntersection, ...groupHighRate, ...groupHighVolume]
            
            // 모자라면 남은 종목 중 상승률 순으로 채움
            if (resultList.length < 30) {
                const remaining = filteredBase.filter(s => !resultList.some(g => g.code === s.code))
                    .sort((a, b) => b.changeRate - a.changeRate)
                resultList = [...resultList, ...remaining].slice(0, 30)
            } else if (resultList.length > 30) {
                resultList = resultList.slice(0, 30)
            }

            const targetStocks = resultList.map(s => ({
                code: s.code.replace(/[^0-9]/g, ''),
                name: s.name,
                rate: s.changeRate,
                trading_value: s.tradingValue || 0,
                source: s.source
            }))

            console.log(`[SchedulerService] ${label} analysis targets: ${targetStocks.length} stocks (Filtered)`)

            // 2. 배치 분석 실행 (데이터 수집부터 AI 분석까지 일괄)
            const result = await this.risingStockAnalysis.analyzeBatchAndSave(targetStocks)

            // 3. 텔레그램 알림 발송 (자동 스케줄인 경우만)
            if (label !== 'MANUAL') {
                const report = this.risingStockAnalysis.generateMarketDailyReport(today)
                const typeLabel = label === 'MORNING' ? '오전 주도주/테마' : '장 마감 시장 총평';
                report.then(res => {
                    if (res.success) {
                        const message = `📢 *[AI 시장 분석 리포터 - ${typeLabel}]*\n\n${res.data?.market_summary ?? ''}`
                        this.telegram.sendMessage(message)
                    }
                })
            }

            return { success: true, count: result.count }
        } catch (error: any) {
            console.error(`[SchedulerService] Batch analysis failed:`, error)
            const msg = `🚨 [AI 자동분석 오류] ${label} 분석 중 오류 발생: ${error.message}`
            if (label !== 'MANUAL') this.telegram.sendMessage(msg)
            return { success: false, error: error.message }
        }
    }
}
