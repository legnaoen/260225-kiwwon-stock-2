const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const userDataPath = process.env.APPDATA + '/kiwoom-trader';
const dbPath = path.join(userDataPath, 'db', 'kiwoom.db');

if (!fs.existsSync(dbPath)) {
    console.log('Database not found at ' + dbPath);
    process.exit(1);
}

const db = new Database(dbPath);

console.log('=== AI STRATEGIES ===');
try {
    const strategies = db.prepare('SELECT id, version, name, created_at, is_active, win_rate, avg_hold_time, target_profit, stop_loss, min_ai_score, scoring_weights FROM ai_strategies').all();
    console.log(JSON.stringify(strategies, null, 2));
} catch(e) {
    console.error(e.message);
}

console.log('\n=== AI STRATEGY HISTORY ===');
try {
    const history = db.prepare('SELECT * FROM ai_strategy_history ORDER BY date DESC LIMIT 20').all();
    console.log(JSON.stringify(history, null, 2));
} catch(e) {
    console.error(e.message);
}

console.log('\n=== SKILLS FILE HISTORY ===');
try {
    const skillsHist = db.prepare('SELECT id, file_name, version, diff_summary, change_type, trigger_context, changed_at FROM skills_file_history ORDER BY id DESC LIMIT 20').all();
    console.log(JSON.stringify(skillsHist, null, 2));
} catch(e) {
    console.error(e.message);
}

console.log('\n=== AI LEARNING LOG ===');
try {
    const learnLog = db.prepare('SELECT * FROM ai_learning_log ORDER BY id DESC LIMIT 20').all();
    console.log(JSON.stringify(learnLog, null, 2));
} catch(e) {
    console.error(e.message);
}

db.close();
