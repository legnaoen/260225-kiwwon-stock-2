import sqlite3
import json

db_path = r"C:\Users\legna\AppData\Roaming\kiwoom-trader\kiwoom.db"
conn = sqlite3.connect(db_path)
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
    print("No result found in first db. Trying second.")
    conn.close()
    
    db_path2 = r"C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db"
    conn2 = sqlite3.connect(db_path2)
    c2 = conn2.cursor()
    c2.execute("SELECT result FROM ai_execution_log WHERE agent_id = 'PORTFOLIO_MANAGER' ORDER BY queued_at DESC LIMIT 1")
    row2 = c2.fetchone()
    if row2 and row2[0]:
        try:
            data = json.loads(row2[0])
            print(json.dumps(data, indent=2, ensure_ascii=False))
        except:
            print(row2[0])
    else:
        print("No result found in second db either.")
    conn2.close()
