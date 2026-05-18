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
    ai_score?: number;        // AI 점수
    related_themes?: string;  // 관련 테마
    exit_price?: number;      // 매도 체결 단가
    exit_date?: string;       // 매도 체결 일시
    realized_profit_pct?: number; // 최종 확정 수익률
    created_at: string;
    updated_at: string;
    target_days?: number;
    holding_days?: number;
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
        
        // 다중 전략 운용을 위해 기존 전략의 is_active=0 강제 해제 로직 삭제


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
                ticket_id, stock_code, stock_name, entry_date, entry_price, quantity, strategy_category, target_exit_date, status, fail_reason, order_no, ai_score, related_themes, created_at, updated_at
            ) VALUES (
                $id, $stockCode, $stockName, $entryDate, $entryPrice, $quantity, $category, $targetExitDate, $status, $failReason, $orderNo, $aiScore, $relatedThemes, $now, $now
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
            aiScore: ticket.ai_score || 0,
            relatedThemes: ticket.related_themes || '',
            now: now
        });

        // [Bugfix] 당일 전량 매도(조건부 지정가) 후 당일 재매수(동시호가) 시,
        // 잔고가 0이 되는 순간이 포착되지 않아 과거 매수일이 계속 유지되는 현상을 방지.
        // 새로운 티켓이 생성되면 무조건 holding_history의 진입일도 최신으로 엎어칩니다.
        const entryDateOnly = ticket.entry_date.split('T')[0];
        (this.db as any).db.prepare(`
            INSERT INTO holding_history (stock_code, first_seen_date) 
            VALUES (?, ?)
            ON CONFLICT(stock_code) DO UPDATE SET first_seen_date = excluded.first_seen_date
        `).run(ticket.stock_code, entryDateOnly);

        return ticketId;
    }

    public getAllTickets(): LiveTradeTicket[] {
        const sql = `
            SELECT 
                t.*,
                s.max_hold_days as target_days,
                (
                    SELECT COUNT(DISTINCT m.date)
                    FROM market_ohlcv_history m
                    WHERE m.stock_code = '069500' 
                      AND m.date > date(t.entry_date)
                      AND (t.exit_date IS NULL OR m.date <= date(t.exit_date))
                ) as holding_days,
                (
                    SELECT MAX(((m.high - t.entry_price) / t.entry_price) * 100)
                    FROM market_ohlcv_history m
                    WHERE m.stock_code = t.stock_code 
                      AND m.date > date(t.entry_date)
                      AND (t.exit_date IS NULL OR m.date <= date(t.exit_date))
                      AND t.entry_price > 0
                ) as peak_return
            FROM live_trade_tickets t
            LEFT JOIN live_trade_strategies s ON t.strategy_category = s.strategy_category
            ORDER BY t.entry_date DESC
        `;
        return (this.db as any).db.prepare(sql).all() as LiveTradeTicket[];
    }

    public getActiveTickets(): LiveTradeTicket[] {
        const sql = `
            SELECT 
                t.*,
                s.max_hold_days as target_days,
                (
                    SELECT COUNT(DISTINCT m.date)
                    FROM market_ohlcv_history m
                    WHERE m.stock_code = '069500' 
                      AND m.date > date(t.entry_date)
                      AND (t.exit_date IS NULL OR m.date <= date(t.exit_date))
                ) as holding_days,
                (
                    SELECT MAX(((m.high - t.entry_price) / t.entry_price) * 100)
                    FROM market_ohlcv_history m
                    WHERE m.stock_code = t.stock_code 
                      AND m.date > date(t.entry_date)
                      AND (t.exit_date IS NULL OR m.date <= date(t.exit_date))
                      AND t.entry_price > 0
                ) as peak_return
            FROM live_trade_tickets t
            LEFT JOIN live_trade_strategies s ON t.strategy_category = s.strategy_category
            WHERE t.status = 'ACTIVE' 
            ORDER BY t.entry_date DESC
        `;
        return (this.db as any).db.prepare(sql).all() as LiveTradeTicket[];
    }

    public getActiveAndSellingTickets(): LiveTradeTicket[] {
        const sql = `
            SELECT 
                t.*,
                s.max_hold_days as target_days,
                (
                    SELECT COUNT(DISTINCT m.date)
                    FROM market_ohlcv_history m
                    WHERE m.stock_code = '069500' 
                      AND m.date > date(t.entry_date)
                      AND (t.exit_date IS NULL OR m.date <= date(t.exit_date))
                ) as holding_days,
                (
                    SELECT MAX(((m.high - t.entry_price) / t.entry_price) * 100)
                    FROM market_ohlcv_history m
                    WHERE m.stock_code = t.stock_code 
                      AND m.date > date(t.entry_date)
                      AND (t.exit_date IS NULL OR m.date <= date(t.exit_date))
                      AND t.entry_price > 0
                ) as peak_return
            FROM live_trade_tickets t
            LEFT JOIN live_trade_strategies s ON t.strategy_category = s.strategy_category
            WHERE t.status IN ('ACTIVE', 'SELLING') 
            ORDER BY t.entry_date DESC
        `;
        return (this.db as any).db.prepare(sql).all() as LiveTradeTicket[];
    }

    public getActiveTicketsByStock(stockCode: string): LiveTradeTicket[] {
        const sql = `
            SELECT 
                t.*,
                s.max_hold_days as target_days,
                (
                    SELECT COUNT(DISTINCT m.date)
                    FROM market_ohlcv_history m
                    WHERE m.stock_code = '069500' 
                      AND m.date > date(t.entry_date)
                      AND (t.exit_date IS NULL OR m.date <= date(t.exit_date))
                ) as holding_days,
                (
                    SELECT MAX(((m.high - t.entry_price) / t.entry_price) * 100)
                    FROM market_ohlcv_history m
                    WHERE m.stock_code = t.stock_code 
                      AND m.date > date(t.entry_date)
                      AND (t.exit_date IS NULL OR m.date <= date(t.exit_date))
                      AND t.entry_price > 0
                ) as peak_return
            FROM live_trade_tickets t
            LEFT JOIN live_trade_strategies s ON t.strategy_category = s.strategy_category
            WHERE t.status = 'ACTIVE' AND t.stock_code = ? 
            ORDER BY t.entry_date ASC
        `;
        return (this.db as any).db.prepare(sql).all(stockCode) as LiveTradeTicket[];
    }

    public closeTicket(ticketId: string): void {
        const sql = `UPDATE live_trade_tickets SET status = 'CLOSED', updated_at = ? WHERE ticket_id = ?`;
        const now = this.db.getKstTimestamp();
        (this.db as any).db.prepare(sql).run(now, ticketId);
    }

    public closeTicketWithExitInfo(ticketId: string, exitPrice: number, realizedProfitPct: number): void {
        const sql = `UPDATE live_trade_tickets SET status = 'CLOSED', exit_price = ?, exit_date = ?, realized_profit_pct = ?, updated_at = ? WHERE ticket_id = ?`;
        const now = this.db.getKstTimestamp();
        (this.db as any).db.prepare(sql).run(exitPrice, now, realizedProfitPct, now, ticketId);
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
     * DB에서 특정 티켓의 현재 상태를 빠르게 확인합니다.
     */
    public getTicketStatus(ticketId: string): string | null {
        const ticket = (this.db as any).db.prepare(
            `SELECT status FROM live_trade_tickets WHERE ticket_id = ?`
        ).get(ticketId) as { status: string } | undefined;
        return ticket ? ticket.status : null;
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

    // ─── Portfolio Cohort Peaks ───────────────────────────────────────────────────

    public upsertCohortPeak(entryDate: string, peakReturnPct: number, peakTime: string): void {
        const sql = `
            INSERT INTO live_trade_portfolio_peaks (entry_date, peak_return_pct, peak_time, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(entry_date) DO UPDATE SET
                peak_return_pct = excluded.peak_return_pct,
                peak_time = excluded.peak_time,
                updated_at = excluded.updated_at
        `;
        const now = this.db.getKstTimestamp();
        (this.db as any).db.prepare(sql).run(entryDate, peakReturnPct, peakTime, now);
    }

    public getAllCohortPeaks(): { entry_date: string; peak_return_pct: number; peak_time: string; updated_at: string }[] {
        const sql = `SELECT * FROM live_trade_portfolio_peaks ORDER BY entry_date DESC`;
        return (this.db as any).db.prepare(sql).all() as any[];
    }

    public upsertPortfolioTimeseries(entryDate: string, tradingDate: string, timeSlot: string, highPct: number, lowPct: number, closePct: number): void {
        const sql = `
            INSERT INTO live_trade_portfolio_timeseries (entry_date, trading_date, time_slot, high_pct, low_pct, close_pct, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entry_date, trading_date, time_slot) DO UPDATE SET
                high_pct = excluded.high_pct,
                low_pct = excluded.low_pct,
                close_pct = excluded.close_pct,
                updated_at = excluded.updated_at
        `;
        const now = this.db.getKstTimestamp();
        (this.db as any).db.prepare(sql).run(entryDate, tradingDate, timeSlot, highPct, lowPct, closePct, now);
    }

    public getTimingAnalysisData(): { 
        peakDistribution: { yield: string; count: number }[],
        timeTrajectory: { time: string; return: number }[],
        sampleCount: number
    } {
        const peaks = this.getAllCohortPeaks();
        const sampleCount = peaks.length;
        
        const distribution = [
            { yield: '-1.0% 이하', count: 0 },
            { yield: '-0.5%', count: 0 },
            { yield: '0.0%', count: 0 },
            { yield: '+1.0%', count: 0 },
            { yield: '+2.0%', count: 0 },
            { yield: '+3.0%', count: 0 },
            { yield: '+4.0%', count: 0 },
            { yield: '+5.0% 이상', count: 0 },
        ];
        
        for (const peak of peaks) {
            const val = peak.peak_return_pct;
            if (val <= -1.0) distribution[0].count++;
            else if (val <= -0.5) distribution[1].count++;
            else if (val <= 0.0) distribution[2].count++;
            else if (val <= 1.0) distribution[3].count++;
            else if (val <= 2.0) distribution[4].count++;
            else if (val <= 3.0) distribution[5].count++;
            else if (val <= 4.0) distribution[6].count++;
            else distribution[7].count++;
        }

        const sql = `
            SELECT time_slot as time, AVG(close_pct) as avg_return
            FROM live_trade_portfolio_timeseries
            WHERE trading_date > entry_date
            GROUP BY time_slot
            ORDER BY time_slot ASC
        `;
        const rows = (this.db as any).db.prepare(sql).all() as { time: string; avg_return: number }[];
        const timeTrajectory = rows.map(r => ({
            time: r.time,
            return: Number((r.avg_return || 0).toFixed(2))
        }));

        return {
            peakDistribution: distribution,
            timeTrajectory,
            sampleCount
        };
    }

    public getTimingRawData(limit: number, offset: number): any[] {
        // 1. Get unique (entry_date, trading_date) pairs with pagination
        const pairsSql = `
            SELECT DISTINCT entry_date, trading_date
            FROM live_trade_portfolio_timeseries
            ORDER BY trading_date DESC, entry_date DESC
            LIMIT ? OFFSET ?
        `;
        const pairs = (this.db as any).db.prepare(pairsSql).all(limit, offset) as { entry_date: string; trading_date: string }[];
        
        if (pairs.length === 0) return [];

        // 2. Fetch all timeseries rows for these pairs
        const result: any[] = [];
        for (const pair of pairs) {
            const rowsSql = `
                SELECT time_slot, close_pct
                FROM live_trade_portfolio_timeseries
                WHERE entry_date = ? AND trading_date = ?
                ORDER BY time_slot ASC
            `;
            const rows = (this.db as any).db.prepare(rowsSql).all(pair.entry_date, pair.trading_date) as { time_slot: string; close_pct: number }[];
            
            // Map time_slot to close_pct
            const timeMap: Record<string, number> = {};
            for (const r of rows) {
                timeMap[r.time_slot] = r.close_pct;
            }
            
            result.push({
                entry_date: pair.entry_date,
                trading_date: pair.trading_date,
                times: timeMap
            });
        }
        
        return result;
    }
}
