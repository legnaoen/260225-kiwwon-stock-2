import sqlite3
import json
import os

db_path = os.path.expandvars(r"%APPDATA%\kiwoom-trader\db\kiwoom.db")
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

# Get recent dates
cursor.execute("SELECT DISTINCT date FROM naver_market_flow WHERE type='THEME' ORDER BY date DESC LIMIT 5")
dates = [r['date'] for r in cursor.fetchall()]

qmarks = ','.join(['?']*len(dates))

cursor.execute(f"SELECT date, name FROM naver_market_flow WHERE type='THEME' AND date IN ({qmarks})", dates)
flow_data = [dict(r) for r in cursor.fetchall()]

cursor.execute(f"SELECT date, name, reason FROM theme_intelligence WHERE type='THEME' AND date IN ({qmarks})", dates)
intel_data = [dict(r) for r in cursor.fetchall()]

# simulate join for '광통신'
matched = []
for flow in flow_data:
    if '광통신' in flow['name']:
        matches = [i for i in intel_data if i['date'] == flow['date'] and i['name'] == flow['name']]
        reason = matches[0]['reason'] if matches else None
        print(f"Flow Name: {flow['name']}, Date: {flow['date']}, Has Reason: {bool(reason)}")

conn.close()
