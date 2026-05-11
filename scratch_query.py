import sqlite3
import os

app_data = os.getenv('APPDATA')
db_path = os.path.join(app_data, 'kiwoom-trader', 'db', 'kiwoom.db')

def fetch_and_print():
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM live_trade_strategies WHERE strategy_category = 'EMERGING_STAR';")
        rows = cursor.fetchall()
        for row in rows:
            print(dict(row))
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    fetch_and_print()
