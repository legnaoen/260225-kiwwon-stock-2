import { eventBus, SystemEvent } from '../utils/EventBus';

export class TelegramService {
    private static instance: TelegramService;

    private constructor() {
        this.setupListeners();
    }

    public static getInstance(): TelegramService {
        if (!TelegramService.instance) {
            TelegramService.instance = new TelegramService();
        }
        return TelegramService.instance;
    }

    private setupListeners() {
        // 매매 체결 시 자동 알림 발송
        eventBus.on(SystemEvent.TRADE_EXECUTED, (data) => {
            this.sendMessage(`[체결 알림] ${JSON.stringify(data)}`);
        });

        // 시스템 오류 발생 시 알림 발송
        eventBus.on(SystemEvent.SYSTEM_ERROR, (error) => {
            this.sendMessage(`[시스템 오류] ${error.message || error}`);
        });
    }

    public sendMessage(message: string) {
        // 추후 telegraf 라이브러리로 봇 연동
        console.log(`[Telegram 발송] ${message}`);
    }
}
