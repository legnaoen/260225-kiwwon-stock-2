
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Kiwoom Trader', 'db', 'kiwoom.db');
const db = new Database(dbPath);

console.log('Querying market_news_consensus:');
const rows = db.prepare('SELECT date, created_at FROM market_news_consensus ORDER BY created_at DESC LIMIT 5').all();
console.log(JSON.stringify(rows, null, 2));

db.close();
