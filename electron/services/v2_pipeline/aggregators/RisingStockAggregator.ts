import { IBaseAggregator } from '../types/PipelineTypes';

export class RisingStockAggregator implements IBaseAggregator {
    public async process(rawData: any): Promise<string> {
        if (!rawData || !rawData.topGainers) return '특징주 데이터가 없습니다.';

        const topGainers = rawData.topGainers;
        const topVolumes = rawData.topVolumes;
        const thematicInsights = rawData.thematicInsights;
        const targetDate = rawData.targetDateStr || '가장 최근 거래일';

        const lines: string[] = [`### 🔥 국내 당일 특징주 및 주도 테마 분석 [${targetDate}]\n`];
        lines.push('> 👉 Master AI는 아래의 원시(Raw) 거래대금/상승률 랭킹 데이터와 그 하단의 [Sub-AI 테마 요약]을 종합하여, 수급(PL-LocalFlow)과 가장 일치하는 메인 주도 테마를 판별하세요.');
        lines.push('');

        // 1. 순수 Raw 데이터: 상승률 TOP 15
        lines.push(`#### 📈 당일 상승률 TOP 15`);
        lines.push('| 순위 | 종목명 | 등락률 | 특징 키워드 |');
        lines.push('| :--- | :--- | :--- | :--- |');
        for (const s of topGainers) {
            lines.push(`| ${s.rank} | **${s.name}** | ${s.change} | ${s.reason_keyword} |`);
        }
        lines.push('');

        // 2. 순수 Raw 데이터: 당일 거래대금 TOP 15
        lines.push(`#### 💰 당일 거래대금 TOP 15`);
        lines.push('| 순위 | 종목명 | 거래대금 | 등락률 | 특징 키워드 |');
        lines.push('| :--- | :--- | :--- | :--- | :--- |');
        for (const s of topVolumes) {
            lines.push(`| ${s.rank} | **${s.name}** | ${s.volume} | ${s.change} | ${s.reason_keyword} |`);
        }
        lines.push('');

        // 3. Sub-AI 주도 테마 분석 결과
        lines.push(`#### 🤖 [Sub-AI 처리 결과] 거래대금 기반 3대 핵심 테마`);
        for (const t of thematicInsights) {
            lines.push(`- **[${t.theme}]**`);
            lines.push(`  - 💡 **상승 사유**: ${t.reason}`);
            lines.push(`  - 🔗 관련 종목군: ${t.stocks}`);
        }
        lines.push('');

        lines.push(`*※ (V2 Pipeline Mock Framework Data)*`);
        return lines.join('\n');
    }
}
