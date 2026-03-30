const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');
const db = new Database(dbPath);

console.log("THEME types:");
console.log(db.prepare("SELECT type FROM theme_intelligence WHERE type LIKE '%THEME%' LIMIT 5").all());
console.log("SECTOR types:");
console.log(db.prepare("SELECT type FROM theme_intelligence WHERE type LIKE '%SECTOR%' LIMIT 5").all());
