const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

const paths = [
    path.join(process.env.APPDATA, 'kiwoom-trader', 'db', 'kiwoom.db'),
    path.join(process.env.APPDATA, 'electron', 'db', 'kiwoom.db'),
    path.join(process.env.APPDATA, 'Electron', 'db', 'kiwoom.db')
];

let dbPath = null;
for (const p of paths) {
    if (fs.existsSync(p)) {
        dbPath = p;
        break;
    }
}

if (!dbPath) {
    console.error('Database not found');
    process.exit(1);
}

const db = new Database(dbPath);
const rows = db.prepare(`SELECT id, date, time_slot, predict, entry_price, close_price, return_pct, max_price, result FROM intraday_predictions WHERE date = '2026-04-06'`).all();
console.log(JSON.stringify(rows, null, 2));
