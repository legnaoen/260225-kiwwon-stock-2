const axios = require('axios');
const fs = require('fs');
async function test() {
    try {
        const tokenStr = fs.readFileSync('c:\\Users\\legna\\Projects\\260224 kiwoom rest api\\store_data.json', 'utf8');
        const store = JSON.parse(tokenStr);
        const token = store.appToken?.access_token || '';

        const response = await axios.post('https://api.kiwoom.com/api/dostk/chart', {
            stk_cd: '005930',
            base_dt: '20260304',
            upd_stkpc_tp: '1'
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10081'
            }
        });
        console.log(JSON.stringify(response.data, null, 2).substring(0, 1000));
    } catch (e) {
        console.log("Error:", e.response?.data || e.message);
    }
}
test();
