import { IBaseAggregator } from '../types/PipelineTypes';

export class LocalFlowAggregator implements IBaseAggregator {
    
    public async process(rawData: any): Promise<string> {
        if (!rawData || !rawData.flows || rawData.flows.length === 0) return '국내 수급 데이터가 없습니다.';

        const flows = rawData.flows;
        const lines: string[] = ['### 🇰🇷 국내 증시 업종별 등락률 현황\n'];

        const timestamp = rawData.timestamp ? new Date(rawData.timestamp).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR');
        const targetDateStr = rawData.targetDateStr || '가장 최근 거래일';
        const marketStatus = rawData.marketStatus || '수집 시점 불명';
        const dayLabel = `[${targetDateStr}]`; 

        lines.push(`> ⏳ **장 상태**: \`${marketStatus}\``);
        lines.push(`> 📊 수집 시각: ${timestamp}`);
        lines.push('');

        // 1. 업종 등락률 랭킹 (상승 순 정렬)
        const sectors = flows.filter((f: any) => f.type === 'SECTOR');
        const sortedByRate = [...sectors].sort((a: any, b: any) => (b.changeRate || 0) - (a.changeRate || 0));

        // 상승 업종
        const risingSectors = sortedByRate.filter((s: any) => s.changeRate > 0);
        const fallingSectors = sortedByRate.filter((s: any) => s.changeRate < 0);

        if (risingSectors.length > 0) {
            lines.push('#### 🔥 상승 업종');
            for (const s of risingSectors) {
                const rateStr = `+${s.changeRate.toFixed(2)}%`;
                const constStr = s.constituents && s.constituents.length > 0 
                    ? ` → 주요종목: ${s.constituents.slice(0, 5).map((c: any) => `${c.name}(${c.changeRate > 0 ? '+' : ''}${c.changeRate.toFixed(1)}%)`).join(', ')}`
                    : '';
                lines.push(`- **${s.name}** ${rateStr}${constStr}`);
            }
            lines.push('');
        }

        if (fallingSectors.length > 0) {
            lines.push('#### 🧊 하락 업종');
            for (const s of fallingSectors) {
                const rateStr = `${s.changeRate.toFixed(2)}%`;
                const constStr = s.constituents && s.constituents.length > 0 
                    ? ` → 주요종목: ${s.constituents.slice(0, 5).map((c: any) => `${c.name}(${c.changeRate > 0 ? '+' : ''}${c.changeRate.toFixed(1)}%)`).join(', ')}`
                    : '';
                lines.push(`- **${s.name}** ${rateStr}${constStr}`);
            }
            lines.push('');
        }

        // 2. 전체 표 (Table Form)
        lines.push('#### 📊 전 업종 등락률 상세');
        lines.push(`| 업종명 | 등락률 | 주요 구성종목 |`);
        lines.push('| :--- | :--- | :--- |');
        for (const s of sortedByRate) {
            const rateStr = s.changeRate !== 0 ? `${s.changeRate > 0 ? '+' : ''}${s.changeRate.toFixed(2)}%` : '-';
            const constStr = s.constituents && s.constituents.length > 0
                ? s.constituents.slice(0, 3).map((c: any) => c.name).join(', ')
                : '-';
            lines.push(`| ${s.name} | ${rateStr} | ${constStr} |`);
        }

        lines.push(`\n*※ Kiwoom REST API ka20002 (업종별주가요청) 실시간 데이터*`);
        lines.push(`\n> 💡 **참고**: 업종별 외인/기관 수급 데이터는 키움 REST API에서 미지원. 향후 뉴스/유튜브 파이프라인으로 보완 예정.`);
        return lines.join('\n');
    }
}
