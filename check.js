const esbuild = require('esbuild');

try {
  esbuild.buildSync({
    entryPoints: ['electron/services/v2_pipeline/MarketLeaderDiscoveryService.ts'],
    outdir: 'dist-test',
    bundle: true,
    platform: 'node',
    external: ['better-sqlite3', 'axios', 'ws']
  });
  console.log('Build successful!');
} catch (e) {
  console.error('Build failed:');
  console.error(e.message);
}
