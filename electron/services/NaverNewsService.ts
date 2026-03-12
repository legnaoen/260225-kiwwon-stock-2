import axios from 'axios'
import Store from 'electron-store'

const store = new Store()

export interface NaverNewsItem {
    title: string
    originallink: string
    link: string
    description: string
    pubDate: string
}

export class NaverNewsService {
    private static instance: NaverNewsService

    private constructor() {}

    public static getInstance(): NaverNewsService {
        if (!NaverNewsService.instance) {
            NaverNewsService.instance = new NaverNewsService()
        }
        return NaverNewsService.instance
    }

    private getKeys() {
        return store.get('naver_api_keys') as { clientId: string, clientSecret: string } | null
    }

    /**
     * 종목명으로 관련 뉴스를 검색합니다.
     * @param query 검색어 (보통 종목명)
     * @param display 검색 결과 개수 (1~100)
     */
    public async searchNews(query: string, display: number = 10): Promise<NaverNewsItem[]> {
        const keys = this.getKeys()
        if (!keys || !keys.clientId || !keys.clientSecret) {
            throw new Error('네이버 API 키가 설정되지 않았습니다. 설정 메뉴에서 입력해주세요.')
        }

        try {
            const response = await axios.get('https://openapi.naver.com/v1/search/news.json', {
                params: {
                    query,
                    display,
                    sort: 'sim' // 유사도순 (관련성 높은 기사를 위해)
                },
                headers: {
                    'X-Naver-Client-Id': keys.clientId,
                    'X-Naver-Client-Secret': keys.clientSecret
                }
            })

            if (response.data && response.data.items) {
                return response.data.items.map((item: any) => ({
                    ...item,
                    title: this.cleanHtml(item.title),
                    description: this.cleanHtml(item.description)
                }))
            }
            return []
        } catch (error: any) {
            console.error('[NaverNewsService] Search Error:', error.response?.data || error.message)
            throw new Error(`네이버 뉴스 검색 실패: ${error.response?.data?.errorMessage || error.message}`)
        }
    }

    /**
     * AI 분석을 위해 다수의 기사를 하나의 텍스트로 결합합니다.
     */
    public async getNewsSummaryForAi(stockName: string): Promise<string> {
        try {
            const news = await this.searchNews(stockName, 5)
            if (news.length === 0) return '관련 뉴스가 없습니다.'

            return news.map((item, idx) => 
                `[기사 ${idx + 1}] ${item.title}\n내용: ${item.description}`
            ).join('\n\n')
        } catch (error) {
            return `뉴스 수집 오류: ${error instanceof Error ? error.message : String(error)}`
        }
    }

    private cleanHtml(text: string): string {
        if (!text) return ''
        return text
            .replace(/<[^>]*>?/gm, '') // HTML 태그 제거
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&apos;/g, "'")
            .replace(/&nbsp;/g, ' ')
    }
}
