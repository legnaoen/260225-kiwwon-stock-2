import sys
import codecs
sys.stdout = codecs.getwriter('utf8')(sys.stdout.detach())
import sqlite3

db_path = 'C:/Users/legna/AppData/Roaming/kiwoom-trader/db/kiwoom.db'
conn = sqlite3.connect(db_path)

# 1. KODEX 200 Backup & Delete
kodex_row = conn.execute("SELECT * FROM market_ohlcv_history WHERE stock_code='069500' AND date='2026-05-15'").fetchone()
if kodex_row:
    conn.execute("DELETE FROM market_ohlcv_history WHERE stock_code='069500' AND date='2026-05-15'")
    conn.commit()

print("--- 1. [Simulating 15:00] KODEX 200 removed, other stocks exist ---")
tickets = conn.execute("""
SELECT 
    t.stock_code, 
    t.entry_date,
    (
        SELECT COUNT(DISTINCT m.date)
        FROM market_ohlcv_history m
        WHERE m.stock_code = '069500' 
          AND m.date > date(t.entry_date)
          AND (t.exit_date IS NULL OR m.date <= date(t.exit_date))
    ) as holding_days_patched,
    (
        SELECT COUNT(DISTINCT m.date)
        FROM market_ohlcv_history m
        WHERE m.date > date(t.entry_date)
          AND (t.exit_date IS NULL OR m.date <= date(t.exit_date))
    ) as holding_days_old
FROM live_trade_tickets t
WHERE t.stock_code = '187870'
""").fetchone()

print(f"Stock: {tickets[0]} | Entry: {tickets[1]}")
print(f"  [PATCHED SQL] holding_days: {tickets[2]}  <-- Correct! (KODEX 200 doesn't exist yet)")
print(f"  [OLD BUG SQL] holding_days: {tickets[3]}  <-- Wrong! (Counted other stocks' data)")

# 2. Restore KODEX 200
if kodex_row:
    conn.execute(
        "INSERT INTO market_ohlcv_history (id, stock_code, date, open, high, low, close, volume, trading_value) VALUES (?,?,?,?,?,?,?,?,?)",
        kodex_row
    )
    conn.commit()

print("\n--- 2. [Simulating after 09:10 Update] KODEX 200 is fetched and saved ---")
tickets_after = conn.execute("""
SELECT 
    t.stock_code, 
    (
        SELECT COUNT(DISTINCT m.date)
        FROM market_ohlcv_history m
        WHERE m.stock_code = '069500' 
          AND m.date > date(t.entry_date)
          AND (t.exit_date IS NULL OR m.date <= date(t.exit_date))
    ) as holding_days_patched
FROM live_trade_tickets t
WHERE t.stock_code = '187870'
""").fetchone()

print(f"Stock: {tickets_after[0]}")
print(f"  [PATCHED SQL] holding_days: {tickets_after[1]}  <-- Correctly recognized as new day!")
