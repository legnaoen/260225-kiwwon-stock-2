const axios = require('axios');
async function test() {
    try {
        const url = 'https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=005930';
        console.log("Fetching:", url);
        let res = await axios.get('http://127.0.0.1:5050/api/fetch_any', {
            params: { url: url, engine: 'md_browse' },
            timeout: 30000 
        });
        console.log("Success! Length:", res.data.text_content.length);
        console.log(res.data.text_content.substring(0, 500));
        console.log("--- MIDDLE ---");
        // Print middle to see if tables are there
        console.log(res.data.text_content.substring(2000, 2500));
    } catch (e) {
        console.error("ERR", e.message, e.response && e.response.status);
    }
}
test();
