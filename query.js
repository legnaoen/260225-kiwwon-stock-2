const DB = require('better-sqlite3');
const db = new DB('trading.db');
const rows = db.prepare('SELECT id, date, predict, cycle, position, entry_price FROM agent_predictions WHERE cycle = "P"').all();
console.log(JSON.stringify(rows, null, 2));
