const fs = require('fs');
const lines = fs.readFileSync('src/components/Settings.tsx', 'utf-8').split('\n');
let d = 0;
let results = [];
for(let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const o = (line.match(/<div[ >\n]/g) || []).length;
  const c = (line.match(/<\/div>/g) || []).length;
  d += o - c;
  if (line.includes('<form')) {
    results.push(`[FORM OPEN] Line ${i+1}: ${line.trim()} | Open divs: ${d}`);
  }
  if (line.includes('</form>')) {
    results.push(`[FORM CLOSE] Line ${i+1}: ${line.trim()} | Open divs: ${d}`);
  }
}
fs.writeFileSync('checker-out2.txt', results.join('\n'));
