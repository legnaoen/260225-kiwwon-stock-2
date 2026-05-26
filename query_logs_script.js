const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'kiwoom-trader', 'db', 'kiwoom.db');
if (!fs.existsSync(dbPath)) {
    console.error('Database not found at:', dbPath);
    process.exit(1);
}

const db = new Database(dbPath);
const rows = db.prepare("SELECT * FROM live_trade_logs WHERE timestamp >= '2026-05-22' ORDER BY timestamp DESC LIMIT 40").all();
console.log(JSON.stringify(rows, null, 2));
