import sqlite3

db_path = r"C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

today = "2026-04-30"

print("=" * 65)
print("[A] DROPPED된 4개 종목의 maiis_trade_history 기록 확인")
print("=" * 65)
dropped_codes = ["005490", "006400", "098460", "298040"]
dropped_names = ["POSCO홀딩스", "삼성SDI", "고영", "효성중공업"]

for code, name in zip(dropped_codes, dropped_names):
    cur.execute("""
        SELECT trade_id, stock_code, stock_name, status, entry_price,
               exit_price, profit_rate, entry_date, exit_date, created_at
        FROM maiis_trade_history
        WHERE stock_code = ?
        ORDER BY trade_id DESC
        LIMIT 5
    """, (code,))
    rows = cur.fetchall()
    print("\n  %s(%s) - 총 %d건:" % (name, code, len(rows)))
    if rows:
        for r in rows:
            print("    [trade_id=%s] status=%s entry_price=%s entry_date=%s exit_date=%s" % (
                r["trade_id"], r["status"], r["entry_price"],
                r["entry_date"], r["exit_date"]))
    else:
        print("    -> maiis_trade_history에 레코드 없음! (OPEN 레코드 미생성 버그)")

print()
print("=" * 65)
print("[B] maiis_trade_history의 모든 레코드 (최근 20개)")
print("=" * 65)
cur.execute("""
    SELECT trade_id, stock_code, stock_name, status, entry_price,
           entry_date, exit_date, profit_rate, created_at
    FROM maiis_trade_history
    ORDER BY trade_id DESC
    LIMIT 20
""")
rows = cur.fetchall()
print("총 %d건" % len(rows))
for r in rows:
    print("  [%s] %s(%s) status=%s entry=%s ~ exit=%s profit=%.2f%%" % (
        r["trade_id"], r["stock_name"], r["stock_code"],
        r["status"], r["entry_date"], r["exit_date"], r["profit_rate"] or 0))

print()
print("=" * 65)
print("[C] 4개 종목의 maiis_portfolio 이력 확인")
print("=" * 65)
for code, name in zip(dropped_codes, dropped_names):
    cur.execute("""
        SELECT id, stock_code, stock_name, status, was_held, entry_price,
               entry_date, profit_rate, updated_at
        FROM maiis_portfolio
        WHERE stock_code = ?
    """, (code,))
    row = cur.fetchone()
    if row:
        print("  %s(%s): status=%s was_held=%s entry_price=%s entry_date=%s profit=%.2f%%" % (
            name, code, row["status"], row["was_held"],
            row["entry_price"], row["entry_date"], row["profit_rate"] or 0))
    else:
        print("  %s(%s): maiis_portfolio에 레코드 없음" % (name, code))

conn.close()
