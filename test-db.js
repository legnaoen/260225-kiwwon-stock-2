const Database = require('better-sqlite3');
const db = new Database('maiis_portfolio.db');
const logs = db.prepare(`SELECT * FROM ai_execution_log WHERE agent_id = 'ReportScoutAgent' ORDER BY queued_at DESC LIMIT 5`).all();
console.log(JSON.stringify(logs, null, 2));
