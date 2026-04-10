const db = require('better-sqlite3')('database.sqlite');
const rows = db.prepare("SELECT length(image_base64) as len, predict FROM intraday_predictions WHERE time_slot = '14:59'").all();
console.log(rows);
const log = db.prepare("SELECT prompt FROM ai_execution_logs WHERE agentId LIKE 'SWARM_%' AND queuedAt LIKE '%14:%' ORDER BY id DESC LIMIT 1").all();
console.log("PROMPT CHECK:", log[0]?.prompt.substring(0, 500));
