import { KiwoomService } from './KiwoomService'
import { eventBus, SystemEvent } from '../utils/EventBus'
import { DatabaseService } from './DatabaseService'

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
    private lastD3SellDate = ''; // 'YYYY-MM-DD'
    private isLiquidationMode = false;
    private startTime = Date.now();
    private d3SellTimer: NodeJS.Timeout | null = null;
    private liquidationMonitorTimer: NodeJS.Timeout | null = null;
    private lastMarketOpenCheckTime = 0;

    private orderQueue: any[] = [];
    private modifyQueue: any[] = [];
    private modifyQueueProcessorTimer: NodeJS.Timeout | null = null;
    private condSellStepMap = new Map<string, number>();

    private activeOrders: Map<string, any> = new Map();
    private lastUnexecutedSyncTime: number = 0;

    // 매수 세션 집계용 변수
    private buySessionStats = {
        totalTarget: 0,
        pending: 0,
        successCount: 0,
        successAmount: 0,
        failCount: 0
    };

    private constructor() {
        // 조건검색 결과 수신 이벤트 리스너
        eventBus.on(SystemEvent.CONDITION_MATCHED, this.handleConditionMatched.bind(this));
        // 실시간 주문체결 내역 처리
        eventBus.on(SystemEvent.ORDER_REALTIME_UPDATE, (d) => this.handleOrderRealtimeUpdate(d))
        // 비상 청산 모드 시작
        eventBus.on(SystemEvent.EMERGENCY_LIQUIDATION_STARTED, this.handleEmergencyLiquidationStarted.bind(this));
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
        if (
            this.config.timeHours !== newConfig.timeHours ||
            this.config.timeMinutes !== newConfig.timeMinutes ||
            this.config.selectedSeq !== newConfig.selectedSeq
        ) {
            this.hasRunToday = false;
        }
        this.config = newConfig || {};
        console.log('[AutoTrade] Config Updated:', this.config);
    }

    public setRunning(status: boolean) {
        this.isRunning = status;
        if (!status) {
            this.isLiquidationMode = false;
            if (this.liquidationMonitorTimer) {
                clearInterval(this.liquidationMonitorTimer);
                this.liquidationMonitorTimer = null;
            }
        }
        this.broadcastLog(`시스템 가동 상태 변경: ${this.isRunning ? 'RUNNING' : 'STOPPED'}`, 'INFO');
        eventBus.emit(SystemEvent.AUTO_TRADE_STATUS_CHANGED, this.isRunning);
    }

    public getIsRunning() {
        return this.isRunning;
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

    private handleOrderRealtimeUpdate(orderInfo: any) {
        if (!this.isRunning) return;
        const ordNo = orderInfo.order_no;
        if (!ordNo) return;

        let existing = this.activeOrders.get(ordNo);
        if (existing) {
            existing.unexec_qty = String(orderInfo.remain_qty);
            if (orderInfo.remain_qty <= 0 || orderInfo.status === '체결') {
                this.activeOrders.delete(ordNo);
            }
        } else if (orderInfo.remain_qty > 0) {
            // 우리가 모르는 신규 주문 발생. 다음 모니터링 주기 때 즉시 REST API 강제 동기화 유도
            this.lastUnexecutedSyncTime = 0;
        }
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

    private normalizePrice(targetPrice: number): number {
        const tick = this.getTickSize(targetPrice);
        return Math.floor(targetPrice / tick) * tick;
    }

    /**
     * 종목의 주요 가격 정보(현재가, 전일종가, 상한가)를 안전하게 추출
     */
    private async resolveStockPriceInfo(code: string) {
        try {
            const info = await this.kiwoomService.getStockBasicInfo(code);
            // ka10001, ka10100 등 다양한 API 응답 구조 대응
            const body = info?.Body || info?.out1 || info?.body || info?.output || info;

            // 로깅 추가: 상한가가 안 나올 경우를 대비해 원본 응답의 키들을 확인


            // 1. 현재가 추출 (ka10001: cur_prc)
            const curStr = String(body?.cur_prc || body?.stk_prc || body?.currentPrice || body?.cur_prc || body?.stck_prpr || body?.prpr || '0').replace(/[^0-9-]/g, '');
            const currentPrice = Math.abs(parseInt(curStr, 10)) || 0;

            // 2. 전일 종가(기준가) 추출 (ka10001: base_pric = 기준가 = 전일종가)
            const yStr = String(body?.base_pric || body?.prdy_clpr || body?.lst_pric || body?.yesterdayPrice || body?.lastPrice || '').replace(/[^0-9]/g, '');
            const yesterdayPrice = parseInt(yStr, 10) || 0;

            // 3. 상한가 추출 (ka10001: upl_pric = 상한가)
            const uStr = String(body?.upl_pric || body?.up_lmt_prc || body?.upperLimitPrice || body?.mx_prc || body?.stck_mxpr || '').replace(/[^0-9]/g, '');
            let upperLimitPrice = parseInt(uStr, 10) || 0;

            // [안전장치] 상한가 정보가 없을 경우 전일 종가 기반으로 직접 계산 (+30%)
            if (upperLimitPrice <= 0 && yesterdayPrice > 0) {
                const calculatedUpper = yesterdayPrice * 1.30;
                upperLimitPrice = this.normalizePrice(calculatedUpper);
                console.log(`[AutoTrade] Upper limit for ${code} calculated manually: ${upperLimitPrice} (Reference close: ${yesterdayPrice})`);
            }

            return {
                currentPrice,
                yesterdayPrice,
                upperLimitPrice,
                name: body?.stk_nm || body?.prdt_nm || body?.name || body?.stck_shrn_isnm || ''
            };
        } catch (e) {
            console.error(`[AutoTrade] resolveStockPriceInfo error for ${code}:`, e);
            return null;
        }
    }

    private startScheduleChecker() {
        if (this.scheduleTimer) clearInterval(this.scheduleTimer);

        this.scheduleTimer = setInterval(() => {
            if (!this.isRunning || !this.config.selectedAccount) return;

            const now = new Date();
            const todayStr = now.toLocaleDateString('sv-SE');

            // 날짜가 바뀌면 실행 여부 초기화
            if (this.lastRunDate !== todayStr) {
                this.lastRunDate = todayStr;
                this.hasRunToday = false;
                this.lastD3SellDate = '';
            }

            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            const currentSecond = now.getSeconds();

            // 1. 기존 매수 스케줄 (조건검색)
            const configHour = parseInt(String(this.config.timeHours || '9'), 10);
            const configMinute = parseInt(String(this.config.timeMinutes || '5'), 10);

            if (!this.hasRunToday && this.config.selectedSeq &&
                currentHour === configHour && currentMinute === configMinute) {

                this.broadcastLog(`지정 시간 도달 (${configHour}:${configMinute}). 조건 검색 시작...`, 'INFO');
                this.hasRunToday = true;

                // 조건검색 조회 1회 실행 (WS 미연결 시 자동 재연결 후 실행)
                this.kiwoomService.startConditionSearch(this.config.selectedSeq)
                    .catch((err: any) => {
                        this.broadcastLog(`[오류] 조건 검색 실패: ${err.message}`, 'ERROR');
                        this.hasRunToday = false; // 실패 시 재시도 허용
                    });
            }

            // 2. D+3 자동 매도 스케줄 (장 시작 감지 기반 동적 실행)
            if (this.lastD3SellDate !== todayStr && currentHour >= 9) {
                this.checkMarketOpenAndScheduleD3Sell(todayStr);
            }
        }, 1000); // 1초마다 확인
    }

    /**
     * 장 시작을 감지하고 D+3 매도 스케줄링 (오늘의 봉 데이터 포착 시)
     */
    private async checkMarketOpenAndScheduleD3Sell(todayStr: string) {
        // [Throttle] API 호출 부하 방지를 위해 1분에 한 번만 체크
        if (Date.now() - this.lastMarketOpenCheckTime < 60000) return;
        this.lastMarketOpenCheckTime = Date.now();

        // todayStr가 형식이 안 맞을 수 있으므로 보정 (예: 2026-3-6 -> 2026-03-06)
        if (todayStr.length < 10) {
            const parts = todayStr.split('-');
            if (parts.length === 3) {
                todayStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            }
        }

        // 중복 체크 방지 (이미 타이머가 돌고 있거나 오늘 완료했다면 패스)
        if (this.d3SellTimer || this.lastD3SellDate === todayStr) return;

        try {
            const chartRes = await this.kiwoomService.getChartData('005930');
            const rawData = chartRes?.stk_dt_pole_chart_qry || chartRes?.output2 || chartRes?.Body || chartRes?.list || [];

            if (Array.isArray(rawData) && rawData.length > 0) {
                const dates = rawData.map((d: any) => {
                    const dateStr = String(d.dt || d.stck_bsop_date || d.date || d.trd_dt || '');
                    return dateStr.length === 8 ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}` : dateStr;
                });

                // 오늘 날짜가 차트 데이터(삼성전자)에 나타났다면? -> 장이 열렸음!
                if (dates.includes(todayStr)) {
                    this.lastD3SellDate = todayStr; // 중복 방지 즉시 마킹

                    const timeSinceStart = Date.now() - this.startTime;

                    // 앱 시작 후 30초 이내에 이미 오늘 날짜가 차트에 있다면 -> 이미 장이 열린 상태에서 앱을 켠 것(Late Startup)
                    // 앱을 켜두고 대기하다가 오늘 날짜가 처음 나타난 것이라면 -> 실제 장 개장 포착 (Wait 3 mins)
                    if (timeSinceStart < 30000) {
                        this.broadcastLog(`[D+3 감시] 장중 진입 포착(Late Startup). 즉시 D+3 대상 조회를 시작합니다.`, 'INFO');
                        this.executeD3AutoSell();
                    } else {
                        this.broadcastLog(`[D+3 감시] 시장 개장 포착. 안정화를 위해 3분 후 주문을 실행합니다.`, 'INFO');
                        this.d3SellTimer = setTimeout(() => {
                            this.executeD3AutoSell();
                            this.d3SellTimer = null;
                        }, 180000); // 3분
                    }

                    // 렌더러(UI)에도 오늘이 거래일임을 알리기 위해 이벤트 발송
                    eventBus.emit(SystemEvent.MARKET_OPENED_DETECTED, { date: todayStr, tradingDays: dates });
                }
            }
        } catch (e) {
            console.error('[AutoTrade] checkMarketOpenAndScheduleD3Sell error:', e);
        }
    }

    /**
     * D+3 거래일 맞이 종목 자동 매도 (공용)
     */
    public async executeD3AutoSell() {
        this.broadcastLog(`[D+3 자동매도] 로직 시작...`, 'INFO');

        const accountNo = this.config.selectedAccount;
        if (!accountNo) {
            this.broadcastLog(`[D+3 자동매도] 계좌 정보가 없어 종료합니다.`, 'WARN');
            return;
        }

        try {
            // 1. 거래일 리스트 확보 (삼성전자 차트 활용)
            const chartRes = await this.kiwoomService.getChartData('005930');
            const rawData = chartRes?.stk_dt_pole_chart_qry || chartRes?.output2 || chartRes?.Body || chartRes?.list || [];

            if (!Array.isArray(rawData) || rawData.length === 0) {
                this.broadcastLog(`[D+3 자동매도] 거래일 데이터를 가져오지 못해 취소합니다.`, 'ERROR');
                return;
            }

            const tradingDays = rawData.map((d: any) => {
                const dateStr = String(d.dt || d.stck_bsop_date || d.date || d.trd_dt || '');
                return dateStr.length === 8 ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}` : dateStr;
            }).filter((d: string) => d.length === 10).sort();

            const today = new Date().toLocaleDateString('sv-SE');
            if (!tradingDays.includes(today)) tradingDays.push(today);
            tradingDays.sort();

            // 2. 보유 종목 및 기록일 조회 (DB)
            const history = DatabaseService.getInstance().getHoldingHistory();
            const holdingsRes = await this.kiwoomService.getHoldings(accountNo);

            // getHoldings 응답 파싱 강화
            const hData = holdingsRes?.data || holdingsRes;
            const hBody = hData?.Body || hData?.body || hData?.output1 || hData;

            let listData = [];
            if (Array.isArray(hBody)) {
                listData = hBody;
            } else {
                listData = hBody?.acnt_evlt_remn_indv_tot || hBody?.output1 || hBody?.list || hBody?.grid || [];
            }

            const holdings = Array.isArray(listData) ? listData : [listData].filter(Boolean);

            if (holdings.length === 0) {
                console.log('[AutoTrade D+3] No holdings found. Full response sample:', JSON.stringify(holdingsRes).substring(0, 300));
                this.broadcastLog(`[D+3 자동매도] 보유 종목 데이터를 찾을 수 없습니다. (응답 키: ${Object.keys(hData || {}).join(', ')})`, 'WARN');
                return;
            }

            const todayIdx = tradingDays.indexOf(today);
            const soldStocks: any[] = [];

            this.broadcastLog(`[D+3 체크] 총 ${holdings.length}개 보유 종목 분석 시작 (거래일수: ${tradingDays.length}, 오늘인덱스: ${todayIdx})`, 'INFO');

            for (const stock of holdings) {
                // UI 및 DB(main.ts/Holdings.tsx)와 완전히 동일한 코드 추출 로직 사용
                let rawCode = String(stock.pdno || stock.stk_cd || stock.code || stock.item_cd || '');
                let cleanCode = rawCode.replace(/^A/i, '').trim();

                // 만약 숫자로만 구성되어 있는데 6자리가 안 되는 경우(앞자리 0 증발) 복구
                if (cleanCode.length > 0 && cleanCode.length < 6 && /^\d+$/.test(cleanCode)) {
                    cleanCode = cleanCode.padStart(6, '0');
                }

                const stockName = stock.prdt_nm || stock.stk_nm || stock.item_nm || stock.name || cleanCode;
                const startDate = history[cleanCode];

                if (!startDate) {
                    continue; // 구매 기록 없는 종목은 조용히 skip
                }

                const startIdx = tradingDays.indexOf(startDate);
                // todayIdx와 startIdx가 둘 다 존재할 때만 계산
                const diff = (startIdx !== -1 && todayIdx !== -1) ? (todayIdx - startIdx) : -1;

                if (diff === 3) {
                    console.log(`[AutoTrade D+3] 매도 대상 포착: ${stockName}(${cleanCode}) 매수일=${startDate}, 거래일차이=${diff}`);
                    const qty = parseInt(stock.hldg_qty || stock.rmnd_qty || stock.qty || '0', 10);
                    if (qty <= 0) {
                        continue;
                    }

                    // 3. 당일 상한가 정보 확보 (검증된 공통 로직 사용)
                    const priceInfo = await this.resolveStockPriceInfo(cleanCode);
                    const orderPrice = priceInfo?.upperLimitPrice || 0;

                    if (orderPrice > 0) {
                        this.broadcastLog(`[D+3 자동매도 포착] ${stockName}: 상한가 ${orderPrice}원 매도 큐 추가`, 'INFO');

                        // 통합 주문 큐(orderQueue)에 투입 (Common Order Module 사용)
                        this.orderQueue.push({
                            type: 'SELL',
                            code: cleanCode,
                            name: stockName,
                            orderQty: qty,
                            orderPrice: orderPrice,
                            trdeType: '5', // 조건부지정가 (Python 예시 기준 '5')
                        });

                        soldStocks.push({ name: stockName, code: cleanCode, qty, price: orderPrice });
                    } else {
                        this.broadcastLog(`[D+3 자동매도] ${stockName}: 가격 정보를 가져올 수 없어 매도 실패`, 'ERROR');
                    }
                }
            }

            if (soldStocks.length > 0) {
                // 주문 세션 초기화 (매도용)
                this.buySessionStats.totalTarget += soldStocks.length;
                this.buySessionStats.pending += soldStocks.length;

                this.processOrderQueue();
            }

            if (soldStocks.length > 0) {
                eventBus.emit(SystemEvent.D3_AUTO_SELL_ORDER_SENT, {
                    count: soldStocks.length,
                    stocks: soldStocks
                });
            }

            this.broadcastLog(`[D+3 자동매도] 총 ${soldStocks.length}건 주문 완료.`, 'INFO');
        } catch (err: any) {
            this.broadcastLog(`[D+3 자동매도] 오류 발생: ${err.message}`, 'ERROR');
        }
    }


    /**
     * 수동 매수 실행 트리거 (예약 시간 지남 등의 이유)
     */
    public executeManualBuy() {
        if (!this.isRunning) {
            this.broadcastLog(`수동 매수 실행 실패. 자동매매 봇이 실행 중이지 않습니다.`, 'WARN');
            return;
        }
        if (!this.config.selectedSeq) {
            this.broadcastLog(`수동 매수 실행 실패. 조건검색식이 설정되지 않았습니다.`, 'WARN');
            return;
        }

        this.broadcastLog(`[시스템 알림] 사용자 요청으로 수동 매수 검색 호출 시작...`, 'INFO');
        this.kiwoomService.startConditionSearch(this.config.selectedSeq)
            .catch((err: any) => {
                this.broadcastLog(`[오류] 수동 매수 조건 검색 실패: ${err.message}`, 'ERROR');
            });
    }

    /**
     * 2. 조건 검색결과 수신 시 예산 분할 및 큐 투입 (Throttling 준비)
     */
    private async handleConditionMatched(stocks: any[]) {
        if (!this.isRunning || this.isLiquidationMode) return;

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

            // 전일 종가 조회 (최대 상한캡 계산용)
            let yesterdayClosePrice = 0;
            try {
                const info = await this.kiwoomService.getStockBasicInfo(cleanCode);
                const body = info?.Body || info?.out1 || info;

                // 가격 정보 복구 로직 보강
                if (isNaN(basePrice) || basePrice <= 0) {
                    const matchStr = String(body?.stk_prc || body?.currentPrice || body?.cur_prc || '').replace(/[^0-9-]/g, '');
                    if (matchStr) basePrice = Math.abs(parseInt(matchStr, 10));
                }

                // 전일 종가 조회 (prdy_clpr 등)
                const yStr = String(body?.prdy_clpr || body?.yesterdayPrice || body?.prdy_clpr_prc || '').replace(/[^0-9]/g, '');
                if (yStr) yesterdayClosePrice = parseInt(yStr, 10);
            } catch (e) {
                this.broadcastLog(`[AutoTrade] 기본정보 조회 실패 (전일종가 미상): ${stock.name}`, 'WARN');
            }

            if (isNaN(basePrice) || basePrice <= 0) {
                this.broadcastLog(`유효하지 않은 가격으로 매수 큐 제외: ${stock.name}(${cleanCode})`, 'WARN');
                continue;
            }

            // 할증 가격 계산 (+3%)
            const rawPremiumPrice = basePrice * (1 + (buyPremiumPct / 100));

            // 상한 캡 가격 계산 (+20%, 기준: 전일 종가)
            // 전일 종가를 못 구했다면 어쩔 수 없이 당일 현재가(basePrice)를 기준으로 방어
            const capBasePrice = yesterdayClosePrice > 0 ? yesterdayClosePrice : basePrice;
            const rawMaxCapPrice = capBasePrice * (1 + (maxPriceLimitPct / 100));

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
            // 새로운 매수 세션 시작
            this.buySessionStats = {
                totalTarget: this.orderQueue.length,
                pending: this.orderQueue.length,
                successCount: 0,
                successAmount: 0,
                failCount: 0
            };
            this.processOrderQueue();
        }
    }

    private processOrderQueue() {
        if (this.queueProcessorTimer) return; // 이미 돌고 있으면 패스

        this.queueProcessorTimer = setInterval(() => {
            if (this.orderQueue.length === 0 && this.buySessionStats.pending === 0) {
                // 매수 세션 종료 시 리포트 발송
                if (this.buySessionStats.totalTarget > 0) {
                    eventBus.emit(SystemEvent.AUTO_BUY_COMPLETED, {
                        success: this.buySessionStats.successCount > 0,
                        count: this.buySessionStats.successCount,
                        totalAmount: this.buySessionStats.successAmount,
                        fails: this.buySessionStats.failCount
                    });
                    this.buySessionStats.totalTarget = 0; // 초기화
                }

                if (this.queueProcessorTimer) {
                    clearInterval(this.queueProcessorTimer);
                    this.queueProcessorTimer = null;
                }
                return;
            }

            if (this.orderQueue.length === 0) return; // Wait for pending tasks

            const throttleLimitStr = String(this.config.throttleLimit || '3');
            const throttleLimit = parseInt(throttleLimitStr, 10);
            const batch = this.orderQueue.splice(0, throttleLimit);

            batch.forEach(async (order) => {
                const isBuy = order.type === 'BUY' || !order.type;
                const msgBase = `${isBuy ? '매수' : '매도'} 대기: ${order.name}(${order.code}) | Qty: ${order.orderQty} | Price: ${order.orderPrice}`;

                const accountNo = this.config.selectedAccount;
                if (!accountNo) {
                    this.broadcastLog(`계좌가 선택되지 않아 주문 실패: ${order.name}`, 'ERROR');
                    if (isBuy) this.buySessionStats.failCount++;
                    this.buySessionStats.pending--;
                    return;
                }

                try {
                    let result: any;
                    if (isBuy) {
                        result = await this.kiwoomService.sendBuyOrder(
                            accountNo,
                            order.code,
                            order.orderQty,
                            order.orderPrice
                        );
                    } else {
                        // D+3 매도 등 (조건부지정가 지원)
                        result = await this.kiwoomService.sendSellOrder(
                            accountNo,
                            order.code,
                            order.orderQty,
                            order.orderPrice,
                            order.trdeType || (order.type === 'SELL' ? '5' : '00'),
                            order.condUv || (order.type === 'SELL' ? String(order.orderPrice) : '')
                        );
                    }

                    const rspMsg = result?.msg1 || result?.message || result?.msg_cd || JSON.stringify(result?.Body || result || "OK");
                    const ordNo = result?.ord_no || result?.Body?.ord_no || '';

                    if (String(rspMsg).includes('부족') || String(rspMsg).includes('불가') || String(rspMsg).includes('초과')) {
                        throw new Error(rspMsg);
                    }

                    this.broadcastLog(`${msgBase} -> 거래소 응답: ${rspMsg} ${ordNo ? `(주문번호: ${ordNo})` : ''}`, 'SUCCESS');
                    console.log(`[AutoTrade Order Success] ${order.name}:`, result);

                    if (isBuy) {
                        this.buySessionStats.successCount++;
                        this.buySessionStats.successAmount += (order.orderPrice * order.orderQty);
                    }
                } catch (err: any) {
                    const errMsg = err?.response?.data?.msg1 || err?.response?.data?.message || err.message || err;
                    const fullError = JSON.stringify(err?.response?.data || err);

                    this.broadcastLog(`${msgBase} -> 발송 실패: ${errMsg}`, 'ERROR');
                    console.error(`[AutoTrade Order Error] ${order.name}:`, fullError);

                    if (isBuy) this.buySessionStats.failCount++;

                    eventBus.emit(SystemEvent.ORDER_FAILED, {
                        reason: String(errMsg),
                        name: order.name,
                        type: order.type || 'BUY',
                        time: new Date().toLocaleTimeString()
                    });
                } finally {
                    this.buySessionStats.pending--;
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

            // 15:20 이후 처리 로직 (일괄 시장가 매도 및 모니터링 타이머 종료 안함)
            if (currentHour > 15 || (currentHour === 15 && currentMin >= 20)) {

                // 실행 여부 체크 플래그 (중복실행 방지, 매일 초기화 필요)
                // this.lastMarketSweepDate 로 하루 1회만 동작하게 제한 필요
                const todayStr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
                const lastMarketSweepDateStr = (this as any)._lastMarketSweepDate || '';

                if (lastMarketSweepDateStr !== todayStr) {
                    this.broadcastLog(`[시스템 알림] 15:20 도달. 잔여 미체결 매도 물량 시장가 일괄 청산 진행.`, 'WARN');
                    await this.executeMarketSweep(accountNo);
                    (this as any)._lastMarketSweepDate = todayStr;
                }

                // 앱 전체 자동매매 동작 종료 제거 (시장 시간 외에도 봇은 살아있음)
                // this.setRunning(false); 
                return;
            }

            try {
                const timeSinceLastSync = Date.now() - this.lastUnexecutedSyncTime;

                // 1분에 1번만 REST API 호출하여 캐시 동기화 (또는 실시간 이벤트로 인해 강제 동기화가 필요한 경우)
                if (timeSinceLastSync > 60000) {
                    const response = await this.kiwoomService.getUnexecutedOrders(accountNo);
                    const orders = response?.oso || response?.output || response?.data || response?.Body?.out1 || [];

                    if (Array.isArray(orders)) {
                        this.activeOrders.clear();
                        for (const order of orders) {
                            if (parseInt(order.unexec_qty || order.oso_qty || order.qty || '0', 10) > 0) {
                                this.activeOrders.set(order.ord_no, order);
                            }
                        }
                        this.lastUnexecutedSyncTime = Date.now();
                        if (this.activeOrders.size > 0) {
                            console.log(`[AutoTrade] 미체결 동기화: ${this.activeOrders.size}건 감시 중`);
                        }
                    }
                }

                const orders = Array.from(this.activeOrders.values());

                // 조건부 설정 (기본값 설정)
                const condHours = parseInt(String(this.config.condSellTimeHours || '15'), 10);
                const condMins = parseInt(String(this.config.condSellTimeMinutes || '10'), 10);
                const condInterval = parseInt(String(this.config.condSellInterval || '3'), 10);

                for (const order of orders) {
                    // 매도 주문 확인
                    const isSellOrder = order.sll_buy_tp === '1' || order.trde_tp === '1' || String(order.io_tp_nm || order.sll_buy_tp || '').includes('매도');
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
                    const rawTimeStr = String(order.tm || order.time || order.ord_time || order.ord_hm || order.ord_tm || "").replace(/[^0-9]/g, '');
                    let diffSeconds = 0;
                    if (rawTimeStr.length >= 4) {
                        const ordHour = parseInt(rawTimeStr.substring(0, 2), 10);
                        const ordMin = parseInt(rawTimeStr.substring(2, 4), 10);
                        const ordSec = rawTimeStr.length >= 6 ? parseInt(rawTimeStr.substring(4, 6), 10) : 0;
                        diffSeconds = (currentHour * 3600 + currentMin * 60 + currentSec) - (ordHour * 3600 + ordMin * 60 + ordSec);
                    }



                    // 큐 삽입 헬퍼
                    const enqueueModify = (typeStr: string, tStep?: number) => {
                        if (!this.modifyQueue.find(q => q.orig_ord_no === orig_ord_no)) {
                            this.modifyQueue.push({
                                type: typeStr,
                                accountNo,
                                orig_ord_no,
                                stk_cd,
                                qty: tStep ? Math.floor(totalQty / (4 - tStep)) || 1 : totalQty, // 1단계: 1/3, 2단계: 1/2, 3단계: 전체
                                modifyType: '00', // 지정가(현재가)
                                step: tStep,
                                curPrc: Math.abs(parseInt(String(order.cur_prc || order.price || '0').replace(/[^0-9-]/g, ''), 10))
                            });
                        }
                    };

                    // --- [로직 A] 조건부지정가 (05) 분할 청산 로직 ---
                    if (trdeType === '05' || trdeType.includes('조건부')) {
                        // [신규 로직] 매도정정이 진행된 물량(원주문번호 보유)이면서 15시 이후인 경우 10초 쿨타임 무한 추적
                        const isModifiedOrder = order.orig_ord_no && String(order.orig_ord_no).trim() !== '' && String(order.orig_ord_no).trim() !== '0000000';

                        if (isModifiedOrder && currentHour >= 15 && diffSeconds >= 10) {
                            enqueueModify('CONDITIONAL_CHASING');
                            continue; // 아래 분할 스케줄 로직은 건너뜀
                        }

                        // [기존 로직] 신규 매도 물량인 경우 설정시간에 맞춘 3분할 스케줄 정정
                        const currentTotalMinutes = currentHour * 60 + currentMin;
                        const condStartTotalMinutes = condHours * 60 + condMins;

                        if (currentTotalMinutes >= condStartTotalMinutes) {
                            const passedIntervals = Math.floor((currentTotalMinutes - condStartTotalMinutes) / condInterval);
                            const currentTargetStep = Math.min(3, passedIntervals + 1); // 1, 2, 3단계

                            const recordedStep = this.condSellStepMap.get(orig_ord_no) || 0;

                            // 단계가 진행되어 아직 처리를 안한 스텝일 경우
                            if (currentTargetStep > recordedStep) {
                                enqueueModify('CONDITIONAL', currentTargetStep);
                                this.condSellStepMap.set(orig_ord_no, currentTargetStep);
                            }
                        }
                    }
                    // --- [로직 B] 일반 지정가 (00) 매도 타이머 기반 단축 청산 로직 ---
                    else {
                        // 15시 기준 쿨타임 변경 (15시 이전: 60초, 15시 이후: 10초)
                        const requireSeconds = currentHour >= 15 ? 10 : 60;

                        if (diffSeconds >= requireSeconds) {
                            enqueueModify('NORMAL');
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
            const orders = response?.oso || response?.output || response?.data || response?.Body?.out1 || [];
            if (!Array.isArray(orders)) return;

            for (const order of orders) {
                const isSellOrder = order.sll_buy_tp === '1' || order.trde_tp === '1' || String(order.io_tp_nm || order.sll_buy_tp || '').includes('매도');
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
                const { type, accountNo, orig_ord_no, stk_cd, qty, step, curPrc } = task;

                // 현재가 조회 - 이미 API가 주면 그걸 먼저 씀
                let currentPrice = curPrc || 0;

                if (!currentPrice || isNaN(currentPrice)) {
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
                        } else if (type === 'CONDITIONAL_CHASING') {
                            this.broadcastLog(`조건부 추적 현재가 정정: ${stk_cd} -> ${currentPrice}원 정정 (${rspMsg})`, 'SUCCESS');
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

    private async handleEmergencyLiquidationStarted() {
        if (!this.isRunning || this.isLiquidationMode) return;

        this.broadcastLog(`[시스템 자동 알림] 비상 청산 모드 돌입. 신규 매수 전면 차단.`, 'WARN');
        this.isLiquidationMode = true;

        const accountNo = this.config.selectedAccount;
        if (!accountNo) {
            this.broadcastLog(`[오류] 선택된 계좌가 없어 청산을 진행할 수 없습니다.`, 'ERROR');
            return;
        }

        try {
            // [Step 1] 기존 미체결 주문 최우선 일괄 취소
            this.broadcastLog(`[비상청산 Step 1] 계좌의 모든 미체결 주문 취소 전송 시작.`, 'INFO');
            try {
                const unexecRes = await this.kiwoomService.getUnexecutedOrders(accountNo);
                const unexecutedOrders = unexecRes?.oso || unexecRes?.output || unexecRes?.data || unexecRes?.Body?.out1 || [];

                if (Array.isArray(unexecutedOrders) && unexecutedOrders.length > 0) {
                    let cancelCount = 0;
                    for (const order of unexecutedOrders) {
                        const totalQty = parseInt(order.unexec_qty || order.oso_qty || order.qty || '0', 10);
                        if (totalQty > 0 && order.ord_no) {
                            let stk_cd = String(order.stk_cd).replace(/^A/i, '').trim();
                            if (stk_cd.length > 0 && stk_cd.length < 6 && /^\d+$/.test(stk_cd)) stk_cd = stk_cd.padStart(6, '0');

                            try {
                                await this.kiwoomService.cancelOrder(accountNo, order.ord_no, stk_cd, totalQty);
                                cancelCount++;
                                await new Promise(res => setTimeout(res, 1000)); // 스로틀링
                            } catch (cancelErr: any) {
                                const errMsg = cancelErr?.response?.data?.msg1 || cancelErr?.message || cancelErr;
                                this.broadcastLog(`[취소실패] ${stk_cd}(${order.ord_no}): ${errMsg}`, 'WARN');
                            }
                        }
                    }
                    if (cancelCount > 0) {
                        this.broadcastLog(`총 ${cancelCount}건의 미체결 주문 취소 전송 완료. 거래소 반영 대기(3초)...`, 'INFO');
                        await new Promise(res => setTimeout(res, 3000));
                    }
                }
            } catch (err: any) {
                this.broadcastLog(`미체결 주문 조회 실패로 취소 과정 생략: ${err.message}`, 'WARN');
            }

            // [Step 2] 잔고 조회 및 전단 매도 전송
            const holdingsRes = await this.kiwoomService.getHoldings(accountNo);
            const hData = holdingsRes?.data || holdingsRes;
            const hBody = hData?.Body || hData?.body || hData?.output1 || hData;

            let listData = [];
            if (Array.isArray(hBody)) {
                listData = hBody;
            } else {
                listData = hBody?.acnt_evlt_remn_indv_tot || hBody?.output1 || hBody?.list || hBody?.grid || [];
            }
            const holdings = Array.isArray(listData) ? listData : [listData].filter(Boolean);

            if (holdings.length === 0) {
                this.broadcastLog(`보유 종목이 없어 청산을 종료합니다.`, 'INFO');
                this.setRunning(false);
                eventBus.emit(SystemEvent.EMERGENCY_LIQUIDATION_COMPLETED);
                return;
            }

            // 전량 시장가 통보 (현재 키움 API가 지정가(00)만 지원한다면 0원으로 03이 되지 않으니, 현재가로 00 주문 생성 필요)
            this.broadcastLog(`총 ${holdings.length}개 잔고 종목 청산 매도 전송 시작.`, 'WARN');
            for (const stock of holdings) {
                const qty = parseInt(stock.hld_qty || stock.hldg_qty || stock.rmnd_qty || stock.qty || '0', 10);
                if (qty <= 0) continue;

                let stk_cd = String(stock.pdno || stock.stk_cd || stock.item_cd).replace(/^A/i, '').trim();
                let currentPrice = Math.abs(parseInt(String(stock.prpr || stock.cur_prc || stock.price || '0').replace(/[^0-9-]/g, ''), 10));

                if (!currentPrice || currentPrice <= 0) {
                    try {
                        const priceInfo = await this.kiwoomService.getCurrentPrice(stk_cd);
                        let rawStr = '';
                        if (priceInfo?.currentPrice) rawStr = priceInfo.currentPrice;
                        else if (priceInfo?.Body?.currentPrice) rawStr = priceInfo.Body.currentPrice;
                        else if (priceInfo?.Body?.out1?.currentPrice) rawStr = priceInfo.Body.out1.currentPrice;

                        const matchStr = String(rawStr).replace(/[^0-9]/g, '');
                        if (matchStr) currentPrice = parseInt(matchStr, 10);
                    } catch (e) {
                        currentPrice = 0; // fallback 도 실패시
                    }
                }

                if (currentPrice > 0) {
                    currentPrice = this.normalizePrice(currentPrice); // 호가 맞춤
                    try {
                        await this.kiwoomService.sendSellOrder(accountNo, stk_cd, qty, currentPrice);
                        this.broadcastLog(`일괄청산 [${stk_cd}] ${stock.prdt_name || stock.prdt_nm || stk_cd} - ${qty}주 현재가(${currentPrice}원) 매도 전송`, 'INFO');
                    } catch (err: any) {
                        const errMsg = err?.response?.data?.msg1 || err?.message || err;
                        this.broadcastLog(`일괄청산 전송 실패 [${stk_cd}]: ${errMsg}`, 'ERROR');
                    }
                } else {
                    this.broadcastLog(`[${stk_cd}] 현재가를 가져올 수 없어 매도 전송 실패.`, 'ERROR');
                }

                // 스로틀링 1초 대기 (키움 API)
                await new Promise(res => setTimeout(res, 1000));
            }

            // [Step 3] 모든 매도 전송이 끝남. 이제 남은 미체결 잔량들이 모두 0이 되고, 보유 수량이 0이 되는 것을 감시.
            this.broadcastLog(`청산 매도 명령 전송 완료. 잔여 미체결 및 잔고 추적 모니터링 시작...`, 'INFO');

            if (this.liquidationMonitorTimer) clearInterval(this.liquidationMonitorTimer);
            this.liquidationMonitorTimer = setInterval(async () => {
                if (!this.isRunning || !this.isLiquidationMode) return;

                // 1. 미체결 주문이 남아있는지 확인
                const response = await this.kiwoomService.getUnexecutedOrders(accountNo);
                const unexecutedOrders = response?.oso || response?.output || response?.data || response?.Body?.out1 || [];
                const hasUnexecutedSellOrders = Array.isArray(unexecutedOrders) && unexecutedOrders.some((order: any) => {
                    const isSell = order.sll_buy_tp === '1' || order.trde_tp === '1' || String(order.io_tp_nm || order.sll_buy_tp || '').includes('매도');
                    const totalQty = parseInt(order.unexec_qty || order.oso_qty || order.qty || '0', 10);
                    return isSell && totalQty > 0;
                });

                if (hasUnexecutedSellOrders) {
                    return; // 아직 미체결 매도가 남아있으면 modifyMonitor가 처리해주도록 기다림
                }

                // 2. 보유 종목이 남아있는지 최종 확인 (파싱 강화)
                const holdRes = await this.kiwoomService.getHoldings(accountNo);
                const hdData = holdRes?.data || holdRes;
                const hdBody = hdData?.Body || hdData?.body || hdData?.output1 || hdData;

                let hdList = [];
                if (Array.isArray(hdBody)) {
                    hdList = hdBody;
                } else {
                    hdList = hdBody?.acnt_evlt_remn_indv_tot || hdBody?.output1 || hdBody?.list || hdBody?.grid || [];
                }
                const currentHoldings = Array.isArray(hdList) ? hdList : [hdList].filter(Boolean);

                const remainItems = currentHoldings.filter((h: any) => parseInt(h.hld_qty || h.hldg_qty || h.rmnd_qty || h.qty || '0', 10) > 0);

                if (remainItems.length === 0) {
                    // 완벽한 청산
                    this.broadcastLog(`⭐ 모든 종목 청산 및 체결 확인. 시스템 자동 종료 수행.`, 'SUCCESS');
                    if (this.liquidationMonitorTimer) clearInterval(this.liquidationMonitorTimer);
                    this.setRunning(false);
                    eventBus.emit(SystemEvent.EMERGENCY_LIQUIDATION_COMPLETED);
                } else {
                    // 매도가 늦어 아직 반영안됐을수 있으니 다음 사이클에 조회 (또는 단주 등 기타 이유, 무한루프를 막는 방어 추가 필요)
                }

            }, 10000); // 10초마다 완벽 청산 여부 확인

        } catch (e: any) {
            this.broadcastLog(`일괄 청산 중 치명적 오류 발생: ${e.message}`, 'ERROR');
        }
    }
}
