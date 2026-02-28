import { eventBus, SystemEvent } from '../utils/EventBus';

export class AutoTradeService {
    private static instance: AutoTradeService;

    private constructor() {
        // 생성 시 이벤트 리스너를 한 번만 등록
        this.setupListeners();
    }

    public static getInstance(): AutoTradeService {
        if (!AutoTradeService.instance) {
            AutoTradeService.instance = new AutoTradeService();
        }
        return AutoTradeService.instance;
    }

    private setupListeners() {
        // KiwoomService(또는 WebSocket)에서 전송한 가격 업데이트 구독
        eventBus.on(SystemEvent.PRICE_UPDATE, (data) => {
            // 매수/매도 조건 판단 로직 예정
        });
    }

    public startScheduler() {
        console.log("[AutoTradeService] 스케줄러가 시작되었습니다.");
        // 추후 node-cron 등을 이용한 조건검색 실행 로직 추가 예정
    }
}
