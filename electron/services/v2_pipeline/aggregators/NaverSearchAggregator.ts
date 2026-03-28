import { IBaseAggregator } from '../types/PipelineTypes';

export class NaverSearchAggregator implements IBaseAggregator {
    public process(rawData: any): string {
        if (!rawData || !rawData.articles || rawData.articles.length === 0) {
            return `### 🔍 '${rawData?.keyword || '검색어'}' 검색 결과\n해당 키워드와 관련된 최신 팩트나 뉴스를 찾을 수 없습니다. 시장의 무관심 영역이거나 검색어가 너무 모호할 수 있습니다.`;
        }

        let md = `### 🔍 키워드 [${rawData.keyword}] 실시간 웹 검색 결과 (최신순)\n\n`;
        
        rawData.articles.forEach((article: any, idx: number) => {
            md += `${idx + 1}. **${article.title}**\n`;
        });
        
        md += `\n*이 최신 검색 데이터를 바탕으로, 사령관의 원래 질문에 가장 적합한 통찰과 결론을 3단계 마크다운 구조(현상-원인-액션) 혹은 티키타카 모드 설정에 맞게 도출하십시오.*\n`;
        return md;
    }
    
    // Fallback for IBaseAggregator if needed
    public executeAggregation(rawData: any): string {
        return this.process(rawData);
    }
}
