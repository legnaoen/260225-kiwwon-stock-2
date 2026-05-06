import { LiveTradeLedgerService } from './LiveTradeLedgerService';
import { KiwoomService } from './KiwoomService';
import { TelegramService } from './TelegramService';
import { eventBus, SystemEvent } from '../utils/EventBus';

export class LiveTradeReconciliationService {
    private static instance: LiveTradeReconciliationService;
    private ledger = LiveTradeLedgerService.getInstance();
    private kiwoom = KiwoomService.getInstance();
    private telegram = TelegramService.getInstance();

    private constructor() {}

    public static getInstance(): LiveTradeReconciliationService {
        if (!LiveTradeReconciliationService.instance) {
            LiveTradeReconciliationService.instance = new LiveTradeReconciliationService();
        }
        return LiveTradeReconciliationService.instance;
    }

    /**
     * getHoldings 응답에서 종목 리스트를 안전하게 파싱
     * AutoTradeService와 동일한 방어적 파싱 로직 사용 (C-2 수정)
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

    /**
     * 장 마감 후 매수/매도 체결 수량 및 상태를 실제 잔고와 대조하여 정산합니다.
     * - ACTIVE 티켓: 매수 체결 수량 검증, 부분 체결/미체결/수동 매도 처리
     * - SELLING 티켓: 매도 체결 완료 확인, 부분 매도 시 잔여분 ACTIVE 복귀
     */
    public async reconcileDailyExecutions(): Promise<void> {
        try {
            console.log('[LiveTradeReconciliation] Starting daily execution reconciliation...');
            this.telegram.sendMessage('🔍 **[실전매매 잔고 정합 확인 시작]**\n실전매매 장부(DB 티켓)와 실제 키움 계좌 잔고를 대조하여 체결 수량을 확인합니다.');

            // 1. 계좌번호 가져오기 (electron-store 기반)
            const Store = (await import('electron-store')).default;
            const store = new Store();
            const settings = store.get('autotrade_settings') as any;
            const accountNo = settings?.selectedAccount;

            if (!accountNo) {
                throw new Error('계좌 정보를 가져올 수 없습니다. (settings.selectedAccount 미설정)');
            }

            // 2. [신규] 당일 전체 체결내역 조회 (kt00007, qry_tp='4')
            let buyExecutionMap: Record<string, { cntr_qty: number; cntr_uv: number; stk_cd: string }> = {};
            let sellExecutionByStock: Record<string, { total_amt: number; total_qty: number }> = {};
            try {
                const executions = await this.kiwoom.getDailyExecutions(accountNo, { sell_tp: '0' });
                for (const ex of executions) {
                    if (ex.sell_tp === '2' && ex.ord_no) { // 매수
                        if (buyExecutionMap[ex.ord_no]) {
                            buyExecutionMap[ex.ord_no].cntr_qty += ex.cntr_qty;
                        } else {
                            buyExecutionMap[ex.ord_no] = {
                                cntr_qty: ex.cntr_qty,
                                cntr_uv:  ex.cntr_uv,
                                stk_cd:   ex.stk_cd
                            };
                        }
                    } else if (ex.sell_tp === '1' && ex.stk_cd) { // 매도
                        if (!sellExecutionByStock[ex.stk_cd]) {
                            sellExecutionByStock[ex.stk_cd] = { total_amt: 0, total_qty: 0 };
                        }
                        sellExecutionByStock[ex.stk_cd].total_qty += ex.cntr_qty;
                        sellExecutionByStock[ex.stk_cd].total_amt += (ex.cntr_qty * ex.cntr_uv);
                    }
                }
                console.log(`[LiveTradeReconciliation] 당일 체결내역 조회 완료 (매수주문: ${Object.keys(buyExecutionMap).length}건, 매도종목: ${Object.keys(sellExecutionByStock).length}건)`);
            } catch (execErr: any) {
                console.warn('[LiveTradeReconciliation] 체결내역 조회 실패 (잔고 대조는 계속 진행):', execErr.message);
            }

            // 3. 키움 계좌 잔고 가져오기 (C-2 수정: 올바른 파싱 적용)
            const holdingsRes = await this.kiwoom.getHoldings(accountNo);
            const rawHoldings = this.parseHoldingsList(holdingsRes);

            console.log(`[LiveTradeReconciliation] HTS 잔고 ${rawHoldings.length}종목 조회 완료`);

            // HTS 잔고 맵 구성 (종목코드 → 보유수량)
            const htsHoldings: Record<string, number> = {};
            for (const h of rawHoldings) {
                const stockCode = (h.stk_cd || h.pdno || h.iscd || '').trim().replace(/^A/, '');
                const qty = parseInt(h.hldg_qty || h.rmnd_qty || h.qty || '0', 10);
                if (stockCode && qty > 0) {
                    htsHoldings[stockCode] = qty;
                }
            }

            // 4. DB의 ACTIVE + SELLING 티켓 가져오기
            const allTickets = this.ledger.getActiveAndSellingTickets();
            const ticketsByStock: Record<string, typeof allTickets> = {};

            for (const ticket of allTickets) {
                if (!ticketsByStock[ticket.stock_code]) {
                    ticketsByStock[ticket.stock_code] = [];
                }
                ticketsByStock[ticket.stock_code].push(ticket);
            }

            // [신규] 오늘 생성된 ACTIVE 티켓에 대해 체결가 업데이트
            const today = new Date().toISOString().split('T')[0];
            for (const ticket of allTickets) {
                if (ticket.status !== 'ACTIVE') continue;
                if (!ticket.entry_date?.startsWith(today)) continue;
                if (!ticket.order_no) continue;

                const execution = buyExecutionMap[ticket.order_no];
                if (execution && execution.cntr_qty > 0 && execution.cntr_uv > 0) {
                    // 실제 체결가가 주문가와 다른 경우에만 업데이트
                    if (Math.abs(execution.cntr_uv - ticket.entry_price) > 0) {
                        this.ledger.updateEntryPrice(ticket.ticket_id, execution.cntr_uv);
                        console.log(`[LiveTradeReconciliation] ${ticket.stock_code} 진입가 업데이트: ${ticket.entry_price} → ${execution.cntr_uv} (체결가)`);
                    }
                }
            }

            let changesCount = 0;

            // 종목별 체결 평균단가 계산 헬퍼
            const getAverageSellPrice = (stkCode: string, fallbackPrice: number = 0) => {
                const sellData = sellExecutionByStock[stkCode];
                if (sellData && sellData.total_qty > 0) {
                    return Math.round(sellData.total_amt / sellData.total_qty);
                }
                return fallbackPrice > 0 ? fallbackPrice : 0; 
            };

            // 4. 종목별 대조 및 조정 (Reconciliation)
            for (const [stockCode, tickets] of Object.entries(ticketsByStock)) {
                const htsTotal = htsHoldings[stockCode] || 0;
                const dbTotal = tickets.reduce((sum, t) => sum + t.quantity, 0);
                let diff = dbTotal - htsTotal;

                if (diff === 0) {
                    // 완벽히 일치 — 단 SELLING 티켓이 있고 HTS 잔고도 0이면 CLOSED 처리
                    const sellingTickets = tickets.filter(t => t.status === 'SELLING');
                    if (htsTotal === 0 && sellingTickets.length > 0) {
                        for (const ticket of sellingTickets) {
                            const exitPrice = getAverageSellPrice(stockCode, ticket.entry_price);
                            const realizedPct = exitPrice > 0 ? Number((((exitPrice - ticket.entry_price) / ticket.entry_price) * 100).toFixed(2)) : 0;
                            
                            this.ledger.closeTicketWithExitInfo(ticket.ticket_id, exitPrice, realizedPct);
                            this.telegram.sendMessage(`✅ **[정산 - 매도 완료]**\n- 종목: ${ticket.stock_name || stockCode}\n- 확정 수익률: ${realizedPct}%\n- 사유: 잔고 0주 확인`);
                            changesCount++;
                        }
                    }
                    continue;
                }

                if (diff > 0) {
                    // DB 수량이 HTS보다 많음 → 매수 미체결 또는 수동 매도 발생
                    console.log(`[LiveTradeReconciliation] 수량 부족 감지: ${stockCode}. DB: ${dbTotal}, HTS: ${htsTotal}, 차이: ${diff}`);

                    // M-2 수정: SELLING 티켓 우선 처리, 그 다음 최근 매수순
                    const sortedTickets = [...tickets].sort((a, b) => {
                        if (a.status === 'SELLING' && b.status !== 'SELLING') return -1;
                        if (a.status !== 'SELLING' && b.status === 'SELLING') return 1;
                        return new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime();
                    });

                    for (const ticket of sortedTickets) {
                        if (diff <= 0) break;

                        const reduceAmount = Math.min(ticket.quantity, diff);
                        const newQuantity = ticket.quantity - reduceAmount;

                        if (newQuantity === 0) {
                            if (ticket.status === 'SELLING') {
                                // 매도 주문이 전량 체결된 경우
                                const exitPrice = getAverageSellPrice(stockCode, ticket.entry_price);
                                const realizedPct = exitPrice > 0 ? Number((((exitPrice - ticket.entry_price) / ticket.entry_price) * 100).toFixed(2)) : 0;
                                
                                this.ledger.closeTicketWithExitInfo(ticket.ticket_id, exitPrice, realizedPct);
                                this.telegram.sendMessage(`✅ **[정산 - 매도 완료]**\n- 종목: ${stockCode}\n- 티켓: ${ticket.entry_date} 진입분\n- 확정 수익률: ${realizedPct}%\n- 사유: 잔고 0주 확인 (정상 매도 완료)`);
                            } else if (ticket.entry_date.startsWith(today)) {
                                // 오늘 매수했는데 HTS에 없음 → 매수 미체결
                                this.ledger.markTicketFailed(ticket.ticket_id, '장 마감 정산: 매수 미체결 확인 (조건부 지정가 동시호가 미체결)');
                                this.telegram.sendMessage(`⚠️ **[정산 - 매수 실패 처리]**\n- 종목: ${stockCode}\n- 사유: HTS 체결 수량 0주 (매수 미체결)`);
                            } else {
                                // 과거 보유 티켓인데 잔고가 없음 → 사용자 수동 매도
                                const exitPrice = getAverageSellPrice(stockCode, ticket.entry_price);
                                const realizedPct = exitPrice > 0 ? Number((((exitPrice - ticket.entry_price) / ticket.entry_price) * 100).toFixed(2)) : 0;
                                
                                this.ledger.closeTicketWithExitInfo(ticket.ticket_id, exitPrice, realizedPct);
                                this.telegram.sendMessage(`⚠️ **[정산 - 수동 매도 감지]**\n- 종목: ${stockCode}\n- 확정 수익률: ${realizedPct}%\n- 사유: 잔고 부족 (사용자가 HTS/MTS로 임의 매도한 것으로 추정)`);
                            }
                        } else {
                            // 부분 처리
                            this.ledger.updateTicketQuantity(ticket.ticket_id, newQuantity);
                            if (ticket.status === 'SELLING') {
                                // 매도 주문이 부분 체결 → 잔여분은 ACTIVE로 복귀 (내일 재청산)
                                this.ledger.markTicketActive(ticket.ticket_id);
                                this.telegram.sendMessage(`⚠️ **[정산 - 부분 매도 반영]**\n- 종목: ${stockCode}\n- 매도 전: ${ticket.quantity}주 → 잔여: ${newQuantity}주\n- 사유: 매도 미체결 잔량 보존. 내일 재청산 예정.`);
                            } else {
                                // 매수 부분 체결
                                this.telegram.sendMessage(`⚠️ **[정산 - 매수 부분 체결 반영]**\n- 종목: ${stockCode}\n- 주문 수량: ${ticket.quantity}주 → 실제 체결: ${newQuantity}주\n- 사유: 조건부 지정가 동시호가 부분 체결`);
                            }
                        }

                        diff -= reduceAmount;
                        changesCount++;
                    }
                } else {
                    // diff < 0: DB 수량이 HTS보다 적음 (비정상 — 로깅만)
                    console.warn(`[LiveTradeReconciliation] 비정상: ${stockCode} DB(${dbTotal}) < HTS(${htsTotal}). 수동 조정이 필요합니다.`);
                    this.telegram.sendMessage(`🚨 **[정산 경고 - 비정상]**\n- 종목: ${stockCode}\n- DB 수량(${dbTotal}주) < HTS 잔고(${htsTotal}주)\n- 장부에 없는 주식이 계좌에 있습니다. 수동 확인이 필요합니다.`);
                }
            }

            console.log('[LiveTradeReconciliation] Reconciliation completed.');
            this.telegram.sendMessage(`✅ **[실전매매 잔고 정합 확인 완료]**\n- 처리된 변경 사항: ${changesCount}건\n- 장부 동기화가 완료되었습니다.`);

        } catch (error: any) {
            console.error('[LiveTradeReconciliation] Error during daily reconciliation:', error);
            eventBus.emit(SystemEvent.LIVE_TRADE_ERROR, {
                time: new Date().toLocaleString('ko-KR', { hour12: false }),
                source: '장 마감 정산',
                message: '장 마감 정산(Reconciliation) 중 에러 발생',
                detail: error.message
            });
            this.telegram.sendMessage(`🚨 **[실전매매 잔고 정합 확인 에러]**\n잔고 대조 중 오류가 발생했습니다.\n- 에러: ${error.message}`);
        }
    }
}
