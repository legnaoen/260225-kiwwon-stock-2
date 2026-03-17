
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');
const db = new Database(dbPath);

console.log('Querying all reports for 2026-03-16:');
const reports = db.prepare("SELECT * FROM market_daily_reports WHERE date = '2026-03-16'").all();
console.log(JSON.stringify(reports, null, 2));

console.log('\nQuerying all stocks for 2026-03-16:');
const stocks = db.prepare("SELECT date, timing, COUNT(*) as count FROM daily_rising_stocks WHERE date = '2026-03-16' GROUP BY timing").all();
console.log(JSON.stringify(stocks, null, 2));

console.log('\nQuerying distinct timings in DB:');
const timings = db.prepare("SELECT DISTINCT timing FROM market_daily_reports").all();
console.log(JSON.stringify(timings, null, 2));

db.close();
