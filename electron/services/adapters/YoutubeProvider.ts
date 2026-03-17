import { DataProvider, IngestionResult, StandardData } from './DataProvider';
import { YoutubeService } from '../YoutubeService';
import { DatabaseService } from '../DatabaseService';
import Store from 'electron-store';

const store = new Store();

export class YoutubeProvider implements DataProvider {
    public readonly providerId = 'youtube_narrative';
    public readonly category = 'NEWS';
    private youtubeService = YoutubeService.getInstance();
    private db = DatabaseService.getInstance();

    async fetch(options?: { channelId?: string }): Promise<IngestionResult> {
        const startTime = Date.now();
        const apiKey = store.get('youtube_api_key') as string;
        
        if (!apiKey) {
            return {
                success: false,
                error: 'YouTube API Key is missing.',
                stats: { startTime, endTime: Date.now(), sizeKb: 0, count: 0 }
            };
        }

        try {
            const result = await this.youtubeService.collectLatestVideos(apiKey, options?.channelId);
            
            if (result.success) {
                // Fetch recent insights to return standard data
                const insights = await this.youtubeService.getLatestInsights(result.count || 5);
                const standardData: StandardData[] = insights.map((ins: any) => ({
                    id: ins.video_id,
                    source: 'YouTube Insights',
                    category: 'NEWS',
                    title: ins.title,
                    content: ins.summary_json ? JSON.parse(ins.summary_json).summary : 'No summary available',
                    timestamp: this.db.getKstTimestamp(new Date(ins.published_at)),
                    metadata: {
                        channel_name: ins.channel_name,
                        channel_id: ins.channel_id,
                        video_id: ins.video_id
                    }
                }));

                return {
                    success: true,
                    data: standardData,
                    stats: {
                        startTime,
                        endTime: Date.now(),
                        sizeKb: 0, // Recorded by service internally
                        count: result.count || 0
                    }
                };
            } else {
                return {
                    success: false,
                    error: result.error,
                    stats: { startTime, endTime: Date.now(), sizeKb: 0, count: 0 }
                };
            }
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                stats: { startTime, endTime: Date.now(), sizeKb: 0, count: 0 }
            };
        }
    }
}
