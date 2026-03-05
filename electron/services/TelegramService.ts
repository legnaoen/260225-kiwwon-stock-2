import { BrowserWindow, app } from 'electron';
import path from 'path';
import { eventBus, SystemEvent } from '../utils/EventBus';
import Store from 'electron-store';
import { Telegraf, Markup } from 'telegraf';
import cron from 'node-cron';
import { AutoTradeService } from './AutoTradeService';
import { KiwoomService } from './KiwoomService';
import { ChartRenderService } from './ChartRenderService';
import { DatabaseService } from './DatabaseService';
import { CompanyAnalysisService } from './CompanyAnalysisService';
import { DartApiService } from './DartApiService';

const store = new Store();

export class TelegramService {
    private static instance: TelegramService;
    private bot: Telegraf | null = null;
    private botToken: string | null = null;
    private chatId: string | null = null;
    private disparityCache: Map<string, string> = new Map();
    private stockSearchCache: Array<{ code: string, name: string }> = [];
    private isWaitingForLiquidation = false;
    private liquidationWaitTimer: NodeJS.Timeout | null = null;
    private scheduleSummaryJob: cron.ScheduledTask | null = null;

    private constructor() {
        this.initializeBot();
        this.setupListeners();
        this.setupCronJobs();
        this.setupScheduleCron();
        this.buildStockSearchCache();

        // Startup check for missed schedule summary
        setTimeout(() => this.checkMissedScheduleSummary(), 10000);
    }

    public static getInstance(): TelegramService {
        if (!TelegramService.instance) {
            TelegramService.instance = new TelegramService();
        }
        return TelegramService.instance;
    }

