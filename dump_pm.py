import sqlite3
import json

conn = sqlite3.connect('kiwoom.db')
c = conn.cursor()
c.execute("SELECT result FROM ai_execution_log WHERE agent_id = 'PORTFOLIO_MANAGER' ORDER BY queued_at DESC LIMIT 1")
row = c.fetchone()
if row and row[0]:
    try:
        data = json.loads(row[0])
        print(json.dumps(data, indent=2, ensure_ascii=False))
    except:
        print(row[0])
else:
    print("No result found")
conn.close()
