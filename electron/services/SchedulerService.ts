import cron from 'node-cron'
import { RisingStockAnalysisService } from './RisingStockAnalysisService'
import { TelegramService } from './TelegramService'
import { KiwoomService } from './KiwoomService'
import { eventBus, SystemEvent } from '../utils/EventBus'
import Store from 'electron-store'
import { IngestionManager } from './IngestionManager'
import { DatabaseService } from './DatabaseService'
import { DEFAULT_NEWS_HUB_SETTINGS, NewsHubSettings } from '../types/NewsHubSettings'
import { isETFOrSPAC } from '../utils/StockFilters'

const store = new Store()

export class SchedulerService {
    private static instance: SchedulerService
    private risingStockAnalysis = RisingStockAnalysisService.getInstance()
    private telegram = TelegramService.getInstance()
    private kiwoom = KiwoomService.getInstance()

    private scheduledJobs: cron.ScheduledTask[] = []

    // OHLCV 중앙 상태 관리
    private ohlcvCollectionStatus: 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED' = 'IDLE';

    // ─── 타임아웃 자동 복구 큐 ───────────────────────────────────
    // 타임아웃으로 실패한 크론 작업을 전부 보관 → 재연결 후 순서대로 재실행
    private retryQueue: Array<{ name: string; fn: () => Promise<void> }> = [];
    private isRecovering: boolean = false;

    private isPmDailyReviewRunning: boolean = false;
    // ──────────────────────────────────────────────────────────────

    // ─── [장 마감 파수꾼] Post-Market Watchdog ────────────────────
    private dailyExecutionFlags: Map<string, string> = new Map(Object.entries(store.get('watchdog_execution_flags') as Record<string, string> || {}));
    private watchdogTasks: { name: string, triggerTime: string, dom?: string, dow?: string, fn: () => Promise<void> }[] = [];

    private setWatchdogFlag(name: string, dateStr: string) {
        this.dailyExecutionFlags.set(name, dateStr);
        store.set('watchdog_execution_flags', Object.fromEntries(this.dailyExecutionFlags));
    }

