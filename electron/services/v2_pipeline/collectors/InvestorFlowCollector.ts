import axios from 'axios';

export class InvestorFlowCollector {
    private proxyJsonUrl = 'http://127.0.0.1:5050/api/proxy_json';

    public async collect(): Promise<any> {
        const rawData: any = {
            timestamp: new Date().toISOString()
        };

        try {
            const [kospi, kosdaq, fut] = await Promise.all([
                this.fetchNaverTrend('KOSPI'),
                this.fetchNaverTrend('KOSDAQ'),
                this.fetchNaverTrend('FUT')
            ]);

            rawData.kospi = kospi;
            rawData.kosdaq = kosdaq;
            rawData.fut = fut;

            // Optional: You can add Program Trading HTML scraping here if you want
            // For now, these 3 JSON endpoints are the core.
            
        } catch (error: any) {
            console.error('[InvestorFlowCollector] 수집 중 오류:', error.message);
        }

        return rawData;
    }

    private async fetchNaverTrend(market: string): Promise<any> {
        const url = `https://m.stock.naver.com/api/index/${market}/trend`;
        try {
            // Node.js 환경에서 직접 호출시 차단될 수 있으므로 Python 프록시를 통합니다.
            const response = await axios.get(this.proxyJsonUrl, {
                params: { url },
                timeout: 5000
            });
            return response.data;
        } catch (error: any) {
            console.error(`[InvestorFlowCollector] ${market} 데이터 수집 실패:`, error.message);
            return null;
        }
    }
}
