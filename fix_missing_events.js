const path = require('path');
const DB = require('better-sqlite3');
const appDataDir = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
const dbPath = path.join(appDataDir, 'kiwoom-rest-api', 'db', 'kiwoom.db');

try {
    const db = new DB(dbPath);
    
    // Find CLOSED trades that don't have a DROPPED or CLEARED matching event around its exit time.
    const stmt = db.prepare(`
        INSERT INTO maiis_portfolio_events (stock_code, stock_name, event_type, old_status, new_status, price, profit_rate, reason, created_at)
        SELECT h.stock_code, h.stock_name, 'DROPPED', 'HELD', 'CLEARED', h.exit_price, h.profit_rate, h.exit_reason, h.exit_at
        FROM maiis_trade_history h
        WHERE h.status = 'CLOSED' 
          AND NOT EXISTS (
              SELECT 1 FROM maiis_portfolio_events e 
              WHERE e.stock_code = h.stock_code 
                AND e.event_type = 'DROPPED' 
                AND DATE(e.created_at) = DATE(h.exit_at)
          )
    `);
    
    const info = stmt.run();
    console.log('Inserted missing sell events for completed trades:', info.changes);
    
    db.close();
} catch (err) {
    console.error('Error:', err);
}
