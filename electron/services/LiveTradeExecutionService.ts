import { KiwoomService } from './KiwoomService';
import { LiveTradeLedgerService, LiveTradeTicket } from './LiveTradeLedgerService';
import { DatabaseService } from './DatabaseService';
import { calculateOrderPrice } from '../utils/tickSize';
import { TelegramService } from './TelegramService';
import { eventBus, SystemEvent } from '../utils/EventBus';
import { getKstDate } from '../utils/DateUtils';

import Store from 'electron-store';

const store = new Store();

export class LiveTradeExecutionService {
    private static instance: LiveTradeExecutionService;
    private kiwoom = KiwoomService.getInstance();
    private ledger = LiveTradeLedgerService.getInstance();
    private telegram = TelegramService.getInstance();

    private accountNo: string = '';

    // ─── 이중 주문 방지 Lock 세트 ───────────────────────────────────────────────
    // 매수: 종목코드를 키로 사용 (동일 종목 동시 매수 방지)
    private buyingInProgress = new Set<string>();
    // 매도: ticket_id를 키로 사용 (동일 티켓 이중 매도 방지)
    private sellingInProgress = new Set<string>();
    // 매도: ticket_id별 최종 매도 시도 시각 (매도 실패 후 연속 재시도 방지 쿨다운)
    private lastSellAttemptTime = new Map<string, number>();

    // ─── 익절 모니터 실행 Lock (크론 중복 방지) ─────────────────────────────────
    // ─── 익절 모니터 실행 Lock (크론 중복 방지) ─────────────────────────────────
    private isTakeProfitRunning = false;

    // ─── 미체결 매도 추적 타이머 ───────────────────────────────────────────────
    private unexecutedChasingTimer: NodeJS.Timeout | null = null;
    private isChasingRunning = false;
    private chaseIntervalMs: number = 5 * 60 * 1000; // 기본 5분

    // ─── 인메모리 캐시 ────────────────────────────────────────────────────────
    private cachedActiveTickets: LiveTradeTicket[] = [];
    private lastCacheTime: number = 0;

    // 포트폴리오 일괄 매도용 캐시
    private latestPrices: Record<string, number> = {};
    private cachedPortfolioConfig = {
        active: false,
        targetRate: 3.0,
        lastUpdated: 0
    };
    private cohortPeaksCache: Record<string, { peak: number; time: string }> | null = null;
    private firstTradingDayCache: Record<string, boolean> = {}; // { "todayStr_entryDateStr": boolean }
    private timeseriesBuckets: Record<string, { currentSlot: string, high: number, low: number, close: number }> = {};

    private constructor() {
        eventBus.on(SystemEvent.PRICE_UPDATE, this.onPriceUpdate.bind(this));
    }

    private emitError(source: string, message: string, detail?: string) {
        eventBus.emit(SystemEvent.LIVE_TRADE_ERROR, {
            time: new Date().toLocaleString('ko-KR', { hour12: false }),
            source,
            message,
            detail: detail || ''
        });
        this.logEvent('ERROR', '', `[${source}] ${message} ${detail || ''}`);
    }

    // ─── DB 로깅 헬퍼 ────────────────────────────────────────────────
    public logEvent(
        type: 'BUY' | 'BUY_SEND' | 'BUY_ACK' | 'BUY_REJECT' | 'SELL' | 'RECON' | 'ERROR' | 'INFO',
        stockCode: string,
        message: string,
        opts: { order_no?: string; rsp_cd?: string; api_response?: string } = {}
    ) {
        try {
            const rawDb = (DatabaseService.getInstance() as any).db;
            rawDb.prepare(`
                INSERT INTO live_trade_logs (timestamp, type, stock_code, message, order_no, rsp_cd, api_response)
                VALUES (datetime('now', 'localtime'), ?, ?, ?, ?, ?, ?)
            `).run(
                type,
                stockCode || '',
                message,
                opts.order_no  || '',
                opts.rsp_cd    || '',
                opts.api_response ? opts.api_response.substring(0, 512) : '' // 512자 제한
            );
        } catch (e: any) {
            console.error('[LiveTrade] DB Log Insert Error:', e.message);
        }
    }

    public static getInstance(): LiveTradeExecutionService {
        if (!LiveTradeExecutionService.instance) {
            LiveTradeExecutionService.instance = new LiveTradeExecutionService();
        }
        return LiveTradeExecutionService.instance;
    }

    public setAccountNo(accountNo: string) {
        this.accountNo = accountNo;
    }

    private getAccountNo(): string {
        if (this.accountNo) return this.accountNo;
        try {
            const settings = store.get('settings') as any;
            if (settings && settings.selectedAccount) {
                this.accountNo = settings.selectedAccount;
                return this.accountNo;
            }
            const autoSettings = store.get('autotrade_settings') as any;
            if (autoSettings && autoSettings.selectedAccount) {
                this.accountNo = autoSettings.selectedAccount;
                return this.accountNo;
            }
        } catch (e) {
            // Ignore
        }
        return '';
    }

    /**
     * Kill-Switch 확인 — electron-store의 'live_trade_kill_switch' 플래그 체크
     * UI에서 긴급 중단 시 true로 설정. 모든 주문 함수에서 호출.
     */
    private isKillSwitchActive(): boolean {
        try {
            const flag = store.get('live_trade_kill_switch') as boolean;
            return flag === true;
        } catch {
            return false;
        }
    }

