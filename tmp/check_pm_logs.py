import sqlite3

DB_PATH = r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db'
db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

# PM 이벤트 로그 확인
print('=== PM 관련 이벤트 로그 (최근 20건) ===')
try:
    rows = db.execute("""
        SELECT event_type, substr(event_detail,1,100) as detail, event_date, stock_code
        FROM maiis_portfolio_events
        ORDER BY id DESC LIMIT 20
    """).fetchall()
    for r in rows:
        print(dict(r))
except Exception as e:
    print(f'Event logs error: {e}')

# AI 실행 로그 확인
print('\n=== AI 실행 로그 (최근) ===')
try:
    rows = db.execute("""
        SELECT substr(message,1,120) as msg, created_at
        FROM ai_run_logs
        ORDER BY id DESC LIMIT 20
    """).fetchall()
    for r in rows:
        print(dict(r))
except Exception as e:
    print(f'Run logs error: {e}')

# 오늘 날짜 추천주 중 PM1이 포트폴리오에 넣은 이력 확인  
print('\n=== maiis_portfolio created_at 확인 (오늘) ===')
try:
    rows = db.execute("""
        SELECT stock_code, stock_name, status, substr(created_at,1,16) as created, substr(updated_at,1,16) as updated
        FROM maiis_portfolio 
        WHERE created_at >= '2026-04-13' 
        ORDER BY created_at DESC
    """).fetchall()
    for r in rows:
        print(dict(r))
    if not rows:
        print('(오늘 생성된 포트폴리오 항목 없음)')
except Exception as e:
    print(f'Error: {e}')

db.close()
