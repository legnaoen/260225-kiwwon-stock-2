const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');
const dbDir = path.join(process.env.APPDATA, 'Electron', 'db', 'kiwoom.db');
if (!fs.existsSync(dbDir)) { const dbDir2 = path.join(process.env.APPDATA, 'kiwoom-trader', 'db', 'kiwoom.db'); fs.writeFileSync('query_out.txt', JSON.stringify(new Database(dbDir2).prepare(`SELECT * FROM intraday_predictions WHERE date='2026-04-06' LIMIT 2`).all(), null, 2)); }
else { fs.writeFileSync('query_out.txt', JSON.stringify(new Database(dbDir).prepare(`SELECT * FROM intraday_predictions WHERE date='2026-04-06' LIMIT 2`).all(), null, 2)); }
