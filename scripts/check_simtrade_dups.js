const Database = require('better-sqlite3');
const db = new Database('database.sqlite', { readonly: true });

// Check actual duplicate count per stock+date
const rows = db.prepare(`
    WITH combined AS (
        SELECT stock_code, stock_name, pick_date, category FROM track_a_buy_picks
        UNION ALL
        SELECT stock_code, stock_name, pick_date, category FROM track_b_buy_picks
        UNION ALL
        SELECT stock_code, stock_name, pick_date, category FROM track_c_buy_picks
        UNION ALL
        SELECT stock_code, stock_name, pick_date, category FROM track_d_buy_picks
        UNION ALL
        SELECT stock_code, stock_name, pick_date, category FROM track_e_buy_picks
    )
    SELECT stock_code, stock_name, pick_date, COUNT(*) as cnt, GROUP_CONCAT(category) as cats
    FROM combined
    WHERE pick_date >= date('now', '-3 days')
    GROUP BY stock_code, pick_date
    HAVING COUNT(*) > 1
    ORDER BY pick_date DESC, cnt DESC
    LIMIT 20
`).all();

console.log('Duplicated stocks (same stock+date in multiple tracks):');
if (rows.length === 0) {
    console.log('  (No duplicates found - data is clean)');
} else {
    rows.forEach(r => {
        console.log(`  ${r.stock_name}(${r.stock_code}) @ ${r.pick_date}: ${r.cnt}x - [${r.cats}]`);
    });
}

// Also check total counts per date
const totals = db.prepare(`
    SELECT pick_date, COUNT(*) as total FROM (
        SELECT pick_date FROM track_a_buy_picks
        UNION ALL SELECT pick_date FROM track_b_buy_picks
        UNION ALL SELECT pick_date FROM track_c_buy_picks
        UNION ALL SELECT pick_date FROM track_d_buy_picks
        UNION ALL SELECT pick_date FROM track_e_buy_picks
    )
    WHERE pick_date >= date('now', '-3 days')
    GROUP BY pick_date ORDER BY pick_date DESC
`).all();

console.log('\nTotal picks per date (raw, with duplicates):');
totals.forEach(r => console.log('  ', r.pick_date, ':', r.total, 'records'));

// After dedup
const deduped = db.prepare(`
    WITH combined AS (
        SELECT pick_date, stock_code FROM track_a_buy_picks
        UNION ALL SELECT pick_date, stock_code FROM track_b_buy_picks
        UNION ALL SELECT pick_date, stock_code FROM track_c_buy_picks
        UNION ALL SELECT pick_date, stock_code FROM track_d_buy_picks
        UNION ALL SELECT pick_date, stock_code FROM track_e_buy_picks
    )
    SELECT pick_date, COUNT(DISTINCT stock_code) as unique_stocks
    FROM combined
    WHERE pick_date >= date('now', '-3 days')
    GROUP BY pick_date ORDER BY pick_date DESC
`).all();

console.log('\nUnique stocks per date (after dedup):');
deduped.forEach(r => console.log('  ', r.pick_date, ':', r.unique_stocks, 'unique stocks'));

db.close();
