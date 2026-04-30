import sqlite3
import json
conn = sqlite3.connect(r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db')
c = conn.cursor()
c.execute("SELECT date, type, name, top_picks_json FROM theme_intelligence WHERE date='2026-04-30' LIMIT 50")
rows = c.fetchall()
for row in rows:
    picks = json.loads(row[3]) if row[3] else []
    print(f"{row[0]} | {row[1]} | {row[2]} | picks: {len(picks)}")
    if picks:
        print(f"  -> {[p.get('stock_name') for p in picks]}")

