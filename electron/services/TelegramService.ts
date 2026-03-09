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
    private dailyTopRisingJobs: cron.ScheduledTask[] = [];
    private weeklyTopRisingJobs: cron.ScheduledTask[] = [];
    private monthlyTopRisingJobs: cron.ScheduledTask[] = [];

    private constructor() {
        this.initializeBot();
        this.setupListeners();
        this.setupCronJobs();
        this.setupScheduleCron();
        this.setupDailyTopRisingCron();
        this.setupWeeklyTopRisingCron();
        this.setupMonthlyTopRisingCron();
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

                    // Auto-save the chat ID for both private and group chats
                    this.chatId = receivedChatId;
                    const currentSettings: any = store.get('telegram_settings') || {};
                    store.set('telegram_settings', {
                        ...currentSettings,
                        botToken: settings.botToken,
                        chatId: receivedChatId,
                        chatType: isGroup ? 'group' : 'private'
                    });

                    console.log(`[TelegramService] Registered Chat ID (${isGroup ? 'Group' : 'Private'}): ${receivedChatId}`);
                    ctx.reply(`✅ [알림 수신 등록 완료]\n이제부터 이 ${isGroup ? '단톡방' : '1:1 대화방'}으로 모든 일정을 안내해 드립니다.`);
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


                            // 키움 API는 Body, body, output, 혹은 최상단에 직접 데이터를 내려줄 수 있음
                            const body = infoRes?.body || infoRes?.Body || infoRes?.output || infoRes;

                            let currentPriceMsg = '';
                            let price = body?.stk_prc || body?.currentPrice || body?.cur_prc || body?.prpr || body?.stk_cls_prc;
                            let changeRate = body?.prdy_ctrt || body?.fltt_rt || body?.change_rate || body?.flu_rt || body?.stk_prdy_ctrt;
                            const yesterdayPrice = body?.prdy_clpr || body?.yesterdayPrice || body?.prdy_clpr_prc;

                            if (price) {
                                const matchStr = String(price).replace(/[^0-9]/g, '');
                                if (matchStr) {
                                    const priceNum = parseInt(matchStr, 10);
                                    let rateStr = '';

                                    // 1. 직접 등락률 필드가 있는 경우
                                    if (changeRate !== undefined && changeRate !== null && changeRate !== '') {
                                        const rateNum = parseFloat(String(changeRate));
                                        if (!isNaN(rateNum)) {
                                            const sign = rateNum > 0 ? '+' : '';
                                            rateStr = ` ${sign}${rateNum.toFixed(2)}%`;
                                        }
                                    }
                                    // 2. 등락률 필드는 없는데 전일종가가 있는 경우 계산 시도
                                    else if (yesterdayPrice) {
                                        const yMatch = String(yesterdayPrice).replace(/[^0-9]/g, '');
                                        if (yMatch) {
                                            const yPriceNum = parseInt(yMatch, 10);
                                            if (yPriceNum > 0) {
                                                const rateNum = ((priceNum - yPriceNum) / yPriceNum) * 100;
                                                const sign = rateNum > 0 ? '+' : '';
                                                rateStr = ` ${sign}${rateNum.toFixed(2)}%`;
                                            }
                                        }
                                    }

                                    currentPriceMsg = `\n\n💵 현재주가: ${priceNum.toLocaleString()}원${rateStr}`;
                                }
                            }

                            if (!currentPriceMsg) {
                                try {
                                    const priceInfo = await kiwoom.getCurrentPrice(targetCode);
                                    const pBody = priceInfo?.Body || priceInfo?.Body?.out1 || priceInfo?.output || priceInfo;

                                    let rawPrice = pBody?.currentPrice || pBody?.cur_prc || pBody?.stk_prc || pBody?.prpr || '';
                                    let rawRate = pBody?.prdy_ctrt || pBody?.fltt_rt || pBody?.flu_rt || pBody?.change_rate || '';

                                    const matchStr = String(rawPrice).replace(/[^0-9]/g, '');
                                    if (matchStr) {
                                        const priceNum = parseInt(matchStr, 10);
                                        let rateStr = '';

                                        const rateNum = parseFloat(String(rawRate));
                                        if (!isNaN(rateNum)) {
                                            const sign = rateNum > 0 ? '+' : '';
                                            rateStr = ` ${sign}${rateNum.toFixed(2)}%`;
                                        }
                                        currentPriceMsg = `\n\n💵 현재주가: ${priceNum.toLocaleString()}원${rateStr}`;
                                    }
                                } catch (e) { }
                            }

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
                                basicInfoMsg = `${currentPriceMsg}\n💰 시가총액: ${cap}\n📊 PER: ${per} | PBR: ${pbr} | ROE: ${roe}%${stStr}`;
                            } else {
                                basicInfoMsg = currentPriceMsg;
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
                            const finalCaption = `https://www.tossinvest.com/?focusedProductCode=A${targetCode}` + basicInfoMsg;
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

    private async checkMissedScheduleSummary() {
        const savedSettings: any = store.get('schedule_settings') || {};
        const settings = {
            notificationTime: savedSettings.notificationTime || '08:30',
            globalDailyNotify: savedSettings.globalDailyNotify ?? false,
            sendMissedOnStartup: savedSettings.sendMissedOnStartup ?? true
        };

        if (!settings.sendMissedOnStartup) return;

        const now = new Date();
        const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
        const lastNotified = store.get('last_schedule_notify_date');

        if (lastNotified === todayStr) return;

        const [hour, minute] = settings.notificationTime.split(':').map(Number);
        const notifyTimeToday = new Date(now);
        notifyTimeToday.setHours(hour, minute, 0, 0);

        if (now > notifyTimeToday) {
            await this.checkAndSendScheduleSummary();
        }
    }

    private async checkAndSendScheduleSummary() {
        try {
            const allSchedules = DatabaseService.getInstance().getAllSchedules();
            const settings: any = store.get('schedule_settings') || { notificationTime: '08:30', globalDailyNotify: false };

            const now = new Date();
            const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

            // Filter for today's schedules
            const todaySchedules = allSchedules.filter((s: any) => {
                const isToday = s.target_date === todayStr;
                const needsNotify = s.reminder_type === 'same_day' || settings.globalDailyNotify;
                const notYetNotified = s.is_notified === 0;
                return isToday && needsNotify && notYetNotified;
            });

            if (todaySchedules.length === 0) return;

            let message = `📅 [${todayStr}] 오늘의 일정 안내\n\n`;
            todaySchedules.forEach((s: any, idx: number) => {
                message += `${idx + 1}. ${s.title}\n`;
                if (s.description) {
                    const plainText = (s.description as string)
                        .replace(/^[*-]{3,}\s*$/gm, '')
                        .replace(/[#*`_~]/g, '')
                        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
                        .replace(/\n{3,}/g, '\n\n')
                        .trim();
                    message += `${plainText}\n`;
                }
                message += `\n`;
            });

            await this.sendMessage(message);

            // Mark as notified in DB
            const db = DatabaseService.getInstance().getDb();
            const stmt = db.prepare('UPDATE schedules SET is_notified = 1 WHERE id = ?');
            const notifiedIds: string[] = [];
            todaySchedules.forEach((s: any) => {
                stmt.run(s.id);
                notifiedIds.push(s.id);
            });

            // Notify renderer to update its state
            const windows = BrowserWindow.getAllWindows();
            windows.forEach(win => {
                if (!win.isDestroyed()) {
                    win.webContents.send('schedule:notified', { ids: notifiedIds });
                }
            });

            store.set('last_schedule_notify_date', todayStr);
            console.log(`[TelegramService] 오늘 일정 ${notifiedIds.length}건 알림 발송 완료`);

        } catch (error) {
            console.error('[TelegramService] Failed to send schedule summary:', error);
        }
    }

    private setupDailyTopRisingCron() {
        this.dailyTopRisingJobs.forEach(job => job.stop());
        this.dailyTopRisingJobs = [];

        const settings: any = store.get('telegram_settings') || {};
        if (!settings.dailyTopRisingNotify) return;

        const times = [
            settings.dailyTopRisingTime1 || '09:30',
            settings.dailyTopRisingTime2 || '14:30'
        ];

        times.forEach(time => {
            const [hour, minute] = time.split(':').map(Number);
            if (!isNaN(hour) && !isNaN(minute)) {
                const cronTime = `${minute} ${hour} * * 1-5`; // Mon-Fri
                const job = cron.schedule(cronTime, () => {
                    this.sendDailyTopRisingMessage(time);
                }, { timezone: 'Asia/Seoul' });
                this.dailyTopRisingJobs.push(job);
                console.log(`[TelegramService] Daily Top Rising Cron set for ${time}`);
            }
        });
    }

    private setupWeeklyTopRisingCron() {
        this.weeklyTopRisingJobs.forEach(job => job.stop());
        this.weeklyTopRisingJobs = [];

        const settings: any = store.get('telegram_settings') || {};
        if (!settings.weeklyTopRisingNotify) return;

        const time = settings.weeklyTopRisingTime || '10:00';
        const [hour, minute] = time.split(':').map(Number);
        if (!isNaN(hour) && !isNaN(minute)) {
            const cronTime = `${minute} ${hour} * * 1-5`;
            const job = cron.schedule(cronTime, () => {
                this.sendPeriodTopRisingMessage('주간(1주일)', 5);
            }, { timezone: 'Asia/Seoul' });
            this.weeklyTopRisingJobs.push(job);
            console.log(`[TelegramService] Weekly Top Rising Cron set for ${time}`);
        }
    }

    private setupMonthlyTopRisingCron() {
        this.monthlyTopRisingJobs.forEach(job => job.stop());
        this.monthlyTopRisingJobs = [];

        const settings: any = store.get('telegram_settings') || {};
        if (!settings.monthlyTopRisingNotify) return;

        const time = settings.monthlyTopRisingTime || '12:00';
        const [hour, minute] = time.split(':').map(Number);
        if (!isNaN(hour) && !isNaN(minute)) {
            const cronTime = `${minute} ${hour} * * 1-5`;
            const job = cron.schedule(cronTime, () => {
                this.sendPeriodTopRisingMessage('월간(1개월)', 20);
            }, { timezone: 'Asia/Seoul' });
            this.monthlyTopRisingJobs.push(job);
            console.log(`[TelegramService] Monthly Top Rising Cron set for ${time}`);
        }
    }

    public async sendDailyTopRisingMessage(timeLabel: string) {
        try {
            console.log(`[TelegramService] Sending daily top rising message for ${timeLabel}...`);
            const kiwoom = KiwoomService.getInstance();
            const res = await kiwoom.getTopRisingStocks();

            // ka10027 응답 키: bid_req_upper 지원 추가
            let rawList: any[] = [];
            if (Array.isArray(res)) {
                rawList = res;
            } else {
                rawList = res?.bid_req_upper || res?.rkinfo_qry || res?.output1 || res?.Body || res?.body?.rkinfo_qry || res?.body?.output1 || res?.body || res?.list || res?.output || res?.data || [];
            }

            if (!Array.isArray(rawList) || rawList.length === 0) {
                // 한 번 더 시도 (다른 필드 탐색)
                if (typeof res === 'object' && res !== null) {
                    const found = Object.values(res).find(v => Array.isArray(v));
                    if (found) rawList = found as any[];
                }
            }

            console.log(`[TelegramService] ka10027 response keys: ${Object.keys(res || {})}`);

            if (!Array.isArray(rawList) || rawList.length === 0) {
                throw new Error('조회된 당일 급등 종목이 없습니다 (목록 없음).');
            }

            // 필터링 및 상위 10개
            const etfKeywords = ['ETF', 'ETN', 'KODEX', 'TIGER', 'ACE', 'KBSTAR', 'ARIRANG', 'HANARO', 'SOL', 'KOSEF', 'VINA', 'KINDEX', 'KB스타'];
            const top10 = rawList
                .filter((s: any) => {
                    const name = (s.stck_nm || s.stk_nm || s.name || '').replace(/\s+/g, '');
                    const isEtf = etfKeywords.some(keyword => name.toUpperCase().includes(keyword.toUpperCase()));
                    return name && !isEtf;
                })
                .slice(0, 10);

            if (top10.length === 0) throw new Error('ETF/ETN을 제외한 당일 급등 종목이 없습니다.');

            let message = `🚀 *[오늘의 급등주 TOP 10]* (${timeLabel})\n\n`;
            top10.forEach((s: any, idx: number) => {
                const name = (s.stck_nm || s.stk_nm || s.name || '알 수 없음').replace(/[*_`\[\]()]/g, '');
                const price = s.stck_prpr || s.stk_prc || s.cur_prc || s.price || '0';
                // flu_rt (ka10027), prdy_ctrt (일반), fltt_rt 등 다양한 키 지원
                const rate = s.flu_rt || s.prdy_ctrt || s.fltt_rt || s.change_rate || '0';

                const priceNum = Math.abs(parseInt(String(price).replace(/[^0-9-]/g, ''), 10)) || 0;
                const rateNum = parseFloat(String(rate)) || 0;
                const sign = rateNum > 0 ? '+' : '';

                message += `${idx + 1}. ${name} ${priceNum.toLocaleString()}원 ${sign}${rateNum.toFixed(2)}%\n`;
            });

            await this.sendMessage(message);
            console.log(`[TelegramService] Daily Top Rising Message sent.`);
        } catch (error: any) {
            console.error('[TelegramService] Daily Message Fail:', error);
            throw error;
        }
    }

    public async sendPeriodTopRisingMessage(label: string, days: number) {
        try {
            console.log(`[TelegramService] Sending ${label} top rising message...`);
            const kiwoom = KiwoomService.getInstance();
            const res = await kiwoom.getPeriodRisingStocks(days);

            // ka10019 응답 키: pric_jmpflu
            let rawList: any[] = [];
            if (Array.isArray(res)) {
                rawList = res;
            } else {
                rawList = res?.pric_jmpflu || res?.pric_jmp || res?.output1 || res?.Body || res?.body?.pric_jmpflu || res?.data || [];
            }

            if (!Array.isArray(rawList) || rawList.length === 0) {
                throw new Error(`${label} 데이터가 없습니다.`);
            }

            // 기간 등락률(jmp_rt) 기준 정렬 및 필터링
            const etfKeywords = ['ETF', 'ETN', 'KODEX', 'TIGER', 'ACE', 'KBSTAR', 'ARIRANG', 'HANARO', 'SOL', 'KOSEF', 'VINA', 'KINDEX', 'KB스타'];
            const top10 = rawList
                .filter((s: any) => {
                    const name = (s.stck_nm || s.stk_nm || s.name || '').replace(/\s+/g, '');
                    const isEtf = etfKeywords.some(keyword => name.toUpperCase().includes(keyword.toUpperCase()));
                    return name && !isEtf;
                })
                .map((s: any) => {
                    // flu_rt, jmp_rt 등 기간 수익률 관련 키 지원
                    const rateStr = String(s.flu_rt || s.jmp_rt || s.prdy_ctrt || '0').replace(/[^0-9.-]/g, '');
                    return { ...s, numericRate: parseFloat(rateStr) };
                })
                .sort((a, b) => b.numericRate - a.numericRate)
                .slice(0, 10);

            if (top10.length === 0) throw new Error(`${label} ETF/ETN 제외 데이터가 없습니다.`);

            let message = `📅 *[${label} 수익률 TOP 10]*\n\n`;
            top10.forEach((s: any, idx: number) => {
                const name = (s.stck_nm || s.stk_nm || s.name || '알 수 없음').replace(/[*_`\[\]()]/g, '');
                const price = s.stck_prpr || s.stk_prc || s.cur_prc || s.price || '0';
                const rate = s.numericRate;

                const priceNum = Math.abs(parseInt(String(price).replace(/[^0-9-]/g, ''), 10)) || 0;
                const sign = rate > 0 ? '+' : '';

                message += `${idx + 1}. ${name} ${priceNum.toLocaleString()}원 ${sign}${rate.toFixed(2)}%\n`;
            });

            await this.sendMessage(message);
            console.log(`[TelegramService] ${label} Message sent.`);
        } catch (error: any) {
            console.error(`[TelegramService] ${label} Message Fail:`, error);
            throw error;
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
                this.sendMessage(`📉 ${displayName}  ${sign}${data.changeRate.toFixed(2)}%\nhttps://www.tossinvest.com/?focusedProductCode=A${numericCode}`);
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

        // [6] D+3 자동매도 주문 메세지
        eventBus.on(SystemEvent.D3_AUTO_SELL_ORDER_SENT, (data: { count: number, stocks: any[] }) => {
            let message = `🔔 [D+3 자동매도 주문 알림]\n\n총 ${data.count}개 종목에 대해 상한가 매도 주문(조건부지정가)을 전송했습니다.\n\n`;
            data.stocks.forEach((s: any, idx: number) => {
                message += `${idx + 1}. ${s.name}(${s.code})\n- 수량: ${s.qty.toLocaleString()}주\n- 가격: ${s.price.toLocaleString()}원(상한가)\n\n`;
            });
            message += `💡 장 마감 시까지 미체결 시 시장가로 자동 전환되어 전량 매도됩니다.`;
            this.sendMessage(message);
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
        if (!this.bot) {
            throw new Error("텔레그램 봇 토큰이 설정되지 않았거나 초기화되지 않았습니다.");
        }
        if (!this.chatId) {
            throw new Error("Chat ID가 설정되지 않았습니다. 텔레그램 개인 톡방 혹은 단톡방에서 봇에게 /start 를 먼저 입력해주세요.");
        }

        try {
            await this.bot.telegram.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
        } catch (error: any) {
            console.error('[TelegramService] Telegram delivery failed:', error);
            throw new Error(`텔레그램 발송 실패: ${error.message}`);
        }
    }

    public reloadConfig() {
        const settings: any = store.get('telegram_settings');
        if (this.bot && this.botToken === settings?.botToken) {
            // 토큰이 같으면 봇을 아예 재시작하지 않고 내부 데이터만 업데이트
            this.chatId = settings?.chatId || null;
            this.setupDailyTopRisingCron();
            this.setupWeeklyTopRisingCron();
            this.setupMonthlyTopRisingCron();
            return;
        }

        if (this.bot) {
            try { this.bot.stop(); } catch (e) { }
            this.bot = null;
        }

        // 텔레그램 API 충돌(409 Conflict) 방지를 위해 기존 봇 종료 후 약간의 딜레이
        setTimeout(() => {
            this.initializeBot();
            this.setupDailyTopRisingCron();
            this.setupWeeklyTopRisingCron();
            this.setupMonthlyTopRisingCron();
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
