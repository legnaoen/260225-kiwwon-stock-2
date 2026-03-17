import { DatabaseService } from './DatabaseService';
import { IngestionManager } from './IngestionManager';
import { AiService } from './AiService';
import { eventBus, SystemEvent } from '../utils/EventBus';
import { JsonUtils } from '../utils/JsonUtils';

export interface YoutubeInsight {
    video_id: string;
    channel_id: string;
    title: string;
    thumbnail?: string;
    published_at: string;
    transcript?: string;
    summary?: any;
    channel_name?: string;
}

export class YoutubeService {
    private static instance: YoutubeService;
    private db = DatabaseService.getInstance();
    private get ingestionManager() {
        return IngestionManager.getInstance();
    }
    private aiService = AiService.getInstance();

    private constructor() { }

    public static getInstance() {
        if (!YoutubeService.instance) {
            YoutubeService.instance = new YoutubeService();
        }
        return YoutubeService.instance;
    }

    private emitProgress(stage: string, message: string, current = 0, total = 0) {
        eventBus.emit(SystemEvent.YOUTUBE_PROGRESS, { stage, message, current, total });
        console.log(`[YoutubeService] [${stage}] ${message} (${current}/${total})`);
    }

    private extractIdOrHandle(input: string): string {
        input = input.trim().replace(/\/$/, '');
        const handleMatch = input.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/(@[\w.-]+)/);
        if (handleMatch) return handleMatch[1];
        const channelMatch = input.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/channel\/(UC[\w-]+)/);
        if (channelMatch) return channelMatch[1];
        if (input.includes('youtube.com/')) {
            const parts = input.split('/');
            const lastPart = parts[parts.length - 1];
            if (lastPart) return lastPart.startsWith('@') ? lastPart : `@${lastPart}`;
        }
        return input;
    }

    public async getChannels() {
        return (this.db as any).db.prepare(`
            SELECT c.*, 
                   (SELECT MAX(published_at) FROM youtube_narrative_logs WHERE channel_id = c.channel_id) as last_collected_at
            FROM youtube_channels c
        `).all();
    }

    public async addChannel(id: string, name: string) {
        const cleanId = this.extractIdOrHandle(id);
        const stmt = (this.db as any).db.prepare('INSERT OR IGNORE INTO youtube_channels (channel_id, channel_name) VALUES (?, ?)');
        return stmt.run(cleanId, name);
    }

    public async removeChannel(id: string) {
        const stmt = (this.db as any).db.prepare('DELETE FROM youtube_channels WHERE channel_id = ?');
        return stmt.run(id);
    }

    public async updateChannelTrust(id: string, score: number) {
        const stmt = (this.db as any).db.prepare('UPDATE youtube_channels SET trust_score = ? WHERE channel_id = ?');
        return stmt.run(score, id);
    }

    public async getLatestInsights(limit = 20) {
        return (this.db as any).db.prepare(`
            SELECT l.*, c.channel_name 
            FROM youtube_narrative_logs l
            JOIN youtube_channels c ON l.channel_id = c.channel_id
            ORDER BY published_at DESC LIMIT ?
        `).all(limit);
    }

    public async saveInsight(insight: YoutubeInsight) {
        const startTime = Date.now();
        try {
            const stmt = (this.db as any).db.prepare(`
                INSERT OR REPLACE INTO youtube_narrative_logs (
                    video_id, channel_id, published_at, title, thumbnail, transcript, summary_json, collected_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            stmt.run(
                insight.video_id,
                insight.channel_id,
                insight.published_at,
                insight.title,
                insight.thumbnail || null,
                insight.transcript || '',
                insight.summary ? JSON.stringify(insight.summary) : null,
                new Date().toISOString()
            );

            this.ingestionManager.recordIngestion('youtube_narrative', 'YouTube Collector', startTime, 200, JSON.stringify(insight).length / 1024);
            return { success: true };
        } catch (error: any) {
            this.ingestionManager.recordIngestion('youtube_narrative', 'YouTube Collector', startTime, 500, 0, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 영상의 자막(Transcript)을 수집합니다.
     */
    private async fetchTranscript(videoId: string): Promise<string> {
        try {
            const axios = (await import('axios')).default;
            const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
            });
            
            const html = response.data;
            const captionsConfigMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
            if (!captionsConfigMatch) return "";

            const captionTracks = JSON.parse(captionsConfigMatch[1]);
            const targetTrack = captionTracks.find((t: any) => t.languageCode === 'ko') || captionTracks[0];
            if (!targetTrack || !targetTrack.baseUrl) return "";

            const transcriptRes = await axios.get(targetTrack.baseUrl);
            const transcriptXml = transcriptRes.data;
            
            const textMatch = transcriptXml.match(/<text.*?>([\s\S]*?)<\/text>/g);
            if (!textMatch) return "";

            return textMatch
                .map((t: string) => t.replace(/<text.*?>|<\/text>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
                .join(' ')
                .slice(0, 5000); // 5000자 제한

        } catch (err) {
            console.error(`[YoutubeService] Transcript fetch failed for ${videoId}`);
            return "";
        }
    }

    public async collectLatestVideos(apiKey: string, channelId?: string, options: { skipAnalysis?: boolean } = {}) {
        apiKey = apiKey.trim();
        this.emitProgress('START', '내러티브 분석 프로세스를 시작합니다...');
        
        try {
            const axios = (await import('axios')).default;
            const channels = channelId 
                ? [{ channel_id: this.extractIdOrHandle(channelId), last_collected_at: null, channel_name: '' }] 
                : await this.getChannels();

            this.emitProgress('CHANNEL_SYNC', '채널 고유 식별자 상태를 점검합니다.', 0, channels.length);
            
            for (let i = 0; i < channels.length; i++) {
                const channel = channels[i];
                if (!channel.channel_id.startsWith('UC')) {
                    this.emitProgress('CHANNEL_SYNC', `${channel.channel_id} 핸들 해소 중...`, i+1, channels.length);
                    try {
                        const handle = channel.channel_id.startsWith('@') ? channel.channel_id : `@${channel.channel_id}`;
                        const chanRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
                            params: { part: 'id,snippet', forHandle: handle, key: apiKey }
                        });
                        if (chanRes.data.items?.length > 0) {
                            const realId = chanRes.data.items[0].id;
                            const realName = chanRes.data.items[0].snippet.title;
                            (this.db as any).db.prepare('UPDATE youtube_channels SET channel_id = ?, channel_name = ? WHERE channel_id = ?').run(realId, realName, channel.channel_id);
                            channel.channel_id = realId;
                            channel.channel_name = realName;
                        }
                    } catch (e) {}
                }
            }

            this.emitProgress('VIDEO_SEARCH', '신규 영상 리스트를 업데이트합니다.');
            const newVideos: any[] = [];
            for (const channel of channels) {
                const oneDayAgo = new Date();
                oneDayAgo.setHours(oneDayAgo.getHours() - 24);
                const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
                    params: { part: 'snippet', channelId: channel.channel_id, maxResults: 3, order: 'date', type: 'video', key: apiKey, publishedAfter: oneDayAgo.toISOString() }
                });
                if (response.data.items) {
                    for (const item of response.data.items) {
                        const existing = (this.db as any).db.prepare('SELECT summary_json, transcript FROM youtube_narrative_logs WHERE video_id = ?').get(item.id.videoId);
                        if (!existing || !existing.summary_json || existing.summary_json.includes('"status":"pending"')) {
                            newVideos.push({
                                video_id: item.id.videoId,
                                channel_id: channel.channel_id,
                                channel_name: channel.channel_name,
                                title: item.snippet.title,
                                thumbnail: item.snippet.thumbnails?.medium?.url,
                                published_at: item.snippet.publishedAt,
                                transcript: existing?.transcript || ""
                            });
                        }
                    }
                }
            }

            if (newVideos.length === 0) {
                this.emitProgress('DONE', '분석할 새로운 영상이 없습니다.');
                return { success: true, count: 0, report: "새로운 영상이 없습니다.", sources: [] };
            }

            // [NEW] 발견된 영상을 즉시 DB에 저장 (분석 전이라도 피드에 노출되도록)
            for (const video of newVideos) {
                await this.saveInsight({
                    ...video,
                    summary: { status: 'pending' }
                });
            }

            const processingVideos = newVideos; // No arbitrary limit
            const totalVideos = processingVideos.length;

            // 1. 모든 영상의 자막 추출
            for (let i = 0; i < totalVideos; i++) {
                const video = processingVideos[i];
                if (!video.transcript) {
                    this.emitProgress('TRANSCRIPT_FETCH', `[${i+1}/${totalVideos}] '${video.title}' 자막 추출 중...`, i+1, totalVideos);
                    video.transcript = await this.fetchTranscript(video.video_id);
                }
            }

            if (options.skipAnalysis) {
                this.emitProgress('DONE', '신규 영상 목록 업데이트가 완료되었습니다. (분석 생략)');
                return { success: true, count: totalVideos, sources: processingVideos };
            }

            // 2. 통합 배치 분석 수행
            this.emitProgress('AI_ANALYSIS', `총 ${totalVideos}개 영상 통합 내러티브 분석 중...`, 1, 1);
            const batchResult = await this.analyzeVideosBatch(processingVideos);
            
            if (!batchResult || !batchResult.global_report) {
                throw new Error("통합 분석 결과 생성에 실패했습니다.");
            }

            // 3. 개별 영상 로그 업데이트 (배치 결과에서 추출된 데이터 매칭)
            this.emitProgress('REPORT_GEN', '개별 인사이트 및 통합 리포트 저장 중...', 1, 1);
            const global = batchResult.global_report;
            const individuals = batchResult.individual_insights || [];

            for (const video of processingVideos) {
                const matchedInsight = individuals.find((v: any) => v.video_id === video.video_id);
                if (matchedInsight) {
                    const individualSummary = {
                        ...matchedInsight,
                        status: 'completed'
                    };
                    delete (individualSummary as any).video_id; // 중복 식별자 제거
                    (this.db as any).db.prepare('UPDATE youtube_narrative_logs SET transcript = ?, summary_json = ? WHERE video_id = ?')
                        .run(video.transcript || '', JSON.stringify(individualSummary), video.video_id);
                } else {
                    // 매칭 실패 시 기본 최소 정보로 저장
                    (this.db as any).db.prepare('UPDATE youtube_narrative_logs SET transcript = ?, summary_json = ? WHERE video_id = ?')
                        .run(video.transcript || '', JSON.stringify({ status: 'completed', summary: '통합 리포트에 포함됨' }), video.video_id);
                }
            }

            // 4. 통합 리포트(Consensus) 최종 저장 (새로운 데이터가 있을 때만)
            const today = DatabaseService.getInstance().getKstDate();
            DatabaseService.getInstance().saveYoutubeDailyConsensus({
                date: today,
                consensus_report: global.consensus_report,
                pivot_analysis: global.pivot_analysis,
                sources_json: JSON.stringify(processingVideos.map(v => ({ channel: v.channel_name, title: v.title, video_id: v.video_id })))
            });

            DatabaseService.getInstance().saveYoutubeNarrativeTrends({
                date: today,
                sector_rankings_json: JSON.stringify(global.sector_rankings),
                sentiment_score: global.sentiment_score,
                hot_keywords_json: JSON.stringify(global.hot_keywords)
            });
            
            this.emitProgress('DONE', '내러티브 지능망 통합 업데이트가 완료되었습니다.');
            return { 
                success: true, 
                count: totalVideos, 
                report: global.consensus_report, 
                pivot: global.pivot_analysis,
                trends: global.sector_rankings,
                sources: processingVideos 
            };

        } catch (error: any) {
            this.emitProgress('ERROR', `오류 발생: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    public async reanalyzeVideo(videoId: string) {
        try {
            const video = (this.db as any).db.prepare('SELECT * FROM youtube_narrative_logs WHERE video_id = ?').get(videoId);
            if (!video) return { success: false, error: '영상을 찾을 수 없습니다.' };
            
            // 자막이 없는 경우 다시 시도
            if (!video.transcript) {
                video.transcript = await this.fetchTranscript(videoId);
            }

            const insight: YoutubeInsight = {
                video_id: video.video_id,
                channel_id: video.channel_id,
                title: video.title,
                published_at: video.published_at,
                transcript: video.transcript
            };

            const summary = await this.analyzeVideo(insight);
            return { success: true, summary };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    private async analyzeVideosBatch(videos: any[]) {
        try {
            const today = DatabaseService.getInstance().getKstDate();
            const pastConsensus = DatabaseService.getInstance().getLatestYoutubeDailyConsensus(7);
            const pastContext = pastConsensus.map((c: any) => `[${c.date}] ${c.consensus_report}`).join('\n');

            const transcriptsBlock = videos.map((v, idx) => {
                return `--- [VIDEO ${idx+1}] ---\nCHANNEL: ${v.channel_name}\nTITLE: ${v.title}\nVIDEO_ID: ${v.video_id}\nTRANSCRIPT: ${v.transcript || 'No transcript'}\n`;
            }).join('\n\n');

            const systemPrompt = `당신은 대한민국 주식 시장의 모든 전문가 견해들을 한데 모아 분석하는 '메가 테마 통합 전략 AI'입니다. 
제공된 수많은 영상 자막(Transcript)들을 동시에 읽고, 전문가들 사이의 공통된 의견과 상충하는 의견을 대조하여 시장의 핵심 내러티브를 분석하십시오.

[분석 지침]
1. 통합 분석 (Global Report): 모든 영상을 관통하는 가장 중요한 흐름을 3~5문장으로 요약하고, 전문가들 간의 합의점과 이견을 명확히 하십시오.
2. 피보팅 감지: 과거 흐름과 비교하여 새롭게 등장하는 내러티브나 시장의 변화(Pivot)를 포착하십시오.
3. 섹터 랭킹: 언급 빈도와 강도를 바탕으로 상위 5개 섹터를 선정하고 상세 근거와 관련주를 포함하십시오.
4. 개별 인사이트 (Individual Insights): 각 영상별로 핵심 요약과 성격(MARKET_ANALYSIS, STOCK_DEEP_DIVE 등)을 추출하여 개별 관리할 수 있게 하십시오.

결과는 반드시 다음 JSON 형식을 엄격히 준수해야 합니다:
{
  "global_report": {
    "consensus_report": "전체 통합 시장 내러티브 요약...",
    "pivot_analysis": "내러티브의 변화점 또는 특이사항...",
    "sector_rankings": [
      { "sector": "섹터명", "score": 95, "summary": "분석 근거...", "related_stocks": [{ "name": "종목명", "change": 1.2 }] }
    ],
    "sentiment_score": 0.65,
    "hot_keywords": [
      { "keyword": "키워드", "score": 98 }
    ]
  },
  "individual_insights": [
    {
       "video_id": "영상 ID (반드시 VIDEO_ID와 일치시킬 것)",
       "contentType": "MARKET_ANALYSIS | STOCK_DEEP_DIVE | ECONOMIC_INSIGHT | OTHERS",
       "summary": "개별 영상의 핵심 한 줄 요약",
       "detailedAnalysis": "2~3문단 분량의 깊이 있는 분석",
       "topSectors": [{ "sector": "명칭", "bias": 0.5, "reasoning": "근거" }],
       "sentiment": 0.5,
       "impactScore": 7,
       "keywords": ["키1", "키2"]
    }
  ]
}`;

            const userPrompt = `[과거 흐름]\n${pastContext || '이력 없음'}\n\n[오늘의 전문가 원문 데이터]\n${transcriptsBlock}`;
            
            const aiResponse = await this.aiService.askGemini(userPrompt, systemPrompt);
            const result = JsonUtils.extractAndParse(aiResponse);
            return result;
        } catch (e: any) {
            console.error('[YoutubeService] Batch analysis failed:', e);
            return null;
        }
    }

    private async analyzeVideo(insight: YoutubeInsight) {
        // 이 함수는 개별 재분석(reanalyzeVideo) 시에 쓰이도록 유지
        try {
            const systemPrompt = `대한민국 주식 시장 수석 전략가로서 영상 자막을 깊이 있게 분석하십시오.
JSON 형식만 반환: { "contentType": "...", "summary": "...", "detailedAnalysis": "...", "topSectors": [...], "sentiment": 0.5, "impactScore": 5, "keywords": [...] }`;
            const userPrompt = `제목: ${insight.title}\n자막: ${insight.transcript}`;
            const aiResponse = await this.aiService.askGemini(userPrompt, systemPrompt);
            const summary = JsonUtils.extractAndParse(aiResponse);
            summary.status = 'completed';
            (this.db as any).db.prepare('UPDATE youtube_narrative_logs SET transcript = ?, summary_json = ? WHERE video_id = ?')
                .run(insight.transcript || '', JSON.stringify(summary), insight.video_id);
            return summary;
        } catch (e) { return { status: 'error' }; }
    }
}