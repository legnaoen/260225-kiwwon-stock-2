const axios = require('axios');

async function check() {
    try {
        const res = await axios.get('http://127.0.0.1:5050/api/fetch_any', {
            params: { url: 'https://stock.naver.com/market/stock/kr/industry/1', engine: 'md_browse' },
            timeout: 30000
        });
        const text = res.data.text_content;
        console.log("=== TOTAL LENGTH:", text.length, "===");
        
        // Find where actual sector data starts - look for patterns like numbers + %
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Print lines that contain % or sector-like keywords
            if (line.match(/\d+\.\d+%/) || line.includes('전기장비') || line.includes('생명보험') || line.includes('통신장비') || line.includes('자동차') || line.includes('은행')) {
                console.log(`LINE ${i}: ${line}`);
            }
        }
        
        console.log("\n=== LAST 2000 CHARS ===");
        console.log(text.slice(-2000));
        
        // Also check for all markdown links
        console.log("\n=== ALL LINKS WITH NUMBERS ===");
        const linkMatches = text.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
        for (const m of linkMatches) {
            if (m.match(/\d{6}/) || m.includes('industry') || m.includes('theme') || m.includes('전기') || m.includes('생명')) {
                console.log(m);
            }
        }
    } catch(e) {
        console.error(e.message);
    }
}
check();
