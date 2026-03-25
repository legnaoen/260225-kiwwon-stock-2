import { IBaseCollector } from '../types/PipelineTypes';
import { NaverNewsService } from '../../NaverNewsService';

export class NewsKeywordCollector implements IBaseCollector {
    private newsService = NaverNewsService.getInstance();

    // 시장 뉴스 검색 키워드 (AI 없이 단순 검색)
    private readonly SEARCH_KEYWORDS = [
        '코스피 코스닥 시황',
        '뉴욕증시 마감',
        '미국 금리 환율',
        '반도체 AI 주식',
        '외국인 기관 매수'
    ];

    public async collect(options?: { forceFetch?: boolean }): Promise<any> {
        try {
            const allArticles: any[] = [];
            const errors: string[] = [];
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

            for (const keyword of this.SEARCH_KEYWORDS) {
                try {
                    const items = await this.newsService.searchNews(keyword, 10);

                    // 최근 24시간 기사만 필터링
                    const recent = items.filter(item => new Date(item.pubDate).getTime() > oneDayAgo);

                    for (const item of recent) {
                        // 중복 제거 (같은 링크가 이미 있으면 스킵)
                        if (!allArticles.find(a => a.link === item.link)) {
                            allArticles.push({
                                title: item.title,
                                description: item.description,
                                link: item.link,
                                originallink: item.originallink,
                                pubDate: item.pubDate,
                                searchKeyword: keyword
                            });
                        }
                    }
                } catch (err: any) {
                    errors.push(`[${keyword}] ${err.message}`);
                }
            }

            // 키워드 빈도 카운팅 (AI 없이 단순 텍스트 매칭)
            const keywordCounts = this.extractKeywordFrequency(allArticles);

            console.log(`[NewsKeywordCollector] 수집 완료: ${allArticles.length}건 (키워드 ${this.SEARCH_KEYWORDS.length}개)`);

            return {
                timestamp: new Date().toISOString(),
                articles: allArticles,
                keywordCounts: keywordCounts,
                totalCount: allArticles.length,
                errors: errors.length > 0 ? errors : undefined
            };

        } catch (error: any) {
            console.error('[NewsKeywordCollector] Error:', error.message);
            
            // API 키 관련 에러 판별
            if (error.message.includes('API 키가 설정되지 않았습니다')) {
                return {
                    timestamp: new Date().toISOString(),
                    articles: [],
                    keywordCounts: [],
                    totalCount: 0,
                    error: '네이버 API 키가 설정되지 않았습니다. [설정 > API 키 관리]에서 등록해주세요.'
                };
            }
            
            return {
                timestamp: new Date().toISOString(),
                articles: [],
                keywordCounts: [],
                totalCount: 0,
                error: error.message
            };
        }
    }

    /**
     * 기사 제목+설명에서 자주 등장하는 키워드를 단순 카운팅
     * (AI 없이 텍스트 빈도 분석)
     */
    private extractKeywordFrequency(articles: any[]): { word: string; count: number; sentiment: string }[] {
        const hotWords = [
            '반도체', 'AI', '인공지능', 'HBM', '엔비디아',
            '금리', '환율', '달러', '인플레이션', '기준금리',
            '외국인', '기관', '매수', '매도', '순매수',
            '코스피', '코스닥', '나스닥', '다우',
            '2차전지', '배터리', '전기차', 'LG에너지',
            '바이오', '신약', '임상', 'FDA',
            '방산', '조선', 'K-푸드', '화장품',
            '트럼프', '관세', '무역전쟁', '지정학',
            '삼성전자', 'SK하이닉스', '현대차',
            '부동산', 'PF', '건설', '분양',
            '배당', 'IPO', '공모주', '상장'
        ];

        const allText = articles.map(a => `${a.title} ${a.description}`).join(' ');
        const counts: { word: string; count: number; sentiment: string }[] = [];

        for (const word of hotWords) {
            const regex = new RegExp(word, 'gi');
            const matches = allText.match(regex);
            if (matches && matches.length >= 2) {
                counts.push({
                    word,
                    count: matches.length,
                    sentiment: 'Neutral'
                });
            }
        }

        return counts.sort((a, b) => b.count - a.count).slice(0, 15);
    }
}
