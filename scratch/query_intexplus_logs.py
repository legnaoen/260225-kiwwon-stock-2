import sqlite3
import json

conn = sqlite3.connect(r"C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db")
c = conn.cursor()

print("=== Log events for 064290 ===")
c.execute("SELECT timestamp, type, stock_code, message, order_no, rsp_cd, api_response FROM live_trade_logs WHERE timestamp >= '2026-05-22' AND stock_code = '064290' ORDER BY timestamp DESC")
for row in c.fetchall():
    print({
        "timestamp": row[0],
        "type": row[1],
        "stock_code": row[2],
        "message": row[3],
        "order_no": row[4],
        "rsp_cd": row[5],
        "api_response": row[6]
    })

print("\n=== Log events containing upper limit or error ===")
c.execute("SELECT timestamp, type, stock_code, message FROM live_trade_logs WHERE timestamp >= '2026-05-22' AND (message LIKE '%상한가%' OR message LIKE '%실패%' OR type = 'ERROR') ORDER BY timestamp DESC LIMIT 30")
for row in c.fetchall():
    print(row)

conn.close()