    private initializeBot() {
        const settings: any = store.get('telegram_settings');
        if (settings && settings.botToken) {
            this.botToken = settings.botToken;
            try {
                this.bot = new Telegraf(settings.botToken);
                this.chatId = settings.chatId || null;

                this.bot.start((ctx) => {
                    const receivedChatId = ctx.chat.id.toString();
                    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';

                    if (isGroup) {
                        ctx.reply('⚠️ [단체방 활성화]\n이 방은 종목 검색 전용으로만 사용됩니다.\n일정 및 시스템 알림을 받으시려면 봇과의 1:1 대화방에서 /start 를 입력해주세요.');
                        return;
                    }

                    // Auto-save the chat ID ONLY for private chats
                    this.chatId = receivedChatId;
                    const currentSettings: any = store.get('telegram_settings') || {};
                    store.set('telegram_settings', {
                        ...currentSettings,
                        botToken: settings.botToken,
                        chatId: receivedChatId,
                        chatType: 'private'
                    });

                    console.log(`[TelegramService] Registered Private Chat ID: ${receivedChatId}`);
                    ctx.reply('✅ [알림 수신 등록 완료]\n이제부터 이 1:1 대화방으로 모든 일정을 안내해 드립니다.');
                });

                // 텔레그램 명령어 메뉴 (자동완성) 세팅
                this.bot.telegram.setMyCommands([
                    { command: 'menu', description: '자동매매 메뉴 제어 UI 열기' },
                    { command: 'panic', description: '🚨 비상 일괄 매도 청산' },
                    { command: '청산', description: '🚨 비상 일괄 매도 청산' }
                ]).catch(err => console.error('[TelegramService] setMyCommands Error:', err));

                // 종합 메뉴 커맨드
                this.bot.command('menu', (ctx) => {
                    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
                    if (isGroup) {
                        return ctx.reply('⚠️ 해당 메뉴는 보안상 1:1 개인 대화방에서만 열 수 있습니다.');
                    }

                    const autoTradeSvc = AutoTradeService.getInstance();
                    const isRunning = autoTradeSvc.getIsRunning();
                    const statusText = isRunning ? '🟢 가동 중' : '🔴 정지 상태';

                    ctx.reply(
                        `🤖 [Kiwoom 자동매매 통합 메뉴]\n\n` +
                        `현재 자동매매 시스템 상태: ${statusText}\n` +
                        `아래 버튼을 터치하여 원하시는 기능을 즉시 실행하세요.`,
                        Markup.inlineKeyboard([
                            [
                                Markup.button.callback(isRunning ? '🔴 자동매매 OFF' : '🟢 자동매매 ON', 'toggle_autotrade')
                            ],
                            [
                                Markup.button.callback('🚨 비상 일괄 개별청산(비추천)', 'emergency_panic')
                            ]
                        ])
                    );
                });

                // 인라인 버튼 액션 핸들러
                this.bot.action('toggle_autotrade', (ctx) => {
                    const autoTradeSvc = AutoTradeService.getInstance();
                    const isRunning = autoTradeSvc.getIsRunning();

                    if (isRunning) {
                        autoTradeSvc.setRunning(false);
                        ctx.editMessageText('✅ 매수 기능이 [정지(OFF)] 되었습니다. (기존 미체결 건의 정정 매도는 유지됩니다.)');
                    } else {
                        autoTradeSvc.setRunning(true);
                        ctx.editMessageText('✅ 자동매매 봇이 [가동(ON)] 되었습니다. 예약된 스케줄에 따라 매수가 감시됩니다.');
                    }
                    ctx.answerCbQuery();
                });

                this.bot.action('emergency_panic', (ctx) => {
                    this.isWaitingForLiquidation = true;
                    if (this.liquidationWaitTimer) clearTimeout(this.liquidationWaitTimer);

                    this.liquidationWaitTimer = setTimeout(() => {
                        this.isWaitingForLiquidation = false;
                        ctx.reply('⏱️ [비상 청산 취소] 1분이 경과하여 청산 대기 상태가 해제되었습니다.');
                    }, 60000);

                    ctx.reply(
                        '⚠️ [경고] 비상 청산 모드 ⚠️\n\n' +
                        '버튼이 눌렸습니다.\n현재 보유 중인 모든 종목을 현재가로 즉각 매도 주문하며, 자동매매 가동이 중지되고 남은 예약 매수가 완전히 차단됩니다.\n\n' +
                        '진행에 정말 동의하시면 채팅창에 [청산실행] 이라고 정확히 입력해 주세요. (1분 내 입력시 즉시 가동)'
                    );
                    ctx.answerCbQuery();
                });

                // 비상 청산 모드 진입 커맨드
                this.bot.command(['panic', '청산'], (ctx) => {
                    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
                    if (isGroup) {
                        return ctx.reply('⚠️ [오류] 비상 청산은 1:1 개인 대화방에서만 가능합니다.');
                    }
                    this.isWaitingForLiquidation = true;
                    if (this.liquidationWaitTimer) clearTimeout(this.liquidationWaitTimer);

                    this.liquidationWaitTimer = setTimeout(() => {
                        this.isWaitingForLiquidation = false;
                        ctx.reply('⏱️ [비상 청산 취소] 1분이 경과하여 청산 대기 상태가 해제되었습니다.');
                    }, 60000);

                    ctx.reply(
                        '⚠️ [경고] 비상 청산 모드 ⚠️\n\n' +
                        '현재 보유 중인 모든 종목을 현재가로 즉각 매도 주문하며, 자동매매 가동이 중지되고 남은 예약 매수가 완전히 차단됩니다.\n\n' +
                        '동의하시면 채팅창에 [청산실행] 이라고 정확히 입력해 주세요. (1분 내 작동)'
                    );
                });

                // 커맨드: 종목명 입력 시 차트 캡처
                this.bot.on('text', async (ctx) => {
                    let text = ctx.message.text.trim();

                    if (text === '청산실행') {
                        if (this.isWaitingForLiquidation) {
                            this.isWaitingForLiquidation = false;
                            if (this.liquidationWaitTimer) clearTimeout(this.liquidationWaitTimer);

                            ctx.reply('🚨 [비상 청산 승인 완료] 즉시 모든 종목에 대한 현재가 매도 주문을 전송하며 자동매매 시스템을 차단합니다. 잠시만 기다려주세요...');
                            eventBus.emit(SystemEvent.EMERGENCY_LIQUIDATION_STARTED);
                        } else {
                            ctx.reply('⚠️ 청산 대기 상태가 아닙니다. /panic 또는 /청산 명령어를 먼저 입력해주세요.');
                        }
                        return;
                    }

                    if (text.startsWith('/')) return;

                    const isAnalysisRequest = text.endsWith(' 분석') || text.endsWith('분석');
                    if (isAnalysisRequest) {
                        text = text.replace(/ 분석$/, '').replace(/분석$/, '').trim();
                    }

                    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
                    const botUsername = ctx.botInfo.username;

                    if (isGroup) {
                        // 단톡방인 경우, 봇을 명시적으로 호출했을 때만 동작 ("@봇이름 종목명")
                        const mention = `@${botUsername}`;
                        if (!text.toLowerCase().startsWith(mention.toLowerCase())) {
                            return; // 봇을 부르지 않은 일반 대화는 무시
                        }
                        // 멘션 부분 제거하고 알맹이 종목명만 추출
                        text = text.substring(mention.length).trim();
                    } else {
                        // 개인 톡방인 경우: 혹시 실수로 멘션을 붙였을 수 있으니 골뱅이 제거
                        text = text.replace(/^@[a-zA-Z0-9_]+\s*/, '').trim();
                    }

                    if (!text) return; // 멘션만 하고 종목명을 안 쓴 경우 ము시


                    // 1. 매핑 캐시가 비어있다면 대기
                    if (this.stockSearchCache.length === 0) {
                        return ctx.reply('⚠️ 주식 종목 데이터를 안전하게 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
                    }

                    // 2. 완전 일치 (Exact Match) 검색
                    let exactMatch = this.stockSearchCache.find(s => s.name.toLowerCase() === text.toLowerCase());
                    let targetCode = '';
                    let targetName = '';

                    if (exactMatch) {
                        targetCode = exactMatch.code;
                        targetName = exactMatch.name;
                    } else {
                        // 3. 부분 일치 (Fuzzy Match) 검색
                        const partialMatches = this.stockSearchCache.filter(s => s.name.toLowerCase().includes(text.toLowerCase()));

                        if (partialMatches.length === 0) {
                            return ctx.reply(`🚫 [종목 검색 실패] '${text}' 에 해당하는 종목을 찾을 수 없습니다.`);
                        }

                        if (partialMatches.length === 1) {
                            // 딱 하나만 매칭되면 그걸로 진행
                            targetCode = partialMatches[0].code;
                            targetName = partialMatches[0].name;
                        } else {
                            // 여러 개 매칭되면 선택 유도
                            const maxResults = 10;
                            const optionsList = partialMatches.slice(0, maxResults).map((s, idx) => `${idx + 1}. ${s.name} (${s.code})`).join('\n');
                            const moreTxt = partialMatches.length > maxResults ? `\n...외 ${partialMatches.length - maxResults}개 더 있음` : '';

                            return ctx.reply(`🕵️ [유사 종목 검색 결과]\n'${text}' 에 해당하는 종목이 여러 개 발견되었습니다. 정확한 이름을 입력해주세요.\n\n${optionsList}${moreTxt}`);
                        }
                    }

                    // 4. 종목 식별 성공, 차트 준비 알림
                    const loadingMsg = await ctx.reply(`📷 [${targetName}] 차트와 재무 정보를 준비 중입니다. 잠시만 기다려주세요...`);

                    try {
                        let basicInfoMsg = '';
                        try {
                            const kiwoom = KiwoomService.getInstance();
                            const infoRes = await kiwoom.getStockBasicInfo(targetCode);
                            console.log(`[TelegramService] ka10001 응답 데이터:`, JSON.stringify(infoRes).substring(0, 300));

                            // 키움 API는 Body, body, output, 혹은 최상단에 직접 데이터를 내려줄 수 있음
                            const body = infoRes?.body || infoRes?.Body || infoRes?.output || infoRes;

                            if (body && (body.per || body.mac || Object.keys(body).length > 2)) {
                                const per = body.per || 'N/A';
                                const pbr = body.pbr || 'N/A';
                                const roe = body.roe || 'N/A';
                                let cap = body.mac || 'N/A';
                                const st = body.orderWarning || '정상';

                                if (cap !== 'N/A' && !isNaN(Number(cap))) {
                                    const numCap = Number(cap);
                                    const jo = numCap / 10000;
                                    cap = `${jo.toFixed(2)}조`;
                                }

                                const stStr = st !== '정상' ? `\n⚠️ 상태: ${st}` : '';
                                basicInfoMsg = `\n\n💰 시가총액: ${cap}\n📊 PER: ${per} | PBR: ${pbr} | ROE: ${roe}%${stStr}`;
                            } else {
                                console.warn('[TelegramService] 응답에 재무 필드가 부족합니다.', Object.keys(body));
                            }
                        } catch (infoErr) {
                            console.error('[TelegramService] 종목기본정보 조회 실패', infoErr);
                        }

                        // 차트 데이터 (최근 약 80봉) 가져와서 최고/최저가 대비 하락/상승률 계산
                        try {
                            const kiwoom = KiwoomService.getInstance();
                            const chartRes = await kiwoom.getChartData(targetCode);
                            // 다양한 API 응답 구조 대응
                            const rawData = chartRes?.stk_dt_pole_chart_qry || chartRes?.output2 || chartRes?.list || chartRes?.output || chartRes?.Output || chartRes?.Body || chartRes?.body || [];

                            if (Array.isArray(rawData) && rawData.length > 0) {
                                // 1. 일봉 데이터를 쓸만한 숫자로 파싱 (뒤집어서 오래된 순 -> 최신 순 정렬)
                                const processed = [...rawData].reverse().map((day: any) => {
                                    const close = Number(day.cur_prc || day.stck_clpr || day.clpr || day.stck_clsprc || day.cls_prc || day.close || day.cur_juka || 0);
                                    let low = Number(day.low_pric || day.stck_lwprc || day.low_prc || day.low || day.low_juka || 0);
                                    let high = Number(day.high_pric || day.stck_hgprc || day.hg_prc || day.high || day.high_juka || 0);
                                    return { close, low: low || close, high: high || close };
                                }).filter((d: any) => d.close > 0);

                                // 2. 최근 80개만 추출
                                const recent80 = processed.slice(-80);

                                if (recent80.length > 0) {
                                    const currentPrice = recent80[recent80.length - 1].close;
                                    const highestPrice = Math.max(...recent80.map((d: any) => d.high));
                                    const lowestPrice = Math.min(...recent80.map((d: any) => d.low));

                                    const upFromLow = ((currentPrice - lowestPrice) / lowestPrice) * 100;
                                    const downFromHigh = ((currentPrice - highestPrice) / highestPrice) * 100;

                                    basicInfoMsg += `\n\n저가대비 +${upFromLow.toFixed(2)}%  |  고가대비 ${downFromHigh.toFixed(2)}%`;
                                }
                            }
                        } catch (chartErr) {
                            console.error('[TelegramService] 차트 데이터 분석 실패', chartErr);
                        }
                        const tgSettings: any = store.get('telegram_settings') || {};
                        const theme = tgSettings.chartTheme || 'dark';

                        if (isAnalysisRequest) {
                            try {
                                const analysisService = CompanyAnalysisService.getInstance();
                                const dartApi = DartApiService.getInstance();

                                // 5. Check if we have financial data
                                const financials = DatabaseService.getInstance().getFinancialData(targetCode);
                                if (financials.length < 5) { // Need at least some years
                                    await ctx.reply(`📊 [${targetName}] 10년 재무 데이터를 DART에서 새로 수집합니다. 약 20초가 소요됩니다...`);
                                    await dartApi.syncBatchFinancials([targetCode]);
                                }

                                const result = await analysisService.analyzeStock(targetCode);
                                if (result) {
                                    await ctx.reply(result.report)
                                } else {
                                    await ctx.reply(`[${targetCode}] 분석을 위한 데이터가 부족합니다. DART 동기화 후 다시 시도해주세요.`)
                                }
                            } catch (analysisErr: any) {
                                console.error('[TelegramService] 분석 실패:', analysisErr);
                                await ctx.reply(`🚫 [오류] 분석 중 예외 발생: ${analysisErr.message}`);
                            }
                        } else {
                            const buffer = await ChartRenderService.captureChart(targetCode, targetName, theme);
                            const finalCaption = `https://stock.naver.com/domestic/stock/${targetCode}` + basicInfoMsg;
                            await ctx.replyWithPhoto({ source: buffer }, { caption: finalCaption });
                        }

                        // 성공 시 로딩 메시지 삭제 시도 (실패해도 무시)
                        try { await ctx.deleteMessage(loadingMsg.message_id); } catch (e) { }
                    } catch (err: any) {
                        ctx.reply(`[오류] 차트 캡처 실패: ${err.message}`);
                    }
                });

                this.bot.launch().catch(err => {
                    console.error('[TelegramService] 봇 런칭 실패:', err);
                    this.bot = null;
                });
                console.log('[TelegramService] 봇 초기화 완료');

                // 앱 시작 시 테스트겸 확인용 메시지 자동 발송
                if (this.chatId) {
                    this.sendMessage('🚀 [시스템 알림] 키움 트레이더 안티그래비티 프로그램이 정상적으로 시작되었습니다.');
                }

            } catch (error) {
                console.error('[TelegramService] 봇 초기화 오류:', error);
                this.bot = null;
            }
        }
    }

    private setupScheduleCron() { // Added
        if (this.scheduleSummaryJob) {
            this.scheduleSummaryJob.stop();
            this.scheduleSummaryJob = null;
        }

        const settings: any = store.get('schedule_settings') || { notificationTime: '08:30', globalDailyNotify: false };
        const [hour, minute] = settings.notificationTime.split(':').map(Number);

        if (!isNaN(hour) && !isNaN(minute)) {
            const cronTime = `${minute} ${hour} * * *`;
            this.scheduleSummaryJob = cron.schedule(cronTime, () => {
                this.checkAndSendScheduleSummary();
            }, { timezone: 'Asia/Seoul' });
            console.log(`[TelegramService] Schedule Cron set for ${settings.notificationTime}`);
        }
    }

    public async triggerScheduleSummaryTest() {
        console.log('[TelegramService] Manual schedule summary test triggered.');
        await this.checkAndSendScheduleSummary();
    }

    public reloadScheduleCron() { // Added
        console.log('[TelegramService] Reloading schedule cron with new settings...');
        this.setupScheduleCron();
    }

    private async checkMissedScheduleSummary() { // Added
        const savedSettings: any = store.get('schedule_settings') || {};
        const settings = {
            notificationTime: savedSettings.notificationTime || '08:30',
            globalDailyNotify: savedSettings.globalDailyNotify ?? false,
            sendMissedOnStartup: savedSettings.sendMissedOnStartup ?? true
        };

        console.log(`[TelegramService] [Debug] Startup missed notification check: enabled=${settings.sendMissedOnStartup}`);

        if (!settings.sendMissedOnStartup) {
            console.log('[TelegramService] [Debug] Startup notification is disabled in settings.');
            return;
        }

        const now = new Date();
        const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

        const lastNotified = store.get('last_schedule_notify_date');
        console.log(`[TelegramService] [Debug] Today: ${todayStr}, Last notified: ${lastNotified}`);

        if (lastNotified === todayStr) {
            console.log(`[TelegramService] [Debug] Already notified today (${todayStr}). Skipping.`);
            return;
        }

        const [hour, minute] = settings.notificationTime.split(':').map(Number);
        const notifyTimeToday = new Date(now);
        notifyTimeToday.setHours(hour, minute, 0, 0);

        console.log(`[TelegramService] [Debug] Current time: ${now.toLocaleTimeString()}, Threshold: ${settings.notificationTime}`);

        if (now > notifyTimeToday) {
            console.log('[TelegramService] [Debug] Threshold passed. Checking for schedules to notify...');
            await this.checkAndSendScheduleSummary();
        } else {
            console.log('[TelegramService] [Debug] Threshold not yet reached. Cron will handle it.');
        }
    }

    private async checkAndSendScheduleSummary() { // Added
        try {
            const allSchedules = DatabaseService.getInstance().getAllSchedules();
            const settings: any = store.get('schedule_settings') || { notificationTime: '08:30', globalDailyNotify: false };

            const now = new Date();
            const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

            console.log(`[TelegramService] [Debug] 알림 체크 시작 - 오늘날짜: ${todayStr}, 전체 일정수: ${allSchedules.length}`);
            console.log(`[TelegramService] [Debug] 설정: dailyNotify=${settings.globalDailyNotify}, time=${settings.notificationTime}`);

            // Filter for today's schedules
            const todaySchedules = allSchedules.filter((s: any) => {
                const isToday = s.target_date === todayStr;
                const needsNotify = s.reminder_type === 'same_day' || settings.globalDailyNotify;
                const notYetNotified = s.is_notified === 0;

                if (isToday) {
                    console.log(`[TelegramService] [Debug] 오늘 일정 발견: ${s.title}, needsNotify=${needsNotify}, isNotified=${s.is_notified}`);
                }

                return isToday && needsNotify && notYetNotified;
            });

            console.log(`[TelegramService] [Debug] 최종 발송 대상 일정수: ${todaySchedules.length}`);

            if (todaySchedules.length === 0) {
                return;
            }

            let message = `📅 [${todayStr}] 오늘의 일정 안내\n\n`;
            todaySchedules.forEach((s: any, idx: number) => {
                message += `${idx + 1}. ${s.title}\n`;
                if (s.description) {
                    // Simple markdown stripping logic
                    const plainText = (s.description as string)
                        .replace(/^[*-]{3,}\s*$/gm, '') // Remove horizontal rules (---, ***)
                        .replace(/[#*`_~]/g, '') // Remove formatting chars
                        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // [text](url) -> text
                        .replace(/\n{3,}/g, '\n\n') // Limit to max 2 newlines (keep paragraph breaks)
                        .trim();
                    message += `${plainText}\n`;
                }
                message += `\n`;
            });

            console.log(`[TelegramService] [Debug] 텔레그램 메시지 발송 시도... 대상 일정수: ${todaySchedules.length}`);
            await this.sendMessage(message);

            // Mark as notified in DB
            const db = DatabaseService.getInstance().getDb();
            const stmt = db.prepare('UPDATE schedules SET is_notified = 1 WHERE id = ?');
            const notifiedIds: string[] = [];
            todaySchedules.forEach((s: any) => {
                stmt.run(s.id);
                notifiedIds.push(s.id);
            });

            // Notify renderer to update its state (Mark as notified in UI stores)
            const windows = BrowserWindow.getAllWindows();
            windows.forEach(win => {
                if (!win.isDestroyed()) {
                    win.webContents.send('schedule:notified', { ids: notifiedIds });
                }
            });

            // Record that we notified today
            store.set('last_schedule_notify_date', todayStr);
            console.log(`[TelegramService] [Debug] 알림 발송 완료 및 렌더러 동기화 요청 (IDs: ${notifiedIds.join(', ')})`);

        } catch (error) {
            console.error('[TelegramService] Failed to send schedule summary:', error);
        }
    }

    private setupListeners() {
        // [1] 매매 체결 시 자동 알림 발송
        eventBus.on(SystemEvent.TRADE_EXECUTED, (data) => {
            this.sendMessage(`✅ [체결 알림]\n${JSON.stringify(data)}`);
        });

        // [2] 시스템 오류 발생 시 알림 발송
        eventBus.on(SystemEvent.SYSTEM_ERROR, (error) => {
            this.sendMessage(`🚨 [시스템 오류]\n${error.message || error}`);
        });

        // [2.5] 비상 청산 종료 알림
        eventBus.on(SystemEvent.EMERGENCY_LIQUIDATION_COMPLETED, () => {
            this.sendMessage(`✅ [비상 청산 종료]\n모든 잔고 청산 및 시장가 매도가 완료되었습니다.\n자동매매 스위치가 완전히 [정지(OFF)] 상태로 전환되었습니다.`);
        });

        // [3] 이격침체 조건 감지 (일 1회 제한)
        eventBus.on(SystemEvent.DISPARITY_SLUMP_DETECTED, (data: { code: string, name: string, disparity: number, changeRate: number }) => {
            const today = new Date().toISOString().split('T')[0];
            const numericCode = data.code.replace(/[^0-9]/g, '');
            const cacheKey = numericCode;

            if (this.disparityCache.get(cacheKey) !== today) {
                this.disparityCache.set(cacheKey, today);

                let displayName = data.name;
                // 이름 데이터가 날아오지 않았거나 코드와 동일한 경우 캐시에서 종목명 찾기
                if (!displayName || displayName === numericCode || displayName === data.code || displayName === '알 수 없음') {
                    const match = this.stockSearchCache.find(s => s.code === numericCode || s.code.replace(/[^0-9]/g, '') === numericCode);
                    if (match) {
                        displayName = match.name;
                    }
                }

                const sign = data.changeRate > 0 ? '+' : '';
                this.sendMessage(`📉 ${displayName}  ${sign}${data.changeRate.toFixed(2)}%\nhttps://stock.naver.com/domestic/stock/${numericCode}/`);
            }
        });

        // [4] 자동매매 주문 실패 (예외)
        eventBus.on(SystemEvent.ORDER_FAILED, (data: { reason: string, name?: string, time: string }) => {
            this.sendMessage(`🚨 [주문 실패 🚨]\n시간: ${data.time}\n종목: ${data.name || '알 수 없음'}\n사유: ${data.reason}\n\n즉시 HTS나 앱을 통해 확인하시기 바랍니다.`);
        });

        // [5] 자동매매 매수 주문 실행 결과 리포트
        eventBus.on(SystemEvent.AUTO_BUY_COMPLETED, (data: { success: boolean, count: number, totalAmount: number, fails: number }) => {
            const statusStr = data.success ? (data.fails === 0 ? '🟢 전체 성공' : '🟡 일부 성공') : '🔴 전체 실패';
            this.sendMessage(`📊 [자동매매 매수 리포트]\n상태: ${statusStr}\n성공 종목 수: ${data.count}종목\n총 매수 금액: ${data.totalAmount.toLocaleString()}원\n실패 건수: ${data.fails}건`);
        });
    }

    public async sendAutoTradeStatusMessage(isTest: boolean = false) {
        try {
            const isRunning = AutoTradeService.getInstance().getIsRunning();
            const statusTxt = isRunning ? '🟢 실행 중' : '🔴 중지 상태';

            const settings: any = store.get('autotrade_settings') || {};
            const seq = settings.selectedSeq || '미설정';
            const timeHours = settings.timeHours || '09';
            const timeMinutes = settings.timeMinutes || '00';
            const buyLimit = Number(String(settings.buyLimit || '').replace(/[^0-9]/g, '') || 0);

            let conditionName = settings.selectedSeqName || '알 수 없음';
            if (conditionName === '알 수 없음' && seq !== '미설정') {
                try {
                    const conditions = await KiwoomService.getInstance().getConditionList();
                    const found = conditions.find((c: any) => c[0] === seq);
                    if (found) {
                        conditionName = found[1];
                    }
                } catch (e) {
                    console.error('[TelegramService] failed to fetch condition list for status message', e);
                }
            }

            let message = '';
            if (isTest) {
                message += '✅ [테스트 메시지]\n안티그래비티 PC앱과 텔레그램 연동이 정상적으로 완료되었습니다!\n\n';
            }

            // [추가] 현재 보유 종목 수 조회
            let holdingsCountText = '';
            const accountNo = settings.selectedAccount;
            if (accountNo) {
                try {
                    const kiwoom = KiwoomService.getInstance();
                    const result = await kiwoom.getHoldings(accountNo);
                    // kt00018 API 규격에 따라 Body 또는 list에서 종목 리스트 추출
                    const holdingsList = result.data?.Body || result.data?.list || [];
                    if (Array.isArray(holdingsList)) {
                        holdingsCountText = `\n📦 보유 현황: 총 ${holdingsList.length}개 종목 보유 중`;
                    }
                } catch (e) {
                    console.error('[TelegramService] failed to fetch holdings count for status message', e);
                    holdingsCountText = `\n📦 보유 현황: 정보 조회 실패`;
                }
            }

            message += `⏰ [자동매매 상태 알림]\n현재 자동매매 봇이 [${statusTxt}] 입니다.${holdingsCountText}\n\n📊 설정 정보\n- 조건식: ${conditionName} (${seq})\n- 매수 스케줄: ${timeHours}:${timeMinutes}\n- 종목당 한도: ${buyLimit.toLocaleString()}원`;

            await this.sendMessage(message);
        } catch (error) {
            console.error('[TelegramService] sendAutoTradeStatusMessage error', error);
            throw error;
        }
    }

    private setupCronJobs() {
        // [6] 자동매매 동작 상태 스케줄 알림 (08:50, 15:00)
        const sendStatus = () => {
            this.sendAutoTradeStatusMessage(false);
        };

        cron.schedule('0 50 8 * * *', sendStatus, { timezone: 'Asia/Seoul' });
        cron.schedule('0 0 15 * * *', sendStatus, { timezone: 'Asia/Seoul' });
    }

    public async sendMessage(message: string) {
        console.log(`[TelegramService] [Debug] sendMessage called. Message length: ${message.length}, ChatID: ${this.chatId}`);
        if (!this.bot) {
            console.log(`[TelegramService] [Debug] Bot not initialized.`);
            console.log(`[Telegram 발송 대기 (Token 미설정)]\n${message}`);
            throw new Error("텔레그램 봇 토큰이 설정되지 않았거나 초기화되지 않았습니다.");
        }
        if (!this.chatId) {
            console.log(`[TelegramService] [Debug] Chat ID missing.`);
            console.log(`[Telegram 발송 대기 (Chat ID 미설정)]\n${message}`);
            throw new Error("Chat ID가 설정되지 않았습니다. 텔레그램 개인 톡방에서 봇에게 /start 를 먼저 입력해주세요.");
        }
        // 단톡방(음수 Chat ID)으로는 시스템 알림 발송 제한
        if (this.chatId.startsWith('-')) {
            console.log(`[TelegramService] [Debug] Blocked for group chat.`);
            console.log(`[Telegram 발송 차단] 단톡방으로는 시스템 알림을 발송하지 않습니다.`);
            throw new Error("현재 등록된 Chat ID가 단톡방입니다. 알림을 받으시려면 개인 톡방에서 봇에게 /start 를 입력해주세요.");
        }

        try {
            await this.bot.telegram.sendMessage(this.chatId, message);
            console.log(`[TelegramService] [Debug] Message sent successfully.`);
        } catch (error: any) {
            console.error('[TelegramService] [Debug] Telegram delivery failed:', error);
            throw new Error(`텔레그램 발송 실패: ${error.message}`);
        }
    }

    public reloadConfig() {
        const settings: any = store.get('telegram_settings');
        if (this.bot && this.botToken === settings?.botToken) {
            // 토큰이 같으면 봇을 아예 재시작하지 않고 내부 데이터만 업데이트
            this.chatId = settings?.chatId || null;
            return;
        }

        if (this.bot) {
            try { this.bot.stop(); } catch (e) { }
            this.bot = null;
        }

        // 텔레그램 API 충돌(409 Conflict) 방지를 위해 기존 봇 종료 후 약간의 딜레이
        setTimeout(() => {
            this.initializeBot();
        }, 1500);
    }

    private async buildStockSearchCache() {
        try {
            const kiwoom = KiwoomService.getInstance();
            // Wait briefly to ensure KiwoomService has token
            setTimeout(async () => {
                try {
                    console.log('[TelegramService] 주식 종목 검색 캐시 구축 시작...');
                    const kospi = await kiwoom.getAllStocks('0');
                    const kosdaq = await kiwoom.getAllStocks('10');
                    if (kospi && Array.isArray(kospi)) {
                        this.stockSearchCache.push(...kospi);
                    }
                    if (kosdaq && Array.isArray(kosdaq)) {
                        this.stockSearchCache.push(...kosdaq);
                    }
                    console.log(`[TelegramService] 검색 캐시 완료. 총 ${this.stockSearchCache.length} 종목 대상`);
                } catch (err) {
                    console.error('[TelegramService] 종목 검색 캐시 생성 실패:', err);
                }
            }, 5000); // 5 seconds after startup to let login finish

        } catch (error) {
            console.error('[TelegramService] buildStockCache setup failed:', error);
        }
    }
}
