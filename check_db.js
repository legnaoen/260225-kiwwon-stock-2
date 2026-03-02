const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const baseDir = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader');
const dbDir = path.join(baseDir, 'db');
const dbPath = path.join(dbDir, 'kiwoom.db');

console.log('Target DB Path:', dbPath);

if (!fs.existsSync(dbPath)) {
    console.log('DB file not found! Checking directory contents...');
    if (fs.existsSync(baseDir)) {
        console.log('Contents of', baseDir, ':', fs.readdirSync(baseDir));
    }
    if (fs.existsSync(dbDir)) {
        console.log('Contents of', dbDir, ':', fs.readdirSync(dbDir));
    }
    process.exit(1);
}

try {
    const db = new Database(dbPath);

    console.log('--- Samsung Electronics Check (005930 or 5930) ---');
    const samsung = db.prepare('SELECT * FROM dart_corp_code WHERE stock_code LIKE "%5930%"').all();
    console.log(samsung);

    console.log('--- Table "dart_corp_code" Count ---');
    const count = db.prepare('SELECT count(*) as cnt FROM dart_corp_code').get();
    console.log('Row count:', count.cnt);

    db.close();
} catch (e) {
    console.error(e);
}

try {
    const db = new Database(dbPath);

    console.log('--- DART Corp Codes (First 2) ---');
    const corpCodes = db.prepare('SELECT * FROM dart_corp_code LIMIT 2').all();
    console.log(corpCodes);

    console.log('--- Schedules (DART only) ---');
    const schedules = db.prepare('SELECT * FROM schedules WHERE source = "DART"').all();
    console.log(schedules);

    db.close();
} catch (e) {
    console.error(e);
}
