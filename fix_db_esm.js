import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');
const db = new Database(dbPath);

const rows = db.prepare(`SELECT id, time_slot, predict, position, rationale FROM intraday_predictions ORDER BY date DESC, time_slot DESC LIMIT 30`).all();

console.log("Before: ");
rows.forEach(r => console.log(`${r.id} | ${r.time_slot} | ${r.predict} | ${r.position}`));

// Fix the corrupted rows
let updateStmt = db.prepare(`UPDATE intraday_predictions SET position = ? WHERE id = ?`);
let fixed = 0;

for (const row of rows) {
    if (row.position && row.position.includes('HOLD(KODEX 200 기준)')) {
        if (row.time_slot === '09:45' || row.time_slot === '10:15') {
            updateStmt.run('KODEX 200', row.id);
            console.log(`Fixed ${row.time_slot} to KODEX 200`);
            fixed++;
        } else {
            updateStmt.run('HOLD', row.id);
            console.log(`Fixed ${row.time_slot} to HOLD`);
            fixed++;
        }
    } else if (row.position === '- HOLD') {
        updateStmt.run('HOLD', row.id);
        console.log(`Fixed ${row.time_slot} from '- HOLD' to 'HOLD'`);
        fixed++;
    }
}
console.log(`Total fixed: ${fixed}`);
