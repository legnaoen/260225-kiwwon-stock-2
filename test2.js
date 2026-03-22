const fs = require('fs');
const ts = require('typescript');

try {
  let file = 'src/components/MaiisAgentTester.tsx';
  let s = fs.readFileSync(file, 'utf8');
  let sf = ts.createSourceFile(file, s, ts.ScriptTarget.Latest, true);
  fs.writeFileSync('tester_errors.txt', "Errors: " + sf.parseDiagnostics.length + "\n" + sf.parseDiagnostics.map(d => d.messageText).join('\n'));

  file = 'src/types/electron.d.ts';
  s = fs.readFileSync(file, 'utf8');
  sf = ts.createSourceFile(file, s, ts.ScriptTarget.Latest, true);
  fs.writeFileSync('electron_errors.txt', "Errors: " + sf.parseDiagnostics.length + "\n" + sf.parseDiagnostics.map(d => d.messageText).join('\n'));
} catch (e) {
  fs.writeFileSync('script_error.txt', e.toString());
}
