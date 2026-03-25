const axios = require('axios');

async function testNaverAPI() {
    try {
        const res = await axios.get('https://m.stock.naver.com/api/stocks/theme/1/ranking');
        console.log("Ranking:", res.data);
    } catch(e) { console.log("error1", e.message); }
    
    try {
        const res2 = await axios.get('https://m.stock.naver.com/api/json/sise/themeListJson.nhn', { params: { pageSize: 20, page: 1 }});
        console.log("Old API:", res2.data.result.themeList.slice(0, 2).map(x => x.themeName));
    } catch(e) { console.log("error2", e.message); }
}

testNaverAPI();
