import requests
from bs4 import BeautifulSoup
import pandas as pd
from io import StringIO

url = "https://finance.naver.com/item/main.naver?code=005930"
res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
soup = BeautifulSoup(res.text, 'html.parser')
div = soup.find('div', class_='section cop_analysis')
if div:
    print("Found '기업실적분석' section!")
    # Parse tables
    tables = pd.read_html(StringIO(str(div)))
    if tables:
        print(tables[0].head(5))
else:
    print("Not found... Try navercomp")

url2 = "https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=005930"
res2 = requests.get(url2, headers={'User-Agent': 'Mozilla/5.0'})
soup2 = BeautifulSoup(res2.text, 'html.parser')
tabs = soup2.find_all('table')
print(f"Found {len(tabs)} tables in navercomp!")
if len(tabs) > 0:
    t = pd.read_html(StringIO(str(tabs[0])))
    print("First table from navercomp:", t[0].head(2))
