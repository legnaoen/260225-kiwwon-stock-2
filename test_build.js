const esbuild = require('esbuild');
esbuild.build({
    entryPoints: ['electron/main.ts'],
    bundle: true,
    platform: 'node',
    external: ['electron', 'vite', 'sqlite3', 'better-sqlite3'],
    outfile: 'esbuild_test.js'
}).then(() => {
    console.log("ESBUILD PASS");
}).catch((e) => {
    console.log("ESBUILD FAIL:", e.message);
});
