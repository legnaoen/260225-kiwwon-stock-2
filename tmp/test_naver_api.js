const axios = require('axios');

async function test() {
    try {
        const keyword = encodeURIComponent('삼성전자');
        const url = `https://m.stock.naver.com/api/news/search?keyword=${keyword}&page=1&pageSize=3`;
        // Or front-api
        const url2 = `https://m.stock.naver.com/front-api/search/news?keyword=${keyword}&page=1&pageSize=3`;
        
        console.log("Testing 1", url);
        let res = await axios.get(url).catch(e=>e.response?.status);
        console.log(res?.data ? "OK 1" : res);

        console.log("Testing 2", url2);
        let res2 = await axios.get(url2).catch(e=>e.response?.status);
        console.log(res2?.data ? "OK 2" : res2);

    } catch (e) {
        console.error(e.message);
    }
}
test();
