const axios = require('axios');

async function check() {
    try {
        const res = await axios.get('http://127.0.0.1:5050/api/fetch_any', {
            params: { url: 'https://stock.naver.com/market/stock/kr/industry/1', engine: 'md_browse' }
        });
        const text = res.data.text_content;
        console.log(text.slice(0, 500));
        console.log("...");
        console.log(text.slice(-500));
        
        // Find how industries are represented
        const matches = text.match(/\[([^\]]+)\]\(([^)]+)\)/g);
        console.log("Links found:");
        if (matches) {
            console.log(matches.slice(0, 10));
        }
    } catch(e) {
        console.error(e.message);
    }
}
check();
