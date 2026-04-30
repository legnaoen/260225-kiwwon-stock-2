import { KiwoomService } from './electron/services/KiwoomService';

async function test() {
    try {
        const kiwoom = KiwoomService.getInstance();
        const price = await kiwoom.getCurrentPrice('005930');
        console.log(JSON.stringify(price, null, 2));
    } catch(e) {
        console.error(e);
    }
}
test();
