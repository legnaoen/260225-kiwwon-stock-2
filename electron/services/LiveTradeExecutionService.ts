import { KiwoomService } from './KiwoomService';
import { LiveTradeLedgerService, LiveTradeTicket } from './LiveTradeLedgerService';
import { calculateOrderPrice } from '../utils/tickSize';
import { TelegramService } from './TelegramService';
import { eventBus, SystemEvent } from '../utils/EventBus';

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

    // ─── 익절 모니터 실행 Lock (크론 중복 방지) ─────────────────────────────────
    private isTakeProfitRunning = false;

    private constructor() {}

    // ─── 에러 이벤트 emit 헬퍼 ────────────────────────────────────────────────
    private emitError(source: string, message: string, detail?: string) {
        eventBus.emit(SystemEvent.LIVE_TRADE_ERROR, {
            time: new Date().toLocaleString('ko-KR', { hour12: false }),
            source,
            message,
            detail: detail || ''
        });
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
    public async executeBuy(stockCode: string, stockName: string, strategyCategory: string, currentPrice: number, targetExitDate: string): Promise<void> {
        // [Guard 1] Kill-Switch
        if (this.isKillSwitchActive()) {
            console.warn(`[LiveTrade] Kill-Switch 활성화 상태. 매수 차단: ${stockName}`);
            this.telegram.sendMessage(`🚫 **[Kill-Switch 활성]** 긴급 중단 상태로 매수가 차단되었습니다.\n- 종목: ${stockName}`);
            return;
        }

        // [Guard 2] 이중 매수 방지 — 동일 종목이 이미 매수 진행 중이면 Skip
        if (this.buyingInProgress.has(stockCode)) {
            console.warn(`[LiveTrade] 이중 매수 방지: ${stockName}(${stockCode}) 이미 매수 처리 중`);
            return;
        }
        this.buyingInProgress.add(stockCode);

        const account = this.getAccountNo();
        if (!account) {
            console.error('[LiveTrade] Account number not set.');
            this.buyingInProgress.delete(stockCode);
            return;
        }

        const strategies = this.ledger.getActiveStrategies();
        const strategy = strategies.find(s => s.strategy_category === strategyCategory);

        if (!strategy) {
            console.warn(`[LiveTrade] Strategy ${strategyCategory} is not active. Skip buy.`);
            this.buyingInProgress.delete(stockCode);
            return;
        }

        // 1. 수량 계산
        const orderPrice = calculateOrderPrice(currentPrice, 1);
        const quantity = Math.floor(strategy.buy_amount_per_trade / orderPrice);

        if (quantity <= 0) {
            console.warn(`[LiveTrade] Calculated quantity is 0 for ${stockName}. Skip buy.`);
            this.ledger.createTicket({
                stock_code: stockCode,
                entry_date: new Date().toISOString().split('T')[0],
                entry_price: orderPrice,
                quantity: 0,
                strategy_category: strategyCategory,
                target_exit_date: targetExitDate,
                status: 'FAILED',
                fail_reason: `1회 매수금액(${strategy.buy_amount_per_trade.toLocaleString()}원)보다 주가(${currentPrice.toLocaleString()}원)가 높음`
            });
            this.telegram.sendMessage(`🚨 **[실전 자동매수 실패]**\n- 종목: ${stockName}\n- 사유: 매수금액 부족`);
            this.buyingInProgress.delete(stockCode);
            return;
        }

        try {
            // 2. 키움 API 매수 주문 전송 (trde_tp: '05' 조건부 지정가)
            console.log(`[LiveTrade] Sending BUY order for ${stockName} (${stockCode}): ${quantity} shares @ ${orderPrice} (Condition Limit)`);
            await this.kiwoom.sendBuyOrder(
                account,
                stockCode,
                quantity,
                orderPrice,
                '05' // 조건부 지정가
            );

            // 3. 주문 전송 즉시 티켓 생성 (ACTIVE)
            this.ledger.createTicket({
                stock_code: stockCode,
                entry_date: new Date().toISOString().split('T')[0],
                entry_price: orderPrice,
                quantity: quantity,
                strategy_category: strategyCategory,
                target_exit_date: targetExitDate,
                status: 'ACTIVE'
            });

            this.telegram.sendMessage(`📈 **[실전 자동매수 발동]**\n- 종목: ${stockName}\n- 가격: ${orderPrice.toLocaleString()}원 (+1틱)\n- 수량: ${quantity}주\n- 전략: ${strategyCategory}\n- 매도목표일: ${targetExitDate}`);
        } catch (error: any) {
            console.error(`[LiveTrade] Failed to execute buy for ${stockName}:`, error);
            this.emitError('매수 주문', `${stockName}(${stockCode}) 매수 주문 실패`, error?.response?.data ? JSON.stringify(error.response.data) : error.message);
            this.ledger.createTicket({
                stock_code: stockCode,
                entry_date: new Date().toISOString().split('T')[0],
                entry_price: orderPrice,
                quantity: quantity,
                strategy_category: strategyCategory,
                target_exit_date: targetExitDate,
                status: 'FAILED',
                fail_reason: `주문 전송 오류: ${error.message}`
            });
            this.telegram.sendMessage(`🚨 **[실전 자동매수 실패]**\n- 종목: ${stockName}\n- 에러: ${error.message}`);
        } finally {
            // Lock 해제 — 성공/실패 모두 해제
            this.buyingInProgress.delete(stockCode);
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
    private async _executeSell(
        ticket: LiveTradeTicket,
        trdeType: '00' | '05',
        sellReason: string,
        account: string
    ): Promise<void> {
        // [Guard 1] Kill-Switch
        if (this.isKillSwitchActive()) {
            console.warn(`[LiveTrade] Kill-Switch 활성화 상태. 매도 차단: ${ticket.stock_code}`);
            this.telegram.sendMessage(`🚫 **[Kill-Switch 활성]** 긴급 중단 상태로 매도가 차단되었습니다.\n- 종목: ${ticket.stock_code}`);
            return;
        }

        // [Guard 2] 이중 매도 방지 — ticket_id가 이미 Lock된 경우 Skip
        if (this.sellingInProgress.has(ticket.ticket_id)) {
            console.warn(`[LiveTrade] 이중 매도 방지: ${ticket.stock_code} (ticket: ${ticket.ticket_id}) 이미 매도 처리 중`);
            return;
        }
        this.sellingInProgress.add(ticket.ticket_id);

        // [Step 1] 매도 주문 전송 직전 — 티켓 상태를 즉시 SELLING으로 변경
        // DB 반영 먼저 → API 호출 순서로 이중 호출 방지
        this.ledger.markTicketSelling(ticket.ticket_id);

        try {
            // [Step 2] 실제 HTS 잔고 조회 → 가용 수량 결정 (I-2: 수량 불일치 안전장치)
            const holdingsRes = await this.kiwoom.getHoldings(account);
            const holdings = this.parseHoldingsList(holdingsRes);

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
                // 이미 수동으로 전량 매도되어 잔고가 없음
                this.ledger.closeTicket(ticket.ticket_id);
                this.telegram.sendMessage(`⚠️ **[매도 취소 - 잔고 없음]**\n- 종목: ${ticket.stock_code}\n- 사유: ${sellReason}\n- HTS 잔고 0주 확인. 이미 수동 매도된 것으로 보여 티켓을 CLOSED 처리합니다.`);
                return;
            } else if (htsQty < ticket.quantity) {
                // 잔고가 티켓보다 부족 (일부 수동 매도 발생)
                sellQty = htsQty;
                this.telegram.sendMessage(`⚠️ **[매도 수량 조정]**\n- 종목: ${ticket.stock_code}\n- 티켓 수량: ${ticket.quantity}주 → 실제 가용: ${htsQty}주\n- 사유: 실제 잔고 부족 (수동 매도로 추정). 가용 잔고 전량 매도합니다.`);
            }

            // [Step 3] 매도 주문 전송
            console.log(`[LiveTrade] Sending SELL order for ${ticket.stock_code}: ${sellQty} shares, trde_tp=${trdeType} (${sellReason})`);
            const currentPrice = holding
                ? parseInt(holding.prpr || holding.cur_prc || holding.stck_prpr || '0', 10)
                : 0;

            if (currentPrice <= 0) {
                throw new Error('현재가를 가져올 수 없습니다. 잔고 응답에 가격 정보 없음.');
            }

            await this.kiwoom.sendSellOrder(
                account,
                ticket.stock_code,
                sellQty,
                currentPrice,
                trdeType
            );

            const typeLabel = trdeType === '05' ? '기간청산(조건부 지정가)' : '익절(지정가)';
            this.telegram.sendMessage(`💰 **[실전 매도 발동 - ${typeLabel}]**\n- 종목: ${ticket.stock_code}\n- 가격: ${currentPrice.toLocaleString()}원\n- 수량: ${sellQty}주\n- 상태: SELLING (장 마감 정산 시 최종 확정)\n- 사유: ${sellReason}`);

        } catch (error: any) {
            // 매도 실패 시 SELLING → ACTIVE 복귀 (다음 폴링에서 재시도 가능하도록)
            console.error(`[LiveTrade] Failed to execute sell for ${ticket.stock_code}:`, error);
            this.emitError('매도 주문', `${ticket.stock_code} 매도 주문 실패 (${sellReason})`, error?.response?.data ? JSON.stringify(error.response.data) : error.message);
            this.ledger.markTicketActive(ticket.ticket_id);
            this.telegram.sendMessage(`🚨 **[실전 매도 주문 실패]**\n- 종목: ${ticket.stock_code}\n- 에러: ${error.message}\n- 티켓 상태를 ACTIVE로 복귀시켰습니다.`);
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

    // ───────────────────────────────────────────────────────────────────────────
    //  장중 모니터링 루프
    // ───────────────────────────────────────────────────────────────────────────

    /**
     * 익절 매도(Type A) 모니터링 루프 (1분 단위 크론 호출)
     * isTakeProfitRunning Lock으로 크론 중복 실행 방지
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
            // 1. HTS 잔고 조회 (현재가 포함)
            const holdingsRes = await this.kiwoom.getHoldings(account);
            const rawHoldings = this.parseHoldingsList(holdingsRes);

            if (rawHoldings.length === 0) return;

            // 2. ACTIVE 상태 티켓만 조회 (SELLING은 이미 매도 중이므로 제외)
            const activeTickets = this.ledger.getActiveTickets();
            if (activeTickets.length === 0) return;

            const { StrategyProfileService } = await import('./StrategyProfileService');
            const profileSvc = StrategyProfileService.getInstance();

            for (const ticket of activeTickets) {
                // 이미 매도 Lock이 걸린 티켓이면 건너뜀
                if (this.sellingInProgress.has(ticket.ticket_id)) continue;

                const holding = rawHoldings.find((h: any) => {
                    const sc = (h.stk_cd || h.pdno || h.iscd || '').trim().replace(/^A/, '');
                    return sc === ticket.stock_code;
                });

                if (!holding) continue;

                // 잔고 응답에서 현재가 추출
                const currentPrice = parseInt(holding.prpr || holding.cur_prc || holding.stck_prpr || '0', 10);
                if (currentPrice <= 0 || ticket.entry_price <= 0) continue;

                const returnPct = ((currentPrice - ticket.entry_price) / ticket.entry_price) * 100;

                // 전략 프로파일에서 목표 수익률 확인
                // M-1: live_trade_strategies.target_profit_rate 우선, 없으면 StrategyProfile 폴백
                const strategyConfig = this.ledger.getActiveStrategies().find(s => s.strategy_category === ticket.strategy_category);
                const targetProfit = strategyConfig?.target_profit_rate > 0
                    ? strategyConfig.target_profit_rate
                    : profileSvc.getProfile(ticket.strategy_category).hardTakeProfit;

                if (targetProfit > 0 && returnPct >= targetProfit) {
                    console.log(`[LiveTrade] 익절 조건 도달: ${ticket.stock_code} (${returnPct.toFixed(2)}% >= ${targetProfit}%)`);
                    // executeTakeProfitSell 내부에서 Lock + SELLING 상태 즉시 반영
                    await this.executeTakeProfitSell(ticket);
                    await new Promise(r => setTimeout(r, 500)); // 연속 주문 간 짧은 딜레이
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
     * 미체결 주문 정정 루프 (1분 단위 호출)
     * 장중 지정가 매도 미체결 시 현재가로 정정 주문
     */
    public async monitorUnexecutedOrders(): Promise<void> {
        if (this.isKillSwitchActive()) return;
        const account = this.getAccountNo();
        if (!account) return;

        try {
            const unexecRes = await this.kiwoom.getUnexecutedOrders(account);
            const unexecList = unexecRes?.oso || unexecRes?.output || [];

            if (unexecList.length === 0) return;

            // ACTIVE + SELLING 모두 포함해서 우리 시스템이 관리 중인 종목 확인
            const managedTickets = this.ledger.getActiveAndSellingTickets();
            const managedCodes = new Set(managedTickets.map(t => t.stock_code));

            for (const order of unexecList) {
                const stkCd = (order.pdno || order.stk_cd || order.iscd || '').trim().replace(/^A/, '');
                const origOrdNo = order.odno || order.ord_no || order.orig_ord_no || '';
                const mdfyQty = parseInt(order.ord_qty || order.rmn_qty || order.qty || '0', 10);

                if (!stkCd || !origOrdNo || mdfyQty <= 0) continue;

                // 우리 시스템이 관리 중인 종목의 주문만 정정
                if (!managedCodes.has(stkCd)) continue;

                const priceInfo = await this.kiwoom.getStockBasicInfo(stkCd);
                const body = priceInfo?.Body || priceInfo?.out1 || priceInfo || {};
                const rawCur = String(body.stk_prc || body.cur_prc || body.stck_prpr || body.currentPrice || 0).replace(/[^0-9-]/g, '');
                const currentPrice = Math.abs(parseInt(rawCur, 10)) || 0;

                if (currentPrice > 0) {
                    console.log(`[LiveTrade] 정정 주문 발송: ${stkCd} (${mdfyQty}주) -> ${currentPrice}원`);
                    await this.kiwoom.modifyOrder(account, origOrdNo, stkCd, mdfyQty, currentPrice);
                    this.telegram.sendMessage(`🔄 **[실전 미체결 정정]**\n- 종목: ${stkCd}\n- 주문번호: ${origOrdNo}\n- 정정가: ${currentPrice.toLocaleString()}원 (현재가)`);
                }
            }
        } catch (err: any) {
            console.error(`[LiveTrade] 미체결 모니터링 중 에러:`, err.message);
            this.emitError('미체결 정정', '미체결 주문 정정 중 에러 발생', err.message);
        }
    }
}
