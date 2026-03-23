const parser = require('@babel/parser');
const fs = require('fs');
try {
  const code = fs.readFileSync('src/components/Settings.tsx', 'utf-8');
  parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  });
  fs.writeFileSync('checker-out.txt', 'SUCCESS');
} catch (e) {
  fs.writeFileSync('checker-out.txt', 'ERROR: ' + e.message + '\nLINE: ' + e.loc.line + '\nCOL: ' + e.loc.column);
}
