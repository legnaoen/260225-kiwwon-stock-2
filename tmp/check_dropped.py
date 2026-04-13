import sqlite3

DB_PATH = r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db'
db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

print('=== DROPPED 종목 상세 ===')
rows = db.execute("""
    SELECT stock_code, stock_name, status, strategy, last_signal_reason, substr(updated_at,1,16) as upd 
    FROM maiis_portfolio 
    WHERE status='DROPPED' 
    ORDER BY updated_at DESC
""").fetchall()
for r in rows:
    print(dict(r))

print('\n=== 전체 maiis_portfolio ===')
all_rows = db.execute("""
    SELECT stock_code, stock_name, status, strategy, conviction_score, last_signal_reason, substr(updated_at,1,16) as upd
    FROM maiis_portfolio 
    ORDER BY updated_at DESC
""").fetchall()
for r in all_rows:
    print(dict(r))

db.close()
