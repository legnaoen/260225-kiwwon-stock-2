const path = require('path');
const fs = require('fs');
const { app } = require('electron');

app.whenReady().then(async () => {
    try {
        console.log('App ready. Importing KiwoomService from dist-test...');
        const servicePath = path.resolve(__dirname, 'dist-test/KiwoomService.js');
        const servicePath2 = path.resolve(__dirname, 'dist-test/services/KiwoomService.js');
        let selectedPath = null;
        if (fs.existsSync(servicePath)) {
            selectedPath = servicePath;
        } else if (fs.existsSync(servicePath2)) {
            selectedPath = servicePath2;
        } else {
            console.error('Service path not found in dist-test:', servicePath, servicePath2);
            app.exit(1);
            return;
        }
        
        console.log('Using path:', selectedPath);
        const { KiwoomService } = require(selectedPath);
        const kiwoom = KiwoomService.getInstance();
        
        console.log('Fetching stock info for 064290 (인텍플러스)...');
        const info = await kiwoom.getStockBasicInfo('064290');
        console.log('--- RESPONSE ---');
        console.log(JSON.stringify(info, null, 2));
        console.log('----------------');
        app.exit(0);
    } catch (e) {
        console.error('Error during execution:', e);
        app.exit(1);
    }
});
