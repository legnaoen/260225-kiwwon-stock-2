import { IBaseAggregator } from '../types/PipelineTypes';

export class InvestorFlowAggregator implements IBaseAggregator {
    
    public async process(rawData: any): Promise<string> {
        if (!rawData) return '데이터 없음';

        const lines: string[] = ['### 💰 실시간 주체별 수급 및 선물 동향\n'];
        
        const timestamp = rawData.timestamp ? new Date(rawData.timestamp).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR');
        lines.push(`> ⏳ **데이터 수집 시점**: ${timestamp} (단위: 억 원, 계약)`);
        lines.push('');

        const formatValue = (valStr: string | undefined, isContract: boolean = false) => {
            if (!valStr) return 'N/A';
            const clean = valStr.replace(/,/g, '');
            const num = parseInt(clean, 10);
            if (isNaN(num)) return valStr;
            
            const unit = isContract ? '계약' : '억';
            const sign = num > 0 ? '🔺 ' : (num < 0 ? '🔻 ' : '');
            const colorBold = num > 0 ? `**<span style="color:red">${sign}+${Math.abs(num).toLocaleString()}${unit}</span>**` 
                           : (num < 0 ? `**<span style="color:blue">${sign}-${Math.abs(num).toLocaleString()}${unit}</span>**` 
                           : `**0${unit}**`);
            return colorBold;
        };

        lines.push('#### 📈 코스피 (KOSPI) 현물 순매수 금액');
        if (rawData.kospi) {
            lines.push(`- **외국인:** ${formatValue(rawData.kospi.foreignValue)}`);
            lines.push(`- **기  관:** ${formatValue(rawData.kospi.institutionalValue)}`);
            lines.push(`- **개  인:** ${formatValue(rawData.kospi.personalValue)}`);
        } else {
            lines.push('- 수집 불가 또는 장 개장 전');
        }
        lines.push('');

        lines.push('#### 📉 코스닥 (KOSDAQ) 현물 순매수 금액');
        if (rawData.kosdaq) {
            lines.push(`- **외국인:** ${formatValue(rawData.kosdaq.foreignValue)}`);
            lines.push(`- **기  관:** ${formatValue(rawData.kosdaq.institutionalValue)}`);
            lines.push(`- **개  인:** ${formatValue(rawData.kosdaq.personalValue)}`);
        } else {
            lines.push('- 수집 불가 또는 장 개장 전');
        }
        lines.push('');

        lines.push('#### 🎲 주가지수 선물 (투기적 방향성 및 왝더독 주포)');
        if (rawData.fut) {
            lines.push(`- **외국인 선물:** ${formatValue(rawData.fut.foreignValue, true)}`);
            lines.push(`- **기  관 선물:** ${formatValue(rawData.fut.institutionalValue, true)}`);
            lines.push(`- **개  인 선물:** ${formatValue(rawData.fut.personalValue, true)}`);
        } else {
            lines.push('- 수집 불가 또는 장 개장 전');
        }
        lines.push('');
        
        lines.push(`\n*※ 네이버 금융 모바일 실시간 API 통계치 기준*`);
        
        return lines.join('\n');
    }
}
