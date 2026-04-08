const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');

if (!fs.existsSync(dbPath)) {
    console.error("DB not found at:", dbPath);
    process.exit(1);
}

const db = new Database(dbPath);

console.log('Fixing DB...');
const rows = db.prepare(`SELECT id, predict, position, time_slot FROM intraday_predictions`).all();

let count = 0;
for(const r of rows) { 
    let newPos = r.position; 
    if (r.position && (r.position.includes('HOLD(KODEX 200 기준)') || r.position === '- HOLD' || r.position === 'HOLD(KODEX 인버스 기준)' || r.position.includes('기준)'))) { 
        if(r.time_slot === '09:45' || r.time_slot === '10:15') {
            newPos = 'KODEX 200'; 
        } else {
            newPos = 'HOLD(관망)'; 
        }
        db.prepare('UPDATE intraday_predictions SET position=? WHERE id=?').run(newPos, r.id); 
        console.log('Fixed', r.time_slot, 'from', r.position, 'to', newPos);
        count++;
    } 
} 
console.log('Done! Fixed', count, 'rows automatically.');
