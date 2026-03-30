import { KiwoomService } from '../KiwoomService'

export class TechnicalAnalyzer {
    private kiwoom: KiwoomService

    constructor(kiwoomService: KiwoomService) {
        this.kiwoom = kiwoomService
    }

    /**
     * KOSPI 대표종목(KODEX 200, 069500)의 일봉/분봉 데이터를 수학적으로 연산하여
     * 환각 없는 텍스트 다이제스트(요약)를 생성합니다.
     */
    public async generateMarketTechnicalDigest(): Promise<string> {
        try {
            // 1. KODEX 200 (KOSPI 200) 데이터 200일 치 수집 (가용한 최대값)
            const dailyData = await this.kiwoom.getOhlcvDaily('069500', 200);
            
            // 2. KODEX 200 오늘자 5분봉 전체 가져오기
            const intradayData = await this.kiwoom.getOhlcv5m('069500', 1);

            // dailyData가 최신순(0번 인덱스가 오늘/최신) 배열이라고 가정.
            // Kiwoom API는 보통 0번째가 최신 영업일입니다.
            if (!dailyData || dailyData.length === 0) {
                return '[데이터 오류] 일봉 차트 데이터를 불러올 수 없어 기술적 분석을 수행할 수 없습니다.';
            }

            const currentPriceText = dailyData[0].close || intradayData?.[0]?.close || 'N/A';
            const currentPriceNum = Math.abs(Number(String(currentPriceText).replace(/[^0-9\-\.]/g, '')));
            
            if (!currentPriceNum || currentPriceNum <= 0) {
                return '[데이터 오류] 현재가를 산출할 수 없습니다.';
            }

            // --- MA(이동평균) 계산 헬퍼 로직 ---
            const calculateMA = (days: number): number | null => {
                if (dailyData.length < days) return null; // 데이터 부족
                let sum = 0;
                for (let i = 0; i < days; i++) {
                    const price = Math.abs(Number(String(dailyData[i].close).replace(/[^0-9\-\.]/g, '')));
                    sum += price;
                }
                return sum / days;
            };

            const ma20 = calculateMA(20);
            const ma60 = calculateMA(60);
            const ma100 = calculateMA(100);
            const ma200 = calculateMA(200);

            // --- 이격도(Disparity) 계산 ---
            // 이격도 = (현재가 / 이동평균) * 100 
            // 100을 넘으면 MA보다 위(초과), 100 미만이면 MA 아래(미달)
            // 직관적인 리포트를 위해 (이격률 - 100) 형태의 증감 퍼센테이지 표시
            const getDisparityPerc = (maValue: number | null): string => {
                if (!maValue) return 'N/A';
                const diff = ((currentPriceNum - maValue) / maValue) * 100;
                return diff >= 0 ? `+${diff.toFixed(2)}%` : `${diff.toFixed(2)}%`;
            }

            // --- 5분봉 단기 모멘텀 계산 ---
            let intradayTrend = '관망';
            if (intradayData && intradayData.length >= 2) {
                // intradayData[0] 이 최신 (900시가 인덱스 끝) / 5분봉 api의 순서에 따라 조정
                // kiwoom 5분봉 API는 0번이 가장 최근 시간입니다.
                const latest5m = Math.abs(Number(String(intradayData[0].close).replace(/[^0-9\-\.]/g, '')));
                const oldest5mInSession = Math.abs(Number(String(intradayData[intradayData.length - 1].close).replace(/[^0-9\-\.]/g, '')));
                const gap = ((latest5m - oldest5mInSession) / oldest5mInSession) * 100;
                if (gap > 0.3) intradayTrend = `강한 상승세 (시가대비 +${gap.toFixed(2)}%)`;
                else if (gap > 0.1) intradayTrend = `완만한 상승세 (시가대비 +${gap.toFixed(2)}%)`;
                else if (gap < -0.3) intradayTrend = `강한 하락세 (시가대비 ${gap.toFixed(2)}%)`;
                else if (gap < -0.1) intradayTrend = `완만한 하락세 (시가대비 ${gap.toFixed(2)}%)`;
                else intradayTrend = `보합세 (시가대비 ${gap.toFixed(2)}%)`;
            }

            // --- 최종 마크다운 리포트 생성 (AI 전용) ---
            const digest = `
[시장 기술적 지표 브리핑 (KOSPI 200 기준)]

1. 현재가 및 장기 이격도 현황
* 현재가격: ${currentPriceNum.toLocaleString()}
* 20일 이동평균: ${ma20 ? Math.floor(ma20).toLocaleString() : 'N/A'} (이격: ${getDisparityPerc(ma20)})
* 60일 이동평균: ${ma60 ? Math.floor(ma60).toLocaleString() : 'N/A'} (이격: ${getDisparityPerc(ma60)})
* 100일 이동평균: ${ma100 ? Math.floor(ma100).toLocaleString() : '데이터 부족'} (이격: ${getDisparityPerc(ma100)})
* 200일 이동평균: ${ma200 ? Math.floor(ma200).toLocaleString() : '데이터 부족'} (이격: ${getDisparityPerc(ma200)})

2. 단기(금일) 분봉 추세 평가
* 당일 시가 대비 흐름: ${intradayTrend}

[평가/결론 유의사항]
* 이격이 양수(+)면 정배열 또는 단기 과열을 암시하며, 음수(-)면 역배열 또는 낙폭 과대 지지 구간을 의미합니다.
* 위 지표를 기반으로, 당신(차트 분석가)은 단기 매수/매도 모멘텀이 어떤 방향으로 가야 유리한지 평가하십시오.
`.trim();

            return digest;
        } catch (e: any) {
            console.error('Technical Digest Error:', e);
            return `[기술적 분석 실패] 오류 메시지: ${e.message}`;
        }
    }
}
