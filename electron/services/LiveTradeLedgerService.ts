import { DatabaseService } from './DatabaseService';
import { v4 as uuidv4 } from 'uuid';

export interface LiveTradeTicket {
    ticket_id: string;
    stock_code: string;
    stock_name?: string;      // 종목명 (표시용)
    entry_date: string;
    entry_price: number;
    quantity: number;
    strategy_category: string;
    target_exit_date: string;
    status: 'ACTIVE' | 'CLOSED' | 'FAILED' | 'SELLING';
    fail_reason?: string;
    order_no?: string;        // 키움 주문번호 (BUY_ACK 후 저장)
    created_at: string;
    updated_at: string;
}

export interface LiveTradeStrategy {
    id: string;
    strategy_category: string;
    is_active: number;
    buy_amount_per_trade: number;
    max_hold_days: number;
    target_profit_rate: number;
    updated_at: string;
}

export class LiveTradeLedgerService {
    private static instance: LiveTradeLedgerService;
    private db = DatabaseService.getInstance();

    private constructor() {}

    public static getInstance(): LiveTradeLedgerService {
        if (!LiveTradeLedgerService.instance) {
            LiveTradeLedgerService.instance = new LiveTradeLedgerService();
        }
        return LiveTradeLedgerService.instance;
    }

    // ─── Strategies Management ────────────────────────────────────────────────
    
    public getStrategies(): LiveTradeStrategy[] {
        const sql = `SELECT * FROM live_trade_strategies`;
        return (this.db as any).db.prepare(sql).all() as LiveTradeStrategy[];
    }

    public getActiveStrategies(): LiveTradeStrategy[] {
        const sql = `SELECT * FROM live_trade_strategies WHERE is_active = 1`;
        return (this.db as any).db.prepare(sql).all() as LiveTradeStrategy[];
    }

    public upsertStrategy(strategy: Omit<LiveTradeStrategy, 'id' | 'updated_at'>): void {
        const id = uuidv4();
        const now = this.db.getKstTimestamp();
        
        // If this strategy is being set to active, deactivate all others
        if (strategy.is_active === 1) {
            const disableOthersSql = `UPDATE live_trade_strategies SET is_active = 0`;
            (this.db as any).db.prepare(disableOthersSql).run();
        }

        const sql = `
            INSERT INTO live_trade_strategies (
                id, strategy_category, is_active, buy_amount_per_trade, max_hold_days, target_profit_rate, updated_at
            ) VALUES (
                $id, $category, $isActive, $buyAmount, $maxHoldDays, $targetProfit, $updatedAt
            )
            ON CONFLICT(strategy_category) DO UPDATE SET
                is_active = excluded.is_active,
                buy_amount_per_trade = excluded.buy_amount_per_trade,
                max_hold_days = excluded.max_hold_days,
                target_profit_rate = excluded.target_profit_rate,
                updated_at = excluded.updated_at
        `;
        
        (this.db as any).db.prepare(sql).run({
            id: id,
            category: strategy.strategy_category,
            isActive: strategy.is_active,
            buyAmount: strategy.buy_amount_per_trade,
            maxHoldDays: strategy.max_hold_days,
            targetProfit: strategy.target_profit_rate,
            updatedAt: now
        });
    }

    // ─── Tickets Management ───────────────────────────────────────────────────

    public createTicket(ticket: Omit<LiveTradeTicket, 'ticket_id' | 'created_at' | 'updated_at'>): string {
        const sql = `
            INSERT INTO live_trade_tickets (
                ticket_id, stock_code, stock_name, entry_date, entry_price, quantity, strategy_category, target_exit_date, status, fail_reason, order_no, created_at, updated_at
            ) VALUES (
                $id, $stockCode, $stockName, $entryDate, $entryPrice, $quantity, $category, $targetExitDate, $status, $failReason, $orderNo, $now, $now
            )
        `;

        const ticketId = uuidv4();
        const now = this.db.getKstTimestamp();

        (this.db as any).db.prepare(sql).run({
            id: ticketId,
            stockCode: ticket.stock_code,
            stockName: ticket.stock_name || '',
            entryDate: ticket.entry_date,
            entryPrice: ticket.entry_price,
            quantity: ticket.quantity,
            category: ticket.strategy_category,
            targetExitDate: ticket.target_exit_date,
            status: ticket.status || 'ACTIVE',
            failReason: ticket.fail_reason || null,
            orderNo: ticket.order_no || '',
            now: now
        });

        return ticketId;
    }

