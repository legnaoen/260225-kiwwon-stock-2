const db = require('better-sqlite3')('kiwoom.db');
const row = db.prepare("SELECT result FROM ai_execution_log WHERE agent_id = 'PORTFOLIO_MANAGER' ORDER BY queued_at DESC LIMIT 1").get();
console.log(row ? row.result : 'No result found');
