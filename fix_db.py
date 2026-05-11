import sqlite3
db = r'C:/Users/legna/AppData/Roaming/kiwoom-trader/db/kiwoom.db'
c = sqlite3.connect(db)
cursor = c.cursor()
cursor.execute("UPDATE live_trade_portfolio_timeseries SET time_slot = '09:00' WHERE time_slot LIKE '9%NaN%'")
cursor.execute("UPDATE live_trade_portfolio_timeseries SET time_slot = '11:00' WHERE time_slot LIKE '11%NaN%'")
cursor.execute("UPDATE live_trade_portfolio_timeseries SET time_slot = '12:00' WHERE time_slot LIKE '12%NaN%'")
cursor.execute("UPDATE live_trade_portfolio_timeseries SET time_slot = '13:00' WHERE time_slot LIKE '13%NaN%'")
cursor.execute("UPDATE live_trade_portfolio_timeseries SET time_slot = '14:00' WHERE time_slot LIKE '14%NaN%'")
c.commit()
print("Fixed NaN time slots")
