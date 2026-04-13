const Database = require('better-sqlite3');
const db = new Database('krx_financial.db');
const rows = db.prepare('SELECT * FROM stock_theme_tags WHERE stock_code= ?').all('010170');
console.log(JSON.stringify(rows, null, 2));
