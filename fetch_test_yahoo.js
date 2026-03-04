const https = require('https');

function testYahoo(symbol) {
    const now = Math.floor(Date.now() / 1000);
    const tenYearsAgo = now - (10 * 365 * 24 * 60 * 60);

    // Yahoo v8 chart API URL
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${tenYearsAgo}&period2=${now}&interval=1mo`;

    console.log(`[Test] Requesting: ${url}`);

    https.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    }, (res) => {
        let data = '';
        console.log(`[Test] Status Code: ${res.statusCode}`);

        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                if (json.chart && json.chart.result) {
                    const quotes = json.chart.result[0].indicators.quote[0];
                    console.log(`[Test] Success! Received ${quotes.close.length} data points.`);
                } else {
                    console.error(`[Test] Failed: ${JSON.stringify(json.chart?.error || 'Unknown error')}`);
                }
            } catch (e) {
                console.error(`[Test] Parse Error: ${e.message}`);
                console.log(`[Test] Raw Data: ${data.substring(0, 200)}...`);
            }
        });
    }).on('error', (err) => {
        console.error(`[Test] Request Error: ${err.message}`);
    });
}

testYahoo('005930.KS');
