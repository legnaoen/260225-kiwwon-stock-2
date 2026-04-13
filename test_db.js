const Database = require('better-sqlite3');
const db = new Database('C:/Users/legna/Projects/260224 kiwoom rest api/data/db/kiwoom.db');

const rows = db.prepare(`SELECT selected_stocks_json FROM mega_theme_ledger WHERE mega_theme_name LIKE '%AI 인프라 고도화%'`).all();
console.log(JSON.stringify(rows, null, 2));
