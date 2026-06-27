import sqlite3
import pandas as pd
import sys
import io

# 한글 깨짐 방지를 위해 출력 인코딩을 utf-8로 설정
sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')

DB_PATH = r"C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db"
conn = sqlite3.connect(DB_PATH)

pd.set_option('display.max_columns', None)
pd.set_option('display.width', 1000)

print("=== 1. 현재 보유 중인 종목 현황 (HELD) ===")
df_held = pd.read_sql_query("""
    SELECT strategy, stock_code, stock_name, entry_price, current_price, profit_rate, entry_date, days_held, conviction_score, source
    FROM maiis_portfolio
    WHERE status = 'HELD'
    ORDER BY entry_date DESC
""", conn)
print(f"총 보유 종목 수: {len(df_held)}개")
print(df_held.to_string())

print("\n=== 2. 최근 20개 완료된 거래 ===")
df_trade = pd.read_sql_query("""
    SELECT entry_date, exit_date, strategy, stock_code, stock_name, entry_price, exit_price, profit_rate, hold_days, exit_reason
    FROM maiis_trade_history
    ORDER BY exit_date DESC, entry_date DESC
    LIMIT 20
""", conn)
print(df_trade.to_string())

print("\n=== 3. 전체 전략별 성과 통계 ===")
df_all_trades = pd.read_sql_query("""
    SELECT strategy, profit_rate
    FROM maiis_trade_history
""", conn)

if not df_all_trades.empty:
    summary = df_all_trades.groupby('strategy').agg(
        total_trades=('profit_rate', 'count'),
        win_trades=('profit_rate', lambda x: (x > 0).sum()),
        avg_profit_rate=('profit_rate', 'mean'),
        median_profit_rate=('profit_rate', 'median'),
        max_profit=('profit_rate', 'max'),
        min_profit=('profit_rate', 'min'),
    )
    summary['win_rate_pct'] = (summary['win_trades'] / summary['total_trades']) * 100
    print(summary.to_string())

conn.close()
