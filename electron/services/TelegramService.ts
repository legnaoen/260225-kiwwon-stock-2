import { BrowserWindow, app } from 'electron';
import path from 'path';
import { eventBus, SystemEvent } from '../utils/EventBus';
import Store from 'electron-store';
import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import { AutoTradeService } from './AutoTradeService';

const store = new Store();

export class TelegramService {
    private static instance: TelegramService;
    private bot: Telegraf | null = null;
    private chatId: string | null = null;
    private disparityCache: Map<string, string> = new Map();

    private constructor() {
        this.initializeBot();
        this.setupListeners();
        this.setupCronJobs();
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
            try {
                this.bot = new Telegraf(settings.botToken);
                this.chatId = settings.chatId || null;

                this.bot.start((ctx) => {
                    const receivedChatId = ctx.chat.id.toString();

                    // Auto-save the chat ID if it wasn't set or differs
                    if (this.chatId !== receivedChatId) {
                        this.chatId = receivedChatId;
                        store.set('telegram_settings', { botToken: settings.botToken, chatId: receivedChatId });
                        console.log(`[TelegramService] Auto-registered Chat ID: ${receivedChatId}`);
                    }

                    ctx.reply('✅ 키움 트레이더 안티그래비티 봇이 활성화되었습니다.\n이 방으로 모든 알림이 전송됩니다.');
                });

                // 커맨드: 종목명 입력 시 차트 캡처
                this.bot.on('text', async (ctx) => {
                    const text = ctx.message.text.trim();
                    if (text.startsWith('/')) return; // ignore commands like /start

                    // Simple flow: notify we are loading
                    const loadingMsg = await ctx.reply(`[${text}] 차트를 조회 중입니다... 잠시만 기다려주세요.`);

                    try {
                        // TODO: Implement actual offscreen window capture using KiwoomService to get data
                        // For now, this is a placeholder or simulation for the image capture logic
                        await ctx.reply(`[안내] '${text}' 차트 캡처 기능이 준비중입니다. (Offscreen Window 렌더링 파이프라인 연동 필요)`);
                    } catch (err: any) {
                        ctx.reply(`조회 실패: ${err.message}`);
                    } finally {
                        // ctx.deleteMessage(loadingMsg.message_id).catch(() => {});
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
            throw new Error("Chat ID가 설정되지 않았습니다. 텔레그램에서 봇에게 /start 를 먼저 입력해주세요.");
        }
        try {
            await this.bot.telegram.sendMessage(this.chatId, message);
        } catch (error: any) {
            console.error('[Telegram 발송 실패]', error);
            throw new Error(`텔레그램 발송 실패: ${error.message}`);
        }
    }

    public reloadConfig() {
        if (this.bot) {
            try { this.bot.stop(); } catch (e) { }
        }
        this.initializeBot();
    }
}
