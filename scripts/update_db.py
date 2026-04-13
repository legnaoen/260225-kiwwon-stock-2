import sqlite3

db_path = r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db'
conn = sqlite3.connect(db_path)
c = conn.cursor()

# Known sectors
sectors = [
    '통신장비',
    '반도체와반도체장비',
    'IT하드웨어',
    '기계',
    '전기장비',
    '제약',
    '금융업',
    '자동차와부품'
]

count = 0
for sector in sectors:
    c.execute("UPDATE stock_theme_tags SET tag_type='SECTOR' WHERE tag_name=?", (sector,))
    count += c.rowcount

conn.commit()
print(f"Updated {count} sector rows.")
