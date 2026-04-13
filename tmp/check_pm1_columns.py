import sqlite3, os

DB_PATH = r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db'
db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

print("=== [진단1] upsertPortfolioWatchlist ON CONFLICT 대상 확인 ===")
# DROPPED 포함 모든 종목 조회 (ON CONFLICT stock_code 기준)
today_picks = db.execute(
    "SELECT stock_code, stock_name, agent_type FROM ai_analyst_picks WHERE date = '2026-04-13'"
).fetchall()
pick_codes = [r['stock_code'] for r in today_picks]

existing = db.execute(
    f"SELECT stock_code, stock_name, status FROM maiis_portfolio WHERE stock_code IN ({','.join(['?']*len(pick_codes))})",
    pick_codes
).fetchall()

print(f"오늘 추천 {len(today_picks)}개 중 maiis_portfolio에 이미 있는 종목:")
for r in existing:
    print(f"  {r['stock_name']}({r['stock_code']}) → status={r['status']}")
if not existing:
    print("  없음 (전부 신규 INSERT 대상)")

print("\n=== [진단2] getActivePortfolio() 결과 재현 ===")
active = db.execute(
    "SELECT stock_code, stock_name, status FROM maiis_portfolio WHERE status NOT IN ('DROPPED', 'HIT') ORDER BY conviction_score DESC"
).fetchall()
print(f"getActivePortfolio() 반환 종목 수: {len(active)}")
for r in active:
    print(f"  {r['stock_name']}({r['stock_code']}) status={r['status']}")

print("\n=== [진단3] PM1 필터링 시뮬레이션 ===")
active_codes = set(r['stock_code'] for r in active)
new_picks = [r for r in today_picks if r['stock_code'] not in active_codes]
print(f"신규 추천주 (activePortfolio 제외 후): {len(new_picks)}개")

print("\n=== [진단4] TelegramService import 경로 ===")
# 빌드된 청크에서 TelegramService 파일 이름 확인
import glob
patterns = glob.glob(r'C:\Users\legna\Projects\260224 kiwoom rest api\dist-electron\Telegram*.js')
print(f"TelegramService 청크: {[os.path.basename(p) for p in patterns]}")

print("\n=== [진단5] PM1 실제 실행 후 DB 상태 (다음에 실행 후 다시 확인) ===")
watchlist = db.execute("SELECT * FROM maiis_portfolio WHERE status = 'WATCHLIST'").fetchall()
print(f"현재 WATCHLIST 종목 수: {len(watchlist)}")
for r in watchlist:
    print(f"  {r['stock_name']}({r['stock_code']})")

db.close()
