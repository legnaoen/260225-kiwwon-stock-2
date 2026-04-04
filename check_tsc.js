const { exec } = require('child_process');
const fs = require('fs');

exec('npx tsc --noEmit', (error, stdout, stderr) => {
    fs.writeFileSync('tsc_errors.log', stdout || stderr || 'No errors', 'utf8');
    console.log('Check tsc_errors.log');
});
