const { execSync } = require('child_process');
const fs = require('fs');

try {
    const res = execSync('npx tsc --noEmit', { encoding: 'utf-8' });
    fs.writeFileSync('tsc_full.log', res);
} catch (e) {
    fs.writeFileSync('tsc_full.log', e.stdout + '\n' + e.stderr);
}
