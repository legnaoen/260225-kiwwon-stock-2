const fs = require('fs');
const parser = require('./node_modules/@babel/parser');
try {
  const code = fs.readFileSync('src/components/Settings.tsx', 'utf-8');
  parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  });
  console.log("SUCCESS");
} catch (e) {
  console.log("ERROR:", e.message);
  console.log("LINE:", e.loc.line, "COL:", e.loc.column);
}
