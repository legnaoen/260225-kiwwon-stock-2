const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const userDataPath = process.env.APPDATA + '/kiwoom-trader'; // Default electron userData path for windows
const dbDir = path.join(userDataPath, 'db');
const dbPath = path.join(dbDir, 'kiwoom.db');

if (!fs.existsSync(dbPath)) {
    console.log('Database not found at ' + dbPath);
    process.exit(1);
}

const db = new Database(dbPath);

const today = '2026-03-13';
console.log('--- Checking data for ' + today + ' ---');

const stocks = db.prepare('SELECT * FROM daily_rising_stocks WHERE date = ?').all(today);
console.log('\n[daily_rising_stocks] entries: ' + stocks.length);
if (stocks.length > 0) {
    stocks.forEach(s => {
        console.log(`- ${s.stock_name} (${s.stock_code}): Timing=${s.timing}, Score=${s.ai_score}, Rate=${s.change_rate}%`);
    });
}

const reports = db.prepare('SELECT * FROM market_daily_reports WHERE date = ?').all(today);
console.log('\n[market_daily_reports] entries: ' + reports.length);
if (reports.length > 0) {
    reports.forEach(r => {
        console.log(`- Timing=${r.timing}, Type=${r.report_type}, Summary Length=${r.market_summary?.length}`);
        console.log(`  Summary: ${r.market_summary?.substring(0, 100)}...`);
    });
}

db.close();
