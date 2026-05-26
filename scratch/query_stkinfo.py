import os
import json
import requests

def test():
    try:
        config_path = os.path.expandvars(r'%APPDATA%\kiwoom-trader\config.json')
        if not os.path.exists(config_path):
            print("config.json not found at:", config_path)
            return
            
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
            
        keys = config.get('kiwoom_keys')
        if not keys:
            print("kiwoom_keys not found in config.json")
            return
            
        appkey = keys.get('appkey')
        secretkey = keys.get('secretkey')
        print(f"Loaded AppKey: {appkey[:5]}... SecretKey: {secretkey[:5]}...")
        
        # Get Token
        token_res = requests.post('https://api.kiwoom.com/oauth2/token', json={
            "grant_type": "client_credentials",
            "appkey": appkey,
            "secretkey": secretkey
        }, headers={'Content-Type': 'application/json;charset=UTF-8'})
        
        token_data = token_res.json()
        token = token_data.get('token') or token_data.get('access_token')
        if not token:
            print("Failed to get token:", token_data)
            return
            
        # Get Stock Info for Intexplus (064290)
        headers = {
            'Content-Type': 'application/json;charset=UTF-8',
            'authorization': f'Bearer {token}',
            'cont-yn': 'N',
            'api-id': 'ka10001'
        }
        
        url = 'https://api.kiwoom.com/api/dostk/stkinfo'
        res = requests.post(url, json={"stk_cd": "064290"}, headers=headers)
        print("Status Code:", res.status_code)
        print("Response JSON:")
        print(json.dumps(res.json(), indent=2, ensure_ascii=False))
        
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    test()
