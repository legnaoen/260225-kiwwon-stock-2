import { KiwoomService } from './electron/services/KiwoomService';
import Store from 'electron-store';
import axios from 'axios';
import Database from 'better-sqlite3';

async function fixTickets() {
    const kiwoom = KiwoomService.getInstance();
    const store = new Store();
    const settings = store.get('autotrade_settings') as any;
    const accountNo = settings?.selectedAccount;
    if (!accountNo) { console.log('no account'); return; }

    try {
        const rawList = await (kiwoom as any).makeApiRequestWithRetry(async (token: any) => {
            const url = `http://localhost:3000/api/dostk/acnt`;
            const headers = { 'authorization': `Bearer ${token}`, 'api-id': 'kt00007', 'Content-Type': 'application/json' };
            const body = { account_no: accountNo, qry_tp: '4', stk_bond_tp: '1', sell_tp: '0', stk_cd: '', fr_ord_no: '', dmst_stex_tp: '%' };
            const res = await axios.post(url, body, { headers });
            return res.data;
        });
        
        let executions = Array.isArray(rawList?.acnt_ord_cntr_prps_dtl) ? rawList.acnt_ord_cntr_prps_dtl : [rawList?.acnt_ord_cntr_prps_dtl];
        executions = executions.filter((e: any) => e);

        let sellData: any = {};
        for (const ex of executions) {
            const stk_cd = String(ex.stk_cd || ex.pdno || '').replace(/^A/, '');
            const sell_tp = String(ex.sell_tp || ex.sll_buy_tp || (String(ex.io_tp_nm).includes('매도') ? '1' : '2'));
            const cntr_qty = parseInt(ex.cntr_qty || '0', 10);
            const cntr_uv = parseInt(ex.cntr_uv || '0', 10);
            
            if (sell_tp === '1') {
                if (!sellData[stk_cd]) sellData[stk_cd] = { qty: 0, amt: 0 };
                sellData[stk_cd].qty += cntr_qty;
                sellData[stk_cd].amt += cntr_qty * cntr_uv;
            }
        }
        
        const dbPath = String.raw`C:\Users\legna\AppData\Roaming\kiwoom-trader\db\kiwoom.db`;
        const db = new Database(dbPath);
        
        const tickets = db.prepare("SELECT * FROM live_trade_tickets WHERE status = 'SELLING'").all() as any[];
        
        for (const t of tickets) {
            const sd = sellData[t.stock_code];
            if (sd && sd.qty > 0) {
                const exitPrice = Math.round(sd.amt / sd.qty);
                const realizedPct = exitPrice > 0 ? Number((((exitPrice - t.entry_price) / t.entry_price) * 100).toFixed(2)) : 0;
                db.prepare("UPDATE live_trade_tickets SET status = 'CLOSED', exit_price = ?, realized_profit_pct = ? WHERE ticket_id = ?").run(exitPrice, realizedPct, t.ticket_id);
                console.log(`Updated ${t.stock_name}: Exit ${exitPrice}, Pct ${realizedPct}%`);
            } else {
                console.log(`No sell data for ${t.stock_name}`);
            }
        }
        db.close();
    } catch (e: any) {
        console.log('error', e.message);
    }
}
fixTickets();
