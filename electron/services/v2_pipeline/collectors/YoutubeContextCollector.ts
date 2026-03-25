import { IBaseCollector } from '../types/PipelineTypes';
import { YoutubeService } from '../../YoutubeService';
import { DatabaseService } from '../../DatabaseService';
import Store from 'electron-store';

const store = new Store();

export class YoutubeContextCollector implements IBaseCollector {
    private youtubeService = YoutubeService.getInstance();
    private db = DatabaseService.getInstance();

    public async collect(options?: { forceFetch?: boolean }): Promise<any> {
        try {
            const apiKey = (store.get('youtube_api_key') as string || '').trim();

            if (!apiKey) {
                return {
                    timestamp: new Date().toISOString(),
                    videos: [],
                    consensus: null,
                    error: 'YouTube API 키가 설정되지 않았습니다. [설정 > API 키 관리]에서 등록해주세요.'
                };
            }

            // 등록된 채널 확인
            const channels = await this.youtubeService.getChannels();
            if (!channels || channels.length === 0) {
                return {
                    timestamp: new Date().toISOString(),
                    videos: [],
                    consensus: null,
                    error: '등록된 유튜브 채널이 없습니다. [설정 > 유튜브 채널 관리]에서 채널을 추가해주세요.'
                };
            }

            // AI 분석 없이 영상 수집 + 자막 추출만 수행
            // (skipAnalysis: true → 자막까지만 수집하고 Gemini 호출 안 함)
            console.log(`[YoutubeContextCollector] ${channels.length}개 채널에서 수집 시작 (AI 분석 스킵)`);
            const result = await this.youtubeService.collectLatestVideos(apiKey, undefined, { skipAnalysis: true });

            // DB에서 최근 수집된 영상 목록 (자막 포함)
            const recentInsights = await this.youtubeService.getLatestInsights(20);
            
            // DB에서 최근 일간 합의(Consensus) 조회 (이전에 AI 분석했던 결과가 있으면 표시)
            const latestConsensus = this.db.getLatestYoutubeDailyConsensus(1);

            const videos = recentInsights.map((ins: any) => {
                let summary = null;
                try {
                    summary = ins.summary_json ? JSON.parse(ins.summary_json) : null;
                } catch (e) {}
                
                return {
                    videoId: ins.video_id,
                    channelName: ins.channel_name || ins.channel_id,
                    title: ins.title,
                    thumbnail: ins.thumbnail,
                    publishedAt: ins.published_at,
                    hasTranscript: !!(ins.transcript && ins.transcript.length > 0),
                    transcriptPreview: ins.transcript ? ins.transcript.slice(0, 200) : '',
                    hasSummary: !!(summary && summary.status === 'completed'),
                    summary: summary
                };
            });

            console.log(`[YoutubeContextCollector] 수집 완료: ${videos.length}개 영상, 신규 ${result.count || 0}개`);

            return {
                timestamp: new Date().toISOString(),
                videos: videos,
                newCount: result.count || 0,
                totalCount: videos.length,
                channelCount: channels.length,
                consensus: latestConsensus?.[0] || null
            };

        } catch (error: any) {
            console.error('[YoutubeContextCollector] Error:', error.message);
            return {
                timestamp: new Date().toISOString(),
                videos: [],
                consensus: null,
                error: error.message
            };
        }
    }
}
