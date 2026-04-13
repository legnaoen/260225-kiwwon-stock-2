import sqlite3, datetime

DB_PATH = r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db'
db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

# PM1이 실제로 하는 INSERT를 그대로 재현
TEST_CODE = '079550'  # LIG넥스원
TEST_NAME = 'LIG넥스원_TEST'
NOW = datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')

print(f"=== [테스트] {TEST_CODE} ({TEST_NAME}) WATCHLIST INSERT 시뮬레이션 ===")

# 현재 상태
existing = db.execute("SELECT * FROM maiis_portfolio WHERE stock_code = ?", (TEST_CODE,)).fetchone()
if existing:
    print(f"기존 레코드 존재: status={existing['status']}")
else:
    print("기존 레코드 없음 (신규 INSERT)")

try:
    db.execute("""
        INSERT INTO maiis_portfolio (
            stock_code, stock_name, status, strategy, conviction_score, theme, 
            entry_date, last_signal, last_signal_reason, analysts_json, lifespan_days,
            last_reviewed_at, created_at, updated_at, raw_context, current_price, entry_price, entry_price_at, was_held
        ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(stock_code) DO UPDATE SET
            status = excluded.status,
            conviction_score = excluded.conviction_score,
            last_signal_reason = excluded.last_signal_reason,
            analysts_json = excluded.analysts_json,
            last_reviewed_at = excluded.last_reviewed_at,
            updated_at = excluded.updated_at
    """, (
        TEST_CODE, TEST_NAME, 'WATCHLIST', 'SWING', 50, None,
        None, None, '[PM 1차 오디션 수집] 2차 통합 심사 대기 중', '["MOMENTUM"]', None,
        NOW, NOW, NOW, None, 0, 0, None, 0
    ))
    db.commit()
    print("✅ INSERT/UPDATE 성공!")
    
    result = db.execute("SELECT stock_code, stock_name, status FROM maiis_portfolio WHERE stock_code = ?", (TEST_CODE,)).fetchone()
    print(f"저장 후 상태: {dict(result)}")

except Exception as e:
    print(f"❌ 에러 발생: {e}")

# 테스트 데이터 롤백
db.execute("UPDATE maiis_portfolio SET status = 'DROPPED' WHERE stock_code = ? AND stock_name = ?", (TEST_CODE, TEST_NAME))
db.commit()
print("테스트 완료 (DROPPED로 롤백)")

# WATCHLIST 체크
watchlist = db.execute("SELECT * FROM maiis_portfolio WHERE status = 'WATCHLIST'").fetchall()
print(f"\n최종 WATCHLIST 종목: {len(watchlist)}개")

db.close()
