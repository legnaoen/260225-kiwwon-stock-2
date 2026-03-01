import { BrowserWindow, app } from 'electron';
import path from 'path';
import { eventBus, SystemEvent } from '../utils/EventBus';
import Store from 'electron-store';
import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import { AutoTradeService } from './AutoTradeService';
import { KiwoomService } from './KiwoomService';
import { ChartRenderService } from './ChartRenderService';

const store = new Store();

export class TelegramService {
    private static instance: TelegramService;
    private bot: Telegraf | null = null;
    private botToken: string | null = null;
    private chatId: string | null = null;
    private disparityCache: Map<string, string> = new Map();
    private stockSearchCache: Array<{ code: string, name: string }> = [];

    private constructor() {
        this.initializeBot();
        this.setupListeners();
        this.setupCronJobs();
        this.buildStockSearchCache();
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
                        ctx.reply('✅ 키움 트레이더 봇이 단톡방에 활성화되었습니다.\n이 방에서는 멘션을 통한 종목 차트 검색 기능만 제한적으로 수행합니다. (시스템 알림 수신 불가)');
                        return;
                    }

                    // Auto-save the chat ID for private chats
                    if (this.chatId !== receivedChatId) {
                        this.chatId = receivedChatId;
                        const currentSettings: any = store.get('telegram_settings') || {};
                        store.set('telegram_settings', { ...currentSettings, botToken: settings.botToken, chatId: receivedChatId });
                        console.log(`[TelegramService] Auto-registered Private Chat ID: ${receivedChatId}`);
                    }

                    ctx.reply('✅ 키움 트레이더 안티그래비티 봇이 활성화되었습니다.\n이 1:1 대화방으로는 모든 시스템 알림이 정상적으로 전송됩니다.');
                });

                // 커맨드: 종목명 입력 시 차트 캡처
                this.bot.on('text', async (ctx) => {
                    let text = ctx.message.text.trim();
                    if (text.startsWith('/')) return;

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

                        const buffer = await ChartRenderService.captureChart(targetCode, targetName, theme);

                        const finalCaption = `https://stock.naver.com/domestic/stock/${targetCode}` + basicInfoMsg;

                        await ctx.replyWithPhoto({ source: buffer }, { caption: finalCaption });
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

    private setupListeners() {
        // [1] 매매 체결 시 자동 알림 발송
        eventBus.on(SystemEvent.TRADE_EXECUTED, (data) => {
            this.sendMessage(`✅ [체결 알림]\n${JSON.stringify(data)}`);
        });

        // [2] 시스템 오류 발생 시 알림 발송
        eventBus.on(SystemEvent.SYSTEM_ERROR, (error) => {
            this.sendMessage(`🚨 [시스템 오류]\n${error.message || error}`);
        });

        // [3] 이격침체 조건 감지 (일 1회 제한)
        eventBus.on(SystemEvent.DISPARITY_SLUMP_DETECTED, (data: { code: string, name: string, disparity: number }) => {
            const today = new Date().toISOString().split('T')[0];
            const cacheKey = `${data.code}`;
            if (this.disparityCache.get(cacheKey) !== today) {
                this.disparityCache.set(cacheKey, today);
                this.sendMessage(`⚠️ [이격침체 포착]\n종목명: ${data.name} (${data.code})\n현재 이격도: ${data.disparity}\n\n* 본 알림은 종목당 하루 1회만 발송됩니다.`);
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

    private setupCronJobs() {
        // [6] 자동매매 동작 상태 스케줄 알림 (08:50, 15:10)
        const sendStatus = () => {
            const isRunning = AutoTradeService.getInstance().isRunning();
            const statusTxt = isRunning ? '🟢 실행 중' : '🔴 중지 상태';
            this.sendMessage(`⏰ [자동매매 상태 알림]\n현재 자동매매 봇이 [${statusTxt}] 입니다.`);
        };

        cron.schedule('0 50 8 * * *', sendStatus, { timezone: 'Asia/Seoul' });
        cron.schedule('0 10 15 * * *', sendStatus, { timezone: 'Asia/Seoul' });
    }

    public async sendMessage(message: string) {
        if (!this.bot) {
            console.log(`[Telegram 발송 대기 (Token 미설정)]\n${message}`);
            throw new Error("텔레그램 봇 토큰이 설정되지 않았거나 초기화되지 않았습니다.");
        }
        if (!this.chatId) {
            console.log(`[Telegram 발송 대기 (Chat ID 미설정)]\n${message}`);
            throw new Error("Chat ID가 설정되지 않았습니다. 텔레그램 개인 톡방에서 봇에게 /start 를 먼저 입력해주세요.");
        }
        // 단톡방(음수 Chat ID)으로는 시스템 알림 발송 제한
        if (this.chatId.startsWith('-')) {
            console.log(`[Telegram 발송 차단] 단톡방으로는 시스템 알림을 발송하지 않습니다.`);
            throw new Error("현재 등록된 Chat ID가 단톡방입니다. 알림을 받으시려면 개인 톡방에서 봇에게 /start 를 입력해주세요.");
        }

        try {
            await this.bot.telegram.sendMessage(this.chatId, message);
        } catch (error: any) {
            console.error('[Telegram 발송 실패]', error);
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
