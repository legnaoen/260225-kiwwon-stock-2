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
    public async generateDailyTechnicalDigest(): Promise<string> {
        try {
            const dailyData = await this.kiwoom.getOhlcvDaily('069500', 200);
            if (!dailyData || dailyData.length === 0) {
                return '[데이터 오류] 일봉 차트 데이터를 불러올 수 없어 기술적 분석(일봉)을 수행할 수 없습니다.';
            }

            const currentPriceText = dailyData[0].close || 'N/A';
            const currentPriceNum = Math.abs(Number(String(currentPriceText).replace(/[^0-9\-\.]/g, '')));
            
            if (!currentPriceNum || currentPriceNum <= 0) {
                return '[데이터 오류] 현재가를 산출할 수 없습니다.';
            }

            const calculateMA = (days: number): number | null => {
                if (dailyData.length < days) return null;
                let sum = 0;
                for (let i = 0; i < days; i++) {
                    sum += Math.abs(Number(String(dailyData[i].close).replace(/[^0-9\-\.]/g, '')));
                }
                return sum / days;
            };

            const ma20 = calculateMA(20);
            const ma60 = calculateMA(60);
            const ma100 = calculateMA(100);
            const ma200 = calculateMA(200);

            const getDisparityPerc = (maValue: number | null): string => {
                if (!maValue) return 'N/A';
                const diff = ((currentPriceNum - maValue) / maValue) * 100;
                return diff >= 0 ? `+${diff.toFixed(2)}%` : `${diff.toFixed(2)}%`;
            }

            const digest = `
[시장 기술적 지표 브리핑 (일봉 - KOSPI 200 기준)]
1. 현재가 및 일봉 중장기 이격도 현황
* 현재가격: ${currentPriceNum.toLocaleString()}
* 20일 이동평균: ${ma20 ? Math.floor(ma20).toLocaleString() : 'N/A'} (이격: ${getDisparityPerc(ma20)})
* 60일 이동평균: ${ma60 ? Math.floor(ma60).toLocaleString() : 'N/A'} (이격: ${getDisparityPerc(ma60)})
* 100일 이동평균: ${ma100 ? Math.floor(ma100).toLocaleString() : '데이터 부족'} (이격: ${getDisparityPerc(ma100)})
* 200일 이동평균: ${ma200 ? Math.floor(ma200).toLocaleString() : '데이터 부족'} (이격: ${getDisparityPerc(ma200)})

[평가/결론 유의사항 - 일봉 거시 분석]
* 이격이 크면(+), 거시적인 매물대 또는 고점 저항대 도달 시 매입보다는 관망/매도를 암시합니다.
* 이격이 마이너스(-)면 거시적인 낙폭과대, 장기적 추세 역배열 바닥권 지지구간 도달 등을 시사합니다.
* 당신은 현재 지수의 사이클이 당일 상승/하락 중 어느 곳에 어깨를 대고 서있는지 거시적(매크로) 환경만 참고하십시오.
`.trim();

            return digest;
        } catch (e: any) {
            console.error('Daily Technical Digest Error:', e);
            return `[기술적 분석 실패 - 일봉] 오류 메시지: ${e.message}`;
        }
    }

    public async generateIntradayTechnicalDigest(): Promise<string> {
        try {
            const intradayData = await this.kiwoom.getOhlcv5m('069500', 3); // 넉넉하게 3일 치 (안전)
            if (!intradayData || intradayData.length === 0) {
                return '[데이터 오류] 분봉 데이터를 불러올 수 없어 장중 기술적 타점 분석을 수행할 수 없습니다.';
            }

            // KiwoomService의 getOhlcv5m은 오름차순(과거->최신)입니다. 
            // 따라서 배열의 마지막 요소가 가장 최근 스냅샷입니다.
            const lastIdx = intradayData.length - 1;
            const latestCandle = intradayData[lastIdx];
            const latestDate = new Date(Number(latestCandle.time) * 1000);
            const latestDateStr = `${latestDate.getFullYear()}${String(latestDate.getMonth()+1).padStart(2,'0')}${String(latestDate.getDate()).padStart(2,'0')}`;

            // "오늘" (또는 최근 거래일 당일) 캔들 추출 (오름차순 유지)
            const todaysCandles = intradayData.filter((c: any) => {
                const d = new Date(Number(c.time) * 1000);
                const dStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
                return dStr === latestDateStr;
            });

            if (todaysCandles.length === 0) {
                return '[데이터 오류] 당일 분봉 차트 정보를 확인할 수 없습니다. (데이터 패칭 지연)';
            }

            // 오늘의 0번이 시가(개장) 캔들, 마지막 캔들이 현재 장중 최근 캔들
            const openCandle = todaysCandles[0];
            const currentCandle = todaysCandles[todaysCandles.length - 1];

            const currentPriceNum = Math.abs(Number(String(currentCandle.close).replace(/[^0-9\-\.]/g, '')));
            const openPrice = Math.abs(Number(String(openCandle.open).replace(/[^0-9\-\.]/g, ''))) || Math.abs(Number(String(openCandle.close).replace(/[^0-9\-\.]/g, '')));

            // 당일 고가 / 저가 산출
            let highPrice = 0;
            let lowPrice = 999999999;
            for (const c of todaysCandles) {
                const h = Math.abs(Number(String(c.high).replace(/[^0-9\-\.]/g, '')));
                const l = Math.abs(Number(String(c.low).replace(/[^0-9\-\.]/g, '')));
                if (h > highPrice) highPrice = h;
                if (l > 0 && l < lowPrice) lowPrice = l;
            }

            // 시가 대비 등락
            const gapFromOpen = ((currentPriceNum - openPrice) / openPrice) * 100;
            const openGapStr = gapFromOpen >= 0 ? `+${gapFromOpen.toFixed(2)}%` : `${gapFromOpen.toFixed(2)}%`;
            
            let intradayOpenTrend = `시가 갭 지지/저항 테스트 중 (${openGapStr})`;
            if (gapFromOpen > 0.5) intradayOpenTrend = `시가 돌파 후 당일 강한 랠리 상승지속 (${openGapStr})`;
            else if (gapFromOpen > 0.1) intradayOpenTrend = `시가 위에서 반등 시도 중 (${openGapStr})`;
            else if (gapFromOpen < -0.5) intradayOpenTrend = `시가를 강하게 깨고 투매/급락 중 (${openGapStr})`;
            else if (gapFromOpen < -0.1) intradayOpenTrend = `시가 아래에서 억눌리는 지속적 하방 압력 (${openGapStr})`;

            // 단기(최근 30분, 6개 캔들) 모멘텀. todaysCandles의 뒤에서부터 추출
            const numCandles = todaysCandles.length;
            const momentumCandles = Math.min(6, numCandles); // 최대 30분치
            const pastCandle = todaysCandles[numCandles - momentumCandles];
            const pastPrice = Math.abs(Number(String(pastCandle.close).replace(/[^0-9\-\.]/g, '')));
            const gap30m = ((currentPriceNum - pastPrice) / pastPrice) * 100;
            const momentum30mStr = gap30m >= 0 ? `+${gap30m.toFixed(2)}%` : `${gap30m.toFixed(2)}%`;
            
            let momentumTrend = `보합 중지 (${momentum30mStr})`;
            if (gap30m > 0.3) momentumTrend = `매우 강력한 단기 상승 모멘텀 작렬 (${momentum30mStr})`;
            else if (gap30m > 0.1) momentumTrend = `점진적 단기 매수세 개입 중 (${momentum30mStr})`;
            else if (gap30m < -0.3) momentumTrend = `단기 투매 및 급격한 가격 하락 발생 (${momentum30mStr})`;
            else if (gap30m < -0.1) momentumTrend = `점진적 매도 압력 출회 중 (${momentum30mStr})`;

            // ** 반등/조정 강도 평가 (저점/고점 대비 거리) **
            const reboundFromLow = ((currentPriceNum - lowPrice) / lowPrice) * 100;
            const drawdownFromHigh = ((currentPriceNum - highPrice) / highPrice) * 100;
            
            let reversalContext = `당초 추세를 이어가는 중`;
            const absDrawdown = Math.abs(drawdownFromHigh);

            if (reboundFromLow > 0.5 && absDrawdown < 0.3) {
                reversalContext = `⚠️ [강력한 상승 반전] 저점(${lowPrice.toLocaleString()})을 찍고 강하게 상승(V자 반등) 중입니다. (+ ${reboundFromLow.toFixed(2)}% 반등)`;
            } else if (drawdownFromHigh < -0.5 && reboundFromLow < 0.3) {
                reversalContext = `⚠️ [강력한 하락 반전] 고점(${highPrice.toLocaleString()}) 대비 거센 매도로 급박하게 추세가 꺾여 하락 중입니다. (${drawdownFromHigh.toFixed(2)}% 급락)`;
            } else if (reboundFromLow >= 0.3 && drawdownFromHigh <= -0.3) {
                // 고점 하락폭과 저점 상승폭이 모두 유의미한 경우 (변동성이 크거나 휩소 발생)
                if (absDrawdown > reboundFromLow * 1.5) {
                    reversalContext = `⚠️ [추세적 급락 속 미약한 기술적 반등] 고점(${highPrice.toLocaleString()})에서 ${absDrawdown.toFixed(2)}%나 폭락한 후, 저점에서 겨우 +${reboundFromLow.toFixed(2)}% 반등하는 데 그쳐 하락 압력이 압도적입니다. 결코 상승 반전(V자 반등)이 아닙니다.`;
                } else if (reboundFromLow > absDrawdown * 1.5) {
                    reversalContext = `⚠️ [강력한 꼬리 매수세 포착] 장중 매도세가 있었으나, 저점(${lowPrice.toLocaleString()})에서 파멸적인 매수세가 유입되며 +${reboundFromLow.toFixed(2)}% 수직 상승(V자 반등)하여 하락분을 씹어먹고 있습니다.`;
                } else {
                    reversalContext = `⚠️ [극심한 V/A 핑퐁 장세] 하루만에 고점 폭락(${drawdownFromHigh.toFixed(2)}%)과 저점 폭등(+${reboundFromLow.toFixed(2)}%)이 모두 발생하는 박스권 휩소 변동성입니다.`;
                }
            } else if (reboundFromLow > 0.25) {
                reversalContext = `⚠️ [단기 상승 반전] 저점 확인 후 바닥에서 매수세(+${reboundFromLow.toFixed(2)}%)가 들어오고 있습니다.`;
            } else if (drawdownFromHigh < -0.25) {
                reversalContext = `⚠️ [고점 저항 확인] 단기 랠리 후 매도세(${drawdownFromHigh.toFixed(2)}%)에 밀리고 있습니다.`;
            }

            // 장중 3분할 파동 알고리즘 (장초반/중반/마지막)
            const chunkSize = Math.max(1, Math.floor(todaysCandles.length / 3));
            let waveStory = "데이터 부족";
            if (todaysCandles.length >= 3) {
                const getAvg = (candles: any[]) => candles.reduce((acc, c) => acc + Math.abs(Number(String(c.close).replace(/[^0-9\-\.]/g, ''))), 0) / (candles.length || 1);
                
                const c1 = todaysCandles.slice(0, chunkSize);
                const c2 = todaysCandles.slice(chunkSize, chunkSize * 2);
                const c3 = todaysCandles.slice(chunkSize * 2);
                
                const avg1 = getAvg(c1);
                const avg2 = getAvg(c2);
                const avg3 = getAvg(c3);

                if (avg1 < avg2 && avg2 < avg3) waveStory = "상승 지속 장세 (Higher High)";
                else if (avg1 > avg2 && avg2 > avg3) waveStory = "하락 지속 추세 (Lower Low)";
                else if (avg1 < avg2 && avg2 > avg3) waveStory = "상승 후 고점 저항선 맞고 추세 반락 (윗꼬리 궤적)";
                else if (avg1 > avg2 && avg2 < avg3) waveStory = "급락 후 바닥 다지고 상승세 돌려세움 (V자/밑꼬리 궤적)";
                else waveStory = "특정 박스권 내 지루한 횡보 휩소 장세";
            }

            // 최근 1시간(12개 봉) 횡보/바닥 다지기 감지 알고리즘
            const last12 = todaysCandles.slice(-12);
            let consolidationStr = "";
            if (last12.length >= 12) {
                const max12 = Math.max(...last12.map(c => Math.abs(Number(String(c.high).replace(/[^0-9\-\.]/g, '')))));
                const min12 = Math.min(...last12.map(c => Math.abs(Number(String(c.low).replace(/[^0-9\-\.]/g, '')))));
                const range12 = ((max12 - min12) / min12) * 100;
                
                if (range12 < 0.6) {
                   consolidationStr = `[단기 바닥 지지/횡보] 최근 1시간 변동폭이 불과 ${range12.toFixed(2)}%로 하락/상승이 멈추었으며, 강력한 하방 경직성(단단한 가격 지지)을 보여주는 바닥 다지기 구간입니다.`;
                } else {
                   consolidationStr = `[변동성 진행중] 최근 1시간 상하단 폭 ${range12.toFixed(2)}%로 가격이 안착하지 못하고 변동하는 중입니다.`;
                }
            }

            // 최근 5개 분봉 미시 패턴 분석 (양봉/음봉 및 꼬리 형태)
            const last5 = todaysCandles.slice(-5);
            const microPattern = last5.map((c, i) => {
                const op = Math.abs(Number(String(c.open).replace(/[^0-9\-\.]/g, '')));
                const cl = Math.abs(Number(String(c.close).replace(/[^0-9\-\.]/g, '')));
                const hi = Math.abs(Number(String(c.high).replace(/[^0-9\-\.]/g, '')));
                const lo = Math.abs(Number(String(c.low).replace(/[^0-9\-\.]/g, '')));
                
                const isYang = cl > op; // 양봉 (Red in KR)
                const isEum = cl < op;  // 음봉 (Blue in KR)
                
                const bodySize = Math.abs(cl - op);
                const totalRange = hi - lo || 1;
                const upperWick = hi - Math.max(op, cl);
                const lowerWick = Math.min(op, cl) - lo;
                
                // 한국장 맞춤 색상 (양봉=빨강, 음봉=파랑, 보합=검정)
                let shapeStr = isYang ? '🔴양봉' : isEum ? '🔵음봉' : '⚫보합';
                
                if (upperWick > bodySize * 1.5 && upperWick > totalRange * 0.3) shapeStr += '(긴상단꼬리/저항)';
                if (lowerWick > bodySize * 1.5 && lowerWick > totalRange * 0.3) shapeStr += '(긴하단꼬리/매수방어)';
                
                return i === last5.length - 1 ? `[현재봉]${shapeStr}` : `[-${last5.length - i - 1}봉]${shapeStr}`;
            }).join(' -> ');

            // 시간대 분석
            const nowTime = new Date();
            const hour = nowTime.getHours();
            let timePhase = "";
            if (hour < 10) timePhase = "장 초반 (방향성 탐색 및 변동성 극대화)";
            else if (hour < 13) timePhase = "장 중반 (당일 주 추세 확립 구간)";
            else if (hour < 15) timePhase = "오후장 (오전 추세의 지속성 또는 반발 매수/매도 테스트)";
            else timePhase = "장 막판 (외인/기관의 종가 포지션 정리 및 급변동 주의)";

            // 보조지표 (CCI)
            let cciAnalysis = "동기화 부족으로 계산 실패";
            if (intradayData.length >= 21) {
                const getTP = (candle: any) => {
                    const h = Math.abs(Number(String(candle.high).replace(/[^0-9\-\.]/g, '')));
                    const l = Math.abs(Number(String(candle.low).replace(/[^0-9\-\.]/g, '')));
                    const c = Math.abs(Number(String(candle.close).replace(/[^0-9\-\.]/g, '')));
                    return (h + l + c) / 3;
                };
                const calcCCI = (endIdx: number, p: number = 20) => {
                    const slice = intradayData.slice(endIdx - p + 1, endIdx + 1);
                    if (slice.length < p) return null;
                    const TPS = slice.map(getTP);
                    const currentTP = TPS[TPS.length - 1];
                    const smaTP = TPS.reduce((a, b) => a + b, 0) / p;
                    const meanDeviation = TPS.reduce((a, b) => a + Math.abs(b - smaTP), 0) / p;
                    return meanDeviation === 0 ? 0 : (currentTP - smaTP) / (0.015 * meanDeviation);
                };

                const currentCCI = calcCCI(intradayData.length - 1);
                const prevCCI = calcCCI(intradayData.length - 2);

                if (currentCCI !== null && prevCCI !== null) {
                    let cciStatus = "";
                    // 사용자 맞춤형 파라미터 적용: 과매수 +80, 과매도 -120
                    const OVERBOUGHT = 80;
                    const OVERSOLD = -120;

                    if (currentCCI > OVERBOUGHT) cciStatus = prevCCI <= OVERBOUGHT ? "과매수 돌파(상승 극대화)" : "과매수 유지(고점 부담)";
                    else if (currentCCI < OVERSOLD) cciStatus = prevCCI >= OVERSOLD ? "과매도 돌파(투매 진입)" : "과매도 유지(바닥권 다지기)";
                    else {
                        if (prevCCI <= OVERSOLD) cciStatus = "⭐ 과매도선(-120) 위로 이탈 (강력한 단기 매수/반등 시그널 ⭐)";
                        else if (prevCCI >= OVERBOUGHT) cciStatus = "💥 과매수선(+80) 아래로 이탈 (단기 차익실현/매도 시그널 💥)";
                        else cciStatus = currentCCI > 0 ? "상승 모멘텀 (0 기준선 위)" : "하락 모멘텀 (0 기준선 아래)";
                    }
                    cciAnalysis = `CCI(20) = ${currentCCI.toFixed(1)} | 기준(+80/-120) 시그널: ${cciStatus}`;
                }
            }

            const digest = `
[초단기(장중 타점) 5분봉 차트 핵심 데이터]
* 현 시간대: ${String(hour).padStart(2,'0')}:${String(nowTime.getMinutes()).padStart(2,'0')} (${timePhase})
* 단가 위치: 고가(${highPrice.toLocaleString()}) | 시가(${openPrice.toLocaleString()}) | 저가(${lowPrice.toLocaleString()}) | 현재가(${currentPriceNum.toLocaleString()})
* 시가 대비 위치: ${gapFromOpen >= 0 ? '+' : ''}${gapFromOpen.toFixed(2)}%

[차트 알고리즘 렌더링 결과]
1. 오늘 파동 궤적: ${waveStory}
2. 최근 1시간 지지선 형태: ${consolidationStr}
3. 고/저점 대비 추세: 고점에서 ${drawdownFromHigh.toFixed(2)}% 밀렸고, 저점대비 +${reboundFromLow.toFixed(2)}% 올랐음.
4. 최근 5개 분봉 스캔: ${microPattern}
5. CCI(20) 보조지표: ${cciAnalysis}

[🚨 AI 추론 절대 규칙 🚨]
* 이 정보들은 진짜 차트의 수식을 백엔드가 대신 읽고 번역해준 "절대적 팩트"입니다.
* 만약 [5번] CCI 지표에서 '⭐과매도선(-120) 위로 이탈⭐' 시그널이 발생했고, 60분간 횡보하며 바닥 다지기가 확인된다면 일봉이 하락장이라도 당당하게 스윙/리바운드 타점(UP)으로 예측하십시오!
* 반대로 강한 지지가 없고 매도 시그널이 발생했다면 어떠한 작은 꼬리 반등에 속지 말고 DOWN을 외치십시오.
* 장황한 문장을 배제하고 팩트만 글머리 기호(•)로 짧고 간결하게 출력하세요.
`.trim();

            return digest;
        } catch (e: any) {
            console.error('Intraday Technical Digest Error:', e);
            return `[기술적 분석 실패 - 분봉] 오류 메시지: ${e.message}`;
        }
    }

    /**
     * 장중 주기적인 폴링용: 5분봉 기준 CCI 20이 과매수/과매도 구간에 도달했거나 
     * 그 구간을 이탈했는지 여부를 반환합니다.
     */
    public async checkCCITrigger(): Promise<{ isTriggered: boolean, status: string }> {
        try {
            const res = await this.kiwoom.getChartData({ stk_cd: '122630' });
            const d = res?.data || res;
            let intradayData = d?.stk_dt_pole_chart_qry || d?.output2 || d?.Body || d?.list || [];
            if (!Array.isArray(intradayData)) intradayData = [];
            intradayData = intradayData.reverse();

            if (intradayData.length < 21) return { isTriggered: false, status: '' };

            const getTP = (candle: any) => {
                const h = Math.abs(Number(String(candle.high).replace(/[^0-9\-\.]/g, '')));
                const l = Math.abs(Number(String(candle.low).replace(/[^0-9\-\.]/g, '')));
                const c = Math.abs(Number(String(candle.close).replace(/[^0-9\-\.]/g, '')));
                return (h + l + c) / 3;
            };
            const calcCCI = (endIdx: number, p: number = 20) => {
                const slice = intradayData.slice(endIdx - p + 1, endIdx + 1);
                if (slice.length < p) return null;
                const TPS = slice.map(getTP);
                const currentTP = TPS[TPS.length - 1];
                const smaTP = TPS.reduce((a, b) => a + b, 0) / p;
                const meanDeviation = TPS.reduce((a, b) => a + Math.abs(b - smaTP), 0) / p;
                return meanDeviation === 0 ? 0 : (currentTP - smaTP) / (0.015 * meanDeviation);
            };

            const currentCCI = calcCCI(intradayData.length - 1);
            const prevCCI = calcCCI(intradayData.length - 2);

            if (currentCCI === null || prevCCI === null) return { isTriggered: false, status: '' };

            const OVERBOUGHT = 80;
            const OVERSOLD = -120;

            if (currentCCI > OVERBOUGHT && prevCCI <= OVERBOUGHT) {
                return { isTriggered: true, status: '과매수 진입' };
            } else if (currentCCI < OVERSOLD && prevCCI >= OVERSOLD) {
                return { isTriggered: true, status: '과매도 진입' };
            } else if (currentCCI <= OVERBOUGHT && prevCCI > OVERBOUGHT) {
                return { isTriggered: true, status: '과매수선 아래로 이탈(단기 차익실현)' };
            } else if (currentCCI >= OVERSOLD && prevCCI < OVERSOLD) {
                return { isTriggered: true, status: '과매도선 위로 이탈(강한 반등)' };
            }
            return { isTriggered: false, status: '' };
        } catch (err) {
            console.error('[TechnicalAnalyzer] checkCCITrigger error:', err);
            return { isTriggered: false, status: '' };
        }
    }
}
