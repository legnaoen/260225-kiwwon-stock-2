import { IBaseAggregator } from '../types/PipelineTypes';

export class ResearchAggregator implements IBaseAggregator {
    public async process(rawData: any): Promise<string> {
        if (!rawData || !rawData.reports) return '증권사 리포트 데이터가 없습니다.';

        const reports = rawData.reports;
        const hotSectors = rawData.hotSectors || [];
        const lines: string[] = [`### 📑 메이저 증권사 데일리 리서치 & 집중 산업 뷰어\n`];
        lines.push(`> 🚨 애널리스트들의 커버리지가 어디로 쏠리고 있는지(트렌드)와 카테고리별 주류 시각을 요약합니다.`);
        lines.push('');
        
        // 1. 애널리스트 집중 산업 (최근 1주)
        if (hotSectors.length > 0) {
            lines.push(`#### 🎯 최근 1주간 애널리스트들이 집중한 산업`);
            for (const s of hotSectors) {
                lines.push(`- **${s.rank}위: ${s.name}** (관련 리포트 ${s.reportCount}건)`);
                lines.push(`  - 💡 핵심 동인: ${s.reason}`);
            }
            lines.push('');
        }

        // 2. 카테고리별 최신 리포트 요약
        lines.push(`#### 📋 카테고리별 최신 리포트 요약`);
        const categoryMap: Record<string, any[]> = {};
        for (const r of reports) {
            if (!categoryMap[r.category]) categoryMap[r.category] = [];
            categoryMap[r.category].push(r);
        }

        for (const [category, items] of Object.entries(categoryMap)) {
            lines.push(`**[${category}]**`);
            for (const r of items) {
                const icon = r.stance === 'Buy' || r.stance === 'Positive' ? '🟢' : r.stance === 'Neutral' ? '🟡' : '🔴';
                lines.push(`- ${icon} **${r.title}** (${r.brokerage}, ${r.analyst})`);
                lines.push(`  - 📌 ${r.summary}`);
            }
            lines.push('');
        }
        
        lines.push(`*※ (V2 Pipeline Mock Framework Data)*`);
        return lines.join('\n');
    }
}
