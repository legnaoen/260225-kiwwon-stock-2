import { IBaseAggregator } from '../types/PipelineTypes';

export class SmartMoneyAggregator implements IBaseAggregator {
    public executeAggregation(rawData: any): string {
        return this.process(rawData);
    }

    public process(rawData: any): string {
        if (!rawData || !rawData.flowData || !Array.isArray(rawData.flowData)) {
            return `### 데이터 구조 오류\n- 매매동향 데이터를 불러오지 못했습니다.`;
        }

        const data = rawData.flowData;
        const stk = rawData.stk_cd;
        
        let md = `### 💰 종목코드 [${stk}] 스마트머니 수급 요약 (최近 60영업일)\n\n`;
        
        md += `| 일자 | 기관 순매수(천주/금액) | 외인 순매수(천주/금액) | 개인 순매수(천주/금액) | 종가 |\n`;
        md += `|---|---|---|---|---|\n`;

        data.forEach((row: any) => {
            const orgn = row.orgn_net_buy_amt > 0 ? `+${row.orgn_net_buy_amt}` : `${row.orgn_net_buy_amt}`;
            const frgnr = row.frgnr_net_buy_amt > 0 ? `+${row.frgnr_net_buy_amt}` : `${row.frgnr_net_buy_amt}`;
            const ind = row.ind_net_buy_amt > 0 ? `+${row.ind_net_buy_amt}` : `${row.ind_net_buy_amt}`;
            md += `| ${row.date} | ${orgn} | ${frgnr} | ${ind} | ${row.cur_prc} |\n`;
        });

        md += `\n> **[참고]** 이 데이터는 \`opt10059\` API를 호출하여 누적된 데이터이며, 단위는 요청 시 입력한 'amt_qty_tp'(금액) 기준입니다.`;

        return md;
    }
}
