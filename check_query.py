import sqlite3
import os
db_path = os.path.join(os.environ['APPDATA'], 'kiwoom-trader', 'db', 'kiwoom.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
query = """
SELECT 
    mat.stock_code, mat.stock_name, mat.entry_price, mat.current_price as original_cp,
    COALESCE(
        (SELECT close FROM market_ohlcv_history 
         WHERE stock_code = REPLACE(mat.stock_code, 'A', '') 
         ORDER BY date DESC LIMIT 1),
        mat.current_price
    ) AS current_price
FROM moonshot_active_tracking mat
ORDER BY mat.created_at DESC
"""
cur.execute(query)
rows = cur.fetchall()
for r in rows:
    print(dict(r))
conn.close()
