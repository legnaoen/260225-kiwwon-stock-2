const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const baseDir = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader');
const dbDir = path.join(baseDir, 'db');
const dbPath = path.join(dbDir, 'kiwoom.db');

console.log('Target DB Path:', dbPath);

if (!fs.existsSync(dbPath)) {
    console.log('DB file not found! Please run the app first to create the database.');
    process.exit(1);
}

try {
    const db = new Database(dbPath);

    console.log('\n--- 1. Table Existence Check ---');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'yahoo%';").all();
    console.log('Found tables:', tables.map(t => t.name));

    if (tables.length < 2) {
        console.log('Warning: Yahoo cache tables not found. Did you restart the app?');
    }

    console.log('\n--- 2. Yahoo Finance Cache (Historical) Count ---');
    const financeCount = db.prepare('SELECT count(*) as cnt FROM yahoo_finance_cache').get();
    console.log('Historical cache rows:', financeCount.cnt);

    console.log('\n--- 3. Yahoo Macro Cache Count ---');
    const macroCount = db.prepare('SELECT count(*) as cnt FROM yahoo_macro_cache').get();
    console.log('Macro cache rows:', macroCount.cnt);

    console.log('\n--- 4. Latest Cache Entries ---');
    const latestFinance = db.prepare('SELECT symbol, updated_at FROM yahoo_finance_cache ORDER BY updated_at DESC LIMIT 3').all();
    console.log('Latest Finance Entries:', latestFinance);

    db.close();
} catch (e) {
    console.error('Error during DB check:', e);
}
