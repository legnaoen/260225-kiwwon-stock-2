import { IBaseAggregator } from '../types/PipelineTypes';
import { DatabaseService } from '../../DatabaseService';

export class ResearchAggregator implements IBaseAggregator {
    public async process(rawData: any): Promise<string> {
        if (!rawData) {
            return '데이터 수집에 실패했습니다.';
        }

        const hotSectors = rawData.hotSectors || [];
        const categoryReports = rawData.categoryReports || [];
        const dateStr = rawData.date;
        const collectedAt = rawData.timestamp;

        if (hotSectors.length === 0 && categoryReports.length === 0) {
            return '수집된 리서치 데이터가 없습니다.';
        }

        const lines: string[] = [`### 🎯 네이버 증권 리서치 통합 뷰어\n`];
        lines.push(`> 🚨 주간 집중 산업 정보와 5개 핵심 리서치 카테고리의 일간 리포트를 통합 수집합니다.\n`);

        let totalSaved = 0;
        const dbPayload: any[] = [];

        // 1. 집중 산업 마크다운
        if (hotSectors.length > 0) {
            lines.push(`#### 📈 [최근 1주간 애널리스트 집중 산업 탑 3]`);
            for (const sector of hotSectors) {
                lines.push(`\n**${sector.rank}위: ${sector.categoryName}** (리포트 ${sector.articles.length}건)`);
                for (let i = 0; i < sector.articles.length; i++) {
                    const article = sector.articles[i];
                    let cleanSnippet = article.snippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    if (cleanSnippet.length > 100) cleanSnippet = cleanSnippet.substring(0, 100) + '...';

                    lines.push(`- **${article.title}** (${article.broker})`);
                    if (cleanSnippet) lines.push(`  > ${cleanSnippet}`);

                    dbPayload.push({
                        date: dateStr,
                        rank: sector.rank,
                        industry_name: sector.categoryName,
                        report_title: article.title,
                        analyst: article.analyst,
                        broker: article.broker,
                        content_snippet: cleanSnippet,
                        url: article.url,
                        collected_at: collectedAt
                    });
                }
            }
            lines.push('');
            lines.push(`---`);
        }

        // 2. 카테고리 리포트 마크다운
        if (categoryReports.length > 0) {
            lines.push(`\n#### 📑 [카테고리별 최신 리포트 (최대 15건)]`);
            for (const cat of categoryReports) {
                if (cat.articles.length === 0) continue;
                lines.push(`\n**[${cat.categoryName}]**`);
                for (let i = 0; i < cat.articles.length; i++) {
                    const article = cat.articles[i];
                    let cleanSnippet = article.snippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    if (cleanSnippet.length > 80) cleanSnippet = cleanSnippet.substring(0, 80) + '...';

                    lines.push(`- **${article.title}** (${article.broker})`);
                    if (cleanSnippet) lines.push(`  > ${cleanSnippet}`);

                    dbPayload.push({
                        date: dateStr,
                        rank: 0,
                        industry_name: cat.categoryName, // 카테고리명을 산업명 필드에 공유
                        report_title: article.title,
                        analyst: article.analyst,
                        broker: article.broker,
                        content_snippet: cleanSnippet,
                        url: article.url,
                        collected_at: collectedAt
                    });
                }
            }
        }

        try {
            if (dbPayload.length > 0) {
                const savedCount = DatabaseService.getInstance().upsertNaverResearchFlow(dbPayload);
                totalSaved += savedCount;
            }
        } catch (err: any) {
             lines.push(`\n> ⚠️ DB 저장 중 오류 발생: ${err.message}\n`);
        }

        lines.push(`\n---`);
        lines.push(`> 💾 총 ${totalSaved}건 DB 저장 완료 (naver_research_flow)`);
        
        return lines.join('\n');
    }
}
