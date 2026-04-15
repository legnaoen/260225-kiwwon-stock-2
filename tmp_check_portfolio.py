import sqlite3
import json

DB_PATH = r"C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db"
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
c = conn.cursor()

today = "2026-04-15"

print("=" * 60)
print("=== 1. 오늘 PM AI 실행 로그 (ai_execution_log) ===")
print("=" * 60)
c.execute("""
    SELECT agent_id, agent_name, status, queued_at, finished_at, duration_ms, error
    FROM ai_execution_log
    WHERE queued_at LIKE ?
    ORDER BY queued_at ASC
""", (f"{today}%",))
for r in c.fetchall():
    print(f"[{r['queued_at']}] {r['agent_id']} | {r['status']} | {r['duration_ms']}ms | err={r['error']}")

print()
print("=" * 60)
print("=== 2. 오늘 ai_analyst_picks (PM1 소스 데이터) ===")
print("=" * 60)
c.execute("""
    SELECT COUNT(*) as cnt, agent_type FROM ai_analyst_picks
    WHERE date = ?
    GROUP BY agent_type
""", (today,))
rows = c.fetchall()
if rows:
    for r in rows:
        print(f"  [{r['agent_type']}] {r['cnt']}개")
else:
    print("  ⚠️ 오늘 ai_analyst_picks 데이터 없음!")

print()
print("=" * 60)
print("=== 3. 현재 maiis_portfolio 상태 ===")
print("=" * 60)
c.execute("""
    SELECT status, strategy, conviction_score, stock_code, stock_name, updated_at
    FROM maiis_portfolio
    WHERE status NOT IN ('DROPPED','HIT','CLEARED')
    ORDER BY status, conviction_score DESC
""")
rows = c.fetchall()
status_count = {}
for r in rows:
    status_count[r['status']] = status_count.get(r['status'], 0) + 1
print("상태별 카운트:", json.dumps(status_count, ensure_ascii=False))
print()
for r in rows:
    print(f"  [{r['status']}] {r['strategy']} | {r['conviction_score']}점 | {r['stock_code']} {r['stock_name']} | {r['updated_at']}")

print()
print("=" * 60)
print("=== 4. WATCHING 전략별 분류 (기대: 10개) ===")
print("=" * 60)
watching = [r for r in rows if r['status'] in ('WATCHING', 'WATCHLIST')]
print(f"총 관심종목: {len(watching)}개")
by_s = {}
for r in watching:
    s = r['strategy'] or 'UNKNOWN'
    by_s.setdefault(s, []).append(r)
for s, items in sorted(by_s.items()):
    print(f"  [{s}] {len(items)}개")

print()
print("=" * 60)
print("=== 5. ai_run_logs (PM 실행 메시지, 최근 2일) ===")
print("=" * 60)
try:
    c.execute("""
        SELECT date, message FROM ai_run_logs
        WHERE date >= date('now', 'localtime', '-2 days')
        AND (message LIKE '%PM%' OR message LIKE '%portfolio%' OR message LIKE '%screening%' OR message LIKE '%Phase%')
        ORDER BY id DESC
        LIMIT 30
    """)
    for r in c.fetchall():
        print(f"  [{r['date']}] {r['message'][:120]}")
except Exception as e:
    print(f"  ai_run_logs 조회 실패: {e}")

conn.close()
