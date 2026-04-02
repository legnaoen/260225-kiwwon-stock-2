const { execSync } = require('child_process');
const fs = require('fs');

try {
    const res = execSync('npx vite build', { encoding: 'utf-8' });
    fs.writeFileSync('vite_build.log', res);
} catch (e) {
    fs.writeFileSync('vite_build.log', e.stdout + '\n' + e.stderr);
}
