import sqlite3

def get_db_price(c, code):
    c.execute("SELECT high, close FROM market_ohlcv_history WHERE stock_code = ? ORDER BY date DESC LIMIT 1;", (code,))
    row = c.fetchone()
    if row:
        return row[0], row[1]
    return 0, 0

def run():
    conn = sqlite3.connect(r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db')
    c = conn.cursor()
    c.execute("SELECT t.ticket_id, t.stock_code, t.stock_name, t.entry_price, t.created_at FROM live_trade_tickets t WHERE t.stock_code IN ('251370', '112290');")
    print(c.fetchall())
        
        if max_pct >= target_pct:
            realized_pct = target_pct - 0.23 # slippage
            exit_price = entry * (1 + target_pct / 100) # sold at target
            reason = "목표가 도달 익절 (9%)"
        else:
            realized_pct = (close - entry) / entry * 100 - 0.23 # slippage
            exit_price = close # sold at close
            reason = "종가 손절/청산"
            
        print(f"{name}({code}): Entry={entry}, High={high}({max_pct:.1f}%), Close={close}, Target={target_pct}% -> Result: {realized_pct:.2f}% ({reason})")
        
        c.execute("UPDATE live_trade_tickets SET status='CLOSED', exit_price=?, realized_profit_pct=? WHERE ticket_id=?", (exit_price, realized_pct, ticket_id))
        
    conn.commit()
    conn.close()

if __name__ == '__main__':
    run()
