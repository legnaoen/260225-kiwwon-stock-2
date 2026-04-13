const { build } = require('esbuild');

build({
  entryPoints: ['electron/services/DatabaseService.ts'],
  bundle: true,
  platform: 'node',
  external: ['better-sqlite3', 'electron', 'electron-store'],
  outfile: 'dist-test/DatabaseService.js',
}).then(() => {
  const { DatabaseService } = require('./dist-test/DatabaseService.js');
  const db = DatabaseService.getInstance();
  const data = db.getThemeTrackerData('THEME', '2026-04-10', 14, 5);
  require('fs').writeFileSync('artifact_db_test.json', JSON.stringify(data, null, 2));
  console.log("Done. Wrote to artifact_db_test.json");
}).catch(() => process.exit(1));
