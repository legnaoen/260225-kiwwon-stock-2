const fs = require('fs');
const code = fs.readFileSync('src/components/Settings.tsx', 'utf-8');
const lines = code.split('\n');

let count = 0;
let formOpen = false;
let startCount = 0;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const opens = (line.match(/<div(\s|>)/g) || []).length;
    const closes = (line.match(/<\/div>/g) || []).length;
    
    if (line.includes('<form')) {
        formOpen = true;
        startCount = count;
        console.log(`[Form OPEN] Line ${i + 1}, divCount: ${count}`);
    }
    
    count += (opens - closes);
    
    if (line.includes('</form>')) {
        formOpen = false;
        console.log(`[Form CLOSE] Line ${i + 1}, divCount (should be ${startCount}): ${count}`);
    }
}
