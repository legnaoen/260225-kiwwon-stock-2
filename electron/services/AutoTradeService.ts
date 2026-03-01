import { KiwoomService } from './KiwoomService'
import { eventBus, SystemEvent } from '../utils/EventBus'

export class AutoTradeService {
    private static instance: AutoTradeService;
    private kiwoomService = KiwoomService.getInstance();

    private isRunning = false;
    private config: any = {};
    private scheduleTimer: NodeJS.Timeout | null = null;
    private modifyTimer: NodeJS.Timeout | null = null;
    private queueProcessorTimer: NodeJS.Timeout | null = null;

    private hasRunToday = false;
    private lastRunDate = ''; // 'YYYY-MM-DD'

    private orderQueue: any[] = [];
    private modifyQueue: any[] = [];
    private modifyQueueProcessorTimer: NodeJS.Timeout | null = null;
    private condSellStepMap = new Map<string, number>();

    private constructor() {
        // 조건검색 결과 수신 이벤트 리스너
        eventBus.on(SystemEvent.CONDITION_MATCHED, this.handleConditionMatched.bind(this));
    }

    public static getInstance(): AutoTradeService {
        if (!AutoTradeService.instance) {
            AutoTradeService.instance = new AutoTradeService();
            AutoTradeService.instance.startScheduleChecker();
            AutoTradeService.instance.startModifyMonitor();
        }
        return AutoTradeService.instance;
    }

    public updateConfig(newConfig: any) {
        this.config = newConfig || {};
        console.log('[AutoTrade] Config Updated:', this.config);
    }

    public setRunning(status: boolean) {
        this.isRunning = status;
        this.broadcastLog(`시스템 가동 상태 변경: ${this.isRunning ? 'RUNNING' : 'STOPPED'}`, 'INFO');
    }

    private broadcastLog(message: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO') {
        if (level === 'ERROR') console.error(`[AutoTrade] ${message}`);
        else console.log(`[AutoTrade] ${message}`);

        eventBus.emit(SystemEvent.AUTO_TRADE_LOG, {
            time: new Date().toLocaleTimeString('en-US', { hour12: false }),
            message,
            level
        });
    }

    /**
     * 한국거래소(KRX) 유가/코스닥 공통 호가 단위 계산 (2023년 개정안)
     */
    private getTickSize(price: number): number {
        if (price < 2000) return 1;
        if (price < 5000) return 5;
        if (price < 20000) return 10;
        if (price < 50000) return 50;
        if (price < 200000) return 100;
        if (price < 500000) return 500;
        return 1000;
    }

    /**
     * 목표 가격을 호가 단위에 맞게 정규화(내림 처리)
     */
    private normalizePrice(targetPrice: number): number {
        const tick = this.getTickSize(targetPrice);
        return Math.floor(targetPrice / tick) * tick;
    }

    /**
     * 1. 1일 1회 스케줄링 체크 로직 (1초마다 시간 확인)
     */
    private startScheduleChecker() {
        if (this.scheduleTimer) clearInterval(this.scheduleTimer);

        this.scheduleTimer = setInterval(() => {
            if (!this.isRunning || !this.config.selectedSeq || !this.config.timeHours) return;

            const now = new Date();
            const todayStr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

            // 날짜가 바뀌면 실행 여부 초기화
            if (this.lastRunDate !== todayStr) {
                this.lastRunDate = todayStr;
                this.hasRunToday = false;
            }

            const currentHour = String(now.getHours()).padStart(2, '0');
            const currentMinute = String(now.getMinutes()).padStart(2, '0');

            if (!this.hasRunToday &&
                currentHour === this.config.timeHours &&
                currentMinute === this.config.timeMinutes) {

                this.broadcastLog(`지정 시간 도달 (${currentHour}:${currentMinute}). 조건 검색 시작...`, 'INFO');
                this.hasRunToday = true;

                // 조건검색 조회 1회 실행
                this.kiwoomService.startConditionSearch(this.config.selectedSeq);
            }
        }, 1000); // 1초마다 확인
    }

