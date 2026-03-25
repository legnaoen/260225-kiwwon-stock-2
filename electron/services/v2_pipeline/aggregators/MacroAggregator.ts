import { IBaseAggregator } from '../types/PipelineTypes';

// Yahoo의 일봉(quotes) 데이터 스펙 일부분
interface Quote {
    date: string;
    close: number;
}

export class MacroAggregator implements IBaseAggregator {
    
    // 심볼을 알기 쉬운 한글명으로 맵핑
    private readonly SYMBOL_NAMES: Record<string, string> = {
        '^KS11': 'KOSPI',
        '^KQ11': 'KOSDAQ',
        '^IXIC': '나스닥',
        '^GSPC': 'S&P 500',
        '^SOX': '필라델피아 반도체 (SOX)',
        'KRW=X': '원/달러 환율',
        '^TNX': '미국 10년물 국채 금리',
        '^IRX': '미국 3개월물 국채 금리',
        '^VIX': 'VIX 지수 (공포지수)',
        'BTC-USD': '비트코인 (BTC/USD)',
        'GC=F': '국제 금 (Gold)',
        'CL=F': '국제 유가 (WTI)',
        'HG=F': '구리 (Dr. Copper)',
    };

    /**
     * @param rawData 원천 JSON 객체 - 각 지수 종가들의 1년치 시계열 배열
     * @returns 마크다운 포맷의 응축된 텍스트
     */
    public async process(rawData: any): Promise<string> {
        if (!rawData) return '데이터 없음';

        const lines: string[] = ['### 🌐 글로벌 매크로 지표 분석 (최근 1년 기준)\n'];
        
        // 데이터 기준 시점 헤더 추가
        const timestamp = rawData._timestamp ? new Date(rawData._timestamp).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR');
        lines.push(`> ⏳ **데이터 조회 시점**: ${timestamp} (전일 종가 및 실시간 야간 마감 기준)`);
        lines.push('');

        // 1. 데이터 파싱 및 통계 전처리
        const stats: Record<string, any> = {};
        for (const symbol of Object.keys(this.SYMBOL_NAMES)) {
            const data = rawData[symbol];
            if (!data || !data.quotes || data.quotes.length === 0) {
                stats[symbol] = { error: true };
                continue;
            }

            const quotes: Quote[] = data.quotes;
            const sortedQuotes = [...quotes].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            
            const current = sortedQuotes[0].close;
            const ret1d = this.calcReturn(current, sortedQuotes[1]?.close);
            const ret5d = this.calcReturn(current, sortedQuotes[5]?.close);
            const ret20d = this.calcReturn(current, sortedQuotes[20]?.close);

            const ma5 = this.calcMA(sortedQuotes, 5);
            const diff5d = ma5 ? this.calcReturn(current, ma5) : null;
            const ma20 = this.calcMA(sortedQuotes, 20);
            const diff20d = ma20 ? this.calcReturn(current, ma20) : null;
            const ma60 = this.calcMA(sortedQuotes, 60);
            const diff60d = ma60 ? this.calcReturn(current, ma60) : null;
            const ma120 = this.calcMA(sortedQuotes, 120);
            const diff120d = ma120 ? this.calcReturn(current, ma120) : null;

            const oneYearQuotes = sortedQuotes.slice(0, 252);
            const closes = oneYearQuotes.map(q => q.close);
            const high52 = Math.max(...closes);
            const low52 = Math.min(...closes);
            const diffHigh52 = this.calcReturn(current, high52); 
            const diffLow52 = this.calcReturn(current, low52);

            stats[symbol] = {
                error: false,
                current,
                currentStr: this.formatValue(symbol, current),
                ret1d, ret5d, ret20d,
                diff5d, diff20d, diff60d, diff120d,
                high52, diffHigh52,
                low52, diffLow52
            };
        }

        // 2. 장단기 금리차 계산 (10년물 - 3개월물)
        let yieldCurveStr = '데이터 없음';
        if (stats['^TNX'] && !stats['^TNX'].error && stats['^IRX'] && !stats['^IRX'].error) {
            const spread = stats['^TNX'].current - stats['^IRX'].current;
            const spreadSign = spread > 0 ? '+' : '';
            // 역전 우려를 한글로 쉽게 풀이
            const invertStatus = spread < 0 ? '**(역전 상태 - 경기 침체 우려)**' : '(정상 상태)';
            yieldCurveStr = `${spreadSign}${spread.toFixed(2)}%p ${invertStatus}`;
        }

        // --- 렌더링 헬퍼 함수 ---
        const renderItem = (symbol: string, isYieldSpread: boolean = false) => {
            const st = stats[symbol];
            if (!st || st.error) return `- **${this.SYMBOL_NAMES[symbol]}**: 수집 실패`;
            
            let txt = `- **${this.SYMBOL_NAMES[symbol]}**: **${st.currentStr}** (전일대비: ${this.formatPct(st.ret1d)})\n`;
            
            if (isYieldSpread) {
                // 국채/금리의 경우 이평선이나 52주 변동폭 보다는 현재 추세를 간략 기재
                txt += `  - 추세: 1주간 ${this.formatPct(st.ret5d)} / 1달간 ${this.formatPct(st.ret20d)}`;
            } else {
                // 주식, 원자재 등의 경우 상세 지표 나열
                txt += `  - 기간 변동률: 1주(${this.formatPct(st.ret5d)}) / 1달(${this.formatPct(st.ret20d)})\n`;
                txt += `  - 이평선 이격도(MA): 5일선(${this.formatPct(st.diff5d)}) / 20일선(${this.formatPct(st.diff20d)}) / 60일선(${this.formatPct(st.diff60d)}) / 120일선(${this.formatPct(st.diff120d)})\n`;
                txt += `  - 52주 극단값 비교: 최고점 대비 하락률 ${this.formatPct(st.diffHigh52)} / 최저점 갱신 후 상승률 +${this.formatPct(st.diffLow52)}`; 
            }
            return txt;
        };

        // 3. 카테고리별 마크다운 조립

        // 카테고리 1: 글로벌 증시 및 반도체
        lines.push('#### 📈 증시 및 반도체 지수 (주도력 확인)');
        lines.push(renderItem('^KS11'));
        lines.push(renderItem('^KQ11'));
        lines.push(renderItem('^GSPC'));
        lines.push(renderItem('^IXIC'));
        lines.push(renderItem('^SOX'));
        lines.push('');

        // 카테고리 2: 외환 및 매크로 지표
        lines.push('#### 💵 외환 & 매크로 (유동성 및 위험 선호도)');
        lines.push(renderItem('KRW=X'));
        lines.push(renderItem('^TNX', true));
        lines.push(renderItem('^VIX', true));
        lines.push(`- **미 장단기 금리차 (10y-3m)**: ${yieldCurveStr}`);
        lines.push('');

        // 카테고리 3: 원자재 및 크립토
        lines.push('#### 🛢️ 원자재 & 크립토 (인플레이션 달러 헷지 및 실물경기 선행)');
        lines.push(renderItem('BTC-USD'));
        lines.push(renderItem('GC=F'));
        lines.push(renderItem('CL=F'));
        lines.push(renderItem('HG=F'));

        return lines.join('\n');
    }

    private calcReturn(current: number, past: number | undefined): number | null {
        if (!past || past === 0) return null;
        return ((current - past) / past) * 100;
    }

    private calcMA(quotes: Quote[], days: number): number | null {
        if (quotes.length < days) return null;
        const sum = quotes.slice(0, days).reduce((acc, q) => acc + q.close, 0);
        return sum / days;
    }

    private formatPct(val: number | null): string {
        if (val === null) return 'N/A';
        const sign = val >= 0 ? '+' : '';
        return `${sign}${val.toFixed(2)}%`;
    }

    private formatValue(symbol: string, val: number): string {
        if (symbol === 'KRW=X') return `${val.toLocaleString(undefined, { maximumFractionDigits: 1 })} 원`;
        if (symbol === '^TNX' || symbol === '^IRX') return `${val.toFixed(3)}%`;
        if (symbol === '^VIX') return `${val.toFixed(2)} pt`;
        if (symbol === 'BTC-USD') return `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
        if (symbol === 'GC=F' || symbol === 'CL=F' || symbol === 'HG=F') return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
        return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
}
