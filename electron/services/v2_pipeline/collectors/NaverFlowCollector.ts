import { IBaseCollector } from '../types/PipelineTypes';
import axios from 'axios';

export class NaverFlowCollector implements IBaseCollector {
    private proxyUrl = 'http://127.0.0.1:5050/api/fetch_any';

    public async collect(options?: { forceFetch?: boolean }): Promise<any> {
        const now = new Date();
        const urls = [
            // 사용자의 요청대로 최신 증권 통합 SPA 페이지 주소를 직접 크롤링합니다.
            { type: 'SECTOR', url: 'https://stock.naver.com/market/stock/kr/industry/1' },
            { type: 'THEME', url: 'https://stock.naver.com/market/stock/kr/theme/1' }
        ];

        const results: any[] = [];

        try {
            for (const item of urls) {
                console.log(`[NaverFlowCollector] Fetching ${item.type} via md-browse...`);
                const response = await axios.get(this.proxyUrl, {
                    params: {
                        url: item.url,
                        engine: 'md_browse'
                    },
                    timeout: 20000 
                });

                if (response.data && response.data.text_content) {
                    results.push({
                        type: item.type,
                        markdown: response.data.text_content,
                        meta: response.data.meta
                    });
                } else {
                    console.warn(`[NaverFlowCollector] No markdown content for ${item.type}`);
                }
            }

            return {
                timestamp: now.toISOString(),
                rawMarkdownList: results
            };

        } catch (error: any) {
            console.error('[NaverFlowCollector] Failed to fetch via Python daemon:', error.message);
            return {
                timestamp: now.toISOString(),
                error: error.message,
                rawMarkdownList: []
            };
        }
    }
}
