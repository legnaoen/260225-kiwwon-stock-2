const axios = require('axios');

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://m.stock.naver.com/"
};

async function test() {
    // 업종: 통신장비=294
    try {
        const res1 = await axios.get('https://m.stock.naver.com/api/stocks/industry/294?page=1&pageSize=5', { headers: HEADERS, timeout: 5000 });
        console.log("=== INDUSTRY API (294) ===");
        console.log("Status:", res1.status);
        const stocks1 = res1.data.stocks || res1.data;
        if (Array.isArray(stocks1)) {
            stocks1.slice(0, 3).forEach(s => console.log(JSON.stringify({
                itemCode: s.itemCode, stockName: s.stockName, closePrice: s.closePrice, 
                fluctuationsRatio: s.fluctuationsRatio
            })));
        } else {
            console.log("Keys:", Object.keys(res1.data));
            console.log(JSON.stringify(res1.data).slice(0, 500));
        }
    } catch(e) {
        console.log("Industry ERROR:", e.response?.status, e.message);
    }

    // 테마: 590
    try {
        const res2 = await axios.get('https://m.stock.naver.com/api/stocks/theme/590?page=1&pageSize=5', { headers: HEADERS, timeout: 5000 });
        console.log("\n=== THEME API (590) ===");
        console.log("Status:", res2.status);
        const stocks2 = res2.data.stocks || res2.data;
        if (Array.isArray(stocks2)) {
            stocks2.slice(0, 3).forEach(s => console.log(JSON.stringify({
                itemCode: s.itemCode, stockName: s.stockName, closePrice: s.closePrice, 
                fluctuationsRatio: s.fluctuationsRatio
            })));
        } else {
            console.log("Keys:", Object.keys(res2.data));
            console.log(JSON.stringify(res2.data).slice(0, 500));
        }
    } catch(e) {
        console.log("Theme ERROR:", e.response?.status, e.message);
    }
}
test();
