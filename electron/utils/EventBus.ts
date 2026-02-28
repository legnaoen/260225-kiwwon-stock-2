import { EventEmitter } from 'events';

class EventBus extends EventEmitter {
    private static instance: EventBus;

    private constructor() {
        super();
        this.setMaxListeners(50); // 서비스 확장을 고려한 여유 있는 리스너 수 제한
    }

    public static getInstance(): EventBus {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }
}

export const eventBus = EventBus.getInstance();

// 타입 안정성을 위한 알려진 시스템 이벤트 목록 정의
export enum SystemEvent {
    PRICE_UPDATE = 'PRICE_UPDATE',
    TRADE_EXECUTED = 'TRADE_EXECUTED',
    ORDER_REQUESTED = 'ORDER_REQUESTED',
    SYSTEM_ERROR = 'SYSTEM_ERROR',
    TOKEN_REFRESHED = 'TOKEN_REFRESHED'
}
