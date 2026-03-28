import { IBaseAggregator } from '../types/PipelineTypes';
import { DatabaseService } from '../../DatabaseService';

/**
 * PL-NewsFlow Aggregator
 * 
 * Collector가 수집한 JSON 뉴스 데이터를 정제 후:
 * 1. DB(naver_news_flow)에 저장
 * 2. 마크다운 리포트 생성
 */
export class NewsFlowAggregator implements IBaseAggregator {
    private dbService = DatabaseService.getInstance();

    public async process(rawData: any): Promise<string> {
        if (!rawData || !rawData.newsList || rawData.newsList.length === 0) {
            return '뉴스 파이프라인에서 수집된 데이터가 없습니다.';
        }

        const dateStr = new Date(rawData.timestamp).toLocaleDateString('sv-SE');
        const collectedAt = new Date(rawData.timestamp).toISOString();
        const lines: string[] = ['### 📰 네이버 증권 뉴스 (주요 + 해외)\n'];
        lines.push(`> 📊 수집 시각: ${new Date(rawData.timestamp).toLocaleString('ko-KR')}\n`);

        let totalSaved = 0;

        for (const newsBlock of rawData.newsList) {
            const { category, articles, error } = newsBlock;
            let categoryName = '기타 뉴스';
            let emoji = '📰';

            if (category === 'MAJOR') {
                categoryName = '주요뉴스';
                emoji = '🇰🇷';
            } else if (category === 'GLOBAL') {
                categoryName = '해외뉴스';
                emoji = '🌐';
            } else if (category === 'STOCK_ANALYSIS') {
                categoryName = '기업·종목분석';
                emoji = '🔎';
            } else if (category === 'GLOBAL_MARKET') {
                categoryName = '해외증시';
                emoji = '🌎';
            }

            if (error) {
                lines.push(`#### ${emoji} ${categoryName}`);
                lines.push(`> ⚠️ 수집 실패: ${error}\n`);
                continue;
            }

            if (!articles || articles.length === 0) {
                lines.push(`#### ${emoji} ${categoryName}`);
                lines.push(`> ⚠️ 기사 없음\n`);
                continue;
            }

            // DB 저장용 페이로드 생성
            const dbPayload: any[] = [];
            
            const hour = new Date(rawData.timestamp).getHours();
            const filterRegex = /(마감시황|마감 시황|상승 마감|하락 마감|마감|특징주|약세|강세)/; // 아침에는 전일 마감 기사 모두 걸러냄
            const priorityRegex = /(특징주|수급|외국인|상한|마감)/; // 오후 정렬용 우대 키워드

            // 오후장에는 수급/마감/특징주 기사를 상단으로 우선 정렬
            if (hour >= 15 && articles.length > 0) {
                articles.sort((a: any, b: any) => {
                    const titleA = a.title || a.tit || '';
                    const titleB = b.title || b.tit || '';
                    return (priorityRegex.test(titleB) ? 1 : 0) - (priorityRegex.test(titleA) ? 1 : 0);
                });
            }

            for (const article of articles) {
                const title = article.title || article.tit || '';
                
                // 장전(09:00 이전)에는 어제 후행성 마감 뉴스 필터링
                if (hour < 9 && filterRegex.test(title)) {
                    continue;
                }

                const source = article.officeName || article.officeHName || article.office || '';
                const articleId = String(article.articleId || article.oid || '');
                const officeId = String(article.officeId || '');
                
                // 새로운 API는 url을 직접 제공하기도 함
                let url = article.url || '';
                if (!url && articleId && officeId) {
                    url = `https://stock.naver.com/news/article/${officeId}/${articleId}`;
                }

                // 본문 요약 (API 종류에 따라 필드명이 다름)
                const bodySnippet = article.subcontent || article.body || article.summary || '';

                if (!title) continue;

                dbPayload.push({
                    date: dateStr,
                    category,
                    title: title.trim(),
                    body_snippet: bodySnippet.trim(),
                    source: source.trim(),
                    article_id: articleId,
                    url,
                    collected_at: collectedAt
                });
            }

            // DB upsert
            if (dbPayload.length > 0) {
                try {
                    this.dbService.upsertNaverNewsFlow(dbPayload);
                    totalSaved += dbPayload.length;
                } catch (dbErr: any) {
                    console.error(`[NewsFlowAggregator] DB 저장 에러 (${category}):`, dbErr.message);
                }
            }

            // 마크다운 렌더링 (상위 10건만 표시 - 내용이 길어지므로 갯수 제한)
            lines.push(`#### ${emoji} ${categoryName} (${dbPayload.length}건)`);
            
            for (let i = 0; i < Math.min(dbPayload.length, 10); i++) {
                const item = dbPayload[i];
                lines.push(`**${i + 1}. ${item.title}** (${item.source})`);
                if (item.body_snippet) {
                    const snippet = item.body_snippet.replace(/\n|\[|\]/g, ' ').substring(0, 100) + '...';
                    lines.push(`> ${snippet}\n`);
                } else {
                    lines.push('');
                }
            }

            if (dbPayload.length > 10) {
                lines.push(`*외 ${dbPayload.length - 10}건 더*`);
            }
            lines.push('');
        }

        lines.push(`---`);
        lines.push(`> 💾 총 ${totalSaved}건 DB 저장 완료 (naver_news_flow)`);

        console.log(`[NewsFlowAggregator] 처리 완료: ${totalSaved}건 DB 저장`);
        return lines.join('\n');
    }
}
