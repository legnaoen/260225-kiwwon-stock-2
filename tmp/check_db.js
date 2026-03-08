const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');
console.log('DB Path:', dbPath);

const db = new Database(dbPath, { readonly: true });

// Check tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('\n=== Tables ===');
tables.forEach(t => console.log(' -', t.name));

// Check holding_history
try {
    const rows = db.prepare('SELECT * FROM holding_history').all();
    console.log('\n=== holding_history contents ===');
    if (rows.length === 0) {
        console.log('  [EMPTY - no rows]');
    } else {
        rows.forEach(r => console.log(`  ${r.stock_code} → ${r.first_seen_date}`));
    }
} catch (e) {
    console.log('\n=== holding_history ERROR ===', e.message);
}

db.close();
