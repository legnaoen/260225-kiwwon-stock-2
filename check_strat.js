const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'kiwoom-trader', 'db', 'kiwoom.db');
const db = new Database(dbPath);

const output = [];

output.push('=== ALL TABLES ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
output.push(JSON.stringify(tables.map(t => t.name), null, 2));

output.push('\n=== AI STRATEGIES ===');
try {
    const strategies = db.prepare('SELECT * FROM ai_strategies').all();
    output.push(JSON.stringify(strategies, null, 2));
} catch(e) {
    output.push(e.message);
}

output.push('\n=== AI STRATEGY HISTORY ===');
try {
    const history = db.prepare('SELECT * FROM ai_strategy_history ORDER BY date DESC LIMIT 30').all();
    output.push(JSON.stringify(history, null, 2));
} catch(e) {
    output.push(e.message);
}

output.push('\n=== SKILLS FILE HISTORY ===');
try {
    const skillsHist = db.prepare('SELECT id, file_name, version, diff_summary, change_type, trigger_context, changed_at FROM skills_file_history ORDER BY id DESC LIMIT 30').all();
    output.push(JSON.stringify(skillsHist, null, 2));
} catch(e) {
    output.push(e.message);
}

output.push('\n=== AI LEARNING LOG ===');
try {
    const learnLog = db.prepare('SELECT * FROM ai_learning_log ORDER BY id DESC LIMIT 30').all();
    output.push(JSON.stringify(learnLog, null, 2));
} catch(e) {
    output.push(e.message);
}

fs.writeFileSync('strat_check_result.txt', output.join('\n'));
db.close();
console.log('Done writing strat_check_result.txt');
