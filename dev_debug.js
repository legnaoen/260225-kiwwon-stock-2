const { KiwoomService } = require('./dist/services/KiwoomService.js');
const { DatabaseService } = require('./dist/services/DatabaseService.js');

async function test() {
    try {
        DatabaseService.getInstance().init(); // Initialize DB if needed
        const kiwoom = KiwoomService.getInstance();
        const tokens = { appkey: 'mock', secretkey: 'mock' }; // Mock token manager bypass? 
        // We will just try to call it and see if it hits the internal server
        
        console.log('Fetching Daily...');
        const daily = await kiwoom.getOhlcvDaily('069500', 5);
        console.log('Daily:', daily);
        
        console.log('Fetching 5m...');
        const m5 = await kiwoom.getOhlcv5m('069500', 1);
        console.log('5M:', m5[m5.length - 1]);
        
    } catch(e) {
        console.error(e);
    }
}
test();
