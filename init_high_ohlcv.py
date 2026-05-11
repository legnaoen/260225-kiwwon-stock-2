import sqlite3

conn=sqlite3.connect(r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db')
c=conn.cursor()

c.execute("SELECT stock_code, stock_name, entry_date, current_price, high_price FROM maiis_portfolio WHERE status = 'HELD'")
items = c.fetchall()

updated = 0
for row in items:
    stock_code, stock_name, entry_date, current_price, high_price = row
    if not entry_date:
        continue
        
    c.execute("SELECT MAX(high) FROM market_ohlcv_history WHERE stock_code = ? AND date >= ?", (stock_code, entry_date))
    ohlcv_max = c.fetchone()[0]
    
    new_high = high_price or 0
    if current_price and current_price > new_high:
        new_high = current_price
        
    if ohlcv_max and ohlcv_max > new_high:
        new_high = ohlcv_max
        
    if new_high > (high_price or 0):
        c.execute("UPDATE maiis_portfolio SET high_price = ? WHERE stock_code = ?", (new_high, stock_code))
        print(f"[{stock_name}] 고점 갱신: {high_price} -> {new_high}")
        updated += 1

conn.commit()
print(f"Total {updated} stocks updated with OHLCV data.")
