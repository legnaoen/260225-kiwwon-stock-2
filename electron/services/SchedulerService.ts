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
     * 일회성 지연 실행 스케줄러 (장애 발생 시 Fallback 용도)
     */
    public scheduleOnceFallback(taskName: string, delayMs: number, taskFn: () => Promise<void>) {
        console.log(`[SchedulerService] 🕒 임시 크론 예약됨: [${taskName}] ${Math.round(delayMs / 1000 / 60)}분 뒤 실행`);
        setTimeout(async () => {
            console.log(`[SchedulerService] 🔄 임시 크론 재실행: [${taskName}]`);
            try {
                await taskFn();
            } catch (e: any) {
                console.error(`[SchedulerService] ❌ 임시 크론 최종 실패: [${taskName}] ${e.message}`);
                this.telegram.sendMessage(`🚨 [AI 복구 실패] 임시 재시도(${taskName})가 실행되었으나 재차 실패했습니다.\n에러: ${e.message}`);
            }
        }, delayMs);
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

            // PerformanceTracker 기록용 (15:35 T+1 / T+5 / T+20) + 장중 인트라데이 평가
            const mcaTrackerJob = cron.schedule('35 15 * * 1-5', async () => {
                try {
                    const { PerformanceTracker } = await import('./v2_agents/PerformanceTracker')
                    const tracker = PerformanceTracker.getInstance()
                    await tracker.runDailyTracking()
                    await tracker.evaluateIntraday()
                    this.telegram.sendMessage(`✅ [15:35] 성과 추적 완료\nT+1/T+5/T+20 수익률 집계 및 장중 예측 평가 정상 완료`)
                } catch (e: any) {
                    console.error('[Scheduler] 성과추적 오류:', e.message)
                    this.telegram.sendMessage(`❌ [15:35] 성과 추적 실패\n오류: ${e.message}`)
                }
            }, { timezone: 'Asia/Seoul' })



            // 장중 군집 AI 로컬 스웜 (09:10 ~ 11:10 간 15분 단위, 총 9회)
            const swarmJobs: cron.ScheduledTask[] = []
            const swarmSlots = ['09:10', '09:25', '09:40', '09:55', '10:10', '10:25', '10:40', '10:55', '11:10']
            for (const slot of swarmSlots) {
                const [hr, min] = slot.split(':')
                const job = cron.schedule(`${parseInt(min)} ${parseInt(hr)} * * 1-5`, async () => {
                    const { IntradaySwarmAgent } = await import('./v2_agents/IntradaySwarmAgent')
                    await IntradaySwarmAgent.getInstance().runSwarm(slot)
                }, { timezone: 'Asia/Seoul' })
                swarmJobs.push(job)
            }

            // 주간 회고 AI (금요일 15:44, 3분 텀 내 편성)
            const weeklyReviewJob = cron.schedule('44 15 * * 5', async () => {
                try {
                    const { MarketReviewAgent } = await import('./v2_agents/MarketReviewAgent')
                    await MarketReviewAgent.getInstance().runWeeklyReview()
                    this.telegram.sendMessage('✅ [15:44] 주간 회고 AI 완료\n이번 주 시장 성과 및 패턴 종합 분석 완료')
                } catch (e: any) {
                    console.error('[Scheduler] 주간 회고 오류:', e.message)
                    this.telegram.sendMessage(`❌ [15:44] 주간 회고 AI 실패\n오류: ${e.message}`)
                }
            }, { timezone: 'Asia/Seoul' })

            // 월간 회고 AI (매월 28일 15:47, 3분 텀 내 편성)
            const monthlyReviewJob = cron.schedule('47 15 28 * *', async () => {
                try {
                    const { MarketReviewAgent } = await import('./v2_agents/MarketReviewAgent')
                    await MarketReviewAgent.getInstance().runMonthlyReview()
                    this.telegram.sendMessage('✅ [15:47] 월간 회고 AI 완료\n이번 달 시장 성과 종합 분석 완료')
                } catch (e: any) {
                    console.error('[Scheduler] 월간 회고 오류:', e.message)
                    this.telegram.sendMessage(`❌ [15:47] 월간 회고 AI 실패\n오류: ${e.message}`)
                }
            }, { timezone: 'Asia/Seoul' })

            // Option 1: Pre-Close 일간 피드백 (로컬 감시 스웜) (15:00)
            const preCloseRetroJob = cron.schedule('0 15 * * 1-5', async () => {
                const { MarketReviewAgent } = await import('./v2_agents/MarketReviewAgent')
                await MarketReviewAgent.getInstance().runPreCloseFeedback()
            }, { timezone: 'Asia/Seoul' })

            // Option 2: Post-Market 일간 회고 AI (15:38, 성과추적 3분 후)
            const dailyRetroJob = cron.schedule('38 15 * * 1-5', async () => {
                try {
                    const { MarketReviewAgent } = await import('./v2_agents/MarketReviewAgent')
                    await MarketReviewAgent.getInstance().runDailyReview()
                    this.telegram.sendMessage('✅ [15:38] 일간 회고 AI 완료\n오늘 시장 성과 큐리큐 일간 파일 정상 완료')
                } catch (e: any) {
                    console.error('[Scheduler] 일간 회고 오류:', e.message)
                    this.telegram.sendMessage(`❌ [15:38] 일간 회고 AI 실패\n오류: ${e.message}`)
                }
            }, { timezone: 'Asia/Seoul' })

            // ─── 종목 AI 파이프라인 (3단계, 5분 간격) ───────────────────────
            // [Step 1] 09:35 수급 AI: NaverFlow(09:26) 데이터 확보 후 급등/거래대금 교차 분석
            const momentumJob = cron.schedule('35 09 * * 1-5', async () => {
                console.log('[Scheduler] 📈 수급 AI (MomentumAnalyst) 자동 실행 시작...')
                try {
                    const { MomentumAnalystAgent } = await import('./v2_agents/MomentumAnalystAgent')
                    await MomentumAnalystAgent.getInstance().runAnalysis()
                } catch (e: any) {
                    console.error('[Scheduler] 수급 AI 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })

            // [Step 2] 09:41 리포트 AI: 증권사 리포트 기반 펀더멘탈 우량주 발굴 (스웜 AI 충돌 회피로 1분 지연)
            const fundamentalJob = cron.schedule('41 09 * * 1-5', async () => {
                console.log('[Scheduler] 📄 리포트 AI (FundamentalAnalyst) 자동 실행 시작...')
                try {
                    const { FundamentalAnalystAgent } = await import('./v2_agents/FundamentalAnalystAgent')
                    await FundamentalAnalystAgent.getInstance().runAnalysis()
                } catch (e: any) {
                    console.error('[Scheduler] 리포트 AI 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })

            // [Step 2-B] 09:42 눈림목 스캐너: Alpha 상위 주도주 중 조정 구간 진입 후보 발굴
            const pullbackJob = cron.schedule('42 09 * * 1-5', async () => {
                console.log('[Scheduler] 🔍 눈림목 스캐너 (PullbackScanner) 자동 실행 시작...')
                try {
                    const { PullbackScannerAgent } = await import('./v2_agents/PullbackScannerAgent')
                    await PullbackScannerAgent.getInstance().runScan()
                } catch (e: any) {
                    console.error('[Scheduler] 눈림목 스캐너 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })

            // [Step 3] 09:45 PM 1차 평가 (루키 오디션)
            const phase1Job = cron.schedule('45 09 * * 1-5', async () => {
                console.log('[Scheduler] 🧑‍💼 포트폴리오 매니저 (1차 필터링) 실행 시작...')
                try {
                    const { PortfolioManagerAgent } = await import('./v2_agents/PortfolioManagerAgent')
                    await PortfolioManagerAgent.getInstance().runPhase1_Screening()
                } catch (e: any) {
                    console.error('[Scheduler] PM 1차 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })

            // [Step 4] 09:48 PM 2차 평가 (리밸런싱 - 캡 초과 통제 및 편입 결정)
            const phase2Job = cron.schedule('48 09 * * 1-5', async () => {
                console.log('[Scheduler] 🧑‍💼 포트폴리오 매니저 (2차 리밸런싱) 실행 시작...')
                try {
                    const { PortfolioManagerAgent } = await import('./v2_agents/PortfolioManagerAgent')
                    await PortfolioManagerAgent.getInstance().runPhase2_Rebalancing()
                } catch (e: any) {
                    console.error('[Scheduler] PM 2차 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })

            // [Step 4-B] 14:05 PM 장중 2차 미니 리뷰 (포트폴리오 중간 점검 및 리밸런싱)
            const phase2MiniJob = cron.schedule('05 14 * * 1-5', async () => {
                console.log('[Scheduler] 🧑‍💼 포트폴리오 매니저 (14시 장중 미니 리뷰) 실행 시작...')
                try {
                    const { PortfolioManagerAgent } = await import('./v2_agents/PortfolioManagerAgent')
                    // 14:05에는 1차 통과자가 없으므로, 현재 활성 상태인 포트폴리오/관심 종목들끼리만 리밸런싱을 수행하여 상태를 재점검합니다.
                    await PortfolioManagerAgent.getInstance().runPhase2_Rebalancing()
                } catch (e: any) {
                    console.error('[Scheduler] PM 장중 미니 리뷰 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })

            // [Step 4] 15:41 장마감 채점: 종가 기준 수익률·수명 심사
            const portfolioJudgeJob = cron.schedule('41 15 * * 1-5', async () => {
                console.log('[Scheduler] ⚖️ 포트폴리오 장마감 채점 자동 실행 시작...')
                try {
                    const { PortfolioJudgeScheduler } = await import('./v2_pipeline/PortfolioJudgeScheduler')
                    await PortfolioJudgeScheduler.getInstance().runDailyJudgement()

                    // [Track A, B, C] 모의매매 성과 채점 연동
                    const { TrackCBuyAgent } = await import('./v2_agents/TrackCBuyAgent')
                    const { TrackBBuyAgent } = await import('./v2_agents/TrackBBuyAgent')
                    const { TrackABuyAgent } = await import('./v2_agents/TrackABuyAgent')
                    const trackCResult = TrackCBuyAgent.getInstance().scoreDailyPerformance()
                    const trackBResult = TrackBBuyAgent.getInstance().scoreDailyPerformance()
                    const trackAResult = TrackABuyAgent.getInstance().scoreDailyPerformance()

                    const trackCMsg = trackCResult.closed > 0
                        ? `\n🎣 Track C (눌림목): ${trackCResult.updated}개 갱신, ${trackCResult.closed}개 청산`
                        : trackCResult.updated > 0 ? `\n🎣 Track C: ${trackCResult.updated}개 보유중 갱신` : ''
                    const trackBMsg = trackBResult.closed > 0
                        ? `\n🚀 Track B (신흥성장주): ${trackBResult.updated}개 갱신, ${trackBResult.closed}개 청산`
                        : trackBResult.updated > 0 ? `\n🚀 Track B: ${trackBResult.updated}개 보유중 갱신` : ''
                    const trackAMsg = trackAResult.closed > 0
                        ? `\n👑 Track A (대장주): ${trackAResult.updated}개 갱신, ${trackAResult.closed}개 청산`
                        : trackAResult.updated > 0 ? `\n👑 Track A: ${trackAResult.updated}개 보유중 갱신` : ''

                    this.telegram.sendMessage(`⚖️ [15:41] 장마감 포트폴리오 채점 완료\n종가 기준 수익률·수명 심사 정상 완료\n확인: 종목AI 탭 > 포트폴리오 리스트${trackAMsg}${trackBMsg}${trackCMsg}`)
                } catch (e: any) {
                    console.error('[Scheduler] 장마감 채점 오류:', e.message)
                    this.telegram.sendMessage(`❌ [15:41] 장마감 채점 실패\n오류: ${e.message}`)
                }
            }, { timezone: 'Asia/Seoul' })

            // [Step 5] 인큐베이터 스캔: Pool B neglect_score 갱신 (15:43)
            const incubatorScanJob = cron.schedule('43 15 * * 1-5', async () => {
                console.log('[Scheduler] 🧪 인큐베이터 neglect_score 스캔 자동 실행 시작...')
                try {
                    const { IncubatorScanEngine } = await import('./v2_agents/IncubatorScanEngine')
                    await IncubatorScanEngine.getInstance().runDailyScan()
                    this.telegram.sendMessage('🧪 [15:43] 인큐베이터 스캔 완료\nneglect_score 갱신 및 IGNITE 후보 평가 완료\n확인: 종목AI 탭 > 인큐베이터')
                } catch (e: any) {
                    console.error('[Scheduler] 인큐베이터 스캔 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })

            // ─────────────────────────────────────────────────────────────────
            // [Step 6 + Track B 통합] 15:05 전 종목 60봉 수집 → 즉시 모의매매 AI 선정
            // ─────────────────────────────────────────────────────────────────
            // 수집 타이밍: 15:05 시작 → ~15:23 완료 (실측 20분 이내)
            // 수집 데이터: 장 마감 약 15~25분 전 가격 (오늘 종가와 오차 < 1%)
            // CrossPeriodAnalyzer는 이 오늘 데이터를 포함한 60봉을 기반으로 분석
            // 진입가 최종 보정은 15:32에 실제 동시호가 확정 종가로 덮어쓰기
            const marketDailyJob = cron.schedule('05 15 * * 1-5', async () => {
                const startTime = new Date()
                const fmt = (d: Date) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
                this.telegram.sendMessage(`🚀 [${fmt(startTime)}] OHLCV 전 종목 수집 시작\n코스피/코스닥 전 종목 60일봉 수집 시작.\n수집 완료 후 → AI 모의매매 매수 선정 자동 실행 예정`)
                console.log('[Scheduler] 🚀 전 종목 데이터 수집 펌프 자동 실행 시작 (15:05, 장중 마지막 수집)...')
                try {
                    const { MarketDataCollectorService } = await import('./v2_pipeline/MarketDataCollectorService')
                    await MarketDataCollectorService.getInstance().runDailyCollection(60)
                    const endTime = new Date()
                    const elapsed = Math.round((endTime.getTime() - startTime.getTime()) / 1000 / 60)
                    this.telegram.sendMessage(`✅ [${fmt(endTime)}] OHLCV 전 종목 수집 완료\n소요 시간: 약 ${elapsed}분\n→ AI 모의매매 매수 선정 시작...`)

                    // ─── 수집 완료 직후 TrackA, TrackB, TrackC 모의매매 AI 선정 연계 실행 ───
                    console.log('[Scheduler] 🎯 수집 완료 → Track A, B, C 모의매매 AI 매수 선정 연계 실행...')
                    const { TrackCBuyAgent } = await import('./v2_agents/TrackCBuyAgent')
                    const { TrackBBuyAgent } = await import('./v2_agents/TrackBBuyAgent')
                    const { TrackABuyAgent } = await import('./v2_agents/TrackABuyAgent')
                    const pickResultC = await TrackCBuyAgent.getInstance().run()
                    const pickResultB = await TrackBBuyAgent.getInstance().run()
                    const pickResultA = await TrackABuyAgent.getInstance().run()

                    let trackAMsg = pickResultA.success 
                        ? `Track A (대장주): 매수 후보 ${pickResultA.saved}개 저장, 제외 ${pickResultA.skipped}개\n`
                        : `Track A 오류: ${pickResultA.error ?? '후보 없음'}\n`
                    let trackBMsg = pickResultB.success 
                        ? `Track B (신흥주): 매수 후보 ${pickResultB.saved}개 저장, 제외 ${pickResultB.skipped}개\n`
                        : `Track B 오류: ${pickResultB.error ?? '후보 없음'}\n`
                    let trackCMsg = pickResultC.success 
                        ? `Track C (눌림목): 매수 후보 ${pickResultC.saved}개 저장, 제외 ${pickResultC.skipped}개`
                        : `Track C 오류: ${pickResultC.error ?? '후보 없음'}`
                    
                    this.telegram.sendMessage(`🎯 [${fmt(new Date())}] 모의매매 AI 선정 완료\n${trackAMsg}${trackBMsg}${trackCMsg}\n→ 15:32 동시호가 확정 종가로 진입가 최종 보정 예정`)
                } catch (e: any) {
                    console.error('[Scheduler] 데이터 수집 / TrackB 선정 오류:', e.message)
                    this.telegram.sendMessage(`❌ [15:05] OHLCV 수집 또는 모의매매 선정 실패\n오류: ${e.message}\n→ 주도주 탭에서 수동 실행 필요`)
                }
            }, { timezone: 'Asia/Seoul' })

            // [Track A, B, C] 15:32 진입가 최종 보정 (동시호가 종료 2분 후)
            // 15:05~15:23 수집 시의 근사 종가 → 실제 확정 종가(동시호가 결과)로 덮어쓰기
            // market_ohlcv_history에 15:30 이후 정확한 close가 들어오면 entry_price 갱신
            // PENDING → ACTIVE
            const trackEntryJob = cron.schedule('32 15 * * 1-5', async () => {
                console.log('[Scheduler] 💰 Track A, B, C 모의매매 진입가 최종 확정...')
                try {
                    const { TrackCBuyAgent } = await import('./v2_agents/TrackCBuyAgent')
                    const { TrackBBuyAgent } = await import('./v2_agents/TrackBBuyAgent')
                    const { TrackABuyAgent } = await import('./v2_agents/TrackABuyAgent')
                    const updatedC = TrackCBuyAgent.getInstance().updateEntryPrices()
                    const updatedB = TrackBBuyAgent.getInstance().updateEntryPrices()
                    const updatedA = TrackABuyAgent.getInstance().updateEntryPrices()
                    
                    if (updatedB > 0 || updatedA > 0 || updatedC > 0) {
                        this.telegram.sendMessage(`💰 [15:32] 모의매매 진입가 최종 확정\nTrack A: ${updatedA}개\nTrack B: ${updatedB}개\nTrack C: ${updatedC}개\n→ 동시호가 확정 종가로 진입가 기록 (ACTIVE)`)
                    }
                } catch (e: any) {
                    console.error('[Scheduler] Track 진입가 확정 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })

            // [메가 테마] 임시 비활성화 (개선 작업 중)
            /*
            const megaThemeJob = cron.schedule('5 16 * * 1-5', async () => {
                console.log('[Scheduler] 🔥 ThemeContextBuilder 메가 테마 집계 시작...')
                try {
                    const { ThemeContextBuilder } = await import('./v2_agents/ThemeContextBuilder')
                    await ThemeContextBuilder.getInstance().runDaily()
                    console.log('[Scheduler] ✅ ThemeContextBuilder 집계 완료')
                } catch (e: any) {
                    console.error('[Scheduler] ThemeContextBuilder 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })
            */

            this.scheduledJobs.push(mcaJobA, mcaJobP, mcaJobB, mcaTrackerJob, preCloseRetroJob, dailyRetroJob, weeklyReviewJob, monthlyReviewJob, momentumJob, fundamentalJob, pullbackJob, phase1Job, phase2Job, phase2MiniJob, portfolioJudgeJob, incubatorScanJob, marketDailyJob, trackEntryJob, ...swarmJobs)

            console.log(`[SchedulerService] V2 AI schedules initialized (MCA: 08:50, CCI, Swarms, Retros)`)
            console.log(`[SchedulerService] 🎨 종목 AI 파이프라인: 수급(09:35) → 리포트(09:40) → 눌림목(09:42) → PM(09:45)`)
            console.log(`[SchedulerService] 📊 장중 파이프라인: OHLCV수집+모의매매선정(15:05) → 진입가확정(15:32)`)
            console.log(`[SchedulerService] 📊 장마감 파이프라인: 성과추적(15:35) → 회고(15:38) → 채점(15:41) → 인큐베이터(15:43) → 주간(15:44,금) → 월간(15:47,28일)`)
        }

        // ═══ [Step 3] NaverFlow 크론 등록 ═══
        const nfSettings = store.get('naverflow_settings') as any
        if (nfSettings?.enabled && Array.isArray(nfSettings?.scheduleSlots)) {
            // Collision Avoidance: adjust legacy times
            nfSettings.scheduleSlots.forEach((s: any) => {
                if (s.time === '09:30') s.time = '09:41'; // 스웜 AI 충돌 회피
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
