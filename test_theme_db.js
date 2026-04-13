const Database = require('better-sqlite3');
const db = new Database('C:/Users/legna/Projects/260224 kiwoom rest api/data/db/kiwoom.db');

const rows = db.prepare(`SELECT date, name, reason FROM theme_intelligence LIMIT 5`).all();
console.log(JSON.stringify(rows, null, 2));

const specific = db.prepare(`SELECT date, name, reason FROM theme_intelligence WHERE name LIKE '%광통신%' LIMIT 5`).all();
console.log("Specific:", JSON.stringify(specific, null, 2));
