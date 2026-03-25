const axios = require('axios');

async function check() {
    try {
        const res = await axios.get('http://127.0.0.1:5050/api/fetch_any', {
            params: { url: 'https://m.stock.naver.com/domestic/sector', engine: 'md_browse' }
        });
        console.log(res.data.text_content.slice(0, 1000));
        console.log("...");
        console.log(res.data.text_content.slice(1000, 2000));
    } catch(e) {
        console.error(e.message);
    }
}
check();
