import sqlite3

DB_PATH = r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db'
db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

# AI raw log 확인 (PM 관련)
print('=== AI daily raw logs (PM) ===')
try:
    rows = db.execute("""
        SELECT date, agent_type, substr(raw_text,1,200) as head
        FROM ai_daily_raw_logs
        WHERE agent_type LIKE '%PORTFOLIO%' OR agent_type LIKE '%PM%'
        ORDER BY date DESC, created_at DESC
        LIMIT 10
    """).fetchall()
    for r in rows:
        print(dict(r))
except Exception as e:
    print(f'Error: {e}')

# PM 이벤트 로그
print('\n=== portfolio_events 컬럼 확인 ===')
try:
    cols = db.execute("PRAGMA table_info(maiis_portfolio_events)").fetchall()
    for c in cols:
        print(dict(c))
except Exception as e:
    print(f'Error: {e}')

print('\n=== maiis_portfolio_events (최근 10건) ===')
try:
    rows = db.execute("""
        SELECT * FROM maiis_portfolio_events
        ORDER BY id DESC LIMIT 10
    """).fetchall()
    for r in rows:
        d = dict(r)
        # truncate long fields
        for k,v in d.items():
            if isinstance(v, str) and len(v) > 100:
                d[k] = v[:100] + '...'
        print(d)
except Exception as e:
    print(f'Error: {e}')

# 오늘 09:45 PM1 실행 여부 확인: 만약 PM1이 실행되었다면 ai_daily_raw_logs에 PM1 관련 로그가 있을 것
print('\n=== 오늘 ai_analyst_picks 시간순 ===')
rows = db.execute("""
    SELECT stock_code, stock_name, agent_type, created_at 
    FROM ai_analyst_picks 
    WHERE date = '2026-04-13' 
    ORDER BY created_at ASC
""").fetchall()
for r in rows:
    print(dict(r))

db.close()
