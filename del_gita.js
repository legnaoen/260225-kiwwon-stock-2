const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');

try {
    const db = new Database(dbPath);
    const info = db.prepare("DELETE FROM leader_regime_snapshot WHERE name LIKE '%기타%'").run();
    console.log("Deleted '기타' regimes:", info.changes);
    db.close();
} catch(e) {
    console.error("Error: ", e.message);
}
