const fs = require('fs');

const chunkPath = 'dist-electron/main-BPN-S2ZO.js';
const content = fs.readFileSync(chunkPath, 'utf8');

// Find the IPC handler
const ipcIdx = content.indexOf('get-sim-trade-picks');
console.log('IPC idx:', ipcIdx);
console.log('Context:', content.substring(ipcIdx - 5, ipcIdx + 60));

// Check for db.prepare
const prepIdx = content.indexOf('db.prepare(`', ipcIdx);
console.log('prepare idx:', prepIdx);
if (prepIdx > 0) {
    console.log('prepare context:', content.substring(prepIdx, prepIdx + 200));
}
