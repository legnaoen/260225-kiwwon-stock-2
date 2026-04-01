import cron from 'node-cron'
import { RisingStockAnalysisService } from './RisingStockAnalysisService'
import { TelegramService } from './TelegramService'
import { KiwoomService } from './KiwoomService'
import { eventBus, SystemEvent } from '../utils/EventBus'
import Store from 'electron-store'
import { IngestionManager } from './IngestionManager'
import { DatabaseService } from './DatabaseService'
import { DEFAULT_NEWS_HUB_SETTINGS, NewsHubSettings } from '../types/NewsHubSettings'


const store = new Store()

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
     * 자동화 스케줄 초기화 (저장된 설정 기반)
     */
    public async initSchedules() {
        // 기존 작업 중지 및 초기화
        this.scheduledJobs.forEach(job => job.stop())
        this.scheduledJobs = []

        // ═══ [Step 1] NewsDataHub 크론 (AI보다 반드시 먼저 등록) ═══
        const hubSettings = store.get('news_hub_settings') as NewsHubSettings || DEFAULT_NEWS_HUB_SETTINGS
        if (hubSettings.enabled) {
            const hubJobs = this.initNewsHubJobs(hubSettings)
            this.scheduledJobs.push(...hubJobs)
            console.log(`[SchedulerService] 📡 NewsDataHub 크론 ${hubJobs.length}개 등록`)
        }

        // ═══ [Step 2] V2 Agent Swarm Schedules ═══
        const settings = store.get('ai_schedule_settings') as any || { enabled: true }
        if (settings.enabled) {
            // [정상화] 기존 트래커 제거 및 진짜 이슈 통합 AI(IssueManagementAgent)를 08:30에 정규 배치
            const imaJob = cron.schedule('30 08 * * 1-5', async () => {
                const { IssueManagementAgent } = await import('./v2_agents/IssueManagementAgent')
                await IssueManagementAgent.getInstance().runDailyAnalysis()
            }, { timezone: 'Asia/Seoul' })

            // Cycle A: 08:50 (장전 시장 파악 - 제미나이가 트래커들의 의견을 종합)
            const mcaJobA = cron.schedule('50 08 * * 1-5', async () => {
                const { MarketConditionAgent } = await import('./v2_agents/MarketConditionAgent')
                await MarketConditionAgent.getInstance().runPrediction('A')
            }, { timezone: 'Asia/Seoul' })
            // Cycle P (Pivot 검증): 09:30 (개장 직후 30분 수급 실데이터로 08:50 예측과 교차 비판 및 스위칭)
            const mcaJobP = cron.schedule('30 09 * * 1-5', async () => {
                const { MarketConditionAgent } = await import('./v2_agents/MarketConditionAgent')
                await MarketConditionAgent.getInstance().runPrediction('P')
            }, { timezone: 'Asia/Seoul' })

            // Cycle B: 15:10 (장마감 전 시장 파악)
            const mcaJobB = cron.schedule('10 15 * * 1-5', async () => {
                const { MarketConditionAgent } = await import('./v2_agents/MarketConditionAgent')
                await MarketConditionAgent.getInstance().runPrediction('B')
            }, { timezone: 'Asia/Seoul' })

            // PerformanceTracker \uae30\ub85d\uc6a9 (15:35 T+1 / T+5 / T+20) + \uc7a5\uc911 \uc778\ud2b8\ub77c\ub370\uc774 \ud3c9\uac00
            const mcaTrackerJob = cron.schedule('35 15 * * 1-5', async () => {
                const { PerformanceTracker } = await import('./v2_agents/PerformanceTracker')
                const tracker = PerformanceTracker.getInstance()
                await tracker.runDailyTracking()
                await tracker.evaluateIntraday()  // \uc7a5\uc911 \uc608\uce21 \uc885\uac00 \ub300\ube44 \ud3c9\uac00
            }, { timezone: 'Asia/Seoul' })

            // 장중 5분봉 CCI 모니터링 및 이벤트 트리거 (09:10 ~ 14:00 사이, 매 5분마다)
            const intradayCciJob = cron.schedule('*/5 9-14 * * 1-5', async () => {
                const now = new Date()
                const timeInt = now.getHours() * 100 + now.getMinutes()
                if (timeInt < 910 || timeInt > 1400) return

                try {
                    // 최근 10분 내 군집 AI 또는 기타 예측이 있었는지 통합 체크
                    const { DatabaseService } = await import('./DatabaseService')
                    const rawDb = (DatabaseService.getInstance() as any).db;
                    
                    // 1. 최근 10분 내 메인 AI(CCI 기반) 실행 이력 스캔
                    const recentCciRun = rawDb.prepare(`
                        SELECT id, created_at FROM intraday_predictions 
                        WHERE id LIKE '%CCI%'
                          AND created_at >= datetime('now', 'localtime', '-10 minutes')
                        ORDER BY created_at DESC LIMIT 1
                    `).get();

                    if (recentCciRun) {
                        console.log(`[SchedulerService] 🕒 최근 10분 내 CCI 기반 예측 이력 존재(${recentCciRun.id}). 실행 스킵.`);
                        return;
                    }

                    // 2. 최근 10분 내 군집 AI(스케줄러 기반) 실행 이력 스캔 (경합/충돌 방지)
                    const recentSwarmRun = rawDb.prepare(`
                        SELECT id, created_at FROM intraday_predictions 
                        WHERE id NOT LIKE '%CCI%'
                          AND created_at >= datetime('now', 'localtime', '-10 minutes')
                        ORDER BY created_at DESC LIMIT 1
                    `).get();

                    if (recentSwarmRun) {
                        console.log(`[SchedulerService] 🕒 최근 10분 내 군집 AI 분석 이력 존재(${recentSwarmRun.id}). 빈번한 실행 방지를 위해 CCI 구동 스킵.`);
                        return;
                    }

                    const { MarketConditionAgent } = await import('./v2_agents/MarketConditionAgent')
                    const { TechnicalAnalyzer } = await import('./v2_agents/TechnicalAnalyzer')
                    const { KiwoomService } = await import('./KiwoomService')
                    const analyzer = new TechnicalAnalyzer(KiwoomService.getInstance())
                    const result = await analyzer.checkCCITrigger()

                    if (result.isTriggered) {
                        const eventSlotStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} (CCI)`
                        console.log(`[SchedulerService] ⚡ CCI 이벤트 감지: ${result.status} -> AI 긴급 시황 분석 트리거`);
                        // MarketConditionAgent.runIntraday 15분 내부 쿨다운 무시(force=true)하고 DB 기준 10분 쿨다운 적용
                        await MarketConditionAgent.getInstance().runIntraday(eventSlotStr, true, result)
                    }
                } catch (err: any) {
                    console.error('[SchedulerService] CCI 이벤트 체크 에러:', err.message)
                }
            }, { timezone: 'Asia/Seoul' })

            // 장중 무제한 로컬 스웜 A/B 테스트 (09:45 ~ 13:45 간 30분 단위, 총 9회)
            const swarmJobs: cron.ScheduledTask[] = []
            const swarmSlots = ['09:45', '10:15', '10:45', '11:15', '11:45', '12:15', '12:45', '13:15', '13:45']
            for (const slot of swarmSlots) {
                const [hr, min] = slot.split(':')
                const job = cron.schedule(`${parseInt(min)} ${parseInt(hr)} * * 1-5`, async () => {
                    const { IntradaySwarmAgent } = await import('./v2_agents/IntradaySwarmAgent')
                    await IntradaySwarmAgent.getInstance().runSwarm(slot)
                }, { timezone: 'Asia/Seoul' })
                swarmJobs.push(job)
            }

            // 주간 회고 AI (금요일 16:00 종료 후)
            const weeklyReviewJob = cron.schedule('0 16 * * 5', async () => {
                const { MarketReviewAgent } = await import('./v2_agents/MarketReviewAgent')
                await MarketReviewAgent.getInstance().runWeeklyReview()
            }, { timezone: 'Asia/Seoul' })

            // 월간 회고 AI (매월 28일 16:30)
            const monthlyReviewJob = cron.schedule('30 16 28 * *', async () => {
                const { MarketReviewAgent } = await import('./v2_agents/MarketReviewAgent')
                await MarketReviewAgent.getInstance().runMonthlyReview()
            }, { timezone: 'Asia/Seoul' })

            // Option 1: Pre-Close 일간 피드백 (로컬 감시 스웜) (15:00)
            const preCloseRetroJob = cron.schedule('0 15 * * 1-5', async () => {
                const { MarketReviewAgent } = await import('./v2_agents/MarketReviewAgent')
                await MarketReviewAgent.getInstance().runPreCloseFeedback()
            }, { timezone: 'Asia/Seoul' })

            // Option 2: Post-Market 일간 회고 AI (로컬) (15:40)
            const dailyRetroJob = cron.schedule('40 15 * * 1-5', async () => {
                const { MarketReviewAgent } = await import('./v2_agents/MarketReviewAgent')
                await MarketReviewAgent.getInstance().runDailyReview()
            }, { timezone: 'Asia/Seoul' })

            this.scheduledJobs.push(imaJob, mcaJobA, mcaJobP, mcaJobB, mcaTrackerJob, intradayCciJob, preCloseRetroJob, dailyRetroJob, weeklyReviewJob, monthlyReviewJob, ...swarmJobs)
            console.log(`[SchedulerService] V2 AI schedules initialized (IMA: 08:30, MCA: 08:50, CCI, Swarms, Retros)`)
        }

        // ═══ [Step 3] NaverFlow 크론 등록 ═══
        const nfSettings = store.get('naverflow_settings') as any
        if (nfSettings?.enabled && Array.isArray(nfSettings?.scheduleSlots)) {
            // Collision Avoidance: adjust legacy times
            nfSettings.scheduleSlots.forEach((s: any) => {
                if (s.time === '09:30') s.time = '09:40';
                if (s.time === '15:30') s.time = '15:45';
            });
            nfSettings.scheduleSlots.forEach((slot: any) => {
                if (!slot.enabled || !slot.time) return
                try {
                    const [hrStr, minStr] = slot.time.split(':')
                    const hr = parseInt(hrStr, 10)
                    const min = parseInt(minStr, 10)
                    if (isNaN(hr) || isNaN(min)) return

                    const cronExpr = `${min} ${hr} * * 1-5`
                    const nfJob = cron.schedule(cronExpr, async () => {
                        console.log(`[SchedulerService] 📊 NaverFlow 배치 수집 시작 (${cronExpr})`)
                        const { V2PipelineManager } = await import('./v2_pipeline/V2PipelineManager')
                        await V2PipelineManager.getInstance().runPipeline('PL-NaverFlow', { forceFetch: true })

                        // 수집 성공 후 테마/섹터 AI 분석 추가 실행
                        try {
                            console.log(`[SchedulerService] 🤖 ThemeIntelligence AI 일괄 분석 연계 시작`)
                            const { ThemeIntelligenceAgent } = await import('./v2_agents/ThemeIntelligenceAgent')
                            await ThemeIntelligenceAgent.getInstance().runBatchAnalysis()
                        } catch (aiErr: any) {
                            console.error(`[SchedulerService] ThemeIntelligence AI 분석 연계 실패:`, aiErr.message)
                        }
                    }, { timezone: 'Asia/Seoul' })
                    this.scheduledJobs.push(nfJob)
                    console.log(`[SchedulerService] 📊 NaverFlow 크론 등록 완료 (${cronExpr})`)
                } catch (err: any) {
                    console.error(`[SchedulerService] NaverFlow 크론 등록 실패 (${slot.time}):`, err.message)
                }
            })
        }
    }

    /**
     * NewsDataHub 크론 동적 등록 (설정 기반)
     */
    private initNewsHubJobs(settings: NewsHubSettings): cron.ScheduledTask[] {
        const jobs: cron.ScheduledTask[] = []
        const daysExpr = settings.operatingDays.join(',') || '1-5'

        for (const slot of settings.scheduleSlots) {
            if (!slot.enabled) continue
            const [hrStr, minStr] = slot.time.split(':')
            const hr = parseInt(hrStr, 10)
            const min = parseInt(minStr, 10)
            if (isNaN(hr) || isNaN(min)) continue

            const cronExpr = `${min} ${hr} * * ${daysExpr}`
            const job = cron.schedule(cronExpr, async () => {
                try {
                    console.log(`[NewsDataHub] 🗞️  ${slot.label}(${slot.time}) 배치 수집 시작`)
                    const { NewsDataHub } = await import('./NewsDataHub')
                    const result = await NewsDataHub.getInstance().runBatchCollect()
                    console.log(`[NewsDataHub] ✅ ${result.collected}건 완료 (버킷: ${result.bucket}, ${result.duration_ms}ms)`)
                } catch (err: any) {
                    console.error(`[NewsDataHub] ❌ 배치 수집 실패 (${slot.time}):`, err.message)
                }
            }, { timezone: 'Asia/Seoul' })
            jobs.push(job)
        }
        return jobs
    }


    /**
     * 일괄 분석 실행 로직 (수동/자동 공용)
     */
    public async runManualBatchAnalysis(label: 'MORNING' | 'EVENING' | 'MANUAL' = 'MANUAL', date?: string) {
        try {
            const now = new Date()
            const hour = now.getHours()
            const minute = now.getMinutes()
            const timeVal = hour * 100 + minute
            
            // 최근 거래일 확인 (005930 차트 기준)
            const latestTradingDay = await this.kiwoom.getLatestTradingDay();
            const { DatabaseService } = await import('./DatabaseService');
            const kstDate = DatabaseService.getInstance().getKstDate();
            const startTime = Date.now();

            // 1. 대상 날짜 결정
            let targetDate = date || kstDate;
            
            // 자동 분석(MORNING/EVENING)일 경우, 오늘이 장 운영일이 아니면 실행 중단
            if ((label === 'MORNING' || label === 'EVENING') && targetDate !== latestTradingDay) {
                // [개선] 오늘이 장 운영일인 평일인데 단지 차트 갱신이 늦어 날짜가 다른 것인지 확인
                const isToday = targetDate === kstDate;
                const dayOfWeek = now.getDay(); // 0(일) ~ 6(토)
                const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

                if (isToday && isWeekday) {
                    console.log(`[SchedulerService] 오늘(${targetDate})은 평일입니다. 최근 거래일(${latestTradingDay})과 불일치하지만 시장 데이터를 분석합니다.`);
                } else {
                    console.log(`[SchedulerService] 오늘(${targetDate})은 장 운영일이 아닙니다. 자동 분석을 건너뜁니다. (최근 거래일: ${latestTradingDay})`);
                    return { success: false, error: 'NON_TRADING_DAY' };
                }
            }

            // 수동 분석(MANUAL)인데 날짜가 지정되지 않은 경우, 주말이면 최근 거래일로 보정
            if (label === 'MANUAL' && !date && targetDate !== latestTradingDay) {
                const dayOfWeek = now.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                // 주말일 경우에만 최근 거래일로 보정, 평일이면(차트 갱신 지연 등) 오늘 날짜 유지
                if (isWeekend) {
                    console.log(`[SchedulerService] 주말 실행 감지. 대상을 최근 거래일(${latestTradingDay})로 보정합니다.`);
                    targetDate = latestTradingDay;
                }
            }

            // 운영 원칙 9.3: 장 시작 전(09:00 이전)에는 오늘 날짜의 분석 리포트 생성을 제한함
            if (timeVal < 900 && targetDate === kstDate && (label === 'MORNING' || label === 'MANUAL')) {
                console.log('[SchedulerService] 장 시작 전입니다. 실시간 수급 데이터가 없으므로 분석을 중지하거나 지연시킵니다.')
                if (label === 'MORNING') return { success: false, error: 'BEFORE_MARKET_OPEN' }
            }

            eventBus.emit(SystemEvent.BATCH_PROGRESS, { step: 'STOCKS', current: 0, total: 1, message: '데이터 수집 중 (캐시 활용)...' })

            // 1. 데이터 수집 (KiwoomService의 캐시가 자동 적용됨)
            const rawCombinedList = await this.kiwoom.getCombinedTopStocks(50, 50)

            const etfKeywords = ['ETF', 'ETN', 'KODEX', 'TIGER', 'ACE', 'KBSTAR', 'ARIRANG', 'HANARO', 'SOL', 'KOSEF', 'KINDEX', 'KB스타', '스팩', 'SPAC']
            
            // 2. 기본 필터링 (ETF, 우선주 등 제거)
            const filteredBase = rawCombinedList.filter(s => {
                const name = s.name.toUpperCase().replace(/\s+/g, '')
                if (etfKeywords.some(kw => name.includes(kw.toUpperCase()))) return false
                if (name.endsWith('우') || name.endsWith('우B') || name.includes('우(')) return false
                if (s.changeRate <= 0) return false // 상승 종목만 대상
                return true
            })

            // 3. 순수 TOP N 방식 (임계값 없이 상위 N개를 무조건 확보)
            
            // Track A: 등락률 상위 TOP 15 (시장이 약세든 강세든 "그날의 주도주")
            const trackA = filteredBase
                .sort((a, b) => b.changeRate - a.changeRate)
                .slice(0, 15)
                .map(s => ({ ...s, source: 'RISING' as const }))
            
            const trackACodes = new Set(trackA.map(s => s.code))

            // Track B: 거래대금 상위 TOP 15 (Track A 중복 제거, 양수 등락률만)
            const trackB = filteredBase
                .filter(s => !trackACodes.has(s.code))
                .sort((a, b) => (b.tradingValue || 0) - (a.tradingValue || 0))
                .slice(0, 15)
                .map(s => ({ ...s, source: 'TRADING_VALUE' as const }))

            // 4. 최종 리스트 구성 (두 트랙 명확히 분리)
            let resultList = [...trackA, ...trackB]

            const targetStocks = resultList.map(s => ({
                code: s.code.replace(/[^0-9]/g, ''),
                name: s.name,
                rate: s.changeRate,
                trading_value: s.tradingValue || 0,
                source: s.source
            }))

            console.log(`[SchedulerService] ${label} analysis targets: ${targetStocks.length} stocks (Track A: ${trackA.length} rising, Track B: ${trackB.length} trading_value)`)

            // 2. 배치 분석 실행 (데이터 수집부터 AI 분석까지 일괄)
            const timing = label === 'MORNING' ? 'MORNING' : (label === 'EVENING' ? 'EVENING' : 'MANUAL')
            const result = await this.risingStockAnalysis.analyzeBatchAndSave(targetStocks, timing, targetDate)

            // 3. 텔레그램 알림 발송 (자동 스케줄인 경우만)
            if (label !== 'MANUAL') {
                /* [V1 Legacy 알림 비활성화]
                const settings = store.get('ai_schedule_settings') as any || { telegramNotify: true }
                if (!settings.telegramNotify) return { success: true, count: result.count }

                const report = await this.risingStockAnalysis.generateMarketDailyReport(targetDate, timing)
                const typeLabel = label === 'MORNING' ? '오전 주도주/테마' : '장 마감 시장 총평';
                
                if (report.success && report.data?.market_summary) {
                    try {
                        const parsed = JSON.parse(report.data.market_summary)
                        let message = `📢 *[AI 시장 분석 - ${typeLabel}]*\n\n`
                        
                        message += `✅ *핵심 요약*\n${parsed.summary_lines.map((l: string) => `• ${l}`).join('\n')}\n\n`
                        message += `🔮 *내일 전망*\n${parsed.market_outlook}\n\n`
                        
                        if (parsed.self_reflection && parsed.self_reflection.length > 5) {
                            message += `🧐 *AI 자아성찰*\n${parsed.self_reflection}\n\n`
                        }
                        
                        message += `🔥 *주요 테마*\n`
                        parsed.top_themes.slice(0, 3).forEach((t: any) => {
                            message += `*${t.rank}. ${t.theme_name}* (${t.rating})\n- ${t.leading_stocks.join(', ')}\n`
                        })
                        
                        this.telegram.sendMessage(message)
                    } catch (e) {
                        // 파싱 실패 시 기본 텍스트라도 전송
                        this.telegram.sendMessage(`📢 *[AI 시장 분석 - ${typeLabel}]*\n\n리포트 생성이 완료되었습니다. 앱에서 상세 내용을 확인하세요.`)
                    }
                }
                */
            }

            // Record success
            IngestionManager.getInstance().recordIngestion(
                'naver_news_top50',
                'Naver Open API (Batch)',
                startTime,
                200,
                Math.round(JSON.stringify(result).length / 1024)
            );
            IngestionManager.getInstance().markAsSuccess('naver_news_top50');

            return { success: true, count: result.count }
        } catch (error: any) {
            console.error(`[SchedulerService] Batch analysis failed:`, error)
            
            // Record failure
            IngestionManager.getInstance().recordIngestion(
                'naver_news_top50',
                'Naver Open API (Batch)',
                startTime,
                500,
                0,
                error.message || 'Unknown Error'
            );

            // const msg = `🚨 [AI 자동분석 오류] ${label} 분석 중 오류 발생: ${error.message}`
            // if (label !== 'MANUAL') this.telegram.sendMessage(msg)
            return { success: false, error: error.message }
        }
    }
}
