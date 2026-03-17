const fs = require('fs');
const path = require('path');

function search(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== 'dist' && file !== 'dist-electron') {
                search(fullPath);
            }
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('.find(')) {
                console.log(`Found in ${fullPath}`);
                const lines = content.split('\n');
                lines.forEach((line, idx) => {
                    if (line.includes('.find(')) {
                        console.log(`  L${idx+1}: ${line.trim()}`);
                    }
                });
            }
        }
    }
}

search('c:\\Users\\legna\\Projects\\260224 kiwoom rest api\\electron');
search('c:\\Users\\legna\\Projects\\260224 kiwoom rest api\\src');
