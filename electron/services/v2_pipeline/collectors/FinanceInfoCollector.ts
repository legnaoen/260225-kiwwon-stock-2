import { IBaseCollector } from '../types/PipelineTypes';
import axios from 'axios';
import { StockMasterService } from '../../StockMasterService';
import { DatabaseService } from '../../DatabaseService';

export class FinanceInfoCollector implements IBaseCollector {
    private proxyUrl = 'http://127.0.0.1:5050/api/fetch_any';

    public async collect(options?: { forceFetch?: boolean, keyword?: string }): Promise<any> {
        const keyword = options?.keyword?.trim();
        if (!keyword) {
            throw new Error("검색할 종목명/종목코드가 제공되지 않았습니다.");
        }

        try {
            console.log(`[FinanceInfoCollector] Resolving stock code for: ${keyword}`);
            
            const stockMaster = StockMasterService.getInstance();
            // 숫자만 있는 경우(이미 종목코드)와 이름인 경우를 구분
            let stockCode = keyword;
            let stockName = keyword;

            if (!/^\d+$/.test(keyword)) {
                // 정확히 일치하는 종목명부터 찾기 (라이크 검색의 ETN/ELW 오탐 방지)
                const db = DatabaseService.getInstance().getDb();
                let exactMatch = db.prepare('SELECT stock_code, stock_name FROM stocks_master WHERE stock_name = ? COLLATE NOCASE LIMIT 1').get(keyword);
                
                if (exactMatch) {
                    stockCode = exactMatch.stock_code;
                    stockName = exactMatch.stock_name;
                } else {
                    const results = await stockMaster.search(keyword, 1);
                    if (!results || results.length === 0) {
                        throw new Error(`내부 DB에서 종목명 '${keyword}'에 일치하는 상장 코드를 찾을 수 없습니다.`);
                    }
                    stockCode = results[0].stock_code;
                    stockName = results[0].stock_name || keyword;
                }
                console.log(`[FinanceInfoCollector] Master match: ${keyword} -> ${stockCode} (${stockName})`);
            }

            // 사령관님 타겟: 모바일 SPA(stock.naver.com)는 '기업실적 표' 부분을
            // 악의적으로 지연 로딩(Lazy Load)하거나 분리된 API로 렌더링하기 때문에,
            // 텍스트 기반 크롤러가 껍데기만 읽게 됩니다.
            // 대신, 타 부서의 크롤러 기술(md_browse)을 100% 동일하게 공유하면서도
            // 표가 HTML 상에 통째로 박혀나오는(SSR) 구형 홈(main.naver.com)을 정밀 타격합니다.
            const targetUrl = `https://finance.naver.com/item/main.naver?code=${stockCode}`;
            console.log(`[FinanceInfoCollector] Fetching finance details via python proxy (SSR mode): ${targetUrl}`);

            // 백엔드 크롤러에 요청
            const response = await axios.get(this.proxyUrl, {
                params: {
                    url: targetUrl,
                    engine: 'md_browse'
                },
                timeout: 35000 
            });

            if (!response.data || !response.data.text_content) {
                throw new Error("Python 크롤러가 마크다운을 정상적으로 추출하지 못했습니다.");
            }

            return {
                keyword: stockName,
                stockCode: stockCode,
                url: targetUrl,
                markdown: response.data.text_content,
                timestamp: new Date().toISOString()
            };

        } catch (error: any) {
            console.error('[FinanceInfoCollector] Error:', error.message);
            throw new Error(`재무/기업개요 수집 실패: ${error.message}`);
        }
    }
}