    public getAllTickets(): LiveTradeTicket[] {
        const sql = `SELECT * FROM live_trade_tickets ORDER BY entry_date DESC`;
        return (this.db as any).db.prepare(sql).all() as LiveTradeTicket[];
    }

    public getActiveTickets(): LiveTradeTicket[] {
        const sql = `SELECT * FROM live_trade_tickets WHERE status = 'ACTIVE' ORDER BY entry_date DESC`;
        return (this.db as any).db.prepare(sql).all() as LiveTradeTicket[];
    }

    public getActiveAndSellingTickets(): LiveTradeTicket[] {
        const sql = `SELECT * FROM live_trade_tickets WHERE status IN ('ACTIVE', 'SELLING') ORDER BY entry_date DESC`;
        return (this.db as any).db.prepare(sql).all() as LiveTradeTicket[];
    }

    public getActiveTicketsByStock(stockCode: string): LiveTradeTicket[] {
        const sql = `SELECT * FROM live_trade_tickets WHERE status = 'ACTIVE' AND stock_code = ? ORDER BY entry_date ASC`;
        return (this.db as any).db.prepare(sql).all(stockCode) as LiveTradeTicket[];
    }

    public closeTicket(ticketId: string): void {
        const sql = `UPDATE live_trade_tickets SET status = 'CLOSED', updated_at = ? WHERE ticket_id = ?`;
        const now = this.db.getKstTimestamp();
        (this.db as any).db.prepare(sql).run(now, ticketId);
    }

    public markTicketSelling(ticketId: string): void {
        const sql = `UPDATE live_trade_tickets SET status = 'SELLING', updated_at = ? WHERE ticket_id = ?`;
        const now = this.db.getKstTimestamp();
        (this.db as any).db.prepare(sql).run(now, ticketId);
    }

    public markTicketActive(ticketId: string): void {
        const sql = `UPDATE live_trade_tickets SET status = 'ACTIVE', updated_at = ? WHERE ticket_id = ?`;
        const now = this.db.getKstTimestamp();
        (this.db as any).db.prepare(sql).run(now, ticketId);
    }

    public updateTicketQuantity(ticketId: string, newQuantity: number): void {
        const sql = `UPDATE live_trade_tickets SET quantity = ?, updated_at = ? WHERE ticket_id = ?`;
        const now = this.db.getKstTimestamp();
        (this.db as any).db.prepare(sql).run(newQuantity, now, ticketId);
    }

    public markTicketFailed(ticketId: string, reason: string): void {
        const sql = `UPDATE live_trade_tickets SET status = 'FAILED', fail_reason = ?, updated_at = ? WHERE ticket_id = ?`;
        const now = this.db.getKstTimestamp();
        (this.db as any).db.prepare(sql).run(reason, now, ticketId);
    }

    /**
     * 키움 주문번호를 티켓에 연결 — 매수 주문 ACK 직후 호출
     */
    public updateOrderNo(ticketId: string, orderNo: string): void {
        const sql = `UPDATE live_trade_tickets SET order_no = ?, updated_at = ? WHERE ticket_id = ?`;
        const now = this.db.getKstTimestamp();
        (this.db as any).db.prepare(sql).run(orderNo, now, ticketId);
    }

    /**
     * 실제 체결가로 entry_price 업데이트 — 장 마감 정산(Reconciliation) 시 호출
     * cntr_uv: kt00007 응답의 체결단가 필드
     */
    public updateEntryPrice(ticketId: string, actualPrice: number): void {
        const sql = `UPDATE live_trade_tickets SET entry_price = ?, updated_at = ? WHERE ticket_id = ?`;
        const now = this.db.getKstTimestamp();
        (this.db as any).db.prepare(sql).run(actualPrice, now, ticketId);
    }

    /**
     * FAILED 티켓 삭제 — UI에서 사용자가 수동으로 제거할 때 호출
     * 안전을 위해 FAILED 상태인 티켓만 삭제 허용
     */
    public deleteTicket(ticketId: string): { deleted: boolean; reason?: string } {
        const ticket = (this.db as any).db.prepare(
            `SELECT ticket_id, status FROM live_trade_tickets WHERE ticket_id = ?`
        ).get(ticketId) as { ticket_id: string; status: string } | undefined;

        if (!ticket) {
            return { deleted: false, reason: '티켓을 찾을 수 없습니다.' };
        }
        if (ticket.status !== 'FAILED') {
            return { deleted: false, reason: `FAILED 상태인 티켓만 삭제 가능합니다. (현재: ${ticket.status})` };
        }

        (this.db as any).db.prepare(`DELETE FROM live_trade_tickets WHERE ticket_id = ?`).run(ticketId);
        return { deleted: true };
    }
}
