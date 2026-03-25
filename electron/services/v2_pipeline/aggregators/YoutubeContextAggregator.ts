import { IBaseAggregator } from '../types/PipelineTypes';

export class YoutubeContextAggregator implements IBaseAggregator {
    public async process(rawData: any): Promise<string> {
        if (!rawData) return '유튜브 데이터가 없습니다.';

        if (rawData.error) {
            return `> ⚠️ ${rawData.error}`;
        }

        const videos = rawData.videos || [];
        const consensus = rawData.consensus;

        if (videos.length === 0 && !consensus) {
            return '> 수집된 유튜브 영상이 없습니다.';
        }

        const lines: string[] = ['### 📺 유튜브 증시 채널 모니터링\n'];

        const timestamp = rawData.timestamp
            ? new Date(rawData.timestamp).toLocaleString('ko-KR')
            : new Date().toLocaleString('ko-KR');

        lines.push(`> 📊 수집 시각: ${timestamp} | 채널 ${rawData.channelCount || 0}개 | 영상 ${videos.length}건 (신규 ${rawData.newCount || 0}건)`);
        lines.push('');

        // 영상 리스트 (로데이터만)
        lines.push('#### 📋 최근 수집 영상');
        lines.push('| 채널 | 영상 제목 | 시간 | 자막 | 분석 |');
        lines.push('| :--- | :--- | :--- | :---: | :---: |');

        for (const v of videos.slice(0, 15)) {
            const time = v.publishedAt
                ? new Date(v.publishedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '-';
            const transcript = v.hasTranscript ? '✅' : '❌';
            const analyzed = v.hasSummary ? '✅' : '⏳';
            const title = v.title.length > 40 ? v.title.slice(0, 40) + '...' : v.title;
            lines.push(`| ${v.channelName || '-'} | ${title} | ${time} | ${transcript} | ${analyzed} |`);
        }

        // 3. 자막 프리뷰 (최신 3건)
        const withTranscript = videos.filter((v: any) => v.hasTranscript && v.transcriptPreview);
        if (withTranscript.length > 0) {
            lines.push('');
            lines.push('#### 📝 최신 영상 자막 프리뷰 (일부)');
            for (const v of withTranscript.slice(0, 3)) {
                lines.push(`\n**${v.channelName} — ${v.title}**`);
                lines.push(`> ${v.transcriptPreview}...`);
            }
        }

        lines.push(`\n*※ YouTube Data API + 자막 크롤링 (로데이터) — AI 분석 미적용*`);
        return lines.join('\n');
    }
}
