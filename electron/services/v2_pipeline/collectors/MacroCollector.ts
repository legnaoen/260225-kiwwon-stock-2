import { YahooFinanceService } from '../../YahooFinanceService';

interface MacroRawData {
    _timestamp?: string;
    [symbol: string]: any; // 인덱스 시그니처와 호환성을 위해 any(또는 구체적 타입 옵셔널)로 완화
}

export class MacroCollector {
    private yahooService = YahooFinanceService.getInstance();
    
    // 13종의 종합 매크로 지표 목록 (레거시 대시보드 스펙)
    private readonly TARGETS = [
        // 1. 증시 및 반도체 (시장 주도력)
        { symbol: '^KS11', name: 'KOSPI' },
        { symbol: '^KQ11', name: 'KOSDAQ' },
        { symbol: '^GSPC', name: 'S&P 500' },
        { symbol: '^IXIC', name: '나스닥' },
        { symbol: '^SOX', name: '필라델피아 반도체 (SOX)' },
        
        // 2. 외환 및 매크로 (유동성/위험 선호도)
        { symbol: 'KRW=X', name: '원/달러 환율' },
        { symbol: '^TNX', name: '미국 10년물 국채 금리' },
        { symbol: '^IRX', name: '미국 3개월물 국채 금리' }, // 장단기 금리차 계산용
        { symbol: '^VIX', name: 'VIX 공포지수' },

        // 3. 원자재 및 크립토 (인플레 및 실물경기 선행)
        { symbol: 'BTC-USD', name: '비트코인 (BTC/USD)' },
        { symbol: 'GC=F', name: '국제 금 (Gold)' },
        { symbol: 'CL=F', name: '국제 유가 (WTI)' },
        { symbol: 'HG=F', name: '구리 (Dr. Copper)' }
    ];

    /**
     * @param options { forceFetch?: boolean } 캐시 만료 전이라도 강제 수집할지 여부
     */
    public async collect(options?: { forceFetch?: boolean }): Promise<MacroRawData> {
        // TODO: forceFetch 옵션을 지원하려면 YahooFinanceService 쪽에 캐시 무시 파라미터가 필요합니다.
        // 현재는 서비스의 캐시를 그대로 활용합니다.
        
        const rawData: MacroRawData = {
            _timestamp: new Date().toISOString()
        };
        
        await Promise.all(
            this.TARGETS.map(async (target) => {
                const data = await this.yahooService.getMacroIndicator(target.symbol);
                rawData[target.symbol] = data;
            })
        );
        
        return rawData;
    }
}
