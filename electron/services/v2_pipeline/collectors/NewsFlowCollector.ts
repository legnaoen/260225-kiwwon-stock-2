import { IBaseCollector } from '../types/PipelineTypes';
import axios from 'axios';

/**
 * PL-NewsFlow Collector
 * 
 * 네이버 증권 뉴스를 JSON API를 통해 수집합니다.
 * NaverFlow에서 검증된 동일한 방식 (Python proxy_json) 사용.
 * 
 * 수집 카테고리:
 *   - MAJOR: 주요뉴스 (네이버 에디터 큐레이션)
 *   - GLOBAL: 해외뉴스 (글로벌 시장 변수)
 */
export class NewsFlowCollector implements IBaseCollector {
    private proxyJsonUrl = 'http://127.0.0.1:5050/api/proxy_json';

    public async collect(options?: { forceFetch?: boolean }): Promise<any> {
        const now = new Date();

        const todayStr = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0')
        ].join('');

        // NaverFlow와 동일한 패턴: 카테고리별 API URL 목록
        const apiSources = [
            {
                category: 'MAJOR',
                url: 'https://m.stock.naver.com/front-api/news/category?category=mainnews&pageSize=20&page=1'
            },
            {
                category: 'GLOBAL', // 기존 해외뉴스 탭
                url: 'https://m.stock.naver.com/front-api/news/worldnews?pageSize=20&page=1'
            },
            {
                category: 'STOCK_ANALYSIS', // 뉴스포커스 > 기업·종목분석
                url: `https://stock.naver.com/api/domestic/news/focus?sid=402&page=1&pageSize=15&date=${todayStr}&enableFallback=true`
            },
            {
                category: 'GLOBAL_MARKET', // 뉴스포커스 > 해외증시
                url: `https://stock.naver.com/api/domestic/news/focus?sid=403&page=1&pageSize=15&date=${todayStr}&enableFallback=true`
            }
        ];

        const results: any[] = [];

        for (const source of apiSources) {
            try {
                console.log(`[NewsFlowCollector] Fetching ${source.category} news via proxy_json...`);
                // Python 크롤러 프록시는 naver.com 도메인을 모두 허용하므로 동일하게 사용 가능!
                const response = await axios.get(this.proxyJsonUrl, {
                    params: { url: source.url },
                    timeout: 15000
                });

                const data = response.data;

                // front-api 응답 구조: { isSuccess, result: [...] }
                // API 종류에 따라 result 또는 articles 내부에 배열이 존재합니다.
                const articles = data?.result || data?.articles || data || [];

                if (Array.isArray(articles) && articles.length > 0) {
                    results.push({
                        category: source.category,
                        articles: articles,
                        count: articles.length
                    });
                    console.log(`[NewsFlowCollector] ${source.category}: ${articles.length}건 수집 완료`);
                } else {
                    console.warn(`[NewsFlowCollector] ${source.category}: 기사 없음`);
                    results.push({
                        category: source.category,
                        articles: [],
                        count: 0
                    });
                }
            } catch (err: any) {
                console.error(`[NewsFlowCollector] ${source.category} 수집 실패:`, err.message);
                results.push({
                    category: source.category,
                    articles: [],
                    count: 0,
                    error: err.message
                });
            }
        }

        return {
            timestamp: now.toISOString(),
            newsList: results
        };
    }
}