    /**
     * 감시자(Watchdog) 대상 크론을 생성합니다. 
     * node-cron이 스킵되더라도 Watchdog이 누락을 감지하고 강제 실행합니다.
     */
    private createWatchdogCron(name: string, cronExpr: string, fn: () => Promise<void>): cron.ScheduledTask {
        const parts = cronExpr.split(' ');
        if (parts.length >= 5) {
            const min = parseInt(parts[0], 10);
            const hr = parseInt(parts[1], 10);
            if (!isNaN(min) && !isNaN(hr)) {
                const triggerTime = `${hr.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
                this.watchdogTasks.push({ name, triggerTime, dom: parts[2], dow: parts[4], fn });
            }
        }
        return cron.schedule(cronExpr, async () => {
            const { getKstDate } = await import('../utils/DateUtils');
            this.setWatchdogFlag(name, getKstDate());
            await fn();
        }, { timezone: 'Asia/Seoul' });
    }

    private morningWatchdogTasks: { name: string, triggerTime: string, maxRecoveryTime: string, dom?: string, dow?: string, fn: () => Promise<void> }[] = [];

    /**
     * 오전 장 파수꾼(Watchdog) 대상 크론을 생성합니다.
     */
    private createMorningWatchdogCron(name: string, cronExpr: string, maxRecoveryTime: string, fn: () => Promise<void>): cron.ScheduledTask {
        const parts = cronExpr.split(' ');
        if (parts.length >= 5) {
            const min = parseInt(parts[0], 10);
            const hr = parseInt(parts[1], 10);
            if (!isNaN(min) && !isNaN(hr)) {
                const triggerTime = `${hr.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
                this.morningWatchdogTasks.push({ name, triggerTime, maxRecoveryTime, dom: parts[2], dow: parts[4], fn });
            }
        }
        return cron.schedule(cronExpr, async () => {
            const { getKstDate } = await import('../utils/DateUtils');
            this.setWatchdogFlag(name, getKstDate());
            await fn();
        }, { timezone: 'Asia/Seoul' });
    }
    // ──────────────────────────────────────────────────────────────

    private async waitForOhlcv(timeoutMinutes: number = 40): Promise<boolean> {
        const start = Date.now();
        while (this.ohlcvCollectionStatus === 'RUNNING') {
            if (Date.now() - start > timeoutMinutes * 60 * 1000) {
                console.warn(`[Scheduler] OHLCV 대기 시간 초과 (${timeoutMinutes}분)`);
                return false;
            }
            await new Promise(r => setTimeout(r, 60000)); // 1분 대기 폴링
        }
        return this.ohlcvCollectionStatus === 'SUCCESS';
    }

    public setOhlcvCollectionStatus(status: 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED') {
        this.ohlcvCollectionStatus = status;
        console.log(`[SchedulerService] OHLCV Collection Status updated to: ${status}`);
    }

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
     * 타임아웃으로 실패한 크론 작업들을 순서대로 재실행
     */
    private async flushRetryQueue() {
        // 현재 큐를 스냅샷으로 가져와서 처리 (실행 중 새 항목 추가 방지)
        const tasks = [...this.retryQueue];
        this.retryQueue = [];
        for (const task of tasks) {
            console.log(`[SchedulerService] 🔄 보류 작업 재실행: [${task.name}]`);
            try {
                await task.fn();
                this.telegram.sendMessage(`✅ [복구 완료] ${task.name}`);
            } catch (e: any) {
                console.error(`[SchedulerService] ❌ [복구 재실패] ${task.name}:`, e.message);
                this.telegram.sendMessage(`❌ [복구 재실패] ${task.name}\n오류: ${e.message}`);
            }
        }
    }

    /**
     * 타임아웃 자동 복구 래퍼
     * 개별 크론의 기존 재시도 로직과 완전 독립으로 동작.
     * 타임아웃 계열 에러가 발생하면 retryQueue에 등록하고 조용히 종료.
     * (타임아웃이 아닌 에러는 기존 방식대로 처리)
     */
    private withRetryOnTimeout(name: string, fn: () => Promise<void>): () => Promise<void> {
        return async () => {
            try {
                await fn();
            } catch (e: any) {
                const isTimeout = e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED'
                    || (e.message && e.message.includes('Circuit Breaker'));
                if (isTimeout) {
                    console.warn(`[Scheduler] ⏸️ [${name}] 타임아웃 감지 → 복구 큐 등록`);
                    // 중복 등록 방지
                    if (!this.retryQueue.find(t => t.name === name)) {
                        this.retryQueue.push({ name, fn });
                    }
                }
                // 타임아웃이 아닌 에러는 래퍼 밖으로 throw하지 않음
                // (각 크론의 catch 블록에서 이미 처리됨)
            }
        };
    }

    /**
     * 자동화 스케줄 초기화 (저장된 설정 기반)
     */
    public async initSchedules() {
        // 기존 작업 중지 및 초기화
        this.scheduledJobs.forEach(job => job.stop())
        this.scheduledJobs = []

        // ─── 타임아웃 자동 복구 리스너 등록 ────────────────────────
        // 기존 리스너가 있으면 중복 등록 방지
        eventBus.removeAllListeners(SystemEvent.KIWOOM_TIMEOUT);
        eventBus.on(SystemEvent.KIWOOM_TIMEOUT, async ({ code }: { code: string }) => {
            if (this.isRecovering) {
                console.log('[SchedulerService] 복구 이미 진행 중 — 중복 트리거 무시');
                return;
            }
            this.isRecovering = true;
            console.warn(`[SchedulerService] 🚨 KIWOOM_TIMEOUT 수신 (${code}). 강제 재연결 시작...`);
            this.telegram.sendMessage(`🚨 키움 타임아웃 감지 (${code})\n→ 자동 재연결 시도 중...`);

            const ok = await this.kiwoom.forceReconnect();

            if (ok) {
                const queueLen = this.retryQueue.length;
                this.telegram.sendMessage(`✅ 재연결 성공!${queueLen > 0 ? `\n보류된 크론 작업 ${queueLen}개를 순서대로 재실행합니다.` : '\n(재시도 대기 작업 없음)'}`);
                
                // UI 에러 배너 자동 해제 신호 전송
                eventBus.emit(SystemEvent.SYSTEM_ERROR, null);
                
                await this.flushRetryQueue();
            } else {
                this.telegram.sendMessage(`🚨 재연결 실패.\n수동으로 앱을 재시작해주세요.`);
            }
            this.isRecovering = false;
        });
        // ────────────────────────────────────────────────────────────

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
            const mcaJobA = this.createMorningWatchdogCron('mcaJobA', '50 08 * * 1-5', '09:30', async () => {
                const { MarketConditionAgent } = await import('./v2_agents/MarketConditionAgent')
                await MarketConditionAgent.getInstance().runPrediction('A')
            })

            // PerformanceTracker 기록용 (15:35 T+1 / T+5 / T+20)
            const mcaTrackerJob = this.createWatchdogCron('mcaTrackerJob', '35 15 * * 1-5', async () => {
                const isReady = await this.waitForOhlcv();
                if (!isReady) {
                    console.log('[Scheduler] 성과 추적 취소: OHLCV 선행 작업 미완료');
                    return;
                }
                try {
                    const { PerformanceTracker } = await import('./v2_agents/PerformanceTracker')
                    const tracker = PerformanceTracker.getInstance()
                    await tracker.runDailyTracking()
                    this.telegram.sendMessage(`✅ [15:35] 성과 추적 완료\nT+1/T+5/T+20 수익률 집계 정상 완료`)
                } catch (e: any) {
                    console.error('[Scheduler] 성과추적 오류:', e.message)
                    this.telegram.sendMessage(`❌ [15:35] 성과 추적 실패\n오류: ${e.message}`)
                }
            }, { timezone: 'Asia/Seoul' })

            // 실전 매매 아침 보유기한 브리핑 (09:10)
            const liveTradeMorningBriefingJob = this.createMorningWatchdogCron('liveTradeMorningBriefingJob', '10 09 * * 1-5', '09:59', async () => {
                try {
                    // [Bugfix] 아침 브리핑 직전에 KODEX 200(069500) 캔들을 최우선 업데이트하여 보유일(holding_days) 계산 기준을 당일로 갱신합니다.
                    const { MarketDataCollectorService } = await import('./v2_pipeline/MarketDataCollectorService');
                    await MarketDataCollectorService.getInstance().refreshStocksClose(['069500']);

                    const { LiveTradeLedgerService } = await import('./LiveTradeLedgerService')
                    const { StockMasterService } = await import('./StockMasterService')
                    const ledger = LiveTradeLedgerService.getInstance()
                    const master = StockMasterService.getInstance()
                    
                    const activeTickets = ledger.getActiveTickets()
                    const todayStr = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
                    
                    const expiringTickets = activeTickets.filter(t => (t.holding_days ?? 0) >= (t.target_days ?? 999))
                    
                    let msg = `📅 **[오늘의 실전매매 보유기한 브리핑]**\n`
                    msg += `- 오늘 날짜: ${todayStr}\n`
                    msg += `- 보유기한 도달 종목: ${expiringTickets.length}건\n\n`
                    
                    if (expiringTickets.length > 0) {
                        msg += `💡 아래 종목들은 장중 목표가에 도달하여 선제 익절되지 않을 경우, 오늘 오후 3시(15:00)에 장 마감 기간청산 로직을 통해 일괄 매도될 예정입니다.\n\n`
                        expiringTickets.forEach((t, idx) => {
                            const name = master.getStock(t.stock_code)?.stock_name || t.stock_code
                            msg += `${idx + 1}. ${name} (목표: D+${t.target_days} / 현재: D+${t.holding_days})\n`
                        })
                    } else {
                        msg += `✅ 오늘은 보유기한 만료로 인한 강제 청산 대기 종목이 없습니다.`
                    }
                    
                    this.telegram.sendMessage(msg)
                } catch (e: any) {
                    console.error('[Scheduler] 실전매매 아침 브리핑 오류:', e.message)
                }
            })

            // 실전 매매 최대 보유일 청산 (Time-Stop) 파이프라인 (15:00)
            const liveTradeTimeStopJob = cron.schedule('00 15 * * 1-5', async () => {
                try {
                    const { LiveTradeLedgerService } = await import('./LiveTradeLedgerService')
                    const { LiveTradeExecutionService } = await import('./LiveTradeExecutionService')
                    const ledger = LiveTradeLedgerService.getInstance()
                    const execSvc = LiveTradeExecutionService.getInstance()
                    
                    const activeTickets = ledger.getActiveTickets()
                    const today = new Date().toISOString().split('T')[0]
                    
                    const expiringTickets = activeTickets.filter(t => (t.holding_days ?? 0) >= (t.target_days ?? 999))
                    
                    if (expiringTickets.length > 0) {
                        this.telegram.sendMessage(`⏳ **[장 마감 기간 청산 시작]**\n- 청산 대상: ${expiringTickets.length}건\n- 최대 보유일 도달로 인해 15:20 동시호가 시장가(조건부 지정가)로 전량 매도 실행합니다.`);
                        for (const ticket of expiringTickets) {
                            try {
                                const priceInfo = await this.kiwoom.getStockBasicInfo(ticket.stock_code);
                                const body = priceInfo?.Body || priceInfo?.out1 || priceInfo || {};
                                const rawCur = String(body.cur_prc || body.stk_prc || body.stck_prpr || '0').replace(/[^0-9-]/g, '');
                                const currentPrice = Math.abs(parseInt(rawCur, 10)) || 0;

                                if (currentPrice > 0) {
                                    await execSvc.executeTimeStopSell(ticket);
                                    await new Promise(r => setTimeout(r, 1000)); // Rate limit 보호
                                } else {
                                    console.warn(`[Scheduler] ${ticket.stock_code} 현재가 조회 실패. 기간청산 건너뜀.`);
                                    this.telegram.sendMessage(`⚠️ **[기간청산 건너뜀]**\n- 종목: ${ticket.stock_code}\n- 사유: 현재가 조회 실패`);
                                }
                            } catch (err: any) {
                                console.error(`[Scheduler] ${ticket.stock_code} 기간청산 매도 에러:`, err.message);
                            }
                        }
                        
                        // (미체결 추적은 09:00부터 상시 가동 중이며 알아서 10초 모드로 변속됨)
                    }
                } catch (e: any) {
                    console.error('[Scheduler] 실전매매 기간청산 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })

            // I-4: 장 시작 전 잔고 대조 (Daily Sync Check, 08:50)
            // 전날 정산 실패 또는 야간 수동 매매로 인한 불일치 조기 감지
            const liveTradeSyncCheckJob = this.createMorningWatchdogCron('liveTradeSyncCheckJob', '50 08 * * 1-5', '08:59', async () => {
                try {
                    const { LiveTradeReconciliationService } = await import('./LiveTradeReconciliationService')
                    console.log('[Scheduler] 장 시작 전 실전매매 잔고 대조 (Sync Check) 실행')
                    await LiveTradeReconciliationService.getInstance().reconcileDailyExecutions()
                } catch (e: any) {
                    console.error('[Scheduler] 장 시작 전 Sync Check 오류:', e.message)
                }
            })

            // 장 마감 실전매매 정산 파이프라인 (15:35)
            const liveTradeReconJob = this.createWatchdogCron('liveTradeReconJob', '35 15 * * 1-5', async () => {
                try {
                    const { LiveTradeReconciliationService } = await import('./LiveTradeReconciliationService')
                    await LiveTradeReconciliationService.getInstance().reconcileDailyExecutions()
                } catch (e: any) {
                    console.error('[Scheduler] 실전매매 장 마감 정산 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })



            // 주간 회고 AI (금요일 15:44, 3분 텀 내 편성)
            const weeklyReviewJob = this.createWatchdogCron('weeklyReviewJob', '44 15 * * 5', async () => {
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
            const monthlyReviewJob = this.createWatchdogCron('monthlyReviewJob', '47 15 28 * *', async () => {
                try {
                    const { MarketReviewAgent } = await import('./v2_agents/MarketReviewAgent')
                    await MarketReviewAgent.getInstance().runMonthlyReview()
                    this.telegram.sendMessage('✅ [15:47] 월간 회고 AI 완료\n이번 달 시장 성과 종합 분석 완료')
                } catch (e: any) {
                    console.error('[Scheduler] 월간 회고 오류:', e.message)
                    this.telegram.sendMessage(`❌ [15:47] 월간 회고 AI 실패\n오류: ${e.message}`)
                }
            }, { timezone: 'Asia/Seoul' })

            // Option 1: Pre-Close 일간 피드백 (로컬 감시 스웜) (15:00) - 사용 안함
            // Option 2: Post-Market 일간 회고 AI (15:38) - 사용 안함

            // ─── 종목 AI 파이프라인 (3단계, 5분 간격) ───────────────────────
            // [Step 1] 09:35 수급 AI: NaverFlow(09:26) 데이터 확보 후 급등/거래대금 교차 분석
            const momentumJob = this.createMorningWatchdogCron('momentumJob', '35 09 * * 1-5', '09:59', this.withRetryOnTimeout('수급AI-09:35', async () => {
                console.log('[Scheduler] 📈 수급 AI (MomentumAnalyst) 자동 실행 시작...')
                try {
                    const { MomentumAnalystAgent } = await import('./v2_agents/MomentumAnalystAgent')
                    await MomentumAnalystAgent.getInstance().runAnalysis()
                } catch (e: any) {
                    console.error('[Scheduler] 수급 AI 오류:', e.message)
                }
            }))

            // [Step 2] 09:41 리포트 AI: 증권사 리포트 기반 펀더멘탈 우량주 발굴 (스웜 AI 충돌 회피로 1분 지연)
            const fundamentalJob = this.createMorningWatchdogCron('fundamentalJob', '41 09 * * 1-5', '09:59', async () => {
                console.log('[Scheduler] 📄 리포트 AI (FundamentalAnalyst) 자동 실행 시작...')
                try {
                    const { FundamentalAnalystAgent } = await import('./v2_agents/FundamentalAnalystAgent')
                    await FundamentalAnalystAgent.getInstance().runAnalysis()
                } catch (e: any) {
                    console.error('[Scheduler] 리포트 AI 오류:', e.message)
                }
            })

            // [Step 2-B] 09:42 눈림목 스캐너: Alpha 상위 주도주 중 조정 구간 진입 후보 발굴
            const pullbackJob = this.createMorningWatchdogCron('pullbackJob', '42 09 * * 1-5', '09:59', async () => {
                console.log('[Scheduler] 🔍 눈림목 스캐너 (PullbackScanner) 자동 실행 시작...')
                try {
                    const { PullbackScannerAgent } = await import('./v2_agents/PullbackScannerAgent')
                    await PullbackScannerAgent.getInstance().runScan()
                } catch (e: any) {
                    console.error('[Scheduler] 눈림목 스캐너 오류:', e.message)
                }
            })

            // [Step 3+4 통합] 09:45 PM 통합 리뷰 (PM1 루키 오디션 → PM2 리밸런싱 즉시 체인 실행)
            // ★ BUG FIX: phase1Job + phase2Job을 runDailyReview() 하나로 통합
            //   이전에는 09:45(PM1)과 09:48(PM2)이 별개 크론으로 실행되어
            //   PM1의 신규 픽(newPicks) 반환값이 PM2로 전달되지 않는 데이터 체인 단절 버그가 있었음.
            //   runDailyReview()는 내부에서 PM1→PM2를 순서대로 실행하며 결과를 직접 전달함.
            const pmDailyJob = this.createMorningWatchdogCron('pmDailyJob', '45 09 * * 1-5', '09:59', this.withRetryOnTimeout('PM통합리뷰-09:45', async () => {
                if (this.isPmDailyReviewRunning) {
                    console.log('[Scheduler] 🧑‍💼 이미 PM 통합 리뷰가 실행 중입니다. 중복 실행을 방지합니다.');
                    return;
                }
                this.isPmDailyReviewRunning = true;
                console.log('[Scheduler] 🧑‍💼 포트폴리오 매니저 (PM1→PM2 통합 리뷰) 실행 시작...')
                try {
                    const { PortfolioManagerAgent } = await import('./v2_agents/PortfolioManagerAgent')
                    await PortfolioManagerAgent.getInstance().runDailyReview()
                } catch (e: any) {
                    console.error('[Scheduler] PM 통합 리뷰 오류:', e.message)
                    try {
                        const { TelegramService } = await import('./TelegramService');
                        TelegramService.getInstance().sendMessage(`❌ [09:45] PM 통합 리뷰 전체 실패\n오류: ${e.message}`);
                    } catch (_) { }
                } finally {
                    this.isPmDailyReviewRunning = false;
                }
            }))

            // [Step 4-B] 14:05 PM 장중 2차 미니 리뷰 (포트폴리오 중간 점검 및 리밸런싱) - 잦은 매매 방지를 위해 비활성화
            /*
            const phase2MiniJob = cron.schedule('05 14 * * 1-5', async () => {
                console.log('[Scheduler] 🧑‍💼 포트폴리오 매니저 (14시 장중 미니 리뷰) 실행 시작...')
                try {
                    const { PortfolioManagerAgent } = await import('./v2_agents/PortfolioManagerAgent')
                    await PortfolioManagerAgent.getInstance().runPhase2_Rebalancing()
                } catch (e: any) {
                    console.error('[Scheduler] PM 장중 미니 리뷰 오류:', e.message)
                }
            }, { timezone: 'Asia/Seoul' })
            */

            // [Step 4] 15:41 장마감 채점: 종가 기준 수익률·수명 심사
            const portfolioJudgeJob = this.createWatchdogCron('portfolioJudgeJob', '41 15 * * 1-5', async () => {
                const isReady = await this.waitForOhlcv();
                if (!isReady) {
                    console.log('[Scheduler] 장마감 채점 취소: OHLCV 선행 작업 미완료');
                    return;
                }
                console.log('[Scheduler] ⚖️ 포트폴리오 장마감 채점 자동 실행 시작...')
                try {
                    const { PortfolioJudgeScheduler } = await import('./v2_pipeline/PortfolioJudgeScheduler')
                    await PortfolioJudgeScheduler.getInstance().runDailyJudgement()

                    const { TrackEBuyAgent } = await import('./v2_agents/TrackEBuyAgent')
                    const { TrackDBuyAgent } = await import('./v2_agents/TrackDBuyAgent')
                    const { TrackCBuyAgent } = await import('./v2_agents/TrackCBuyAgent')
                    const { TrackBBuyAgent } = await import('./v2_agents/TrackBBuyAgent')
                    const { TrackABuyAgent } = await import('./v2_agents/TrackABuyAgent')
                    const trackEResult = TrackEBuyAgent.getInstance().scoreDailyPerformance()
                    const trackDResult = TrackDBuyAgent.getInstance().scoreDailyPerformance()
                    const trackCResult = TrackCBuyAgent.getInstance().scoreDailyPerformance()
                    const trackBResult = TrackBBuyAgent.getInstance().scoreDailyPerformance()
                    const trackAResult = TrackABuyAgent.getInstance().scoreDailyPerformance()

                    const trackEMsg = trackEResult.closed > 0
                        ? `\n🎯 Track E (단기눌림): ${trackEResult.updated}개 갱신, ${trackEResult.closed}개 청산`
                        : trackEResult.updated > 0 ? `\n🎯 Track E: ${trackEResult.updated}개 보유중 갱신` : ''
                    const trackDMsg = trackDResult.closed > 0
                        ? `\n⚡ Track D (당일급등): ${trackDResult.updated}개 갱신, ${trackDResult.closed}개 청산`
                        : trackDResult.updated > 0 ? `\n⚡ Track D: ${trackDResult.updated}개 보유중 갱신` : ''
                    const trackCMsg = trackCResult.closed > 0
                        ? `\n🎣 Track C (눌림목): ${trackCResult.updated}개 갱신, ${trackCResult.closed}개 청산`
                        : trackCResult.updated > 0 ? `\n🎣 Track C: ${trackCResult.updated}개 보유중 갱신` : ''
                    const trackBMsg = trackBResult.closed > 0
                        ? `\n🚀 Track B (신흥성장주): ${trackBResult.updated}개 갱신, ${trackBResult.closed}개 청산`
                        : trackBResult.updated > 0 ? `\n🚀 Track B: ${trackBResult.updated}개 보유중 갱신` : ''
                    const trackAMsg = trackAResult.closed > 0
                        ? `\n👑 Track A (대장주): ${trackAResult.updated}개 갱신, ${trackAResult.closed}개 청산`
                        : trackAResult.updated > 0 ? `\n👑 Track A: ${trackAResult.updated}개 보유중 갱신` : ''

                    this.telegram.sendMessage(`⚖️ [15:41] 장마감 포트폴리오 채점 완료\n종가 기준 수익률·수명 심사 정상 완료\n확인: 종목AI 탭 > 포트폴리오 리스트${trackAMsg}${trackBMsg}${trackCMsg}${trackDMsg}${trackEMsg}`)

                    // [소급 실행 검사] 휴장일로 인해 이월된 정기 자가학습이 있으면 즉시 실행
                    const pendingRun = store.get('pending_self_learning_run') || false;
                    if (pendingRun) {
                        console.log('[Scheduler] 🔄 이월된 자가학습(pending_self_learning_run) 감지. 소급 실행을 가동합니다...');
                        const aiSettings = store.get('ai_settings') as any || {};
                        const selfLearning = aiSettings.selfLearningSettings || {};
                        this.runSelfLearningPipeline(selfLearning.holidayOption).catch(e => {
                            console.error('[Scheduler] 이월 자가학습 소급 실행 실패:', e);
                        });
                    }

                    // [주도주 AI 통합 소급 실행 검사]
                    const pendingTracksRun = store.get('pending_tracks_learning_run') || false;
                    if (pendingTracksRun) {
                        console.log('[Scheduler] 🔄 이월된 주도주 AI 통합 자가학습(pending_tracks_learning_run) 감지. 소급 실행을 가동합니다...');
                        const aiSettings = store.get('ai_settings') as any || {};
                        const trackSettings = aiSettings.trackLearningSettings || {};
                        this.runAllTracksSelfLearningPipeline(trackSettings.holidayOption).catch(e => {
                            console.error('[Scheduler] 이월 주도주 AI 통합 자가학습 소급 실행 실패:', e);
                        });
                    }
                } catch (e: any) {
                    console.error('[Scheduler] 장마감 채점 오류:', e.message)
                    this.telegram.sendMessage(`❌ [15:41] 장마감 채점 실패\n오류: ${e.message}`)
                }
            }, { timezone: 'Asia/Seoul' })

            // [Step 5] 인큐베이터 스캔: Pool B neglect_score 갱신 (15:43)
            const incubatorScanJob = this.createWatchdogCron('incubatorScanJob', '43 15 * * 1-5', async () => {
                const isReady = await this.waitForOhlcv();
                if (!isReady) {
                    console.log('[Scheduler] 인큐베이터 스캔 취소: OHLCV 선행 작업 미완료');
                    return;
                }
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
            const marketDailyJob = this.createWatchdogCron('marketDailyJob', '05 15 * * 1-5', this.withRetryOnTimeout('OHLCV수집+모의매매-15:05', async () => {
                this.ohlcvCollectionStatus = 'RUNNING';
                const startTime = new Date()
                const fmt = (d: Date) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
                this.telegram.sendMessage(`🚀 [${fmt(startTime)}] OHLCV 전 종목 수집 시작\n코스피/코스닥 전 종목 100일봉 수집 시작.\n수집 완료 후 → AI 모의매매 매수 선정 자동 실행 예정`)
                console.log('[Scheduler] 🚀 전 종목 데이터 수집 펌프 자동 실행 시작 (15:05, 장중 마지막 수집)...')
                try {
                    const { MarketDataCollectorService } = await import('./v2_pipeline/MarketDataCollectorService')
                    const collector = MarketDataCollectorService.getInstance();
                    
                    let result = await collector.runDailyCollection(100);
                    
                    // 재시도 로직 (최대 5회)
                    let retries = 0;
                    while (!result.success && retries < 5) {
                        retries++;
                        this.telegram.sendMessage(`⚠️ [15:05] OHLCV 수집 실패 (수집: ${result.collected}개). 30초 후 재시도합니다... (${retries}/5)`);
                        console.log(`[Scheduler] OHLCV 수집 실패. 30초 대기 후 재시도 (${retries}/5)...`);
                        await new Promise(r => setTimeout(r, 30 * 1000));
                        result = await collector.runDailyCollection(100);
                    }
                    
                    if (!result.success) {
                        this.ohlcvCollectionStatus = 'FAILED';
                        this.telegram.sendMessage(`🚨 [OHLCV 수집 최종 실패] 자동 복구 실패.\n오류 확산을 막기 위해 오늘 주도주 AI(Track A~E) 모의매매 실행을 전면 중단(Abort)합니다.`);
                        return; // 연쇄 실행 차단
                    }

                    this.ohlcvCollectionStatus = 'SUCCESS';
                    const endTime = new Date()
                    const elapsed = Math.round((endTime.getTime() - startTime.getTime()) / 1000 / 60)
                    this.telegram.sendMessage(`✅ [${fmt(endTime)}] OHLCV 전 종목 수집 완료\n소요 시간: 약 ${elapsed}분\n→ AI 모의매매 매수 선정 시작...`)

                    // ─── 수집 완료 직후 TrackA, TrackB, TrackC, TrackD, TrackE 모의매매 AI 선정 연계 실행 ───
                    console.log('[Scheduler] 🎯 수집 완료 → Track A, B, C, D, E 모의매매 AI 매수 선정 연계 실행...')
                    const { TrackEBuyAgent } = await import('./v2_agents/TrackEBuyAgent')
                    const { TrackDBuyAgent } = await import('./v2_agents/TrackDBuyAgent')
                    const { TrackCBuyAgent } = await import('./v2_agents/TrackCBuyAgent')
                    const { TrackBBuyAgent } = await import('./v2_agents/TrackBBuyAgent')
                    const { TrackABuyAgent } = await import('./v2_agents/TrackABuyAgent')
                    const pickResultE = await TrackEBuyAgent.getInstance().run()
                    const pickResultD = await TrackDBuyAgent.getInstance().run()
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
                        ? `Track C (눌림목): 매수 후보 ${pickResultC.saved}개 저장, 제외 ${pickResultC.skipped}개\n`
                        : `Track C 오류: ${pickResultC.error ?? '후보 없음'}\n`
                    let trackDMsg = pickResultD.success 
                        ? `Track D (당일급등): 매수 후보 ${pickResultD.saved}개 저장, 제외 ${pickResultD.skipped}개\n`
                        : `Track D 오류: ${pickResultD.error ?? '후보 없음'}\n`
                    let trackEMsg = pickResultE.success 
                        ? `Track E (단기눌림): 매수 후보 ${pickResultE.saved}개 저장, 제외 ${pickResultE.skipped}개`
                        : `Track E 오류: ${pickResultE.error ?? '후보 없음'}`

                    // ─────────────────────────────────────────────────────────────────
                    // 🔥 [실전 매매 연동] 모의매매 선정 완료 직후
                    // 계획서 2.3: "모의매매 파이프라인이 종목을 선별할 때,
                    //              실전 매매 활성 전략과 일치하는 종목이 선별되면
                    //              그 즉시 실전 매수 주문 파이프라인으로 넘겨 실행"
                    // ─────────────────────────────────────────────────────────────────
                    try {
                        const { LiveTradeLedgerService } = await import('./LiveTradeLedgerService')
                        const { LiveTradeExecutionService } = await import('./LiveTradeExecutionService')
                        const strategies = LiveTradeLedgerService.getInstance().getStrategies()
                        const activeLiveStrategies = strategies.filter((s: any) => s.is_active === 1)

                        if (activeLiveStrategies.length > 0) {
                            let totalLiveTradeLog = '';
                            const today = (await import('../utils/DateUtils')).getKstDate();
                            const rawDb = (DatabaseService.getInstance() as any).db;
                            let hasLiveTradeAction = false;

                            for (const activeLiveStrategy of activeLiveStrategies) {
                                const activeCategory = activeLiveStrategy.strategy_category as string;
                                const maxHoldDays = activeLiveStrategy.max_hold_days as number;

                                const CATEGORY_TO_PICK_TABLE: Record<string, string> = {
                                    'TRUE_LEADER':             'track_a_buy_picks',
                                    'EMERGING_STAR':           'track_b_buy_picks',
                                    'PULLBACK_REBOUND':        'track_c_buy_picks',
                                    'PULLBACK_DIP':            'track_c_buy_picks',
                                    'INTRADAY_SURGE':          'track_d_buy_picks',
                                    'SHORT_TERM_CONSOLIDATION':'track_e_buy_picks',
                                };

                                const pickTable = CATEGORY_TO_PICK_TABLE[activeCategory];

                                if (pickTable) {
                                    const todayPicks: any[] = rawDb.prepare(`
                                        SELECT stock_code, stock_name, current_price, entry_price, buy_score, related_themes_json
                                        FROM ${pickTable}
                                        WHERE pick_date = ? AND category = ?
                                    `).all(today, activeCategory);

                                    if (todayPicks.length > 0) {
                                        hasLiveTradeAction = true;
                                        const calcTargetExitDate = (fromDate: string, businessDays: number): string => {
                                            const d = new Date(fromDate)
                                            let added = 0
                                            while (added < businessDays) {
                                                d.setDate(d.getDate() + 1)
                                                const dow = d.getDay()
                                                if (dow !== 0 && dow !== 6) added++ // 주말 제외
                                            }
                                            return d.toISOString().split('T')[0]
                                        }
                                        const targetExitDate = calcTargetExitDate(today, maxHoldDays)

                                        const forceClosingAuction = store.get('portfolio_force_closing_auction') || false;
                                        if (forceClosingAuction) {
                                            const now = new Date();
                                            const kstH = (now.getUTCHours() + 9) % 24;
                                            const kstM = now.getUTCMinutes();
                                            
                                            // 현재 시간이 15:00 ~ 15:19 사이라면 무조건 15:20:20 (20초 버퍼)까지 대기
                                            if (kstH === 15 && kstM < 20) {
                                                // 거래소와의 미세한 시간 오차로 인해 정규장에 즉시 체결되는 것을 막기 위해 20초 버퍼 추가
                                                const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 20, 20);
                                                const diffMs = targetTime.getTime() - now.getTime();
                                                
                                                console.log(`[Scheduler] 15:20 동시호가 대기 옵션 활성화됨. 15:20:20까지 ${Math.round(diffMs/1000)}초 대기...`);
                                                this.telegram.sendMessage(`⏳ [15:20 동시호가 대기]\nAI 모의매매 분석이 완료되었습니다.\n실전매수 '동시호가 강제 대기' 옵션 및 거래소 시간 오차 방지를 위해 15:20:20초까지 매수 발송을 대기합니다. (${Math.round(diffMs/1000)}초)`);
                                                await new Promise(resolve => setTimeout(resolve, diffMs));
                                                console.log(`[Scheduler] 대기 종료. 동시호가 매수 프로세스 재개`);
                                            }
                                        }

                                        totalLiveTradeLog += `\n\n🔥 [실전 매매] 전략: ${activeCategory} | 목표일: ${targetExitDate}`
                                        for (const pick of todayPicks) {
                                            const ohlcvRow: any = rawDb.prepare(`
                                                SELECT close FROM market_ohlcv_history
                                                WHERE stock_code = ? AND date = ?
                                            `).get(pick.stock_code, today)
                                            let currentPrice: number = ohlcvRow?.close ?? 0;

                                            if (currentPrice <= 0) {
                                                try {
                                                    const priceInfo = await this.kiwoom.getStockBasicInfo(pick.stock_code);
                                                    const body = priceInfo?.Body || priceInfo?.out1 || priceInfo || {};
                                                    const rawCur = String(body.cur_prc || body.stk_prc || body.stck_prpr || '0').replace(/[^0-9-]/g, '');
                                                    currentPrice = Math.abs(parseInt(rawCur, 10)) || 0;
                                                } catch(err) {
                                                    console.error(`[Scheduler] ${pick.stock_code} 현재가 대체 수집 실패:`, err);
                                                }
                                            }

                                            if (currentPrice <= 0) {
                                                totalLiveTradeLog += `\n  ⚠️ ${pick.stock_name}: OHLCV/현재가 조회 실패 → 매수 스킵`;
                                                continue;
                                            }
                                            try {
                                                await LiveTradeExecutionService.getInstance().executeBuy(
                                                    pick.stock_code,
                                                    pick.stock_name,
                                                    activeCategory,
                                                    currentPrice,
                                                    targetExitDate,
                                                    pick.buy_score,
                                                    pick.related_themes_json
                                                )
                                                totalLiveTradeLog += `\n  ✅ ${pick.stock_name}(${pick.stock_code}): ${currentPrice.toLocaleString()}원 매수 발동`
                                            } catch (buyErr: any) {
                                                totalLiveTradeLog += `\n  🚨 ${pick.stock_name} 매수 실패: ${buyErr.message}`
                                            }
                                        }
                                    }
                                }
                            }

                            if (hasLiveTradeAction) {
                                this.telegram.sendMessage(`🎯 [${fmt(new Date())}] 모의매매 AI 선정 완료\n${trackAMsg}${trackBMsg}${trackCMsg}${trackDMsg}${trackEMsg}\n→ 15:32 동시호가 확정 종가로 진입가 최종 보정 예정${totalLiveTradeLog}`)
                                return; // 실전매매 연동 시 텔레그램 중복 발송 방지
                            }
                        }
                    } catch (liveTradeConnErr: any) {
                        console.error('[Scheduler] 실전 매매 연동 중 오류 (무시하고 계속):', liveTradeConnErr.message)
                        this.telegram.sendMessage(`⚠️ [실전 매매 연동 오류]\n모의매매 선정은 완료되었으나 실전 매수 연동 중 오류가 발생했습니다.\n오류: ${liveTradeConnErr.message}`)
                    }

                    this.telegram.sendMessage(`🎯 [${fmt(new Date())}] 모의매매 AI 선정 완료\n${trackAMsg}${trackBMsg}${trackCMsg}${trackDMsg}${trackEMsg}\n→ 15:32 동시호가 확정 종가로 진입가 최종 보정 예정`)
                } catch (e: any) {
                    this.ohlcvCollectionStatus = 'FAILED';
                    console.error('[Scheduler] 데이터 수집 / 모의매매 선정 오류:', e.message)
                    this.telegram.sendMessage(`❌ [15:05] OHLCV 수집 또는 모의매매 선정 실패\n오류: ${e.message}\n→ 주도주 탭에서 수동 실행 필요`)
                }
            }), { timezone: 'Asia/Seoul' })

            // [Track A, B, C, D, E] 15:32 진입가 최종 보정 (동시호가 종료 2분 후)
            // ① 오늘 PENDING 종목의 종가를 Kiwoom API로 재수집 (동시호가 확정 종가 반영)
            // ② 갱신된 market_ohlcv_history.close를 읽어 entry_price 확정 (PENDING → ACTIVE)
            const trackEntryJob = this.createWatchdogCron('trackEntryJob', '32 15 * * 1-5', this.withRetryOnTimeout('진입가확정-15:32', async () => {
                const isReady = await this.waitForOhlcv();
                if (!isReady) {
                    console.log('[Scheduler] 💰 진입가 확정 취소: OHLCV 선행 작업 미완료');
                    return;
                }
                console.log('[Scheduler] 💰 Track A, B, C, D, E 모의매매 진입가 최종 확정...')
                try {
                    const today = (await import('../utils/DateUtils')).getKstDate()
                    const rawDb = (DatabaseService.getInstance() as any).db

                    // ── Step 1: 오늘 PENDING 종목 및 기존 ACTIVE 종목 코드 전 트랙 합산 수집 ──
                    const targetCodes = new Set<string>()
                    const pickTables = [
                        'track_a_buy_picks', 'track_b_buy_picks', 'track_c_buy_picks',
                        'track_d_buy_picks', 'track_e_buy_picks',
                    ]
                    for (const table of pickTables) {
                        try {
                            const rows = rawDb.prepare(
                                `SELECT stock_code FROM ${table} WHERE status IN ('PENDING', 'ACTIVE')`
                            ).all() as { stock_code: string }[]
                            rows.forEach(r => targetCodes.add(r.stock_code))
                        } catch (_) { /* 테이블 없으면 skip */ }
                    }

                    const codeList = Array.from(targetCodes)
                    console.log(`[Scheduler] 💰 종가/수익률 갱신 대상 종목 (PENDING+ACTIVE): ${codeList.length}개 → ${codeList.join(', ')}`)

                    // ── Step 2: 동시호가 확정 종가 재수집 ──
                    if (codeList.length > 0) {
                        const { MarketDataCollectorService } = await import('./v2_pipeline/MarketDataCollectorService')
                        const refreshResult = await MarketDataCollectorService.getInstance().refreshStocksClose(codeList)
                        this.telegram.sendMessage(`🔄 [15:32] 동시호가 종가 재수집 완료\n갱신: ${refreshResult.refreshed}개 / 실패: ${refreshResult.failed}개\n→ 진입가/수익률 최종 확정 시작...`)
                    }

                    // ── Step 3: 갱신된 종가로 entry_price 최종 확정 (PENDING → ACTIVE) ──
                    const { TrackEBuyAgent } = await import('./v2_agents/TrackEBuyAgent')
                    const { TrackDBuyAgent } = await import('./v2_agents/TrackDBuyAgent')
                    const { TrackCBuyAgent } = await import('./v2_agents/TrackCBuyAgent')
                    const { TrackBBuyAgent } = await import('./v2_agents/TrackBBuyAgent')
                    const { TrackABuyAgent } = await import('./v2_agents/TrackABuyAgent')
                    const updatedE = TrackEBuyAgent.getInstance().updateEntryPrices()
                    const updatedD = TrackDBuyAgent.getInstance().updateEntryPrices()
                    const updatedC = TrackCBuyAgent.getInstance().updateEntryPrices()
                    const updatedB = TrackBBuyAgent.getInstance().updateEntryPrices()
                    const updatedA = TrackABuyAgent.getInstance().updateEntryPrices()

                    if (updatedB > 0 || updatedA > 0 || updatedC > 0 || updatedD > 0 || updatedE > 0) {
                        this.telegram.sendMessage(`💰 [15:32] 모의매매 진입가 최종 확정\nTrack A: ${updatedA}개\nTrack B: ${updatedB}개\nTrack C: ${updatedC}개\nTrack D: ${updatedD}개\nTrack E: ${updatedE}개\n→ 동시호가 확정 종가로 진입가 기록 (ACTIVE)`)
                    }
                    
                    // JSON 어댑터 및 CLI 파이프라인 연동 (tracker.py)
                    try {
                        if (process.env.KIWOOM_EXPORT_TO_TRACKER === '1') {
                            await this.exportToTrackerAndIngest(today);
                        } else {
                            console.log('[Scheduler] tracker.py 자동 연동 건너뜀: Codex 15:15 자동화가 close_buy 추천 생성을 전담합니다.');
                        }
                    } catch (err: any) {
                        console.error('[Scheduler] tracker.py 연동 오류:', err);
                    }
                } catch (e: any) {
                    console.error('[Scheduler] Track 진입가 확정 오류:', e.message)
                    this.telegram.sendMessage(`❌ [15:32] 진입가 확정 실패\n오류: ${e.message}`)
                }
            }), { timezone: 'Asia/Seoul' })

            // [비활성화] 메가 테마 관리: 매매와 무관한 단순 브리핑용이므로 스케줄 제외 (사용자 요청)
            /*
            const megaThemeJob = cron.schedule('43 09 * * 1-5', async () => {
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

            // [Step 6.5] 14:55 테마 AI (ThemeIntelligence) 종가 베팅을 위한 전용 크론 (비활성화됨)
            const themeAiJob = this.createWatchdogCron('themeAiJob', '55 14 * * 1-5', async () => {
                console.log(`[SchedulerService] 🤖 14:55 테마주 AI (종가 베팅용) 비활성화됨 (실행 건너뜀)`)
                /*
                try {
                    // 테마 AI 실행 전, 최신 테마/섹터 순위를 확보하기 위해 NaverFlow 수집 파이프라인 1회 강제 실행
                    const { V2PipelineManager } = await import('./v2_pipeline/V2PipelineManager')
                    await V2PipelineManager.getInstance().runPipeline('PL-NaverFlow', { forceFetch: true })
                    
                    // 수집된 데이터를 바탕으로 테마 AI 분석 실행
                    const { ThemeIntelligenceAgent } = await import('./v2_agents/ThemeIntelligenceAgent')
                    await ThemeIntelligenceAgent.getInstance().runBatchAnalysis()
                } catch (e: any) {
                    console.error(`[SchedulerService] 테마 AI 전용 파이프라인 실패:`, e.message)
                }
                */
            }, { timezone: 'Asia/Seoul' })

            // [실전 매매] 1분 단위 미체결 주문 모니터링 및 익절 매도 모니터링 (09:00 ~ 15:30 장중)
            const liveTradeMonitorJob = cron.schedule('* 09-14 * * 1-5', async () => {
                try {
                    const { LiveTradeExecutionService } = await import('./LiveTradeExecutionService');
                    await LiveTradeExecutionService.getInstance().monitorTakeProfit();

                    const now = new Date();
                    const kstH = (now.getUTCHours() + 9) % 24;
                    const kstM = now.getUTCMinutes();

                    // (Watchdog 통합으로 인해 레거시 PM 지연 캐치업 로직 삭제)
                } catch (e: any) {
                    // Ignore background errors or log them silently
                }
            }, { timezone: 'Asia/Seoul' });
            
            // 09:00 동적 미체결 추적 타이머 가동 (Idle/Chase 자동 변속)
            const liveTradeChasingStartJob = cron.schedule('00 09 * * 1-5', async () => {
                try {
                    const { LiveTradeExecutionService } = await import('./LiveTradeExecutionService');
                    LiveTradeExecutionService.getInstance().startUnexecutedSellChasing();
                } catch (e: any) {}
            }, { timezone: 'Asia/Seoul' });

            // ─── [장 마감 파수꾼] 백그라운드 타이머 스킵 자가 치유(Auto-Healing) ───
            const postMarketWatchdog = cron.schedule('* 14-15 * * 1-5', async () => {
                const { getKstDate } = await import('../utils/DateUtils');
                const today = getKstDate();
                const now = new Date();
                const kstH = (now.getUTCHours() + 9) % 24;
                const kstM = now.getUTCMinutes();
                const kstDOW = now.getDay();
                const kstDOM = now.getDate();
                const timeStr = `${kstH.toString().padStart(2, '0')}:${kstM.toString().padStart(2, '0')}`;

                for (const job of this.watchdogTasks) {
                    if (job.dow && job.dow !== '*' && job.dow !== '1-5') {
                        if (job.dow === '5' && kstDOW !== 5) continue;
                    }
                    if (job.dom && job.dom !== '*') {
                        if (parseInt(job.dom, 10) !== kstDOM) continue;
                    }
                    // 원래 스케줄 시간보다 1분 뒤(>)부터 누락 검사 (정각 중복 실행 방지)
                    if (timeStr > job.triggerTime && timeStr <= '15:59') {
                        const lastRun = this.dailyExecutionFlags.get(job.name);
                        if (lastRun !== today) {
                            console.log(`[Watchdog] ⏰ 지연/누락 감지: ${job.name} (${job.triggerTime}) -> 복구 실행!`);
                            this.telegram.sendMessage(`🛡️ [Watchdog] 백그라운드 타이머 누락을 감지하여 보충 실행합니다: ${job.name}`);
                            this.setWatchdogFlag(job.name, today);
                            try {
                                await job.fn();
                            } catch (e: any) {
                                console.error(`[Watchdog] ❌ 복구 실패: ${job.name}`, e);
                            }
                        }
                    }
                }
            }, { timezone: 'Asia/Seoul' });

            // ─── [장전 오전 파수꾼] 오전 스케줄 전용 자가 치유 ───
            const morningWatchdog = cron.schedule('* 08-09 * * 1-5', async () => {
                const { getKstDate } = await import('../utils/DateUtils');
                const today = getKstDate();
                const now = new Date();
                const kstH = (now.getUTCHours() + 9) % 24;
                const kstM = now.getUTCMinutes();
                const kstDOW = now.getDay();
                const kstDOM = now.getDate();
                const timeStr = `${kstH.toString().padStart(2, '0')}:${kstM.toString().padStart(2, '0')}`;

                for (const job of this.morningWatchdogTasks) {
                    if (job.dow && job.dow !== '*' && job.dow !== '1-5') {
                        if (job.dow === '5' && kstDOW !== 5) continue;
                    }
                    if (job.dom && job.dom !== '*') {
                        if (parseInt(job.dom, 10) !== kstDOM) continue;
                    }
                    // 원래 스케줄 시간보다 1분 뒤(>)부터 누락 검사 (정각 중복 실행 방지)
                    if (timeStr > job.triggerTime && timeStr <= job.maxRecoveryTime) {
                        const lastRun = this.dailyExecutionFlags.get(job.name);
                        if (lastRun !== today) {
                            console.log(`[Watchdog] ⏰ 오전 지연/누락 감지: ${job.name} (${job.triggerTime} ~ ${job.maxRecoveryTime}) -> 복구 실행!`);
                            this.telegram.sendMessage(`🛡️ [오전 Watchdog] 백그라운드 타이머 누락을 감지하여 보충 실행합니다: ${job.name}`);
                            this.setWatchdogFlag(job.name, today);
                            try {
                                await job.fn();
                            } catch (e: any) {
                                console.error(`[Watchdog] ❌ 오전 복구 실패: ${job.name}`, e);
                            }
                        }
                    }
                }
            }, { timezone: 'Asia/Seoul' });

            // ═══ [Step 7] AI 자가학습 및 오답노트 작성 스케줄 ═══
            let selfLearningJob: cron.ScheduledTask | null = null;
            const aiSettings = store.get('ai_settings') as any || {};
            const selfLearning = aiSettings.selfLearningSettings || {
                enabled: false,
                interval: 'WEEKLY',
                dayOfWeek: [5],
                dayOfMonth: 1,
                time: '16:00',
                holidayOption: 'NEXT_OPEN'
            };

            if (selfLearning.enabled) {
                const selfLearningCronExpr = this.buildSelfLearningCron(selfLearning);
                console.log(`[SchedulerService] 🤖 AI 자가학습 크론 등록: expression='${selfLearningCronExpr}', holidayOption='${selfLearning.holidayOption}'`);
                selfLearningJob = this.createWatchdogCron('selfLearningJob', selfLearningCronExpr, async () => {
                    await this.runSelfLearningPipeline(selfLearning.holidayOption);
                }, { timezone: 'Asia/Seoul' });
            }

            // ═══ [Step 8] 주도주 AI 통합 자가학습 크론 등록 ═══
            let trackLearningJob: cron.ScheduledTask | null = null;
            const trackSettings = aiSettings.trackLearningSettings || {
                enabled: false,
                interval: 'WEEKLY',
                dayOfWeek: [5],
                dayOfMonth: 1,
                time: '16:00',
                holidayOption: 'NEXT_OPEN'
            };

            if (trackSettings.enabled) {
                const cronExpr = this.buildSelfLearningCron(trackSettings);
                console.log(`[SchedulerService] 🤖 주도주 AI 통합 자가학습 크론 등록: expression='${cronExpr}', holidayOption='${trackSettings.holidayOption}'`);
                trackLearningJob = this.createWatchdogCron('trackLearningJob', cronExpr, async () => {
                    await this.runAllTracksSelfLearningPipeline(trackSettings.holidayOption);
                }, { timezone: 'Asia/Seoul' });
            }

            this.scheduledJobs.push(mcaJobA, mcaTrackerJob, weeklyReviewJob, monthlyReviewJob, momentumJob, fundamentalJob, pullbackJob, pmDailyJob, portfolioJudgeJob, incubatorScanJob, marketDailyJob, trackEntryJob, themeAiJob, liveTradeMonitorJob, liveTradeChasingStartJob, liveTradeReconJob, liveTradeTimeStopJob, liveTradeSyncCheckJob, liveTradeMorningBriefingJob, postMarketWatchdog, morningWatchdog)
            if (selfLearningJob) {
                this.scheduledJobs.push(selfLearningJob);
            }
            if (trackLearningJob) {
                this.scheduledJobs.push(trackLearningJob);
            }

            console.log(`[SchedulerService] V2 AI schedules initialized (MCA: 08:50, Swarms, Retros)`)
            console.log(`[SchedulerService] 🎨 종목 AI 파이프라인: 수급(09:35) → 리포트(09:41) → 눌림목(09:42) → 메가테마(09:43) → PM통합(09:45, PM1→PM2 체인)`)
            console.log(`[SchedulerService] 📊 장중 파이프라인: OHLCV수집+모의매매선정(15:05) → 진입가확정(15:32)`)
            console.log(`[SchedulerService] 📊 장마감 파이프라인: 성과추적(15:35) → 채점(15:41) → 인큐베이터(15:43) → 주간(15:44,금) → 월간(15:47,28일)`)
            console.log(`[SchedulerService] 📈 실전 매매 미체결 루프 활성화 (장중 1분 단위)`)
        }

        // ═══ [Step 3] NaverFlow 크론 등록 ═══
        const nfSettings = store.get('naverflow_settings') as any
        if (nfSettings?.enabled && Array.isArray(nfSettings?.scheduleSlots)) {
            // Collision Avoidance & User Request Update
            nfSettings.scheduleSlots.forEach((s: any) => {
                if (s.time === '09:30') s.time = '09:41'; // 스웜 AI 충돌 회피
                if (s.time === '15:30') s.time = '15:45';
                if (s.time === '09:26' || s.time === '09:41') s.time = '09:40'; // 사용자 요청 강제 변경 (09:26 -> 09:40)
            });
            store.set('naverflow_settings', nfSettings); // 변경사항을 파일(스토어)에도 즉시 저장

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

                        // 성과 판독(ThemeMockTradingJudgeAgent) 가동 (비활성화됨)
                        try {
                            if (hr >= 15 && min >= 30) {
                                console.log(`[SchedulerService] ⚖️ 장 마감 후 스케줄 감지(${hr}:${min}): Theme 판독기 비활성화됨 (실행 건너뜀)`)
                                /*
                                const { ThemeMockTradingJudgeAgent } = await import('./v2_agents/ThemeMockTradingJudgeAgent')
                                await ThemeMockTradingJudgeAgent.getInstance().evaluatePicks()
                                */
                            }
                        } catch (aiErr: any) {
                            console.error(`[SchedulerService] 테마 연계 파이프라인 실패:`, aiErr.message)
                        }
                    }, { timezone: 'Asia/Seoul' })
                    this.scheduledJobs.push(nfJob)
                    console.log(`[SchedulerService] 📊 NaverFlow 크론 등록 완료 (${cronExpr})`)
                } catch (err: any) {
                    console.error(`[SchedulerService] NaverFlow 크론 등록 실패 (${slot.time}):`, err.message)
                }
            })
        }

        // ═══ [Step 4] Moonshot AI 크론 등록 (비활성화됨) ═══
        const moonshotSettings = store.get('moonshot_settings') as any;
        if (false && moonshotSettings?.enabled) {
            try {
                // Scanner
                if (moonshotSettings.scannerCronTime) {
                    const [hrStr, minStr] = moonshotSettings.scannerCronTime.split(':');
                    const hr = parseInt(hrStr, 10);
                    const min = parseInt(minStr, 10);
                    if (!isNaN(hr) && !isNaN(min)) {
                        const cronExpr = `${min} ${hr} * * 1-5`;
                        const scannerJob = this.createWatchdogCron('moonshotScannerJob', cronExpr, async () => {
                            console.log(`[SchedulerService] 🚀 Moonshot Scanner AI 자동 실행 시작...`);
                            this.telegram.sendMessage(`🚀 [Moonshot] 텐베거 자동 신규 발굴 스캐너(Scanner AI)가 백그라운드에서 실행되었습니다. 지정된 조건검색을 수집합니다.`);
                            
                            try {
                                // 사용자가 저장한 조건식을 그대로 사용. 미설정 시 경고 후 중단.
                                const activeConditions: string[] = moonshotSettings.conditions || [];
                                if (activeConditions.length === 0) {
                                    console.warn('[SchedulerService] Moonshot Scanner: 저장된 조건식이 없어 스캔을 건너뜁니다.');
                                    this.telegram.sendMessage(`⚠️ [Moonshot Scanner] 조건식이 설정되지 않았습니다.\n텐베거 AI 탭 > 우상단 설정(⚙️)에서 A/B/C안 조건식을 지정 후 저장하세요.`);
                                    return;
                                }
                                const targetSeqs = activeConditions;

                                let allFoundStocks: any[] = [];

                                for (let i = 0; i < targetSeqs.length; i++) {
                                    const seq = targetSeqs[i];
                                    console.log(`[SchedulerService] 🚀 Moonshot 조건검색 [${seq}] 수집 요청...`);
                                    
                                    const stocks = await new Promise<any[]>((resolve) => {
                                        let handled = false;
                                        const timeoutId = setTimeout(() => {
                                            if (!handled) {
                                                handled = true;
                                                eventBus.removeListener(SystemEvent.CONDITION_MATCHED, onConditionMatched);
                                                console.log(`[SchedulerService] 조건검색 [${seq}] 응답 타임아웃 (10초)`);
                                                resolve([]);
                                            }
                                        }, 10000); // 최대 10초 대기

                                        const onConditionMatched = (payload: any) => {
                                            const payloadSeq = Array.isArray(payload) ? (payload.length > 0 ? payload[0].seq : undefined) : payload.seq;
                                            const stocks = Array.isArray(payload) ? payload : (payload.stocks || []);

                                            if (!handled && String(payloadSeq).trim() === String(seq).trim()) {
                                                handled = true;
                                                clearTimeout(timeoutId);
                                                eventBus.removeListener(SystemEvent.CONDITION_MATCHED, onConditionMatched);
                                                resolve(stocks);
                                            }
                                        };

                                        eventBus.on(SystemEvent.CONDITION_MATCHED, onConditionMatched);
                                        
                                        this.kiwoom.startConditionSearch(seq).catch(err => {
                                            console.error(`[SchedulerService] 조건검색 [${seq}] 실행 실패:`, err);
                                            if (!handled) {
                                                handled = true;
                                                clearTimeout(timeoutId);
                                                eventBus.removeListener(SystemEvent.CONDITION_MATCHED, onConditionMatched);
                                                resolve([]);
                                            }
                                        });
                                    });

                                    if (stocks.length > 0) {
                                        // 태그 추가
                                        const tag = i === 0 ? 'A안' : i === 1 ? 'B안' : 'C안';
                                        stocks.forEach(s => s.tag = tag);
                                        allFoundStocks = allFoundStocks.concat(stocks);
                                    }
                                    
                                    // TR Limit 방어를 위해 1.5초 대기
                                    await new Promise(r => setTimeout(r, 1500)); 
                                }

                                if (allFoundStocks.length === 0) {
                                    this.telegram.sendMessage(`⚠️ [Moonshot] 발굴된 종목이 없습니다. 자동 스캐너를 종료합니다.`);
                                    return;
                                }

                                // 중복 종목 제거 및 태그 병합
                                const uniqueStocksMap = new Map();
                                allFoundStocks.forEach(s => {
                                    if (uniqueStocksMap.has(s.code)) {
                                        uniqueStocksMap.get(s.code).tag += `, ${s.tag}`;
                                    } else {
                                        uniqueStocksMap.set(s.code, { ...s });
                                    }
                                });
                                const uniqueStocks = Array.from(uniqueStocksMap.values());

                                this.telegram.sendMessage(`✅ [Moonshot] 조건검색 완료: 총 ${uniqueStocks.length}건 발굴. 즉시 AI 전체 검증(Deep Scanning)을 시작합니다.`);
                                
                                const { MoonshotValidationAgent } = await import('./v2_agents/MoonshotValidationAgent');
                                await MoonshotValidationAgent.getInstance().runValidation(uniqueStocks, undefined, true);
                                
                            } catch (e: any) {
                                console.error('[SchedulerService] Moonshot 스캐너 에러:', e);
                                this.telegram.sendMessage(`❌ [Moonshot] 자동 스캐너 실행 중 오류 발생: ${e.message}`);
                            }

                        }, { timezone: 'Asia/Seoul' });
                        this.scheduledJobs.push(scannerJob);
                        console.log(`[SchedulerService] 🚀 Moonshot Scanner 크론 등록 완료 (${cronExpr})`);
                    }
                }

                // Tracker
                if (moonshotSettings.trackerCronTime) {
                    const [hrStr, minStr] = moonshotSettings.trackerCronTime.split(':');
                    const hr = parseInt(hrStr, 10);
                    const min = parseInt(minStr, 10);
                    if (!isNaN(hr) && !isNaN(min)) {
                        const cronExpr = `${min} ${hr} * * 1-5`;
                        const trackerJob = this.createWatchdogCron('moonshotTrackerJob', cronExpr, async () => {
                            console.log(`[SchedulerService] 🚀 Moonshot Tracker AI 자동 실행 시작...`);
                            try {
                                this.telegram.sendMessage(`🚀 [Moonshot] 액티브 트래킹 데일리 리뷰(Tracker AI) 자동 실행이 시작되었습니다.`);
                                const { MoonshotTrackerAgent } = await import('./v2_agents/MoonshotTrackerAgent');
                                await MoonshotTrackerAgent.getInstance().runDailyReview();
                                this.telegram.sendMessage(`✅ [Moonshot] 데일리 리뷰 완료. 텐베거 포트폴리오를 점검하고 UI에 결과를 반영했습니다.`);
                            } catch (e: any) {
                                console.error('[SchedulerService] Moonshot Tracker 에러:', e.message);
                                this.telegram.sendMessage(`❌ [Moonshot] 데일리 리뷰 실패: ${e.message}`);
                            }
                        }, { timezone: 'Asia/Seoul' });
                        this.scheduledJobs.push(trackerJob);
                        console.log(`[SchedulerService] 🚀 Moonshot Tracker 크론 등록 완료 (${cronExpr})`);
                    }
                }
            } catch(e: any) {
                console.error(`[SchedulerService] Moonshot 크론 등록 실패:`, e.message);
            }
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

            // 2. 기본 필터링 (ETF, 우선주 등 제거)
            const filteredBase = rawCombinedList.filter(s => {
                const name = s.name.toUpperCase().replace(/\s+/g, '')
                if (isETFOrSPAC(name)) return false
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

    private async exportToTrackerAndIngest(date: string) {
        console.log(`[Scheduler] 📝 tracker.py 연동용 JSON 추출 시작 (${date})`);
        const { DatabaseService } = await import('./DatabaseService');
        const rawDb = (DatabaseService.getInstance() as any).db;
        
        const run_id = `auto_1532_${date.replace(/-/g, '')}`;
        const recommendations: any[] = [];
        
        const trackMap = [
            { table: 'track_a_buy_picks', track: 'stable' },
            { table: 'track_b_buy_picks', track: 'stable' },
            { table: 'track_c_buy_picks', track: 'mfe_attack' },
            { table: 'track_d_buy_picks', track: 'mfe_attack' },
            { table: 'track_e_buy_picks', track: 'overlap' },
        ];
        
        for (const { table, track } of trackMap) {
            try {
                const picks = rawDb.prepare(`
                    SELECT stock_code, stock_name, current_price, entry_price, reason, risk
                    FROM ${table}
                    WHERE pick_date = ? AND status = 'ACTIVE'
                `).all(date) as any[];
                
                for (const pick of picks) {
                    recommendations.push({
                        strategy: "close_buy",
                        track: track,
                        source_track: "codex_1532",
                        recommended_at: new Date().toISOString(),
                        ticker: pick.stock_code,
                        name: pick.stock_name,
                        observation_price: pick.current_price,
                        basis_price: pick.entry_price > 0 ? pick.entry_price : pick.current_price,
                        basis_price_date: date,
                        basis_price_source: "kiwoom_after_market",
                        basis_quality: "needs-confirm",
                        eval_due_date: null,
                        status: "pending",
                        rationale: pick.reason,
                        invalidation_condition: pick.risk || "이탈 시 손절",
                        source_report_path: null,
                        source_url: null
                    });
                }
            } catch (e) {
                // Table might not exist or other error
            }
        }
        
        if (recommendations.length === 0) {
            console.log('[Scheduler] tracker.py 연동: 오늘 ACTIVE 된 추천 종목이 없습니다.');
            return;
        }
        
        const payload = {
            run: {
                run_id,
                run_type: "codex_cron",
                created_at: new Date().toISOString()
            },
            recommendations
        };
        
        const fs = require('fs');
        const path = require('path');
        const trackerDir = 'c:/Users/legna/OneDrive/문서/Obsidian Vault/Codex Wiki/투자/investment_tracker';
        const inboxDir = path.join(trackerDir, 'data', 'inbox');
        
        if (!fs.existsSync(inboxDir)) {
            fs.mkdirSync(inboxDir, { recursive: true });
        }
        
        const fileName = `auto_${date}.json`;
        const filePath = path.join(inboxDir, fileName);
        
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
        console.log(`[Scheduler] tracker.py JSON 추출 완료: ${filePath}`);
        
        // CLI 연동 (tracker.py ingest)
        const { exec } = require('child_process');
        
        const pythonExe = fs.existsSync(path.join(trackerDir, 'venv', 'Scripts', 'python.exe'))
            ? path.join(trackerDir, 'venv', 'Scripts', 'python.exe')
            : 'C:\\Users\\legna\\AppData\\Local\\Programs\\Python\\Python310\\python.exe';
            
        const cmd = `"${pythonExe}" tracker.py process-inbox`;
        
        console.log(`[Scheduler] tracker.py process-inbox 명령어 실행: ${cmd}`);
        exec(cmd, { cwd: trackerDir }, (error: any, stdout: string, stderr: string) => {
            if (error) {
                console.error(`[Scheduler] tracker.py process-inbox 에러: ${error.message}`);
                return;
            }
            if (stderr) {
                console.warn(`[Scheduler] tracker.py process-inbox 경고: ${stderr}`);
            }
            console.log(`[Scheduler] tracker.py process-inbox 성공:\n${stdout}`);
            try {
                const { TelegramService } = require('./TelegramService');
                TelegramService.getInstance().sendMessage(`✅ [tracker.py 연동] 파이프라인 (ingest -> correct-basis -> evaluate -> render) 처리가 성공적으로 완료되었습니다.\n(파일: ${fileName})`);
            } catch (_) {}
        });
    }

    /**
     * 자가학습 설정 기반 크론 표현식 생성
     */
    private buildSelfLearningCron(settings: any): string {
        const time = settings.time || '16:00';
        const [hourStr, minStr] = time.split(':');
        const hour = parseInt(hourStr, 10) || 16;
        const min = parseInt(minStr, 10) || 0;

        if (settings.interval === 'DAILY') {
            return `${min} ${hour} * * 1-5`;
        } else if (settings.interval === 'WEEKLY') {
            const days = Array.isArray(settings.dayOfWeek) 
                ? settings.dayOfWeek.join(',') 
                : (settings.dayOfWeek !== undefined ? settings.dayOfWeek : 5);
            return `${min} ${hour} * * ${days}`;
        } else if (settings.interval === 'MONTHLY') {
            const dom = settings.dayOfMonth || 1;
            return `${min} ${hour} ${dom} * *`;
        }
        return `${min} ${hour} * * 5`; 
    }

    /**
     * 자가학습 파이프라인 통합 실행
     */
    public async runSelfLearningPipeline(holidayOption: 'SKIP' | 'NEXT_OPEN' = 'NEXT_OPEN'): Promise<void> {
        console.log('[SchedulerService] 🤖 AI 정기 자가학습 파이프라인 가동...');
        const { getKstDate } = await import('../utils/DateUtils');
        const todayStr = getKstDate();
        
        const today = new Date();
        const dow = today.getDay();
        const isWeekend = dow === 0 || dow === 6;
        
        let isMarketOpenDay = !isWeekend;
        try {
            const dbInstance = DatabaseService.getInstance();
            const rawDb = (dbInstance as any).db;
            const row = rawDb.prepare(`
                SELECT COUNT(*) as cnt FROM market_ohlcv_history 
                WHERE stock_code = '069500' AND date = ?
            `).get(todayStr.replace(/-/g, ''));
            
            if (row && row.cnt === 0) {
                isMarketOpenDay = false; 
            }
        } catch (e) {
            console.warn('[Scheduler] 개장일 판단 DB 체크 오류:', e);
        }

        if (!isMarketOpenDay) {
            console.log(`[Scheduler] 🤖 오늘은 휴장일(주말/공휴일)입니다. (날짜: ${todayStr})`);
            if (holidayOption === 'SKIP') {
                console.log('[Scheduler] 🤖 휴장일 건너뛰기(SKIP) 정책에 따라 오늘 학습을 중단합니다.');
                this.telegram.sendMessage(`🤖 **[정기 자가학습 건너뜀]**\n- 날짜: ${todayStr} (휴장일)\n- 건너뛰기(SKIP) 정책이 적용되었습니다.`);
                return;
            } else if (holidayOption === 'NEXT_OPEN') {
                console.log('[Scheduler] 🤖 휴장일 소급 실행(NEXT_OPEN) 정책에 따라 이월 플래그를 설정합니다.');
                store.set('pending_self_learning_run', true);
                this.telegram.sendMessage(`🤖 **[정기 자가학습 이월]**\n- 날짜: ${todayStr} (휴장일)\n- 다음 개장일 장마감 후 소급 실행 예정입니다.`);
                return;
            }
        }

        try {
            this.telegram.sendMessage('🤖 **[정기 AI 자가학습 시작]**\n- 애널리스트 및 PM2 성과 회고와 오답노트 자동 업데이트를 시작합니다.');
            
            const { RetrospectiveAgent } = await import('./v2_agents/RetrospectiveAgent');
            const retrospectiveAgent = new RetrospectiveAgent(this.kiwoom);
            
            console.log('[Scheduler] 자가학습 Step 1: 애널리스트 과거 추천 종목 채점...');
            const evalCount = await retrospectiveAgent.evaluatePastPicks(); 
            
            console.log('[Scheduler] 자가학습 Step 2: 애널리스트 회고 및 오답노트(SKILL.md) 갱신...');
            await retrospectiveAgent.runRetrospectiveLogic(); 

            console.log('[Scheduler] 자가학습 Step 3: PM2 포트폴리오 매매 복기 및 마스터 가이드 갱신...');
            const { PortfolioRetrospectiveAgent } = await import('./v2_agents/PortfolioRetrospectiveAgent');
            await PortfolioRetrospectiveAgent.getInstance().run(); 

            store.set('pending_self_learning_run', false);

            this.telegram.sendMessage(`✅ **[정기 AI 자가학습 완료]**\n- 애널리스트 채점 완료: ${evalCount}건\n- PM2 마스터 가이드 및 서브 AI 지침서(SKILL.md)가 성공적으로 업데이트되었습니다.`);
        } catch (err: any) {
            console.error('[Scheduler] 정기 자가학습 오류:', err.message);
            this.telegram.sendMessage(`🚨 **[정기 AI 자가학습 실패]**\n- 오류: ${err.message}`);
        }
    }

    /**
     * 주도주 AI 특정 트랙(Track A ~ E)의 자가학습 파이프라인 실행
     */
    public async runTrackSelfLearningPipeline(track: 'A' | 'B' | 'C' | 'D' | 'E', holidayOption: 'SKIP' | 'NEXT_OPEN' = 'NEXT_OPEN'): Promise<void> {
        console.log(`[SchedulerService] 🤖 Track ${track} 정기 자가학습 파이프라인 가동...`);
        const { getKstDate } = await import('../utils/DateUtils');
        const todayStr = getKstDate();
        
        const today = new Date();
        const dow = today.getDay();
        const isWeekend = dow === 0 || dow === 6;
        
        let isMarketOpenDay = !isWeekend;
        try {
            const dbInstance = DatabaseService.getInstance();
            const rawDb = (dbInstance as any).db;
            const row = rawDb.prepare(`
                SELECT COUNT(*) as cnt FROM market_ohlcv_history 
                WHERE stock_code = '069500' AND date = ?
            `).get(todayStr.replace(/-/g, ''));
            
            if (row && row.cnt === 0) {
                isMarketOpenDay = false; 
            }
        } catch (e) {
            console.warn('[Scheduler] 개장일 판단 DB 체크 오류:', e);
        }

        const pendingKey = `pending_track_${track.toLowerCase()}_learning`;

        if (!isMarketOpenDay) {
            console.log(`[Scheduler] 🤖 오늘은 휴장일입니다. Track ${track} 학습 유보 (날짜: ${todayStr})`);
            if (holidayOption === 'SKIP') {
                console.log(`[Scheduler] 🤖 SKIP 정책에 따라 Track ${track} 오늘 학습을 건너뜁니다.`);
                this.telegram.sendMessage(`🤖 **[Track ${track} 자가학습 건너뜀]**\n- 날짜: ${todayStr} (휴장일)\n- SKIP 정책이 적용되었습니다.`);
                return;
            } else if (holidayOption === 'NEXT_OPEN') {
                console.log(`[Scheduler] 🤖 NEXT_OPEN 정책에 따라 Track ${track} 이월 플래그를 설정합니다.`);
                store.set(pendingKey, true);
                this.telegram.sendMessage(`🤖 **[Track ${track} 자가학습 이월]**\n- 날짜: ${todayStr} (휴장일)\n- 다음 개장일 장마감 후 소급 실행 예정입니다.`);
                return;
            }
        }

        try {
            this.telegram.sendMessage(`🤖 **[Track ${track} AI 자가학습 시작]**\n- 최근 매매 타점 성적 복기 및 지침서(track_${track.toLowerCase()}_phase2.md) 증분 학습을 시작합니다.`);
            
            const { TrackRetrospectiveAgent } = await import('./v2_agents/TrackRetrospectiveAgent');
            const result = await TrackRetrospectiveAgent.getInstance().runRetrospective(track, 30); // 정기는 기본 30일 범위
            
            store.set(pendingKey, false);

            if (result.skipped) {
                this.telegram.sendMessage(`ℹ️ **[Track ${track} AI 자가학습 유보]**\n- 사유: ${result.reason}`);
            } else if (result.success) {
                this.telegram.sendMessage(`✅ **[Track ${track} AI 자가학습 완료]**\n- 주도주 지침서가 성공적으로 최적화 및 업데이트되었습니다.`);
            } else {
                throw new Error(result.error || '알 수 없는 오류');
            }
        } catch (err: any) {
            console.error(`[Scheduler] Track ${track} 자가학습 오류:`, err.message);
            this.telegram.sendMessage(`🚨 **[Track ${track} AI 자가학습 실패]**\n- 오류: ${err.message}`);
        }
    }

    /**
     * 주도주 AI 모든 트랙(Track A ~ E)의 자가학습 파이프라인 일괄 순차 실행
     */
    public async runAllTracksSelfLearningPipeline(holidayOption: 'SKIP' | 'NEXT_OPEN' = 'NEXT_OPEN'): Promise<void> {
        console.log('[SchedulerService] 🤖 주도주 AI 모든 트랙 통합 정기 자가학습 파이프라인 가동...');
        const { getKstDate } = await import('../utils/DateUtils');
        const todayStr = getKstDate();
        
        const today = new Date();
        const dow = today.getDay();
        const isWeekend = dow === 0 || dow === 6;
        
        let isMarketOpenDay = !isWeekend;
        try {
            const dbInstance = DatabaseService.getInstance();
            const rawDb = (dbInstance as any).db;
            const row = rawDb.prepare(`
                SELECT COUNT(*) as cnt FROM market_ohlcv_history 
                WHERE stock_code = '069500' AND date = ?
            `).get(todayStr.replace(/-/g, ''));
            
            if (row && row.cnt === 0) {
                isMarketOpenDay = false; 
            }
        } catch (e) {
            console.warn('[Scheduler] 개장일 판단 DB 체크 오류:', e);
        }

        if (!isMarketOpenDay) {
            console.log(`[Scheduler] 🤖 오늘은 휴장일입니다. 주도주 AI 자가학습 유보 (날짜: ${todayStr})`);
            if (holidayOption === 'SKIP') {
                console.log('[Scheduler] 🤖 SKIP 정책에 따라 오늘 학습을 건너뜁니다.');
                this.telegram.sendMessage(`🤖 **[주도주 자가학습 건너뜀]**\n- 날짜: ${todayStr} (휴장일)\n- SKIP 정책이 적용되었습니다.`);
                return;
            } else if (holidayOption === 'NEXT_OPEN') {
                console.log('[Scheduler] 🤖 NEXT_OPEN 정책에 따라 이월 플래그를 설정합니다.');
                store.set('pending_tracks_learning_run', true);
                this.telegram.sendMessage(`🤖 **[주도주 자가학습 이월]**\n- 날짜: ${todayStr} (휴장일)\n- 다음 개장일 장마감 후 소급 실행 예정입니다.`);
                return;
            }
        }

        try {
            this.telegram.sendMessage(`🤖 **[주도주 AI 통합 자가학습 시작]**\n- Track A ~ E 전체의 최근 매매 타점 성적 복기 및 지침서 증분 학습을 순차 실행합니다.`);
            
            const tracks: ('A' | 'B' | 'C' | 'D' | 'E')[] = ['A', 'B', 'C', 'D', 'E'];
            const { TrackRetrospectiveAgent } = await import('./v2_agents/TrackRetrospectiveAgent');
            
            let successCount = 0;
            let skippedCount = 0;
            let failedCount = 0;

            for (const track of tracks) {
                try {
                    const result = await TrackRetrospectiveAgent.getInstance().runRetrospective(track, 30);
                    if (result.skipped) {
                        skippedCount++;
                    } else if (result.success) {
                        successCount++;
                    } else {
                        failedCount++;
                    }
                } catch (err: any) {
                    console.error(`[Scheduler] Track ${track} 자가학습 실패:`, err.message);
                    failedCount++;
                }
            }

            store.set('pending_tracks_learning_run', false);

            this.telegram.sendMessage(
                `✅ **[주도주 AI 통합 자가학습 완료]**\n` +
                `- 대상: Track A ~ E (총 5개 트랙)\n` +
                `- 결과: 성공 ${successCount}개, 유보(스킵) ${skippedCount}개, 실패 ${failedCount}개`
            );
        } catch (err: any) {
            console.error('[Scheduler] 통합 자가학습 오류:', err.message);
            this.telegram.sendMessage(`🚨 **[주도주 AI 통합 자가학습 실패]**\n- 오류: ${err.message}`);
        }
    }
}

