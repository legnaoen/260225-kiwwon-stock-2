const axios = require('axios');
async function test() {
    try {
        const url = 'https://companyinfo.stock.naver.com/v1/company/c1010001.aspx?cmp_cd=005930';
        let res = await axios.get('http://127.0.0.1:5050/api/fetch_any', {
            params: { url: url, engine: 'md_browse' },
            timeout: 30000 
        });
        console.log(res.data.text_content.substring(0, 1000));
        console.log("----");
        console.log(res.data.text_content.substring(res.data.text_content.length - 1000));
    } catch (e) {
        console.error(e.message);
    }
}
test();
