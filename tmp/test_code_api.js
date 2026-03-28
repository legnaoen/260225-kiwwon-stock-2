const axios = require('axios');

async function test() {
    try {
        const keyword = encodeURIComponent('삼성전자');
        const url = `https://m.stock.naver.com/front-api/search/summary?keyword=${keyword}`; // Changed from front-api to api
        const url2 = `https://m.stock.naver.com/api/search/all?keyword=${keyword}`;
        
        console.log("Testing:", url2);
        let res2 = await axios.get(url2).catch(e=>e.response?.status);
        console.log("RES:", JSON.stringify(res2?.data?.result?.items?.[0] || res2.data, null, 2));

    } catch (e) {
        console.error(e.message);
    }
}
test();