    /**
     * 2. 조건 검색결과 수신 시 예산 분할 및 큐 투입 (Throttling 준비)
     */
    private async handleConditionMatched(stocks: any[]) {
        if (!this.isRunning) return;

        this.broadcastLog(`조건 검색 결과 수신: ${stocks.length} 종목 포착`, 'INFO');

        if (stocks.length === 0) return;

        const dailyBudgetStr = String(this.config.dailyBudget || '7000000');
        const buyLimitStr = String(this.config.buyLimit || '1000000');
        const buyPremiumStr = String(this.config.buyPremium || '3');
        const maxPriceLimitStr = String(this.config.maxPriceLimit || '20');

        const dailyBudget = parseInt(dailyBudgetStr, 10);
        const perStockLimit = parseInt(buyLimitStr, 10);
        const buyPremiumPct = parseFloat(buyPremiumStr); // +3%
        const maxPriceLimitPct = parseFloat(maxPriceLimitStr); // +20% 캡

        // 예산 동적 분배 로직 (Scale Down)
        const requiredBudget = stocks.length * perStockLimit;
        let actualPerStockBudget = perStockLimit;

        if (requiredBudget > dailyBudget) {
            actualPerStockBudget = Math.floor(dailyBudget / stocks.length);
            console.log(`[AutoTrade] Budget Exceeded! Required: ${requiredBudget}, Daily Limit: ${dailyBudget}. Scaling down per-stock budget to: ${actualPerStockBudget}`);
        }

        for (const stock of stocks) {
            // '2'는 편출(조건이탈)이므로 무시, '1'(편입) 또는 최초 조회 결과만 처리
            // (1회 조회의 경우 type 값 없이 오거나 구분됨)
            if (stock.type === '2') {
                this.broadcastLog(`편출(2) 신호로 매수 큐 제외: ${stock.name}`, 'WARN');
                continue;
            }

            // 맨 앞의 'A'만 제거 (숫자와 영문자가 섞인 종목코드 지원. 예: A0004V0 -> 0004V0)
            let cleanCode = String(stock.code).replace(/^A/i, '').trim();

            // 키움/JSON 변환 과정에서 숫자로만 된 코드의 앞자리 0이 증발한 경우 복구
            if (cleanCode.length > 0 && cleanCode.length < 6 && /^\d+$/.test(cleanCode)) {
                cleanCode = cleanCode.padStart(6, '0');
            }
            let basePrice = Number(stock.price);

            if (!cleanCode) {
                this.broadcastLog(`종목코드가 유효하지 않아 매수 큐 제외: ${stock.name} (${stock.code})`, 'WARN');
                continue;
            }

            // 종목 가격 정보가 없는 경우, 주식기본조회 API를 통해 실시간 조회
            if (isNaN(basePrice) || basePrice <= 0) {
                try {
                    const priceInfo = await this.kiwoomService.getCurrentPrice(cleanCode);
                    let rawStr = '';
                    if (priceInfo?.currentPrice) rawStr = priceInfo.currentPrice;
                    else if (priceInfo?.Body?.currentPrice) rawStr = priceInfo.Body.currentPrice;
                    else if (priceInfo?.Body?.out1?.currentPrice) rawStr = priceInfo.Body.out1.currentPrice;

                    const matchStr = String(rawStr).replace(/[^0-9]/g, '');
                    if (matchStr) basePrice = parseInt(matchStr, 10);
                } catch (e) {
                    this.broadcastLog(`종목 가격을 불러오지 못해 매수 큐 제외: ${stock.name}(${cleanCode})`, 'WARN');
                    continue;
                }
            }

            if (isNaN(basePrice) || basePrice <= 0) {
                this.broadcastLog(`유효하지 않은 가격으로 매수 큐 제외: ${stock.name}(${cleanCode})`, 'WARN');
                continue;
            }

            // 할증 가격 계산 (+3%)
            const rawPremiumPrice = basePrice * (1 + (buyPremiumPct / 100));

            // 상한 캡 가격 계산 (+20%)
            const rawMaxCapPrice = basePrice * (1 + (maxPriceLimitPct / 100));

            // 최종 목표가 (상한 캡 이하로 제한)
            const targetRawPrice = Math.min(rawPremiumPrice, rawMaxCapPrice);

            // 호가 단위 보정 (내림 처리하여 단위 맞춤)
            const orderPrice = this.normalizePrice(targetRawPrice);

            // 수량 계산 (투입 예산 / 주문가)
            const orderQty = Math.floor(actualPerStockBudget / orderPrice);

            if (orderQty > 0) {
                // 주문 큐에 삽입
                this.orderQueue.push({
                    code: cleanCode,
                    name: stock.name,
                    orderPrice: orderPrice,
                    orderQty: orderQty,
                    basePrice: basePrice,
                    premiumPct: buyPremiumPct,
                    isScaleDown: requiredBudget > dailyBudget
                });
            } else {
                this.broadcastLog(`예산 부족으로 매수 큐 제외: ${stock.name} (예산: ${actualPerStockBudget}, 가격: ${orderPrice})`, 'WARN');
            }
        }

        this.broadcastLog(`${this.orderQueue.length} 건 매수 큐 투입 (스로틀링 처리 준비)`, 'INFO');
        if (this.orderQueue.length > 0) {
            this.processOrderQueue();
        }
    }

