import sqlite3

db_path = r"C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db"
conn = sqlite3.connect(db_path)
c = conn.cursor()
c.execute("SELECT result FROM ai_execution_log WHERE agent_id = 'PORTFOLIO_MANAGER' ORDER BY queued_at DESC LIMIT 1")
row = c.fetchone()
if row and row[0]:
    with open('dump.json', 'w', encoding='utf-8') as f:
        f.write(row[0])
    print("Dumped to dump.json")
else:
    print("No result found.")
conn.close()
