import sqlite3, os
db_path = os.path.join(os.environ['APPDATA'], 'kiwoom-trader', 'db', 'kiwoom.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("SELECT MAX(date) as latest, COUNT(DISTINCT stock_code) as total_stocks FROM market_ohlcv_history")
row = cur.fetchone()
print(f"DB 최신 날짜: {row[0]} | 총 종목 수: {row[1]}")

cur.execute("SELECT date, COUNT(stock_code) as cnt FROM market_ohlcv_history WHERE date >= '2026-04-15' GROUP BY date ORDER BY date DESC")
rows = cur.fetchall()
print("최근 날짜별 종목 수:")
for r in rows:
    print(f"  {r[0]}: {r[1]}개")

# 오늘(2026-04-22) 데이터 있는지 확인
cur.execute("SELECT COUNT(stock_code) FROM market_ohlcv_history WHERE date = '2026-04-22'")
today = cur.fetchone()
print(f"\n2026-04-22 데이터: {today[0]}개")

# 텐베거 Active Tracking 종목들의 OHLCV 상태
cur.execute("SELECT stock_code, stock_name FROM moonshot_active_tracking WHERE is_invalidated = 0 LIMIT 10")
moonshot_stocks = cur.fetchall()
print(f"\n텐베거 Active Tracking 종목 ({len(moonshot_stocks)}개):")
for code, name in moonshot_stocks:
    clean_code = code.replace('A', '', 1) if code.startswith('A') else code
    cur.execute("SELECT MAX(date), close FROM market_ohlcv_history WHERE stock_code = ?", (clean_code,))
    ohlcv = cur.fetchone()
    print(f"  {name}({clean_code}): 최신 OHLCV={ohlcv}")

conn.close()
