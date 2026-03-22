import fs from 'fs';
['src/components/MaiisAgentTester.tsx', 'electron/main.ts', 'electron/preload.ts', 'electron/services/DatabaseService.ts', 'electron/services/MasterAiService.ts', 'src/types/electron.d.ts'].forEach(f => {
    try {
        fs.readFileSync(f);
    } catch(e) {
        console.error("Missing:", f);
    }
});
