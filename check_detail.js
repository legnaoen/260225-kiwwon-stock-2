const axios = require('axios');

async function check() {
    try {
        // 업종 상세 페이지 (통신장비)
        const res = await axios.get('http://127.0.0.1:5050/api/fetch_any', {
            params: { url: 'https://stock.naver.com/market/stock/kr/industry/1?no=294', engine: 'md_browse' },
            timeout: 30000
        });
        const text = res.data.text_content;
        console.log("=== TOTAL LENGTH:", text.length, "===\n");
        
        // 종목 데이터가 있는 구간 찾기
        const lines = text.split('\n');
        let dataStart = false;
        for (let i = 0; i < lines.length; i++) {
            // 종목명이나 종목코드 패턴 찾기
            if (lines[i].match(/\d{6}/) || lines[i].includes('현재가') || lines[i].includes('전일대비') || lines[i].includes('종목명')) {
                console.log(`L${i}: ${lines[i].slice(0, 120)}`);
                dataStart = true;
            } else if (dataStart && lines[i].trim().length > 0 && i < 200) {
                console.log(`L${i}: ${lines[i].slice(0, 120)}`);
            }
        }

        // 링크 패턴 확인
        console.log("\n=== ALL LINKS IN PAGE ===");
        const linkMatches = text.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
        for (const m of linkMatches) {
            if (m.match(/\d{6}/) || m.includes('stock') || m.includes('domestic')) {
                console.log(m.slice(0, 150));
            }
        }
    } catch(e) {
        console.error(e.message);
    }
}
check();
