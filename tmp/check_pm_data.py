import sqlite3

DB_PATH = r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db'
db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

print('=== ai_analyst_picks 최근 날짜별 요약 ===')
rows = db.execute('SELECT date, agent_type, COUNT(*) as cnt FROM ai_analyst_picks GROUP BY date, agent_type ORDER BY date DESC LIMIT 20').fetchall()
for r in rows:
    print(dict(r))

print('\n=== maiis_portfolio 활성 종목 ===')
rows2 = db.execute("SELECT stock_code, stock_name, status, strategy, conviction_score, substr(updated_at,1,16) as upd FROM maiis_portfolio WHERE status NOT IN ('DROPPED','HIT') ORDER BY conviction_score DESC").fetchall()
for r in rows2:
    print(dict(r))

print('\n=== maiis_portfolio WATCHLIST 상태 종목 ===')
rows3 = db.execute("SELECT stock_code, stock_name, status, last_signal_reason FROM maiis_portfolio WHERE status = 'WATCHLIST'").fetchall()
for r in rows3:
    print(dict(r))

# Check the PM1 vs picks relationship
print('\n=== 추천주가 포트폴리오와 겹치는지 확인 ===')
latest_date = db.execute('SELECT MAX(date) as d FROM ai_analyst_picks').fetchone()['d']
print(f'Latest picks date: {latest_date}')

if latest_date:
    picks = db.execute('SELECT stock_code, stock_name, agent_type FROM ai_analyst_picks WHERE date = ?', (latest_date,)).fetchall()
    active = db.execute("SELECT stock_code FROM maiis_portfolio WHERE status NOT IN ('DROPPED','HIT')").fetchall()
    active_codes = set(r['stock_code'] for r in active)
    
    overlap = 0
    new = 0
    for p in picks:
        if p['stock_code'] in active_codes:
            overlap += 1
        else:
            new += 1
            print(f'  NEW: {p["stock_name"]}({p["stock_code"]}) by {p["agent_type"]}')
    print(f'\n총 추천주: {len(picks)}, 이미 포트폴리오에 있음: {overlap}, 신규: {new}')

db.close()
