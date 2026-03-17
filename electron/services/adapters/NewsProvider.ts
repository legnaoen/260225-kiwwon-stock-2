import { DataProvider, IngestionResult, StandardData } from './DataProvider';
import { NaverNewsService } from '../NaverNewsService';
import { DatabaseService } from '../DatabaseService';

export class NewsProvider implements DataProvider {
    public readonly providerId = 'naver_news_top50';
    public readonly category = 'NEWS';
    private newsService = NaverNewsService.getInstance();
    private db = DatabaseService.getInstance();

    async fetch(options?: { query?: string, limit?: number }): Promise<IngestionResult> {
        const startTime = Date.now();
        const query = options?.query || '코스피 코스닥 시황';
        const limit = options?.limit || 20;

        try {
            const items = await this.newsService.searchNews(query, limit);
            
            const standardData: StandardData[] = items.map(item => ({
                id: Buffer.from(item.link).toString('base64'),
                source: 'Naver News',
                category: 'NEWS',
                title: item.title,
                content: item.description,
                url: item.link,
                timestamp: this.db.getKstTimestamp(new Date(item.pubDate)),
                metadata: {
                    originalPubDate: item.pubDate,
                    originallink: item.originallink
                }
            }));

            const sizeKb = JSON.stringify(items).length / 1024;

            return {
                success: true,
                data: standardData,
                stats: {
                    startTime,
                    endTime: Date.now(),
                    sizeKb,
                    count: items.length
                }
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                stats: {
                    startTime,
                    endTime: Date.now(),
                    sizeKb: 0,
                    count: 0
                }
            };
        }
    }
}
