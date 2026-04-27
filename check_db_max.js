const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join('C:\\Users\\legna\\AppData\\Roaming\\kiwoom-trader\\db\\kiwoom.db');
const db = new Database(dbPath);

console.log('--- KODEX 200 (069500) max date ---');
const maxDateRow = db.prepare(`SELECT MAX(date) as max_date FROM market_ohlcv_history WHERE stock_code = '069500'`).get();
console.log(maxDateRow);

console.log('--- 광전자 (017900) max date ---');
const kwangMaxDateRow = db.prepare(`SELECT MAX(date) as max_date FROM market_ohlcv_history WHERE stock_code = '017900'`).get();
console.log(kwangMaxDateRow);

db.close();
