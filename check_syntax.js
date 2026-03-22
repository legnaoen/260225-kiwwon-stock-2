const fs = require('fs');
const ts = require('typescript');
const file = 'src/components/MaiisAgentTester.tsx';
const s = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, s, ts.ScriptTarget.Latest, true);
fs.writeFileSync('result.txt', sf.parseDiagnostics.map(d => d.messageText).join('\n'));
