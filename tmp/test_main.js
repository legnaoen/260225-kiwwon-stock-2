const axios = require('axios');
const fs = require('fs');
async function test() {
    try {
        const url = 'https://finance.naver.com/item/main.naver?code=005930';
        console.log("Fetching:", url);
        let res = await axios.get('http://127.0.0.1:5050/api/fetch_any', {
            params: { url: url, engine: 'md_browse' },
            timeout: 30000 
        });
        fs.writeFileSync('C:\\Users\\legna\\Projects\\260224 kiwoom rest api\\tmp\\test_finance_main.txt', res.data.text_content);
        console.log("Saved to test_finance_main.txt");
    } catch (e) {
        console.error("ERR", e.message, e.response && e.response.status);
    }
}
test();
