const ts = require('typescript');
const fs = require('fs');
const src = fs.readFileSync('src/components/PmTracker.tsx', 'utf8');

// Try parsing as TSX
const sourceFile = ts.createSourceFile('PmTracker.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Check for parse diagnostics  
const diags = sourceFile.parseDiagnostics || [];
if (diags.length > 0) {
    diags.forEach(d => {
        const pos = sourceFile.getLineAndCharacterOfPosition(d.start);
        console.log(`ERROR at line ${pos.line + 1}, col ${pos.character}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    });
} else {
    console.log('TSX Parse OK - no syntax errors');
}