    /**
     * 3. 로봇 배달부: 초당 N건씩 주문 큐 딜레이 처리 (Throttling)
     */
    private processOrderQueue() {
        if (this.queueProcessorTimer) return; // 이미 돌고 있으면 패스

        this.queueProcessorTimer = setInterval(() => {
            if (this.orderQueue.length === 0) {
                if (this.queueProcessorTimer) {
                    clearInterval(this.queueProcessorTimer);
                    this.queueProcessorTimer = null;
                }
                return;
            }

            const throttleLimitStr = String(this.config.throttleLimit || '3');
            const throttleLimit = parseInt(throttleLimitStr, 10);
            const batch = this.orderQueue.splice(0, throttleLimit);

            batch.forEach(async (order) => {
                const msgBase = `매수 대기: ${order.name}(${order.code}) | Qty: ${order.orderQty} | Price: ${order.orderPrice}`;

                const accountNo = this.config.selectedAccount;
                if (!accountNo) {
                    this.broadcastLog(`계좌가 선택되지 않아 매수 실패: ${order.name}`, 'ERROR');
                    return;
                }

                try {
                    const result = await this.kiwoomService.sendBuyOrder(
                        accountNo,
                        order.code,
                        order.orderQty,
                        order.orderPrice
                    );

                    // 키움서버 정상 응답이더라도 '예수금 부족' 등이 msg1로 올 수 있음
                    const rspMsg = result?.msg1 || result?.message || result?.msg_cd || JSON.stringify(result?.Body || result || "OK");
                    this.broadcastLog(`${msgBase} -> 거래소 응답: ${rspMsg}`, 'SUCCESS');
                } catch (err: any) {
                    const errMsg = err?.response?.data?.msg1 || err?.response?.data?.message || err.message || err;
                    this.broadcastLog(`${msgBase} -> 발송 실패: ${errMsg}`, 'ERROR');
                }
            });

        }, 1000); // 1초에 한 번씩 N개 처리
    }

