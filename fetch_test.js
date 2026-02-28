const axios = require('axios');

async function test() {
    try {
        const tokenRes = await axios.post('https://api.kiwoom.com/oauth2/token', {
            grant_type: 'client_credentials',
            appkey: '7vJgBdUKZQOXgfN9ZMg2ZRaZZhB2mgzJMNim3Zz5nwk',
            secretkey: 'Wa1ComElLUcKzTeNGcHKOB0IJ6otwB1TA30wmZtlNq4'
        });

        const token = tokenRes.data.access_token || tokenRes.data.token;
        console.log('Token acquired:', token.slice(0, 5));

        const res = await axios.post('https://api.kiwoom.com/api/dostk/acnt', {}, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka00001'
            }
        });

        console.log('ka00001 response:', JSON.stringify(res.data, null, 2));

        const acctList = Array.isArray(res.data?.acctNo) ? res.data.acctNo : [res.data?.acctNo];
        const acct = acctList[0];

        let acctClean = "5100286310"; // Hardcoded from previous run if needed
        if (acct) acctClean = typeof acct === 'string' ? acct.split(';')[0] : acct;

        console.log('Using account:', acctClean);

        const res2 = await axios.post('https://api.kiwoom.com/api/dostk/acnt', {
            account_no: acctClean,
            qry_tp: "1",
            dmst_stex_tp: "KRX"
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'kt00018',
                'cont-yn': 'N',
                'next-key': ""
            }
        });

        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const res3 = await axios.post('https://api.kiwoom.com/api/dostk/acnt', {
            account_no: acctClean,
            fr_dt: today,
            to_dt: today
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'kt00016'
            }
        });
        console.log('kt00016 response keys:', Object.keys(res3.data));
        console.log('kt00016 data:', JSON.stringify(res3.data, null, 2));

        const res4 = await axios.post('https://api.kiwoom.com/api/dostk/stkinfo', {
            stk_cd: '005930|000660'
        }, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'authorization': `Bearer ${token}`,
                'api-id': 'ka10095'
            }
        });
        console.log('ka10095 response keys:', Object.keys(res4.data));
        console.log('ka10095 data:', JSON.stringify(res4.data).slice(0, 500));
    } catch (e) {
        console.error('Error:', e.response ? JSON.stringify(e.response.data) : e.message);
    }
}

test();
