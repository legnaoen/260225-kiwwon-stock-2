import cron from 'node-cron'
import { RisingStockAnalysisService } from './RisingStockAnalysisService'
import { TelegramService } from './TelegramService'
import { KiwoomService } from './KiwoomService'
import { eventBus, SystemEvent } from '../utils/EventBus'
import Store from 'electron-store'
import { IngestionManager } from './IngestionManager'

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
    public initSchedules() {
        // 기존 작업 중지 및 초기화
        this.scheduledJobs.forEach(job => job.stop())
        this.scheduledJobs = []

        const settings = store.get('ai_schedule_settings') as any || {
            enabled: true,
            preMarketTime: '08:30',
            morningTime: '10:00',
            eveningTime: '15:40',
            telegramNotify: true
        }

        if (!settings.enabled) {
            console.log('[SchedulerService] Automated analysis is disabled.')
            return
        }

        // 1. 장 시작 전 매크로/유튜브 분석 (08:30)
        const [pHour, pMinute] = settings.preMarketTime.split(':')
        const preMarketJob = cron.schedule(`${pMinute} ${pHour} * * 1-5`, () => {
            console.log(`[SchedulerService] Starting PRE_MARKET analysis (${settings.preMarketTime})...`)
            this.runPreMarketAnalysis()
        }, { timezone: 'Asia/Seoul' })

        // 2. 오전 급등주/주도주 분석
        const [mHour, mMinute] = settings.morningTime.split(':')
        const morningJob = cron.schedule(`${mMinute} ${mHour} * * 1-5`, () => {
            console.log(`[SchedulerService] Starting automatic morning market analysis (${settings.morningTime})...`)
            this.runManualBatchAnalysis('MORNING')
        }, { timezone: 'Asia/Seoul' })

        // 3. 장 마감 및 시장 요약 분석
        const [eHour, eMinute] = settings.eveningTime.split(':')
        const eveningJob = cron.schedule(`${eMinute} ${eHour} * * 1-5`, () => {
            console.log(`[SchedulerService] Starting automatic evening market analysis (${settings.eveningTime})...`)
            this.runManualBatchAnalysis('EVENING')
        }, { timezone: 'Asia/Seoul' })

        this.scheduledJobs.push(preMarketJob, morningJob, eveningJob)

        // 4. 시장 뉴스 브리핑 (사용자 설정 시간)
        const newsSettings = store.get('market_briefing_settings') as any || { reportTime: '08:20', telegramTime: '08:30', enabled: true };
        if (newsSettings.enabled) {
            const [rHour, rMinute] = newsSettings.reportTime.split(':');
            const newsJob = cron.schedule(`${rMinute} ${rHour} * * 1-5`, () => {
                console.log(`[SchedulerService] Starting automatic Market News Briefing (${newsSettings.reportTime})...`);
                this.runMarketNewsAnalysis();
            }, { timezone: 'Asia/Seoul' });
            
            const [tHour, tMinute] = newsSettings.telegramTime.split(':');
            const newsTelegramJob = cron.schedule(`${tMinute} ${tHour} * * 1-5`, () => {
                console.log(`[SchedulerService] Sending Market News Telegram Notification (${newsSettings.telegramTime})...`);
                this.sendMarketNewsTelegram();
            }, { timezone: 'Asia/Seoul' });

            this.scheduledJobs.push(newsJob, newsTelegramJob);
        }

        // 5. 유튜브 내러티브 분석 (독자적 스케줄)
        const ytSettings = store.get('youtube_settings') as any || { enabled: true, collectTime: '08:30' };
        if (ytSettings.enabled) {
            const [yHour, yMinute] = ytSettings.collectTime.split(':');
            const ytJob = cron.schedule(`${yMinute} ${yHour} * * 1-5`, () => {
                console.log(`[SchedulerService] Starting automatic Youtube Narrative Analysis (${ytSettings.collectTime})...`);
                this.runYoutubeAnalysis();
            }, { timezone: 'Asia/Seoul' });
            this.scheduledJobs.push(ytJob);
        }

        console.log(`[SchedulerService] Automated analysis schedules (PRE: ${settings.preMarketTime}, AM: ${settings.morningTime}, PM: ${settings.eveningTime}, NEWS: ${newsSettings.reportTime}, YT: ${ytSettings.collectTime}) initialized.`)
    }

    private async runMarketNewsAnalysis() {
        const { MarketNewsService } = await import('./MarketNewsService');
        await MarketNewsService.getInstance().generateMarketBriefing();
    }

    private async sendMarketNewsTelegram() {
        const { MarketNewsService } = await import('./MarketNewsService');
        const latest = MarketNewsService.getInstance().getLatestBriefings(1)[0];
        if (latest) {
            try {
                const parsed = JSON.parse(latest.summary_json);
                let message = `📣 *[MAIIS 시장 뉴스 브리핑]*\n\n`;
                message += `📅 *기준일자*: ${latest.date}\n`;
                message += `🌡️ *시장온도*: ${parsed.sentiment > 0.5 ? '🔥 탐욕' : parsed.sentiment < -0.5 ? '😨 공포' : '😐 중립'} (${parsed.sentiment})\n\n`;
                const summaryLines = Array.isArray(parsed.summary) ? parsed.summary : (typeof parsed.summary === 'string' ? [parsed.summary] : []);
                message += `✅ *핵심 요약*\n${summaryLines.map((s: string) => `• ${s}`).join('\n')}\n\n`;
                message += `🔄 *피보팅 분석*\n${parsed.pivot}\n\n`;
                message += `🔥 *HOT 테마*\n`;
                parsed.themes.forEach((t: any) => {
                    message += `- *${t.theme_name}*: ${t.reason}\n`;
                });
                
                this.telegram.sendMessage(message);
            } catch (e) {
                this.telegram.sendMessage(`📣 *[MAIIS 시장 뉴스 브리핑]*\n분석이 완료되었습니다. 앱에서 확인하세요.`);
            }
        }
    }

    private async runYoutubeAnalysis() {
        const { YoutubeService } = await import('./YoutubeService');
        const apiKey = store.get('youtube_api_key') as string;
        if (apiKey) {
            await YoutubeService.getInstance().collectLatestVideos(apiKey);
        } else {
            console.warn('[SchedulerService] YouTube API Key missing. Skipping auto-analysis.');
        }
    }

    /**
     * 장 시작 전 거시지표 및 유튜브 전문가 의견 수집/분석 (08:30)
     */
    public async runPreMarketAnalysis() {
        const { YahooFinanceService } = await import('./YahooFinanceService')
        const { YoutubeService } = await import('./YoutubeService')
        
        console.log('[SchedulerService] Running PRE_MARKET Strategic Ingestion...');
        
        try {
            // 1. 매크로 지표 업데이트
            const macro = YahooFinanceService.getInstance()
            await macro.updateGlobalMacroData() // 내부에서 IngestionManager 기록함
            
            // 2. 유튜브 내러티브 업데이트 (장전 전략 수립) - 개별 스케줄과 겹칠 수 있으므로 필요시만 호출
            const youtube = YoutubeService.getInstance()
            const apiKey = store.get('youtube_api_key') as string;
            if (apiKey) {
                await youtube.collectLatestVideos(apiKey)
            }
            
            console.log('[SchedulerService] PRE_MARKET Analysis Completed.');
        } catch (e) {
            console.error('[SchedulerService] PRE_MARKET Analysis Failed:', e);
        }
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
            const timing = label === 'MORNING' ? 'MORNING' : (label === 'EVENING' ? 'EVENING' : 'MANUAL')
            const result = await this.risingStockAnalysis.analyzeBatchAndSave(targetStocks, timing, targetDate)

            // 3. 텔레그램 알림 발송 (자동 스케줄인 경우만)
            if (label !== 'MANUAL') {
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

            const msg = `🚨 [AI 자동분석 오류] ${label} 분석 중 오류 발생: ${error.message}`
            if (label !== 'MANUAL') this.telegram.sendMessage(msg)
            return { success: false, error: error.message }
        }
    }
}
