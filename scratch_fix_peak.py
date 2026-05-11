import sqlite3
import os

db_path = os.path.join(os.environ.get('APPDATA'), 'kiwoom-trader', 'db', 'kiwoom.db')
print(f"Connecting to {db_path}")

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM live_trade_portfolio_peaks WHERE entry_date='2026-05-08'")
    print("Current peak:", cursor.fetchone())

    # Get max before 15:00
    cursor.execute("SELECT time_slot, high_pct FROM live_trade_portfolio_timeseries WHERE entry_date='2026-05-08' AND time_slot < '15:00' ORDER BY high_pct DESC LIMIT 1")
    row = cursor.fetchone()
    if row:
        best_time, best_pct = row
        print(f"New best peak before 15:00 is {best_pct} at {best_time}")
        
        # Update peaks table
        cursor.execute("UPDATE live_trade_portfolio_peaks SET peak_return_pct=?, peak_time=? WHERE entry_date='2026-05-08'", (best_pct, best_time))
        print(f"Rows updated: {cursor.rowcount}")

        # Optional: delete timeseries data after 15:00 to clean the chart
        cursor.execute("DELETE FROM live_trade_portfolio_timeseries WHERE entry_date='2026-05-08' AND time_slot >= '15:00'")
        print(f"Rows deleted from timeseries: {cursor.rowcount}")

        conn.commit()
    else:
        print("No timeseries data found before 15:00 for 2026-05-08")

except Exception as e:
    print("Error:", e)
finally:
    if 'conn' in locals():
        conn.close()
