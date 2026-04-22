import sqlite3
import os
db_path = os.path.join(os.environ['APPDATA'], 'kiwoom-trader', 'db', 'kiwoom.db')
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
query = """
    SELECT 
        mat.stock_code,
        mdr.daily_narrative AS latest_daily_narrative,
        mdr.verdict AS latest_verdict,
        mdr.reviewed_at AS latest_reviewed_at
    FROM moonshot_active_tracking mat
    LEFT JOIN (
        SELECT stock_code, daily_narrative, verdict, reviewed_at,
               ROW_NUMBER() OVER(PARTITION BY stock_code ORDER BY reviewed_at DESC) as rn
        FROM moonshot_daily_review
    ) mdr ON mdr.stock_code = mat.stock_code AND mdr.rn = 1
    ORDER BY mat.created_at DESC
"""
cur.execute(query)
rows = cur.fetchall()
for r in rows:
    print(dict(r))
conn.close()
