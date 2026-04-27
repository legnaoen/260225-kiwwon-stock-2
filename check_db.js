const Database = require('better-sqlite3');
const path = require('path');

// Assuming standard AppData\Roaming path for Electron
const dbPath = path.join('C:\\Users\\legna\\AppData\\Roaming\\kiwoom-trader\\db\\kiwoom.db');
const db = new Database(dbPath);

const targetCandles = 5;

// Simulate getTradingDateCutoff(5)
const cutoffRows = db.prepare(`
    SELECT date FROM market_ohlcv_history 
    WHERE stock_code = '069500' 
    ORDER BY date DESC LIMIT ?
`).all(targetCandles);

console.log('--- KODEX 200 (069500) Last 5 dates ---');
console.log(cutoffRows);

let targetDate = '';
if (cutoffRows && cutoffRows.length > 0) {
    targetDate = cutoffRows[cutoffRows.length - 1].date;
}
console.log('targetDate (5 days ago):', targetDate);

console.log('\n--- 광전자 (017900) Data >= targetDate ---');
const kwangRows = db.prepare(`
    SELECT stock_code, date, open, high, low, close, trading_value
    FROM market_ohlcv_history
    WHERE date >= ? AND stock_code = '017900'
    ORDER BY date ASC
`).all(targetDate);

console.log(kwangRows);

console.log('\n--- 이노인스트루먼트 (215790) Data >= targetDate ---');
const innoRows = db.prepare(`
    SELECT stock_code, date, open, high, low, close, trading_value
    FROM market_ohlcv_history
    WHERE date >= ? AND stock_code = '215790'
    ORDER BY date ASC
`).all(targetDate);

console.log(innoRows);

db.close();
