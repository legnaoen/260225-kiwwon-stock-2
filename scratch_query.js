const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\legna\\AppData\\Roaming\\kiwoom-trader\\db\\kiwoom.db');
const row = db.prepare("SELECT error FROM ai_execution_log WHERE agent_id = 'PORTFOLIO_MANAGER' AND status = 'FAILED' ORDER BY started_at DESC LIMIT 1").get();
console.log(row ? row.error : 'No error found');
