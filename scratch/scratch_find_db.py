import os
import glob

appdata_path = os.environ.get('APPDATA')
pattern = os.path.join(appdata_path, '**/kiwoom.db')
print('Searching for kiwoom.db in APPDATA:', appdata_path)

files = glob.glob(pattern, recursive=True)
print('Found database files:')
for f in files:
    print(f)