    /**
     * 4. 미체결 매도 주문 자동 정정 스레드 
     * - 장중 (14:59 이전) : 1분 단위 감지 (지정가)
     * - 15:00 ~ 15:20 : 10초 단위 감지 (지정가), 조건부지정가 3분할 정정
     * - 15:20 : 모든 미체결 잔량 시장가(03) 일괄 청산 후 모니터링 강제 종료
     */
    private startModifyMonitor() {
        if (this.modifyTimer) clearInterval(this.modifyTimer);

        // 10초 짧은 주기로 지속 감지
        this.modifyTimer = setInterval(async () => {
            if (!this.isRunning || !this.config.autoModify) return;

            const accountNo = this.config.selectedAccount;
            if (!accountNo) return;

            const now = new Date();
            const currentHour = now.getHours();
            const currentMin = now.getMinutes();
            const currentSec = now.getSeconds();

            const currentTimeStr = `${String(currentHour).padStart(2, '0')}${String(currentMin).padStart(2, '0')}`;

            // 15:20 이후 처리 로직 (일괄 시장가 매도 및 모니터링 타이머 종료)
            if (currentHour > 15 || (currentHour === 15 && currentMin >= 20)) {
                this.broadcastLog(`[시스템 알림] 15:20 도달. 잔여 미체결 매도 물량 시장가 일괄 청산 진행.`, 'WARN');
                await this.executeMarketSweep(accountNo);

                if (this.modifyTimer) clearInterval(this.modifyTimer);
                this.modifyTimer = null;

                // 앱 전체 자동매매 동작 종료 (선택사항, 모니터링 및 로봇 배달부만 중지)
                this.setRunning(false);
                return;
            }

            try {
                // 미체결 주문 목록
                const response = await this.kiwoomService.getUnexecutedOrders(accountNo);
                const orders = response?.output || response?.data || response?.Body?.out1 || [];

                if (!Array.isArray(orders)) return;

                // 조건부 설정 (기본값 설정)
                const condHours = parseInt(String(this.config.condSellTimeHours || '15'), 10);
                const condMins = parseInt(String(this.config.condSellTimeMinutes || '10'), 10);
                const condInterval = parseInt(String(this.config.condSellInterval || '3'), 10);

                for (const order of orders) {
                    // 매도 주문 확인
                    const isSellOrder = order.sll_buy_tp === '1' || order.trde_tp === '1' || String(order.sll_buy_tp || '').includes('매도');
                    if (!isSellOrder) continue;

                    let stk_cd = String(order.stk_cd).replace(/^A/i, '').trim();
                    if (stk_cd.length > 0 && stk_cd.length < 6 && /^\d+$/.test(stk_cd)) {
                        stk_cd = stk_cd.padStart(6, '0');
                    }

                    const orig_ord_no = order.ord_no;
                    const totalQty = parseInt(order.unexec_qty || order.oso_qty || order.qty || '0', 10);

                    if (totalQty <= 0) continue;

                    // 키움 미체결 TR의 조건부 지정가 타입 (보통 05)
                    const trdeType = String(order.ord_tp || order.trde_tp || '00');

                    // 1시간환산 초 계산 (정확도 확보)
                    const ordTimeStr = order.ord_time || order.ord_hm || order.ord_tm || "";
                    let diffSeconds = 0;
                    if (ordTimeStr.length >= 4) {
                        const ordHour = parseInt(ordTimeStr.substring(0, 2), 10);
                        const ordMin = parseInt(ordTimeStr.substring(2, 4), 10);
                        const ordSec = ordTimeStr.length >= 6 ? parseInt(ordTimeStr.substring(4, 6), 10) : 0;
                        diffSeconds = (currentHour * 3600 + currentMin * 60 + currentSec) - (ordHour * 3600 + ordMin * 60 + ordSec);
                    }

                    // --- [로직 A] 조건부지정가 (05) 분할 청산 로직 ---
                    if (trdeType === '05' || trdeType.includes('조건부')) {
                        const currentTotalMinutes = currentHour * 60 + currentMin;
                        const condStartTotalMinutes = condHours * 60 + condMins;

                        if (currentTotalMinutes >= condStartTotalMinutes) {
                            const passedIntervals = Math.floor((currentTotalMinutes - condStartTotalMinutes) / condInterval);
                            const currentTargetStep = Math.min(3, passedIntervals + 1); // 1, 2, 3단계

                            const recordedStep = this.condSellStepMap.get(orig_ord_no) || 0;

                            // 단계가 진행되어 아직 처리를 안한 스텝일 경우
                            if (currentTargetStep > recordedStep) {
                                let orderQty = 0;
                                if (currentTargetStep === 1) orderQty = Math.floor(totalQty / 3) || 1;
                                else if (currentTargetStep === 2) orderQty = Math.floor(totalQty / 2) || 1;
                                else orderQty = totalQty; // 3차엔 전량

                                // 큐에 삽입
                                this.modifyQueue.push({
                                    type: 'CONDITIONAL',
                                    accountNo,
                                    orig_ord_no,
                                    stk_cd,
                                    qty: orderQty,
                                    modifyType: '00', // 지정가(현재가)
                                    step: currentTargetStep
                                });
                                this.condSellStepMap.set(orig_ord_no, currentTargetStep);
                            }
                        }
                    }
                    // --- [로직 B] 일반 지정가 (00) 매도 타이머 기반 단축 청산 로직 ---
                    else {
                        // 15시 기준 쿨타임 변경 (15시 이전: 60초, 15시 이후: 10초)
                        const requireSeconds = currentHour >= 15 ? 10 : 60;

                        if (diffSeconds >= requireSeconds) {
                            // 큐 이미 들어가있는지 중복검사 (비효율 방지)
                            if (!this.modifyQueue.find(q => q.orig_ord_no === orig_ord_no)) {
                                this.modifyQueue.push({
                                    type: 'NORMAL',
                                    accountNo,
                                    orig_ord_no,
                                    stk_cd,
                                    qty: totalQty,
                                    modifyType: '00', // 지정가(현재가)
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('[AutoTrade] modifyMonitor error:', err);
            }

            // 정정 큐에 항목이 있다면 처리 스레드 가동
            if (this.modifyQueue.length > 0) {
                this.processModifyQueue();
            }

        }, 10000); // 10초마다 체크
    }

    /**
     * 15:20 시장가 일괄 청산 (강제 스위핑)
     */
    private async executeMarketSweep(accountNo: string) {
        try {
            const response = await this.kiwoomService.getUnexecutedOrders(accountNo);
            const orders = response?.output || response?.data || response?.Body?.out1 || [];
            if (!Array.isArray(orders)) return;

            for (const order of orders) {
                const isSellOrder = order.sll_buy_tp === '1' || order.trde_tp === '1' || String(order.sll_buy_tp || '').includes('매도');
                if (!isSellOrder) continue;

                let stk_cd = String(order.stk_cd).replace(/^A/i, '').trim();
                if (stk_cd.length > 0 && stk_cd.length < 6 && /^\d+$/.test(stk_cd)) stk_cd = stk_cd.padStart(6, '0');

                const totalQty = parseInt(order.unexec_qty || order.oso_qty || order.qty || '0', 10);
                if (totalQty <= 0) continue;

                // 즉시 시장가(03) 전송
                try {
                    // 시장가는 호가(단가)가 0으로 전송되어야 함 (키움 API 규격)
                    // Kiwoom API에서 시장가는 trde_tp 03을 직접 넣지못하면 직접 modifyOrder 시 trde_tp를 지정하도록 개선 필요. 
                    // 현재는 편의상 0원으로 전송. (또는 KiwoomService.ts의 modifyOrder 내부 개선 필요)
                    await this.kiwoomService.modifyOrder(accountNo, order.ord_no, stk_cd, totalQty, 0);
                    this.broadcastLog(`[지정 마감시장] 시장가 15:20 청산 성공: ${stk_cd} (잔량 ${totalQty}주)`, 'SUCCESS');
                } catch (e: any) {
                    const errMsg = e?.response?.data?.msg1 || e?.response?.data?.message || e.message;
                    this.broadcastLog(`[시장가 청산 오류] ${stk_cd} : ${errMsg}`, 'ERROR');
                }
            }
        } catch (err) {
            console.error('[AutoTrade] Market Sweep Error:', err);
        }
    }

    /**
     * 매도 정정 주문 큐 (Throttling 적용된 배달부)
     */
    private processModifyQueue() {
        if (this.modifyQueueProcessorTimer) return; // 이미 순환중이면 패스

        this.modifyQueueProcessorTimer = setInterval(() => {
            if (this.modifyQueue.length === 0) {
                if (this.modifyQueueProcessorTimer) {
                    clearInterval(this.modifyQueueProcessorTimer);
                    this.modifyQueueProcessorTimer = null;
                }
                return;
            }

            const throttleLimitStr = String(this.config.throttleLimit || '3');
            const throttleLimit = parseInt(throttleLimitStr, 10);

            // 앞단 큐 N개 추출
            const batch = this.modifyQueue.splice(0, throttleLimit);

            batch.forEach(async (task) => {
                const { type, accountNo, orig_ord_no, stk_cd, qty, step } = task;

                // 현재가 조회
                let currentPrice = 0;
                try {
                    const priceInfo = await this.kiwoomService.getCurrentPrice(stk_cd);
                    let rawStr = '';
                    if (priceInfo?.currentPrice) rawStr = priceInfo.currentPrice;
                    else if (priceInfo?.Body?.currentPrice) rawStr = priceInfo.Body.currentPrice;
                    else if (priceInfo?.Body?.out1?.currentPrice) rawStr = priceInfo.Body.out1.currentPrice;

                    const matchStr = String(rawStr).replace(/[^0-9]/g, '');
                    if (matchStr) currentPrice = parseInt(matchStr, 10);
                } catch (e) {
                    this.broadcastLog(`[AutoTrade] Failed to get price for modify: ${stk_cd}`, 'WARN');
                }

                if (currentPrice > 0) {
                    currentPrice = this.normalizePrice(currentPrice);

                    try {
                        const result = await this.kiwoomService.modifyOrder(
                            accountNo,
                            orig_ord_no,
                            stk_cd,
                            qty,
                            currentPrice
                        );
                        const rspMsg = result?.msg1 || result?.message || result?.msg_cd || JSON.stringify(result?.Body || "OK");

                        if (type === 'CONDITIONAL') {
                            this.broadcastLog(`상태도달 조건부 정정 [${step}차]: ${stk_cd} -> ${currentPrice}원 정정 (${rspMsg})`, 'SUCCESS');
                        } else {
                            this.broadcastLog(`일반 지연 매도 정정: ${stk_cd} -> ${currentPrice}원 정정 (${rspMsg})`, 'SUCCESS');
                        }
                    } catch (e: any) {
                        const errMsg = e?.response?.data?.msg1 || e?.response?.data?.message || e.message || e;
                        this.broadcastLog(`정정 실패: ${stk_cd} 정정 거부(${errMsg})`, 'ERROR');
                    }
                }
            });

        }, 1000); // 초당 주문 (스로틀링)
    }
}
