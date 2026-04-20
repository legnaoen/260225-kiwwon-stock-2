import { IBaseAggregator } from '../types/PipelineTypes';

export class FundamentalAggregator implements IBaseAggregator {
    public executeAggregation(rawData: any): string {
        return this.process(rawData);
    }

    public process(rawData: any): string {
        if (!rawData || !rawData.stock_code) {
            return `### 데이터 구조 오류\n- 펀더멘털 데이터를 불러오지 못했습니다.`;
        }

        let md = `### 📊 종목 [${rawData.stock_name} (${rawData.stock_code})] 펀더멘털 요약\n\n`;
        
        md += `- **시가총액**: ${rawData.market_cap}\n`;
        md += `- **신용비율**: ${rawData.credit_ratio.toFixed(2)}%\n`;
        md += `- **PER**: ${rawData.per.toFixed(2)}\n`;
        md += `- **PBR**: ${rawData.pbr.toFixed(2)}\n`;
        md += `- **EPS**: ${rawData.eps}\n`;

        if (rawData.credit_ratio > 3.0) {
            md += `\n> ⚠️ **주의**: 신용 잔고율이 다소 높은 편입니다 (3% 초과).`;
        }

        md += `\n> **[참고]** 이 데이터는 \`opt10001\`(주식기본정보요청) API를 호출하여 반환된 값입니다.`;

        return md;
    }
}
