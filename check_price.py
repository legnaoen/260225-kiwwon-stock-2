import requests
import json
import sqlite3

# 키움 토큰 가져오기 (db에서 읽는다고 가정)
conn = sqlite3.connect(r'C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db')
c = conn.cursor()
c.execute("SELECT access_token FROM tokens LIMIT 1")
token_row = c.fetchone()
if not token_row:
    print("Token not found")
    exit(1)
token = token_row[0]

# Ka10004 현재가 조회
headers = {
    'Content-Type': 'application/json;charset=UTF-8',
    'authorization': f'Bearer {token}',
    'cont-yn': 'N',
    'api-id': 'ka10004'
}
res = requests.post('http://127.0.0.1:8080/api/dostk/stkrtprc', json={"stk_cd": "066575"}, headers=headers)
print("Status:", res.status_code)
print("Response:", res.text)
