import { IBaseCollector } from '../types/PipelineTypes';
import { NaverNewsService } from '../../NaverNewsService';

export class NaverSearchCollector implements IBaseCollector {
    private newsService = NaverNewsService.getInstance();

    public async collect(options?: { forceFetch?: boolean, keyword?: string }): Promise<any> {
        const keyword = options?.keyword;
        if (!keyword) {
            throw new Error("검색어가 제공되지 않았습니다.");
        }
        
        try {
            console.log(`[NaverSearchCollector] Searching for: ${keyword} via Naver Open API...`);
            
            // Naver Open API를 사용하여 최대 7건의 관련 뉴스 검색
            const items = await this.newsService.searchNews(keyword, 7);
            
            return {
                keyword: keyword,
                articles: items,
                timestamp: new Date().toISOString()
            };
        } catch (error: any) {
            // API 키가 없는 경우 등 에러 발생 시 명확히 전달
            if (error.message.includes('API 키가 설정되지 않았습니다')) {
                throw new Error('네이버 API 키가 설정되지 않았습니다. [설정 > API 키 관리]에서 등록해주세요.');
            }
            throw new Error(`Naver Search Failed: ${error.message}`);
        }
    }
}
