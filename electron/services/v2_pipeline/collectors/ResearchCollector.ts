import axios from 'axios';
import { IBaseCollector } from '../types/PipelineTypes';
import { DatabaseService } from '../../DatabaseService';

export class ResearchCollector implements IBaseCollector {
    private readonly PROXY_URL = 'http://127.0.0.1:5050/api/proxy_json';

    public async collect(options?: { forceFetch?: boolean }): Promise<any> {
        try {
            console.log('[PL-Research] Fetching Naver Research Data...');
            const dateStr = DatabaseService.getInstance().getKstDate();
            const hotSectors: any[] = [];
            
            // 1. 애널리스트 집중 산업 TOP 3
            try {
                const targetUrl = 'https://stock.naver.com/api/domestic/research/industry-research';
                const response = await axios.get(this.PROXY_URL, {
                    params: { url: targetUrl },
                    timeout: 10000
                });

                if (response.data && !response.data.error) {
                    const industryMap = response.data;
                    let rank = 1;
                    if (industryMap && typeof industryMap === 'object') {
                        for (const [industryName, reportsList] of Object.entries(industryMap)) {
                            if (!Array.isArray(reportsList)) continue;
                            if (rank > 3) break;

                            const articles = (reportsList as any[]).map((r: any) => ({
                                title: r.title || '(No Title)',
                                analyst: r.analyst || '',
                                broker: r.brokerName || '',
                                snippet: r.content || '',
                                url: r.endUrl || ''
                            }));

                            hotSectors.push({
                                rank,
                                categoryName: industryName,
                                articles
                            });
                            rank++;
                        }
                    }
                }
            } catch (err: any) {
                console.warn('[PL-Research] Failed to fetch Top 3 Industries:', err.message);
            }

            // 2. 카테고리별 전체 리포트 1페이지 수집 (데일리, 종목, 산업, 전략, 경제)
            const categories = [
                { id: 'MARKET', name: '데일리' },
                { id: 'COMPANY', name: '국내종목' },
                { id: 'INDUSTRY', name: '산업분석' },
                { id: 'INVEST', name: '투자전략' },
                { id: 'ECONOMY', name: '경제분석' }
            ];

            const categoryReports: any[] = [];

            for (const cat of categories) {
                try {
                    console.log(`[PL-Research] Fetching Category: ${cat.name}`);
                    const catUrl = `https://stock.naver.com/api/domestic/research/category?category=${cat.id}&page=1&pageSize=15`;
                    const res = await axios.get(this.PROXY_URL, {
                        params: { url: catUrl },
                        timeout: 10000
                    });

                    if (res.data && res.data.content && Array.isArray(res.data.content)) {
                        const articles = res.data.content.map((r: any) => ({
                            title: r.title || '(No Title)',
                            analyst: r.analyst || '', // API에 따라 누락될 수도 있음
                            broker: r.brokerName || '',
                            snippet: r.content || '',
                            url: r.endUrl || ''
                        }));

                        categoryReports.push({
                            rank: 0,
                            categoryName: cat.name,
                            articles
                        });
                    }
                    
                    // Delay between category requests to prevent rate limit
                    await new Promise(r => setTimeout(r, 500));
                } catch (err: any) {
                    console.warn(`[PL-Research] Failed to fetch category ${cat.name}:`, err.message);
                }
            }

            return {
                timestamp: new Date().toISOString(),
                date: dateStr,
                hotSectors,
                categoryReports
            };
            
        } catch (err: any) {
            console.error(`[PL-Research] Critical Error collecting data:`, err.message);
            throw new Error(`Naver research sync failed: ${err.message}`);
        }
    }
}
