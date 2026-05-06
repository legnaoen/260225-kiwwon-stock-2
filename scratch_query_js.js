const { KiwoomService } = require('./electron/services/KiwoomService');

async function testKiwoomAPI() {
    const kiwoom = KiwoomService.getInstance();
    // Use an existing cached token or perform a quick mock
    const Store = (await import('electron-store')).default;
    const store = new Store();
    const settings = store.get('autotrade_settings') || {};
    const accountNo = settings.selectedAccount;
    
    if (!accountNo) { console.log('no account'); return; }

    try {
        const rawList = await kiwoom.makeApiRequestWithRetry(async (token) => {
            const url = `http://localhost:3000/api/dostk/acnt`;
            const headers = { 'authorization': `Bearer ${token}`, 'api-id': 'kt00007' };
            const body = { account_no: accountNo, qry_tp: '4', stk_bond_tp: '1', sell_tp: '0', stk_cd: '', fr_ord_no: '', dmst_stex_tp: '%' };
            const axios = require('axios');
            const res = await axios.post(url, body, { headers });
            return res.data;
        });
        
        const list = Array.isArray(rawList?.acnt_ord_cntr_prps_dtl) ? rawList.acnt_ord_cntr_prps_dtl : [rawList?.acnt_ord_cntr_prps_dtl];
        console.log('Sample item keys:', Object.keys(list[0] || {}));
        console.log('Sample item:', list[0]);
    } catch (e) {
        console.log('error', e.message);
    }
}
testKiwoomAPI();