    /**
     * getHoldings 응답에서 종목 리스트를 안전하게 파싱
     * AutoTradeService와 동일한 방어적 파싱 로직 사용
     */
    private parseHoldingsList(holdingsRes: any): any[] {
        const hData = holdingsRes?.data || holdingsRes;
        const hBody = hData?.Body || hData?.body || hData?.output1 || hData;

        let listData: any[] = [];
        if (Array.isArray(hBody)) {
            listData = hBody;
        } else {
            listData = hBody?.acnt_evlt_remn_indv_tot || hBody?.output1 || hBody?.list || hBody?.grid || [];
        }
        return Array.isArray(listData) ? listData : [];
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  매수 파이프라인
    // ───────────────────────────────────────────────────────────────────────────

    /**
     * 조건부 지정가 매수 (현재가 + 1틱) 실행 파이프라인
     */
    public async executeBuy(stockCode: string, stockName: string, strategyCategory: string, currentPrice: number, targetExitDate: string, aiScore?: number, relatedThemes?: string): Promise<void> {
        // [Guard 1] Kill-Switch
        if (this.isKillSwitchActive()) {
            console.warn(`[LiveTrade] Kill-Switch 활성화 상태. 매수 차단: ${stockName}`);
            this.logEvent('INFO', stockCode, `Kill-Switch 활성. 매수 차단: ${stockName}`);
            this.telegram.sendMessage(`🚫 **[Kill-Switch 활성]** 긴급 중단 상태로 매수가 차단되었습니다.\n- 종목: ${stockName}`);
            return;
        }

        // [Guard 1.5] 회로 차단기(Circuit Breaker) 상태 체크
        if (this.kiwoom.isCircuitBroken()) {
            console.warn(`[LiveTrade] 회로 차단기(Circuit Breaker) 활성화 상태. 매수 보류: ${stockName}`);
            return;
        }

        // [Guard 2] 이중 매수 방지 — 동일 종목+동일 전략이 이미 매수 진행 중이면 Skip
        const lockKey = `${stockCode}_${strategyCategory}`;
        if (this.buyingInProgress.has(lockKey)) {
            console.warn(`[LiveTrade] 이중 매수 방지: ${stockName}(${stockCode}) - ${strategyCategory} 이미 매수 처리 중`);
            this.logEvent('INFO', stockCode, `이중 매수 방지 (Lock): ${stockName}(${strategyCategory}) 이미 처리 중`);
            return;
        }

        // [Guard 2.5] DB 티켓 중복 검사 — 오늘 동일 전략에서 이미 매수 시도/성공한 티켓이 있는지 확인
        const todayKst = getKstDate();
        const rawDb = (DatabaseService.getInstance() as any).db;
        const existingTicket = rawDb.prepare(`
            SELECT ticket_id FROM live_trade_tickets 
            WHERE stock_code = ? AND entry_date = ? AND strategy_category = ?
        `).get(stockCode, todayKst, strategyCategory);

        if (existingTicket) {
            console.warn(`[LiveTrade] 이중 매수 방지(DB): ${stockName}(${stockCode}) - ${strategyCategory} 오늘 이미 발급된 티켓 존재`);
            this.logEvent('INFO', stockCode, `이중 매수 방지 (DB): 오늘 동일 전략 발급된 티켓 존재`);
            return;
        }

        this.buyingInProgress.add(lockKey);

        const account = this.getAccountNo();
        if (!account) {
            console.error('[LiveTrade] Account number not set.');
            this.buyingInProgress.delete(lockKey);
            return;
        }

        const strategies = this.ledger.getActiveStrategies();
        const strategy = strategies.find(s => s.strategy_category === strategyCategory);

        if (!strategy) {
            console.warn(`[LiveTrade] Strategy ${strategyCategory} is not active. Skip buy.`);
            this.buyingInProgress.delete(lockKey);
            return;
        }

        // 상한가(Upper Limit) 조회 로직 추가 (2차 시도 재시도 및 안전망 보완)
        let upperLimit = 0;
        let priceInfo: any = null;
        try {
            priceInfo = await this.kiwoom.getStockBasicInfo(stockCode);
        } catch (e: any) {
            console.warn(`[LiveTrade] 상한가 조회 1차 실패 (${stockCode}):`, e.message);
            try {
                await new Promise(r => setTimeout(r, 500));
                priceInfo = await this.kiwoom.getStockBasicInfo(stockCode);
            } catch (e2: any) {
                console.warn(`[LiveTrade] 상한가 조회 2차 재시도 실패 (${stockCode}):`, e2.message);
            }
        }

        if (priceInfo) {
            try {
                const body = priceInfo?.Body || priceInfo?.out1 || priceInfo?.body || priceInfo?.output || priceInfo || {};
                let rawUpl = String(body.upl_pric || body.upl || body.up_lmt_prc || body.upperLimitPrice || body.mxpr || body.mx_prc || body.stck_mxpr || 0).replace(/[^0-9-]/g, '');
                upperLimit = Math.abs(parseInt(rawUpl, 10)) || 0;
                
                if (upperLimit <= 0) {
                    const yStr = String(body.base_pric || body.prdy_clpr || body.lst_pric || body.yesterdayPrice || body.lastPrice || '').replace(/[^0-9]/g, '');
                    const yesterdayPrice = parseInt(yStr, 10) || 0;
                    if (yesterdayPrice > 0) {
                        const calculatedUpper = yesterdayPrice * 1.30;
                        const { getTickSize: getTick } = await import('../utils/tickSize');
                        const tick = getTick(calculatedUpper);
                        upperLimit = Math.floor(calculatedUpper / tick) * tick;
                        console.log(`[LiveTrade] 상한가 조회 불가로 전일종가(${yesterdayPrice}) 기준 수동 계산 적용: ${upperLimit}`);
                    }
                }
            } catch (e: any) {
                console.warn(`[LiveTrade] 상한가 파싱 중 예외 발생 (${stockCode}):`, e.message);
            }
        }

        if (upperLimit <= 0) {
            upperLimit = currentPrice;
            console.log(`[LiveTrade] 상한가 획득 실패로 현재가(${currentPrice})를 임시 상한가 안전선으로 설정합니다.`);
        }

        // ─── 1. 주문 시점 기반 동적 주문 유형 결정 (Option B) ───────────────────
        // KST 현재 시각을 HHMM 정수로 비교 (예: 15:21 → 1521)
        const nowKst = new Date();
        // getKstDate() 는 날짜만 반환 → 시/분은 직접 계산 (KST = UTC+9)
        const kstHour   = (nowKst.getUTCHours() + 9) % 24;
        const kstMinute = nowKst.getUTCMinutes();
        const kstHHMM   = kstHour * 100 + kstMinute;

        const isAfterSimultaneousAuction = kstHHMM >= 1520; // 15:20 동시호가 돌입 기준

        let trdeType: string;
        let orderPrice: number;
        let orderTypeLabel: string;

        if (isAfterSimultaneousAuction) {
            // 15:20 이후: 지정가(00), 현재가 × 1.03 (상한가 방향, 호가 단위 올림)
            trdeType = '00';
            const rawPrice = Math.round(currentPrice * 1.03);
            // 호가 단위 올림: calculateOrderPrice의 내부 tick 로직 활용
            // rawPrice를 tick 단위로 정렬: rawPrice - (rawPrice % tickSize) + tickSize
            const { getTickSize: getTick } = await import('../utils/tickSize');
            const tick = getTick(rawPrice);
            orderPrice = rawPrice % tick === 0 ? rawPrice : rawPrice + (tick - (rawPrice % tick));
            
            if (upperLimit > 0 && orderPrice > upperLimit) {
                console.log(`[LiveTrade] 주문가(${orderPrice})가 상한가(${upperLimit})를 초과하여 상한가로 하향 보정합니다.`);
                orderPrice = upperLimit;
                orderTypeLabel = `지정가(상한가 보정) ${orderPrice.toLocaleString()}원`;
            } else {
                orderTypeLabel = `지정가(동시호가 +3%) ${orderPrice.toLocaleString()}원`;
            }
        } else {
            // 15:20 이전: 조건부 지정가(05), 현재가 + 1틱
            trdeType = '05';
            orderPrice = calculateOrderPrice(currentPrice, 1);
            
            if (upperLimit > 0 && orderPrice > upperLimit) {
                console.log(`[LiveTrade] 주문가(${orderPrice})가 상한가(${upperLimit})를 초과하여 상한가로 하향 보정합니다.`);
                orderPrice = upperLimit;
                orderTypeLabel = `조건부 지정가(상한가 보정) ${orderPrice.toLocaleString()}원`;
            } else {
                orderTypeLabel = `조건부 지정가 ${orderPrice.toLocaleString()}원 (+1틱)`;
            }
        }

        // 2. 수량 계산
        const quantity = Math.floor(strategy.buy_amount_per_trade / orderPrice);

        if (quantity <= 0) {
            console.warn(`[LiveTrade] Calculated quantity is 0 for ${stockName}. Skip buy.`);
            this.logEvent('ERROR', stockCode, `수량 계산 0. 매수금액(${strategy.buy_amount_per_trade.toLocaleString()}) < 주가(${currentPrice.toLocaleString()})`);
            this.ledger.createTicket({
                stock_code: stockCode,
                stock_name: stockName,
                entry_date: getKstDate(),
                entry_price: orderPrice,
                quantity: 0,
                strategy_category: strategyCategory,
                target_exit_date: targetExitDate,
                status: 'FAILED',
                fail_reason: `1회 매수금액(${strategy.buy_amount_per_trade.toLocaleString()}원)보다 주가(${currentPrice.toLocaleString()}원)가 높음`,
                ai_score: aiScore,
                related_themes: relatedThemes
            });
            this.telegram.sendMessage(`🚨 **[실전 자동매수 실패]**\n- 종목: ${stockName}\n- 사유: 매수금액 부족`);
            this.buyingInProgress.delete(stockCode);
            return;
        }

        // 3. 주문 전송 직전 로그 (BUY_SEND)
        this.logEvent(
            'BUY_SEND',
            stockCode,
            `매수 주문 전송 시작 | ${orderTypeLabel} × ${quantity}주 | 전략: ${strategyCategory} | 시각: ${kstHour.toString().padStart(2,'0')}:${kstMinute.toString().padStart(2,'0')}`
        );
        console.log(`[LiveTrade] Sending BUY order for ${stockName} (${stockCode}): ${quantity} shares @ ${orderPrice} trde_tp=${trdeType}`);

        try {
            // 4. 키움 API 매수 주문 전송
            const apiResult = await this.kiwoom.sendBuyOrder(
                account,
                stockCode,
                quantity,
                orderPrice,
                trdeType
            );

            // 5. API 응답 파싱 (return_code & return_msg 체크)
            const ordNo   = String(apiResult?.ord_no  || apiResult?.odno     || apiResult?.order_no || '');
            const rspCd   = apiResult?.return_code !== undefined ? String(apiResult.return_code) : String(apiResult?.rsp_cd || apiResult?.rsp_msg1 || '');
            const rspMsg  = apiResult?.return_msg !== undefined ? String(apiResult.return_msg) : String(apiResult?.rsp_msg || apiResult?.msg || apiResult?.msg1 || '');
            const isSuccess = apiResult && (apiResult.return_code === 0 || apiResult.return_code === '0');
            const apiResponseStr = JSON.stringify(apiResult || {}).substring(0, 512);

            if (isSuccess) {
                // 6. 접수 성공: 티켓 생성 → order_no 연결
                const ticketId = this.ledger.createTicket({
                    stock_code: stockCode,
                    stock_name: stockName,
                    entry_date: getKstDate(),
                    entry_price: orderPrice,
                    quantity: quantity,
                    strategy_category: strategyCategory,
                    target_exit_date: targetExitDate,
                    status: 'ACTIVE',
                    order_no: ordNo,
                    ai_score: aiScore,
                    related_themes: relatedThemes
                });

                // 티켓에 order_no 별도 업데이트 (createTicket 반환 ticketId 활용)
                if (ordNo) {
                    this.ledger.updateOrderNo(ticketId, ordNo);
                }

                this.logEvent(
                    'BUY_ACK',
                    stockCode,
                    `키움 접수 성공 | ord_no: ${ordNo || '(없음)'} | rsp_cd: ${rspCd} | msg: ${rspMsg || '정상처리'}`,
                    { order_no: ordNo, rsp_cd: rspCd, api_response: apiResponseStr }
                );
                this.telegram.sendMessage(
                    `📈 **[실전 자동매수 발동]**\n` +
                    `- 종목: ${stockName}\n` +
                    `- 주문유형: ${isAfterSimultaneousAuction ? '지정가(동시호가 +3%)' : '조건부 지정가(+1틱)'}\n` +
                    `- 가격: ${orderPrice.toLocaleString()}원\n` +
                    `- 수량: ${quantity}주\n` +
                    `- 전략: ${strategyCategory}\n` +
                    `- 주문번호: ${ordNo || '(미수신)'}\n` +
                    `- 매도목표일: ${targetExitDate}`
                );
            } else {
                // 7. 접수 거부: FAILED 티켓 생성
                this.ledger.createTicket({
                    stock_code: stockCode,
                    stock_name: stockName,
                    entry_date: getKstDate(),
                    entry_price: orderPrice,
                    quantity: quantity,
                    strategy_category: strategyCategory,
                    target_exit_date: targetExitDate,
                    status: 'FAILED',
                    fail_reason: `키움 접수 거부: rsp_cd=${rspCd}, msg=${rspMsg}`,
                    ai_score: aiScore,
                    related_themes: relatedThemes
                });
                this.logEvent(
                    'BUY_REJECT',
                    stockCode,
                    `키움 접수 거부 | rsp_cd: ${rspCd} | msg: ${rspMsg}`,
                    { order_no: '', rsp_cd: rspCd, api_response: apiResponseStr }
                );
                this.emitError('매수 주문', `${stockName}(${stockCode}) 매수 접수 거부`, `rsp_cd=${rspCd}, msg=${rspMsg}`);
                this.telegram.sendMessage(
                    `🚨 **[실전 자동매수 거부]**\n` +
                    `- 종목: ${stockName}\n` +
                    `- 오류코드: ${rspCd}\n` +
                    `- 메시지: ${rspMsg}`
                );
            }
        } catch (error: any) {
            console.error(`[LiveTrade] Failed to execute buy for ${stockName}:`, error);
            const errDetail = error?.response?.data ? JSON.stringify(error.response.data) : error.message;
            this.emitError('매수 주문', `${stockName}(${stockCode}) 매수 주문 실패`, errDetail);
            this.ledger.createTicket({
                stock_code: stockCode,
                stock_name: stockName,
                entry_date: getKstDate(),
                entry_price: orderPrice,
                quantity: quantity,
                strategy_category: strategyCategory,
                target_exit_date: targetExitDate,
                status: 'FAILED',
                fail_reason: `주문 전송 오류: ${error.message}`,
                ai_score: aiScore,
                related_themes: relatedThemes
            });
            this.logEvent(
                'ERROR',
                stockCode,
                `매수 주문 HTTP 예외: ${error.message}`,
                { api_response: errDetail.substring(0, 512) }
            );
            this.telegram.sendMessage(`🚨 **[실전 자동매수 실패]**\n- 종목: ${stockName}\n- 에러: ${error.message}`);
        } finally {
            // Lock 해제 — 성공/실패 모두 해제
            this.buyingInProgress.delete(lockKey);
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  매도 파이프라인
    // ───────────────────────────────────────────────────────────────────────────

    /**
     * 매도 주문 실행 공통 헬퍼 — 실제 잔고 확인 후 안전하게 매도 수량 결정
     * C-1: 이중 매도 방지 Lock (ticket_id 기반)
     * I-2: 실제 잔고 < 티켓 수량일 경우 가용 잔고 전체 매도
     */
    private cachedHoldings: any[] | null = null;
    private lastHoldingsCacheTime: number = 0;

    private async getCachedHoldings(account: string) {
        const now = Date.now();
        if (this.cachedHoldings && now - this.lastHoldingsCacheTime < 5000) {
            return this.cachedHoldings;
        }

        const holdingsRes = await this.kiwoom.getHoldings(account);
        const data = holdingsRes?.data || holdingsRes;
        
        // 에러 코드 체크 (빈도 초과 등)
        if (data?.rt_cd !== '0' && data?.rt_cd !== 0 && data?.msg_cd) {
            if (data?.msg1) {
                throw new Error(`[잔고 조회 실패] ${data.msg1}`);
            }
        }

        const parsed = this.parseHoldingsList(holdingsRes);
        
        // 정상 응답인데 배열이 0개라면 (정상적인 계좌 비움일 수 있음)
        // 하지만 에러 메시지가 동반된 경우 방어
        if (parsed.length === 0 && data?.msg1 && data.msg1.includes('오류')) {
             throw new Error(`[잔고 조회 오류] ${data.msg1}`);
        }

        this.cachedHoldings = parsed;
        this.lastHoldingsCacheTime = now;
        return this.cachedHoldings;
    }

    private async _executeSell(
        ticket: LiveTradeTicket,
        trdeType: '00' | '05' | '03',
        sellReason: string,
        account: string
    ): Promise<void> {
        // [Guard 1] Kill-Switch
        if (this.isKillSwitchActive()) {
            console.warn(`[LiveTrade] Kill-Switch 활성화 상태. 매도 차단: ${ticket.stock_code}`);
            this.logEvent('INFO', ticket.stock_code, `Kill-Switch 활성. 매도 차단: ${sellReason}`);
            this.telegram.sendMessage(`🚫 **[Kill-Switch 활성]** 긴급 중단 상태로 매도가 차단되었습니다.\n- 종목: ${ticket.stock_name || ticket.stock_code}`);
            return;
        }

        // [Guard 1.3] 매도 주문 쿨다운 적용 (동일 티켓의 무분별한 연속 매도 실패/재시도 스팸 방지)
        const lastAttempt = this.lastSellAttemptTime.get(ticket.ticket_id) || 0;
        const cooldownMs = 15000; // 15초 쿨다운
        if (Date.now() - lastAttempt < cooldownMs) {
            console.log(`[LiveTrade] 매도 주문 쿨다운 적용 중 (${ticket.stock_code}, 남은 시간: ${Math.ceil((cooldownMs - (Date.now() - lastAttempt)) / 1000)}초)`);
            return;
        }

        // [Guard 1.7] 회로 차단기(Circuit Breaker) 상태 체크
        if (this.kiwoom.isCircuitBroken()) {
            console.warn(`[LiveTrade] 회로 차단기(Circuit Breaker) 활성화 상태. 매도 주문 보류: ${ticket.stock_name || ticket.stock_code}`);
            return;
        }

        // [Guard 2] 이중 매도 방지 — ticket_id가 이미 Lock된 경우 Skip
        if (this.sellingInProgress.has(ticket.ticket_id)) {
            console.warn(`[LiveTrade] 이중 매도 방지: ${ticket.stock_code} (ticket: ${ticket.ticket_id}) 이미 매도 처리 중`);
            this.logEvent('INFO', ticket.stock_code, `이중 매도 방지 (Lock): 이미 처리 중 (${ticket.ticket_id})`);
            return;
        }

        // [Guard 2.5] DB 상태 이중 체크 (Stale Cache로 인한 중복 호출 및 Race Condition 방지)
        const currentStatus = this.ledger.getTicketStatus(ticket.ticket_id);
        if (currentStatus !== 'ACTIVE') {
            console.warn(`[LiveTrade] 매도 중단: ${ticket.stock_code} DB 상태가 ACTIVE가 아님 (현재: ${currentStatus})`);
            return;
        }

        this.sellingInProgress.add(ticket.ticket_id);
        this.lastSellAttemptTime.set(ticket.ticket_id, Date.now());

        // [Step 1] 매도 주문 전송 직전 — 티켓 상태를 즉시 SELLING으로 변경
        // DB 반영 먼저 → API 호출 순서로 이중 호출 방지
        this.ledger.markTicketSelling(ticket.ticket_id);
        this.lastCacheTime = 0; // 즉시 캐시 무효화 (stale cache로 인한 웹소켓 다중 호출 방지)

        try {
            // [Step 2] 실제 HTS 잔고 조회 → 가용 수량 결정 (I-2: 수량 불일치 안전장치)
            const holdings = await this.getCachedHoldings(account);

            const holding = holdings.find((h: any) => {
                const sc = (h.stk_cd || h.pdno || h.iscd || '').trim().replace(/^A/, '');
                return sc === ticket.stock_code;
            });

            const htsQty = holding
                ? parseInt(holding.hldg_qty || holding.rmnd_qty || holding.qty || '0', 10)
                : 0;

            // 티켓 수량과 실제 잔고 중 안전한 쪽으로 매도
            let sellQty = ticket.quantity;
            if (htsQty === 0) {
                // [Bugfix] 동시호가(15:20~15:30)에 매수한 경우, 아직 15:30이 되지 않아 잔고가 0으로 보일 수 있음.
                const nowKst = new Date();
                const kstHour = (nowKst.getUTCHours() + 9) % 24;
                const kstMinute = nowKst.getUTCMinutes();
                const kstHHMM = kstHour * 100 + kstMinute;

                // 티켓이 오늘 생성되었고, 현재 시각이 15:20~15:30 사이라면 매도를 보류 (체결 대기 중)
                const entryDate = (ticket.entry_date || '').split('T')[0];
                const today = new Date(nowKst.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
                const isSimultaneousAuction = (kstHHMM >= 1520 && kstHHMM < 1530);

                if (isSimultaneousAuction && entryDate === today) {
                    console.log(`[LiveTrade] 매도 보류: 동시호가 매수 체결 대기 상태 추정. (${ticket.stock_code})`);
                    this.logEvent('INFO', ticket.stock_code, `매도 보류: 동시호가 체결 대기 중 (15:20~15:30)`);
                    this.ledger.markTicketActive(ticket.ticket_id);
                    return;
                }

                // 이미 수동으로 전량 매도되어 잔고가 없음
                this.ledger.closeTicket(ticket.ticket_id);
                this.logEvent('INFO', ticket.stock_code, `매도 취소: 잔고 없음 (수동 매도 추정). 티켓 CLOSED 처리.`);
                this.telegram.sendMessage(`⚠️ **[매도 취소 - 잔고 없음]**\n- 종목: ${ticket.stock_name || ticket.stock_code}\n- 사유: ${sellReason}\n- HTS 잔고 0주 확인. 이미 수동 매도된 것으로 보여 티켓을 CLOSED 처리합니다.`);
                return;
            } else if (htsQty < ticket.quantity) {
                // 잔고가 티켓보다 부족 (일부 수동 매도 발생)
                sellQty = htsQty;
                this.logEvent('INFO', ticket.stock_code, `매도 수량 조정: 잔고(${htsQty}) < 티켓(${ticket.quantity})`);
                this.telegram.sendMessage(`⚠️ **[매도 수량 조정]**\n- 종목: ${ticket.stock_name || ticket.stock_code}\n- 티켓 수량: ${ticket.quantity}주 → 실제 가용: ${htsQty}주\n- 사유: 실제 잔고 부족 (수동 매도로 추정). 가용 잔고 전량 매도합니다.`);
            }

            // 단기과열 종목이고 조건부지정가(05) 주문 시 시장가(03)로 우회 처리
            let finalTrdeType = trdeType;
            let finalSellReason = sellReason;
            if (trdeType === '05' && this.kiwoom.isOverheatedStock(ticket.stock_code)) {
                finalTrdeType = '03';
                finalSellReason = `${sellReason} (단기과열 우회 시장가)`;
                console.log(`[LiveTrade] ${ticket.stock_code} 종목은 단기과열 상태이므로 조건부지정가(05) -> 시장가(03)로 우회 매도 처리합니다.`);
            }

            // [Step 3] 매도 주문 전송
            console.log(`[LiveTrade] Sending SELL order for ${ticket.stock_code}: ${sellQty} shares, trde_tp=${finalTrdeType} (${finalSellReason})`);
            const currentPrice = holding
                ? parseInt(holding.prpr || holding.cur_prc || holding.stck_prpr || '0', 10)
                : 0;

            if (currentPrice <= 0) {
                throw new Error('현재가를 가져올 수 없습니다. 잔고 응답에 가격 정보 없음.');
            }

            const apiResult = await this.kiwoom.sendSellOrder(
                account,
                ticket.stock_code,
                sellQty,
                currentPrice,
                finalTrdeType
            );

            // API 응답 검증 (return_code === 0 또는 '0' 인지 체크)
            const isSuccess = apiResult && (apiResult.return_code === 0 || apiResult.return_code === '0');
            if (!isSuccess) {
                const rspCd = apiResult?.return_code !== undefined ? String(apiResult.return_code) : 'ERROR';
                const rspMsg = apiResult?.return_msg || JSON.stringify(apiResult || {});
                throw new Error(`키움 API 매도 접수 거절 (코드: ${rspCd}, 메시지: ${rspMsg})`);
            }

            const typeLabel = finalTrdeType === '05' 
                ? '기간청산(조건부 지정가)' 
                : (finalTrdeType === '03' ? '기간청산(단기과열 우회 시장가)' : '익절(지정가)');
            this.logEvent('SELL', ticket.stock_code, `매도 발동 - ${typeLabel} (${sellQty}주 @ ${currentPrice}) 사유: ${finalSellReason}`);
            this.telegram.sendMessage(`💰 **[실전 매도 발동 - ${typeLabel}]**\n- 종목: ${ticket.stock_name || ticket.stock_code}\n- 가격: ${currentPrice.toLocaleString()}원\n- 수량: ${sellQty}주\n- 상태: SELLING (장 마감 정산 시 최종 확정)\n- 사유: ${finalSellReason}`);

        } catch (error: any) {
            // 매도 실패 시 SELLING → ACTIVE 복귀 (다음 폴링에서 재시도 가능하도록)
            console.error(`[LiveTrade] Failed to execute sell for ${ticket.stock_code}:`, error);
            this.emitError('매도 주문', `${ticket.stock_code} 매도 주문 실패 (${sellReason})`, error?.response?.data ? JSON.stringify(error.response.data) : error.message);
            this.ledger.markTicketActive(ticket.ticket_id);
            this.lastCacheTime = 0; // 즉시 캐시 무효화
            this.telegram.sendMessage(`🚨 **[실전 매도 주문 실패]**\n- 종목: ${ticket.stock_name || ticket.stock_code}\n- 에러: ${error.message}\n- 티켓 상태를 ACTIVE로 복귀시켰습니다.`);
        } finally {
            // Lock 해제
            this.sellingInProgress.delete(ticket.ticket_id);
        }
    }

    /**
     * 지정가 목표가 도달 시 익절 매도 파이프라인 (Type A)
     */
    public async executeTakeProfitSell(ticket: LiveTradeTicket): Promise<void> {
        const account = this.getAccountNo();
        if (!account) return;
        await this._executeSell(ticket, '00', '목표 수익률 도달 (익절)', account);
    }

    /**
     * 최대 보유일 도달 시 청산 파이프라인 (Type B)
     */
    public async executeTimeStopSell(ticket: LiveTradeTicket): Promise<void> {
        const account = this.getAccountNo();
        if (!account) return;
        await this._executeSell(ticket, '05', '최대 보유일 도달 (기간 청산)', account);
    }

    /**
     * 추적 모드 주기 변경 (1분 / 5분) 및 타이머 재시작
     */
    private setChaseInterval(ms: number) {
        if (this.chaseIntervalMs === ms && this.unexecutedChasingTimer !== null) return;
        this.chaseIntervalMs = ms;
        this.startUnexecutedSellChasing();
    }

    /**
     * 캐시된 ACTIVE 티켓 목록 반환 (웹소켓 틱마다 DB 쿼리 방지)
     * 5초에 한 번만 DB와 동기화
     */
    private getCachedActiveTickets(): LiveTradeTicket[] {
        const now = Date.now();
        if (now - this.lastCacheTime > 5000) {
            this.cachedActiveTickets = this.ledger.getActiveTickets();
            this.lastCacheTime = now;
        }
        return this.cachedActiveTickets;
    }

    private cachedActiveStrategies: any[] = [];
    private lastStrategyCacheTime: number = 0;

    private getCachedActiveStrategies(): any[] {
        const now = Date.now();
        if (now - this.lastStrategyCacheTime > 5000) {
            this.cachedActiveStrategies = this.ledger.getActiveStrategies();
            this.lastStrategyCacheTime = now;
        }
        return this.cachedActiveStrategies;
    }

    private getPortfolioConfig() {
        const now = Date.now();
        if (now - this.cachedPortfolioConfig.lastUpdated > 5000) {
            this.cachedPortfolioConfig.active = store.get('portfolio_auto_sell_active') as boolean || false;
            this.cachedPortfolioConfig.targetRate = store.get('portfolio_target_profit_rate') as number || 3.0;
            this.cachedPortfolioConfig.lastUpdated = now;
        }
        return this.cachedPortfolioConfig;
    }

    private trackCohortPeaks(activeTickets: LiveTradeTicket[]) {
        if (this.cohortPeaksCache === null) {
            this.cohortPeaksCache = {};
            try {
                const peaks = this.ledger.getAllCohortPeaks();
                for (const p of peaks) {
                    this.cohortPeaksCache[p.entry_date] = { peak: p.peak_return_pct, time: p.peak_time };
                }
            } catch (e) {
                console.error('[LiveTrade] Failed to load cohort peaks cache', e);
            }
        }

        const now = new Date();
        const kstH = (now.getUTCHours() + 9) % 24;
        const kstM = now.getUTCMinutes();
        const kstS = now.getUTCSeconds();
        const kstTime = `${kstH.toString().padStart(2, '0')}:${kstM.toString().padStart(2, '0')}:${kstS.toString().padStart(2, '0')}`;
        
        // [개선] 15:00 이후에는 장 마감 전 타임컷 등 대량 매도 발생으로 
        // 남은 종목에 의한 수익률 펌핑(왜곡)이 생길 수 있으므로 기록을 중단합니다.
        const timeVal = kstH * 100 + kstM;
        if (timeVal >= 1500) return;

        const cohorts: Record<string, { totalInvested: number, totalCurrent: number, missingPrice: boolean }> = {};
        
        for (const ticket of activeTickets) {
            const dateStr = (ticket.entry_date || '').split('T')[0];
            if (!dateStr) continue;
            
            if (!cohorts[dateStr]) {
                cohorts[dateStr] = { totalInvested: 0, totalCurrent: 0, missingPrice: false };
            }
            
            if (ticket.entry_price <= 0) continue;
            const p = this.latestPrices[ticket.stock_code] || (ticket as any).current_price || ticket.entry_price;
            if (!p || p <= 0) {
                cohorts[dateStr].missingPrice = true;
                continue;
            }
            
            const qty = ticket.quantity || 0;
            if (qty <= 0) continue;
            
            cohorts[dateStr].totalInvested += ticket.entry_price * qty;
            cohorts[dateStr].totalCurrent += p * qty;
        }

        const formatter = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const todayStr = formatter.format(now);

        for (const [dateStr, data] of Object.entries(cohorts)) {
            if (data.missingPrice || data.totalInvested <= 0) continue;
            
            // 보유일 1일(매수일 다음 거래일) 기준 검증
            if (todayStr <= dateStr) continue; // 매수 당일은 스킵
            
            const cacheKey = `${todayStr}_${dateStr}`;
            if (this.firstTradingDayCache[cacheKey] === undefined) {
                const db = DatabaseService.getInstance().getDb();
                const row = db.prepare(`SELECT COUNT(DISTINCT date) as cnt FROM market_ohlcv_history WHERE date > ? AND date < ?`).get(dateStr, todayStr) as { cnt: number } | undefined;
                this.firstTradingDayCache[cacheKey] = (row?.cnt === 0);
            }
            if (!this.firstTradingDayCache[cacheKey]) continue; // 다음 거래일(1일차)가 아니면 갱신 안함

            const avgReturnPct = ((data.totalCurrent - data.totalInvested) / data.totalInvested) * 100;
            
            // 1) 최고점(Peak) 갱신
            const cached = this.cohortPeaksCache[dateStr];
            if (!cached || avgReturnPct > cached.peak) {
                this.cohortPeaksCache[dateStr] = { peak: avgReturnPct, time: kstTime };
                try {
                    this.ledger.upsertCohortPeak(dateStr, avgReturnPct, kstTime);
                } catch (e) {
                    console.error(`[LiveTrade] Failed to upsert cohort peak for ${dateStr}`, e);
                }
            }

            // 2) 10분봉 캔들 버킷팅(Timeseries)
            const slotMins = Math.floor(kstM / 10) * 10;
            const slotStr = `${kstH.toString().padStart(2, '0')}:${slotMins.toString().padStart(2, '0')}`;

            let bucket = this.timeseriesBuckets[dateStr];
            
            if (!bucket || bucket.currentSlot !== slotStr) {
                // 슬롯이 변경되었으면(예: 09:10 -> 09:20), 이전 슬롯 데이터를 DB에 플러시(Flush)
                if (bucket) {
                    try {
                        this.ledger.upsertPortfolioTimeseries(dateStr, todayStr, bucket.currentSlot, bucket.high, bucket.low, bucket.close);
                    } catch (e) {
                        console.error(`[LiveTrade] Failed to flush timeseries for ${dateStr} at slot ${bucket.currentSlot}`, e);
                    }
                }
                // 새 슬롯 버킷 초기화
                this.timeseriesBuckets[dateStr] = {
                    currentSlot: slotStr,
                    high: avgReturnPct,
                    low: avgReturnPct,
                    close: avgReturnPct
                };
            } else {
                // 현재 슬롯 갱신
                bucket.high = Math.max(bucket.high, avgReturnPct);
                bucket.low = Math.min(bucket.low, avgReturnPct);
                bucket.close = avgReturnPct; // 종가는 들어오는 최신 값
            }
        }
    }

    /**
     * [Event-Driven] 웹소켓 실시간 가격 수신 시 목표가 도달 즉각 매도 검사
     */
    private async onPriceUpdate(data: { code: string; price: number }) {
        if (this.isKillSwitchActive()) return;

        // 1. 개별 종목 최신가 업데이트 (포트폴리오 평가용)
        this.latestPrices[data.code] = data.price;

        const activeTickets = this.getCachedActiveTickets();
        if (activeTickets.length === 0) return;

        // 포트폴리오 코호트(날짜별) 고점 상시 기록 (Kill-Switch 활성 여부 무관)
        this.trackCohortPeaks(activeTickets);

        const { StrategyProfileService } = await import('./StrategyProfileService');
        const profileSvc = StrategyProfileService.getInstance();

        for (const ticket of activeTickets) {
            // 해당 종목의 가격 업데이트인지 확인하여 개별 익절 점검
            if (ticket.stock_code === data.code) {
                if (this.sellingInProgress.has(ticket.ticket_id)) continue;
                if (ticket.entry_price <= 0) continue;

                const returnPct = ((data.price - ticket.entry_price) / ticket.entry_price) * 100;

                const strategyConfig = this.getCachedActiveStrategies().find(s => s.strategy_category === ticket.strategy_category);
                const targetProfit = strategyConfig?.target_profit_rate > 0
                    ? strategyConfig.target_profit_rate
                    : profileSvc.getProfile(ticket.strategy_category).hardTakeProfit;

                if (targetProfit > 0 && returnPct >= targetProfit) {
                    console.log(`[LiveTrade] 실시간 익절 도달 (WS): ${ticket.stock_code} (${returnPct.toFixed(2)}% >= ${targetProfit}%)`);
                    await this.executeTakeProfitSell(ticket);
                    // 매도 주문 직후 추적 모드 1분로 전환
                    this.setChaseInterval(60 * 1000);
                }
            }
        }

        // 2. 포트폴리오 통합 익절 체크 (모든 트랙 통합 계좌 기준)
        const pConfig = this.getPortfolioConfig();
        if (pConfig.active && pConfig.targetRate > 0) {
            let totalInvested = 0;
            let totalCurrentValue = 0;
            let missingPrice = false;

            for (const ticket of activeTickets) {
                if (ticket.entry_price <= 0) continue;
                const p = this.latestPrices[ticket.stock_code] || ticket.entry_price;
                if (!p || p <= 0) {
                    missingPrice = true;
                    break;
                }
                const qty = ticket.quantity || 0;
                if (qty <= 0) continue;

                totalInvested += ticket.entry_price * qty;
                totalCurrentValue += p * qty;
            }

            if (!missingPrice && totalInvested > 0) {
                const avgReturnPct = ((totalCurrentValue - totalInvested) / totalInvested) * 100;
                
                if (avgReturnPct >= pConfig.targetRate) {
                    console.log(`[LiveTrade] 🎯 포트폴리오 목표 수익률 도달! (평균: ${avgReturnPct.toFixed(2)}% >= ${pConfig.targetRate}%) -> 전량 매도 시작`);
                    this.logEvent('INFO', 'PORTFOLIO', `포트폴리오 평균 수익률 ${avgReturnPct.toFixed(2)}% 도달 (목표 ${pConfig.targetRate}%) -> 전량 매도 트리거`);
                    this.telegram.sendMessage(`🎯 **[포트폴리오 목표 도달 - 전량 매도]**\n- 평균 수익률: ${avgReturnPct.toFixed(2)}%\n- 목표: ${pConfig.targetRate}%\n- 보유 종목 일괄 매도(익절)를 시작합니다.`);

                    const ticketsToSell = activeTickets.filter(t => !this.sellingInProgress.has(t.ticket_id));
                    
                    // 비동기 백그라운드로 0.5초 딜레이 순차 매도 (Rate Limit 방지)
                    (async () => {
                        for (const t of ticketsToSell) {
                            await this.executeTakeProfitSell(t);
                            await new Promise(r => setTimeout(r, 500));
                        }
                        this.setChaseInterval(60 * 1000);
                    })().catch(console.error);

                    return;
                }
            }
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  장중 모니터링 루프
    // ───────────────────────────────────────────────────────────────────────────

    /**
     * 익절 매도(Type A) 모니터링 폴백 로직 (크론 호출)
     * 웹소켓 누락 대비용 당일 OHLCV 고가 체크
     */
    public async monitorTakeProfit(): Promise<void> {
        // [Guard] 이전 실행이 아직 완료되지 않으면 건너뜀
        if (this.isTakeProfitRunning) {
            console.log('[LiveTrade] monitorTakeProfit: 이전 실행 진행 중. 이번 주기 건너뜀.');
            return;
        }
        if (this.isKillSwitchActive()) return;

        this.isTakeProfitRunning = true;
        const account = this.getAccountNo();
        if (!account) {
            this.isTakeProfitRunning = false;
            return;
        }

        try {
            // 2. ACTIVE 상태 티켓만 조회 (SELLING은 이미 매도 중이므로 제외)
            const activeTickets = this.ledger.getActiveTickets();
            if (activeTickets.length === 0) return;

            // 포트폴리오 코호트(날짜별) 고점 상시 기록 (Kill-Switch 활성 여부 무관)
            this.trackCohortPeaks(activeTickets);

            // [백그라운드 필수 구독] 실전 매매 진행 중인 종목은 UI 무관하게 웹소켓 상시 구독 보장
            const activeSymbols = activeTickets.map(t => t.stock_code);
            this.kiwoom.wsRegister(activeSymbols);

            const { StrategyProfileService } = await import('./StrategyProfileService');
            const profileSvc = StrategyProfileService.getInstance();

            for (const ticket of activeTickets) {
                // 이미 매도 Lock이 걸린 티켓이면 건너뜀
                if (this.sellingInProgress.has(ticket.ticket_id)) continue;
                if (ticket.entry_price <= 0) continue;

                // [Fix] 당일 진입한 종목은 당일 OHLCV 고점 기반 Fail-Safe 매도 로직에서 제외.
                // 당일 고가는 매수 시점 이전에 형성되었을 수 있어, 잘못된 즉시 매도를 유발할 수 있음.
                const today = new Date().toISOString().split('T')[0];
                if (ticket.entry_date === today) {
                    continue;
                }

                // 틱 수신 장애 대비 당일 최고가(High) 조회 
                const candles = await this.kiwoom.getOhlcvDaily(ticket.stock_code, 1);
                if (candles.length === 0) continue;
                
                const todayCandle = candles[candles.length - 1];
                const highPrice = todayCandle.high;
                if (highPrice <= 0) continue;

                const returnPct = ((highPrice - ticket.entry_price) / ticket.entry_price) * 100;

                // 전략 프로파일에서 목표 수익률 확인
                const strategyConfig = this.getCachedActiveStrategies().find(s => s.strategy_category === ticket.strategy_category);
                const targetProfit = strategyConfig?.target_profit_rate > 0
                    ? strategyConfig.target_profit_rate
                    : profileSvc.getProfile(ticket.strategy_category).hardTakeProfit;

                if (targetProfit > 0 && returnPct >= targetProfit) {
                    console.log(`[LiveTrade] Fail-Safe 익절 도달 (OHLCV 당일 고점): ${ticket.stock_code} (고가 ${highPrice}원, ${returnPct.toFixed(2)}% >= ${targetProfit}%)`);
                    await this.executeTakeProfitSell(ticket);
                    this.setChaseInterval(60 * 1000);
                    await new Promise(r => setTimeout(r, 500)); // 연속 주문 간 짧은 딜레이
                }
            }

            // 3. 포트폴리오 통합 익절 체크 (OHLCV High fallback)
            const pConfig = this.getPortfolioConfig();
            if (pConfig.active && pConfig.targetRate > 0) {
                let totalInvested = 0;
                let totalCurrentValue = 0;
                let missingPrice = false;

                for (const ticket of activeTickets) {
                    if (ticket.entry_price <= 0) continue;
                    const p = this.latestPrices[ticket.stock_code] || ticket.entry_price;
                    if (!p || p <= 0) {
                        missingPrice = true;
                        break;
                    }
                    const qty = ticket.quantity || 0;
                    if (qty <= 0) continue;

                    totalInvested += ticket.entry_price * qty;
                    totalCurrentValue += p * qty;
                }

                if (!missingPrice && totalInvested > 0) {
                    const avgReturnPct = ((totalCurrentValue - totalInvested) / totalInvested) * 100;
                    if (avgReturnPct >= pConfig.targetRate) {
                        console.log(`[LiveTrade] 🎯 Fail-Safe 포트폴리오 목표 수익률 도달! (평균: ${avgReturnPct.toFixed(2)}% >= ${pConfig.targetRate}%) -> 전량 매도 시작`);
                        this.logEvent('INFO', 'PORTFOLIO', `Fail-Safe 포트폴리오 평균 수익률 ${avgReturnPct.toFixed(2)}% 도달 (목표 ${pConfig.targetRate}%) -> 전량 매도 트리거`);
                        this.telegram.sendMessage(`🎯 **[포트폴리오 목표 도달 (Fail-Safe) - 전량 매도]**\n- 평균 수익률: ${avgReturnPct.toFixed(2)}%\n- 목표: ${pConfig.targetRate}%\n- 보유 종목 일괄 매도(익절)를 시작합니다.`);

                        const ticketsToSell = activeTickets.filter(t => !this.sellingInProgress.has(t.ticket_id));
                        for (const t of ticketsToSell) {
                            await this.executeTakeProfitSell(t);
                            await new Promise(r => setTimeout(r, 500));
                        }
                        this.setChaseInterval(60 * 1000);
                    }
                }
            }
        } catch (err: any) {
            console.error(`[LiveTrade] 익절 모니터링 중 에러:`, err.message);
            this.emitError('익절 모니터링', '익절 조건 스캔 중 에러 발생', err.message);
        } finally {
            this.isTakeProfitRunning = false;
        }
    }

    /**
     * 프론트엔드 모달에서 실행하는 "테스트 매수"
     * 대상 종목의 현재가/하한가를 조회하여 지정가 매수 주문을 내고 로그 배열을 반환한다.
     */
    public async executeTestBuy(stockCode: string, qty: number, accountNo?: string): Promise<string[]> {
        const logs: string[] = [];
        const log = (msg: string) => {
            const time = new Date().toLocaleTimeString('ko-KR');
            const line = `[${time}] ${msg}`;
            console.log(`[TestBuy] ${msg}`);
            logs.push(line);
        };

        log(`🧪 테스트 매수 시작 - 종목코드: ${stockCode}, 수량: ${qty}주`);

        if (this.isKillSwitchActive()) {
            log(`❌ Kill-Switch 활성화 상태로 매수 차단됨`);
            return logs;
        }

        const account = accountNo || this.getAccountNo();
        if (!account) {
            log(`❌ 설정된 계좌 정보가 없습니다.`);
            return logs;
        }
        log(`✅ 키움 계좌번호 로드 완료: ${account.substring(0, account.length - 3)}***`);

        try {
            log(`🔍 종목(${stockCode}) 현재가 및 하한가 조회 중...`);
            const priceInfo = await this.kiwoom.getStockBasicInfo(stockCode);
            const body = priceInfo?.Body || priceInfo?.out1 || priceInfo || {};
            
            const rawCur = String(body.stk_prc || body.cur_prc || body.stck_prpr || body.currentPrice || 0).replace(/[^0-9-]/g, '');
            const currentPrice = Math.abs(parseInt(rawCur, 10)) || 0;
            
            // 키움 API 구조에 따라 하한가(lwl_pric) 추출 (다양한 키 구조 대응)
            let rawLwl = String(body.lwl_pric || body.lwl || body.lo_lmt_prc || body.lowerLimitPrice || body.mnpr || body.mn_prc || body.stck_mnpr || 0).replace(/[^0-9-]/g, '');
            let limitLow = Math.abs(parseInt(rawLwl, 10)) || 0;
            
            if (currentPrice === 0) {
                log(`❌ 현재가 조회 실패. 종목코드를 확인하세요. 응답: ${JSON.stringify(body).substring(0, 50)}`);
                return logs;
            }
            if (limitLow === 0) {
                log(`⚠️ 하한가 필드(lwl_pric) 조회 안됨. 자체 계산 수행 (-30%)`);
                limitLow = calculateOrderPrice(currentPrice * 0.70, 1);
            }

            log(`✅ 현재가: ${currentPrice.toLocaleString()}원 / 하한가: ${limitLow.toLocaleString()}원`);
            log(`🚀 하한가(${limitLow.toLocaleString()}원)로 지정가(00) 매수 주문 발송 시도...`);

            const result = await this.kiwoom.sendBuyOrder(
                account,
                stockCode,
                qty,
                limitLow,
                '00' 
            );

            log(`✅ 주문 발송 성공!`);
            log(`- API 응답: ${JSON.stringify(result)}`);
        } catch (e: any) {
            log(`❌ 주문 발송 중 API 에러 발생: ${e.message}`);
            if (e.response && e.response.data) {
                log(`- 에러 상세: ${JSON.stringify(e.response.data)}`);
            }
        }

        log(`🧪 테스트 매수 프로세스 종료`);
        return logs;
    }

    /**
     * 동적 미체결 타임스탑 매도 추적 정정 시작 (기본 5분 / 추적 시 1분)
     */
    public startUnexecutedSellChasing(): void {
        if (this.unexecutedChasingTimer) {
            clearInterval(this.unexecutedChasingTimer);
        }
        
        const mode = this.chaseIntervalMs === 60 * 1000 ? 'Chase Mode (1분)' : 'Idle Mode (5분)';
        console.log(`[LiveTrade] 미체결 매도 추적기 시작 - ${mode}`);

        this.unexecutedChasingTimer = setInterval(async () => {
            if (this.isChasingRunning) return;
            this.isChasingRunning = true;
            try {
                await this.processUnexecutedSellChasing();
            } catch (err: any) {
                console.error(`[LiveTrade] 미체결 매도 추적 에러:`, err.message);
            } finally {
                this.isChasingRunning = false;
            }
        }, this.chaseIntervalMs);
    }

    /**
     * 미체결 매도 추적 종료
     */
    public stopUnexecutedSellChasing(): void {
        if (this.unexecutedChasingTimer) {
            clearInterval(this.unexecutedChasingTimer);
            this.unexecutedChasingTimer = null;
            this.logEvent('INFO', '', '[LiveTrade] 미체결 매도 추적기 종료 (15:20 동시호가 돌입)');
            console.log('[LiveTrade] 미체결 매도 추적기 종료');
        }
    }

    /**
     * 미체결 매도 추적 및 Market Sweep (15:18 일괄 시장가 청산) 로직 수행
     */
    private async processUnexecutedSellChasing(): Promise<void> {
        if (this.isKillSwitchActive()) {
            this.stopUnexecutedSellChasing();
            return;
        }

        // [Guard 1.5] 회로 차단기(Circuit Breaker) 상태 체크
        if (this.kiwoom.isCircuitBroken()) {
            console.warn('[LiveTrade] 회로 차단기(Circuit Breaker) 활성화 상태. 미체결 매도 추적 일시 중단.');
            return;
        }

        const account = this.getAccountNo();
        if (!account) return;

        // 현재 시간 확인
        const nowKst = new Date();
        const kstHour = (nowKst.getUTCHours() + 9) % 24;
        const kstMinute = nowKst.getUTCMinutes();
        const hhmm = kstHour * 100 + kstMinute;

        // 15:20 동시호가 시작되면 타이머 종료 (이후는 거래소가 알아서 시장가 체결시킴)
        if (hhmm >= 1520) {
            this.stopUnexecutedSellChasing();
            return;
        }

        // 15:15 이상이면 Market Sweep 대기를 위해 무조건 1분 추적 모드(Chase Mode)로 업그레이드
        if (hhmm >= 1515 && this.chaseIntervalMs !== 60 * 1000) {
            console.log('[LiveTrade] 15:15 도달. 장 마감 정정을 위해 추적 주기를 1분(Chase Mode)으로 강제 상향 조정합니다.');
            this.setChaseInterval(60 * 1000);
        }

        // 15:18이 되면 Market Sweep (일괄 시장가 '03' 정정)
        const isMarketSweepTime = hhmm >= 1518;

        try {
            // kt00007 매도 미체결만 조회
            const unexecRes = await this.kiwoom.getUnexecutedOrdersKt00007(account, { sell_tp: '1' });
            const unexecList = unexecRes?.oso || [];

            if (unexecList.length === 0) {
                // 미체결 잔량이 없고 현재 1분 모드라면, 5분(Idle) 모드로 다운그레이드
                if (this.chaseIntervalMs === 60 * 1000) {
                    console.log('[LiveTrade] 미체결 잔량 0건 확인. 추적 주기를 5분(Idle Mode)으로 하향 조정.');
                    this.setChaseInterval(5 * 60 * 1000);
                }
                return;
            }

            // 미체결 잔량이 발견되었는데 5분(Idle) 모드라면 1분(Chase) 모드로 업그레이드
            if (this.chaseIntervalMs !== 60 * 1000) {
                console.log('[LiveTrade] 미체결 잔량 발견. 추적 주기를 1분(Chase Mode)로 상향 조정.');
                this.setChaseInterval(60 * 1000);
                // 모드 상향 조정만 하고 이번 턴은 즉시 반환 (다음 1분 후부터 본격 처리)
                return;
            }

            // 우리 시스템이 관리 중인 종목만 필터
            const managedTickets = this.ledger.getActiveAndSellingTickets();
            const managedCodes = new Set(managedTickets.map(t => t.stock_code));

            let processedCount = 0;
            for (const order of unexecList) {
                try {
                    // kt00007 규격에 따른 필드 매핑
                    const stkCd = (order.pdno || order.stk_cd || order.iscd || '').trim().replace(/^A/, '');
                    const origOrdNo = order.odno || order.ord_no || order.orig_ord_no || '';
                    const mdfyQty = parseInt(order.ord_rmnd_qty || order.rmn_qty || order.ord_qty || '0', 10); // 잔량
                    const ordUv = parseInt(order.ord_uv || '0', 10); // 기존 주문 단가

                    if (!stkCd || !origOrdNo || mdfyQty <= 0) continue;
                    if (!managedCodes.has(stkCd)) continue;

                    // 단기과열(시장가 매도) 종목은 미체결 정정 대상에서 제외
                    if (this.kiwoom.isOverheatedStock(stkCd)) {
                        console.log(`[LiveTrade] 정정 제외: ${stkCd} 종목은 단기과열(시장가 매도) 종목이므로 미체결 정정 대상에서 제외합니다.`);
                        continue;
                    }

                    if (isMarketSweepTime) {
                        const targetTicket = managedTickets.find(t => t.stock_code === stkCd);
                        const stockName = targetTicket?.stock_name || stkCd;
                        // [Step 3] Market Sweep (시장가 일괄 청산)
                        console.log(`[LiveTrade] 15:18 시장가 일괄 정정 발송: ${stockName}(${stkCd}) (${mdfyQty}주)`);
                        this.logEvent('SELL', stkCd, `[매도정정 시도] 15:18 Market Sweep. 원주문:${origOrdNo}, 잔량:${mdfyQty}주 시장가(03) 정정 요청`);
                        
                        const res = await this.kiwoom.modifyOrder(account, origOrdNo, stkCd, mdfyQty, 0, '03'); // 시장가는 단가 0, trde_tp 03
                        const data = res?.data || res;
                        const isSuccess = data && (data.return_code === 0 || data.return_code === '0');
                        if (!isSuccess) {
                            const err = new Error(data?.return_msg || '알 수 없는 키움 API 오류');
                            (err as any).returnCode = data?.return_code !== undefined ? String(data.return_code) : 'ERROR';
                            (err as any).rawResponse = JSON.stringify(data || {});
                            throw err;
                        }
                        
                        const ordNo = String(data?.ord_no || data?.odno || data?.order_no || '');
                        const rspCd = data?.return_code !== undefined ? String(data.return_code) : '';
                        const apiResponseStr = JSON.stringify(data || {}).substring(0, 512);
                        this.logEvent('SELL', stkCd, `[매도정정 성공] 15:18 Market Sweep. 남은 ${mdfyQty}주 시장가 일괄 정정 완료`, {
                            order_no: ordNo,
                            rsp_cd: rspCd,
                            api_response: apiResponseStr
                        });
                        this.telegram.sendMessage(`🧹 **[Market Sweep: 시장가 일괄 청산]**\n- 종목: ${stockName}\n- 미체결 잔량: ${mdfyQty}주\n- 시장가(03) 정정 발송됨.`);
                    } else {
                        // [Step 2] 일반 지정가 추적 (현재가 - 1틱)
                        const priceInfo = await this.kiwoom.getStockBasicInfo(stkCd);
                        const body = priceInfo?.Body || priceInfo?.acnt_ord_cntr_prps_dtl || priceInfo || {};
                        const rawCur = String(body.stk_prc || body.cur_prc || body.stck_prpr || body.currentPrice || 0).replace(/[^0-9-]/g, '');
                        const currentPrice = Math.abs(parseInt(rawCur, 10)) || 0;

                        if (currentPrice > 0) {
                            const chasePrice = calculateOrderPrice(currentPrice, -1);
                            
                            // 동일 가격 정정 방지 (키움 API 에러 방어)
                            if (chasePrice === ordUv) {
                                console.log(`[LiveTrade] 정정 보류: ${stkCd} 현재 미체결가(${ordUv}원)와 정정가(${chasePrice}원)가 동일함.`);
                                this.logEvent('INFO', stkCd, `[정정 보류] 미체결가(${ordUv})와 목표가(${chasePrice}) 동일. 대기중`);
                                continue;
                            }

                            console.log(`[LiveTrade] 추적 지정가 정정 발송: ${stkCd} (${mdfyQty}주) -> 현재가 ${currentPrice}원, 정정가 ${chasePrice}원`);
                            this.logEvent('SELL', stkCd, `[매도정정 시도] 미체결 ${mdfyQty}주 추적 -> 현재가:${currentPrice}, 목표가:${chasePrice} (원주문:${origOrdNo})`);
                            
                            const res = await this.kiwoom.modifyOrder(account, origOrdNo, stkCd, mdfyQty, chasePrice, '00');
                            const data = res?.data || res;
                            const isSuccess = data && (data.return_code === 0 || data.return_code === '0');
                            if (!isSuccess) {
                                const err = new Error(data?.return_msg || '알 수 없는 키움 API 오류');
                                (err as any).returnCode = data?.return_code !== undefined ? String(data.return_code) : 'ERROR';
                                (err as any).rawResponse = JSON.stringify(data || {});
                                throw err;
                            }
                            
                            const ordNo = String(data?.ord_no || data?.odno || data?.order_no || '');
                            const rspCd = data?.return_code !== undefined ? String(data.return_code) : '';
                            const apiResponseStr = JSON.stringify(data || {}).substring(0, 512);
                            this.logEvent('SELL', stkCd, `[매도정정 성공] 미체결 ${mdfyQty}주 -> 지정가 ${chasePrice}원 정정 완료`, {
                                order_no: ordNo,
                                rsp_cd: rspCd,
                                api_response: apiResponseStr
                            });
                        }
                    }
                    processedCount++;
                    
                    // Rate Limit (초당 주문 제한) 우회를 위한 500ms 딜레이
                    await new Promise(r => setTimeout(r, 500));
                } catch (innerErr: any) {
                    const errMsg = innerErr?.message || String(innerErr);
                    console.error(`[LiveTrade] 개별 미체결 정정 실패 (종목코드: ${order.stk_cd || order.pdno || ''}):`, errMsg);
                    // UI에 노출되도록 에러 로그 기록
                    const stkCdFallback = (order.pdno || order.stk_cd || order.iscd || '').trim().replace(/^A/, '');
                    const rspCd = innerErr.returnCode || 'ERROR';
                    const apiResponse = innerErr.rawResponse || '{}';
                    this.logEvent('ERROR', stkCdFallback, `[매도정정 실패] 키움 API 거절 사유: ${errMsg}`, {
                        rsp_cd: rspCd,
                        api_response: apiResponse
                    });
                    this.emitError('정정 실패', `[${stkCdFallback}] 매도 정정 중 키움 서버 에러`, errMsg);
                    // 특정 종목 정정에 실패해도 다음 종목으로 계속 진행 (전체 루프 중단 방지)
                }
            }

            if (processedCount === 0 && isMarketSweepTime) {
                // 더 이상 우리 시스템 소관의 미체결 잔량이 없으면 타이머 일찍 종료 가능
                this.stopUnexecutedSellChasing();
            }

        } catch (err: any) {
            console.error(`[LiveTrade] 미체결 매도 추적 중 에러:`, err.message);
            this.emitError('미체결 추적', '미체결 매도 추적/정정 중 에러 발생', err.message);
        }
    }
}
