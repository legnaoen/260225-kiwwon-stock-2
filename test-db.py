import subprocess
import json
import xml.etree.ElementTree as ET

cmd = 'wevtutil qe System /q:"*[System[Provider[@Name=\'Microsoft-Windows-Kernel-Power\'] and (EventID=42 or EventID=107 or EventID=506 or EventID=507) and TimeCreated[@SystemTime>=\'2026-05-10T23:50:00.000Z\' and @SystemTime<=\'2026-05-11T00:10:00.000Z\']]]" /f:xml'
try:
    output = subprocess.check_output(cmd, shell=True, text=True)
    print("Events found:")
    print(output[:2000])
except Exception as e:
    print("Error:", e)
