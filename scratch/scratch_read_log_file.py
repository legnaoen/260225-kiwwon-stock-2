import os

appdata_path = os.environ.get('APPDATA')
log_path = os.path.join(appdata_path, 'kiwoom-trader', 'pm1_debug.log')

print('Log path:', log_path)

if os.path.exists(log_path):
    print('Reading last 100 lines of log file:')
    try:
        with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
            # 마지막 100줄 출력
            for line in lines[-100:]:
                print(line.strip())
    except Exception as e:
        print('Error reading log file:', e)
else:
    print('Log file does not exist.')
