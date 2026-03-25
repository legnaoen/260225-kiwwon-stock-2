import { IBaseAggregator } from '../types/PipelineTypes';

export class NewsKeywordAggregator implements IBaseAggregator {
    public async process(rawData: any): Promise<string> {
        if (!rawData) return '뉴스 데이터가 없습니다.';

        // API 키 미설정 에러
        if (rawData.error) {
            return `> ⚠️ ${rawData.error}`;
        }

        const articles = rawData.articles || [];
        const keywordCounts = rawData.keywordCounts || [];

        if (articles.length === 0) {
            return '> 최근 24시간 내 수집된 뉴스가 없습니다.';
        }

        const lines: string[] = ['### 📰 실시간 시장 뉴스 현황\n'];
        
        const timestamp = rawData.timestamp 
            ? new Date(rawData.timestamp).toLocaleString('ko-KR') 
            : new Date().toLocaleString('ko-KR');
        
        lines.push(`> 📊 수집 시각: ${timestamp} | 총 ${articles.length}건 (최근 24시간)`);
        lines.push('');

        // 검색 키워드별 수집 현황 표시
        const keywordGroups = new Map<string, number>();
        for (const a of articles) {
            const kw = a.searchKeyword || '기타';
            keywordGroups.set(kw, (keywordGroups.get(kw) || 0) + 1);
        }
        
        lines.push('#### 🔍 검색 키워드 (네이버 뉴스 API)');
        for (const [kw, count] of keywordGroups) {
            lines.push(`- \`${kw}\` → ${count}건 수집`);
        }
        lines.push('');

        // 1. 키워드 빈도 랭킹 (AI 없는 단순 카운팅)
        if (keywordCounts.length > 0) {
            lines.push('#### 🔑 뉴스 헤드라인 키워드 빈도 (Top 10)');
            lines.push('| 키워드 | 언급 횟수 | 비중 |');
            lines.push('| :--- | :---: | :--- |');
            
            const maxCount = keywordCounts[0]?.count || 1;
            for (const k of keywordCounts.slice(0, 10)) {
                const bar = '█'.repeat(Math.round((k.count / maxCount) * 10));
                lines.push(`| **${k.word}** | ${k.count}회 | ${bar} |`);
            }
            lines.push('');
        }

        // 2. 주요 기사 리스트 (검색 키워드별 그룹핑)
        lines.push('#### 📋 주요 기사');
        
        // 키워드별로 그룹핑
        const grouped = new Map<string, any[]>();
        for (const a of articles) {
            const key = a.searchKeyword || '기타';
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(a);
        }

        for (const [keyword, group] of grouped) {
            lines.push(`\n**🔍 ${keyword}** (${group.length}건)`);
            // 최신순으로 최대 5건만 표시
            const sorted = group
                .sort((a: any, b: any) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
                .slice(0, 5);
            
            for (const a of sorted) {
                const time = new Date(a.pubDate).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                lines.push(`- [${time}] ${a.title}`);
                if (a.description) {
                    lines.push(`  > ${a.description.slice(0, 100)}${a.description.length > 100 ? '...' : ''}`);
                }
            }
        }

        lines.push(`\n*※ 네이버 뉴스 검색 API (로데이터) — AI 분석 미적용*`);
        return lines.join('\n');
    }
}
