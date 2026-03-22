const fs = require('fs');
const ts = require('typescript');
const code = fs.readFileSync('src/components/MaiisAgentTester.tsx', 'utf8');
const sf = ts.createSourceFile('test.tsx', code, ts.ScriptTarget.Latest, true);
console.log('Errors:', sf.parseDiagnostics.length);
sf.parseDiagnostics.forEach(d => console.log(d.messageText));
