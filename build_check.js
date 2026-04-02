const { execSync } = require('child_process');
try {
    const res = execSync('npm run build', { encoding: 'utf-8' });
    console.log("SUCCESS:", res);
} catch (e) {
    console.log("FAILED:");
    console.log(e.stdout);
    console.log(e.stderr);
}
