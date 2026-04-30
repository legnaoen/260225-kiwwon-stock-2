"""
레트로 Fix: OPEN 레코드 누락으로 성적표에 기록되지 않은 종목 수동 복구
대상: POSCO홀딩스(005490), 효성중공업(298040), 삼성SDI(006400)
"""
import sqlite3
from datetime import datetime

db_path = r"C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

now_ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S+09:00")
today = "2026-04-30"

# 복구 대상 종목: (stock_code, stock_name, entry_date, entry_price, exit_price, profit_rate, exit_reason)
# exit_price는 entry_price 기준 profit_rate로 역산 (실제 현재가 없으므로 수익률로 계산)
targets = [
    {
        "stock_code": "005490",
        "stock_name": "POSCO홀딩스",
        "entry_date": "2026-04-28",
        "entry_price": 472500.0,
        "profit_rate": -1.69,
        "strategy": "MOMENTUM",
        "exit_reason": "AI 심사 결과 SELL 판정 - 상단 저항 및 모멘텀 약화"
    },
    {
        "stock_code": "298040",
        "stock_name": "효성중공업",
        "entry_date": "2026-04-28",
        "entry_price": 4049000.0,
        "profit_rate": -1.36,
        "strategy": "MOMENTUM",
        "exit_reason": "AI 심사 결과 SELL 판정 - 과거 급등 이후 조정 국면"
    },
    {
        "stock_code": "006400",
        "stock_name": "삼성SDI",
        "entry_date": "2026-04-29",
        "entry_price": 705000.0,
        "profit_rate": 0.28,
        "strategy": "MOMENTUM",
        "exit_reason": "AI 심사 결과 SELL 판정 - ESS 배터리 불확실성"
    },
]

print("=" * 65)
print("레트로 Fix: OPEN 레코드 생성 + CLOSED 처리")
print("=" * 65)

for t in targets:
    stock_code = t["stock_code"]
    stock_name = t["stock_name"]
    entry_date = t["entry_date"]
    entry_price = t["entry_price"]
    profit_rate = t["profit_rate"]
    strategy = t["strategy"]
    exit_reason = t["exit_reason"]

    # exit_price 역산
    exit_price = round(entry_price * (1 + profit_rate / 100))

    # 보유 기간 계산
    entry_ms = datetime.strptime(entry_date, "%Y-%m-%d")
    exit_ms = datetime.strptime(today, "%Y-%m-%d")
    hold_days = (exit_ms - entry_ms).days

    # 이미 OPEN 레코드가 있는지 확인
    cur.execute(
        "SELECT trade_id FROM maiis_trade_history WHERE stock_code = ? AND status = 'OPEN' ORDER BY trade_id DESC LIMIT 1",
        (stock_code,)
    )
    existing_open = cur.fetchone()

    if existing_open:
        print(f"\n  [{stock_name}] 이미 OPEN 레코드 존재(trade_id={existing_open['trade_id']}), CLOSED 처리만 진행")
        cur.execute("""
            UPDATE maiis_trade_history
            SET exit_date=?, exit_price=?, exit_reason=?, exit_at=?,
                profit_rate=?, hold_days=?, status='CLOSED', updated_at=?
            WHERE trade_id=?
        """, (today, exit_price, exit_reason, now_ts,
              profit_rate, hold_days, now_ts, existing_open["trade_id"]))
        print(f"    -> CLOSED: exit_price={exit_price:,} profit={profit_rate:+.2f}%")
    else:
        # 이미 CLOSED인 최신 레코드 확인 (중복 방지)
        cur.execute(
            "SELECT trade_id, status, entry_date, exit_date FROM maiis_trade_history WHERE stock_code=? ORDER BY trade_id DESC LIMIT 1",
            (stock_code,)
        )
        latest = cur.fetchone()
        if latest and latest["status"] == "CLOSED" and latest["exit_date"] == today:
            print(f"\n  [{stock_name}] 오늘 날짜 CLOSED 레코드 이미 존재(trade_id={latest['trade_id']}), 스킵")
            continue

        print(f"\n  [{stock_name}({stock_code})] OPEN 레코드 없음 → 신규 생성 후 CLOSED 처리")

        # OPEN INSERT
        cur.execute("""
            INSERT INTO maiis_trade_history
                (stock_code, stock_name, entry_date, entry_price, entry_reason,
                 entry_at, strategy, analysts_json, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
        """, (
            stock_code, stock_name, entry_date, entry_price,
            f"[레트로 복구] PM2 매수 편입 ({entry_date})",
            now_ts, strategy, "[]", now_ts, now_ts
        ))
        trade_id = cur.lastrowid
        print(f"    -> OPEN 레코드 생성: trade_id={trade_id}")

        # CLOSED로 즉시 업데이트
        cur.execute("""
            UPDATE maiis_trade_history
            SET exit_date=?, exit_price=?, exit_reason=?, exit_at=?,
                profit_rate=?, hold_days=?, status='CLOSED', updated_at=?
            WHERE trade_id=?
        """, (today, exit_price, exit_reason, now_ts,
              profit_rate, hold_days, now_ts, trade_id))
        print(f"    -> CLOSED: trade_id={trade_id} entry={entry_price:,} exit={exit_price:,} profit={profit_rate:+.2f}%")

conn.commit()

print()
print("=" * 65)
print("복구 결과 확인: 오늘(4/30) CLOSED 레코드")
print("=" * 65)
cur.execute("""
    SELECT trade_id, stock_code, stock_name, status, entry_price, exit_price,
           profit_rate, hold_days, entry_date, exit_date
    FROM maiis_trade_history
    WHERE DATE(exit_date) = ?
    ORDER BY trade_id DESC
""", (today,))
rows = cur.fetchall()
print(f"총 {len(rows)}건")
for r in rows:
    print(f"  [trade_id={r['trade_id']}] {r['stock_name']}({r['stock_code']}) "
          f"status={r['status']} profit={r['profit_rate']:+.2f}% "
          f"보유기간={r['hold_days']}일 ({r['entry_date']}~{r['exit_date']})")

conn.close()
print("\n완료!")
