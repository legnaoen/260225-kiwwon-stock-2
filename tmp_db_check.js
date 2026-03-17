
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');
const db = new Database(dbPath);

const output = [];

output.push('--- Reports for 2026-03-16 ---');
const reports16 = db.prepare("SELECT date, timing, report_type FROM market_daily_reports WHERE date = '2026-03-16'").all();
output.push(JSON.stringify(reports16, null, 2));

output.push('\n--- Reports for 2026-03-17 ---');
const reports17 = db.prepare("SELECT date, timing, report_type FROM market_daily_reports WHERE date = '2026-03-17'").all();
output.push(JSON.stringify(reports17, null, 2));

output.push('\n--- Stocks for 2026-03-16 ---');
const stocks16 = db.prepare("SELECT timing, COUNT(*) as count FROM daily_rising_stocks WHERE date = '2026-03-16' GROUP BY timing").all();
output.push(JSON.stringify(stocks16, null, 2));

output.push('\n--- Stocks for 2026-03-17 ---');
const stocks17 = db.prepare("SELECT timing, COUNT(*) as count FROM daily_rising_stocks WHERE date = '2026-03-17' GROUP BY timing").all();
output.push(JSON.stringify(stocks17, null, 2));

fs.writeFileSync('db_check_result.txt', output.join('\n'));
db.close();
