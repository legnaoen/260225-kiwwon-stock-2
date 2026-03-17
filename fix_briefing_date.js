
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Kiwoom Trader', 'db', 'kiwoom.db');
const db = new Database(dbPath);

console.log('--- DB Fix Script Start ---');

try {
    // 1. Check for the anomaly
    // Today is 2026-03-16. If we find a record with date='2026-03-15' created on 2026-03-16 (UTC or KST around 8am), that's the one.
    // In UTC, 2026-03-16 08:20 KST is 2026-03-15 23:20 UTC.
    // So created_at will likely look like '2026-03-15T23:20...'
    
    const rows = db.prepare("SELECT * FROM market_news_consensus WHERE date = '2026-03-15'").all();
    console.log(`Found ${rows.length} records for 2026-03-15`);
    
    for (const row of rows) {
        console.log(`Record: date=${row.date}, created_at=${row.created_at}`);
        // If created_at is very recent (within last few hours)
        const createdAt = new Date(row.created_at);
        const now = new Date();
        const diffMs = now.getTime() - createdAt.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        
        if (diffHours < 5) {
            console.log('Match found! This record was likely generated today (3/16) but labeled as 3/15.');
            
            // Check if 2026-03-16 already exists (e.g. if I ran the fix already)
            const exists = db.prepare("SELECT date FROM market_news_consensus WHERE date = '2026-03-16'").get();
            
            if (!exists) {
                console.log('Renaming date to 2026-03-16...');
                db.prepare("UPDATE market_news_consensus SET date = '2026-03-16' WHERE date = '2026-03-15' AND created_at = ?")
                  .run(row.created_at);
                console.log('Update successful.');
            } else {
                console.log('Record for 2026-03-16 already exists. Skipping rename to avoid conflict.');
            }
        }
    }
} catch (e) {
    console.error('Error during DB fix:', e);
} finally {
    db.close();
}
console.log('--- DB Fix Script End ---');
