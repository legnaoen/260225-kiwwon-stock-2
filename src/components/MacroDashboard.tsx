import React, { useState, useEffect } from 'react'
import { Globe, ArrowRight, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react'

const Sparkline = ({ data, isUp }: { data: number[], isUp: boolean }) => {
    if (!data || data.length < 2) return <div className="h-6 w-20"></div>;

    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const height = 24;
    const width = 80;
    const step = width / (data.length - 1);
    
    const points = data.map((d, i) => {
        const x = i * step;
        const y = height - ((d - min) / range) * height;
        return `${x},${y}`;
    }).join(' ');

    const color = isUp ? 'rgb(239, 68, 68)' : 'rgb(59, 130, 246)'

    return (
        <svg width={width} height={height} className="overflow-visible ml-auto opacity-80">
            <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
        </svg>
    )
}

// Indicator Data Structure
interface IndicatorData {
    name: string;
    value: string;
    change: string;
    isUp: boolean;
    trend: number[];
    desc?: string;
    trendDesc?: string;
}

type PeriodType = '1D' | '1W' | '1M' | '6M' | '1Y';

export default function MacroDashboard() {
    const [loading, setLoading] = useState(true);
    const [lastSync, setLastSync] = useState<string>('--:--:--');
    const [period, setPeriod] = useState<PeriodType>('1D');
    
    // We store raw data to avoid re-fetching when period changes
    const [rawData, setRawData] = useState<any[]>([]);
    
    const [indices, setIndices] = useState<IndicatorData[]>([]);
    const [macros, setMacros] = useState<IndicatorData[]>([]);
    const [commodities, setCommodities] = useState<IndicatorData[]>([]);

    const symbols = [
        '^KS11', '^KQ11', '^GSPC', '^IXIC', '^SOX', // 증시 지수
        'KRW=X', '^TNX', '^IRX', '^VIX', // 외환/금리 (IRX proxy)
        'BTC-USD', 'GC=F', 'CL=F', 'HG=F' // 원자재/크립토
    ];

    useEffect(() => {
        fetchMacroData();
    }, []);

    // Whenever period or rawData changes, rebuild the UI data
    useEffect(() => {
        if (rawData.length > 0) {
            processData(rawData, period);
        }
    }, [period, rawData]);

    const fetchMacroData = async () => {
        setLoading(true);
        try {
            const res = await window.electronAPI.getYahooMacros(symbols);
            if (res.success && res.data) {
                setRawData(res.data);
                setLastSync(new Date().toLocaleTimeString('ko-KR', { hour12: false }));
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }

    const processData = (data: any[], currentPeriod: PeriodType) => {
        const mapData = (symbol: string, defaultName: string, desc?: string): IndicatorData => {
            const idx = symbols.indexOf(symbol);
            const item = data[idx];
            
            if (!item || !item.meta || !item.quotes || item.quotes.length === 0) {
                return { name: defaultName, value: '-', change: '-', isUp: false, trend: [], desc, trendDesc: '데이터 누락' };
            }
            
            const validQuotes = item.quotes.filter((q: any) => q.close !== null);
            const price = item.meta.regularMarketPrice;
            
            // Determine previous close based on selected period
            let prevClose = item.meta.chartPreviousClose; // default to 1Y usually
            const daysCount = validQuotes.length;

            if (currentPeriod === '1D') {
                // For 1D, Yahoo's `previousClose` is the most accurate if it exists, otherwise use last available historical day
                prevClose = item.meta.previousClose || (daysCount > 1 ? validQuotes[daysCount - 2].close : prevClose);
            } else if (currentPeriod === '1W') {
                // ~5 trading days ago
                prevClose = daysCount > 5 ? validQuotes[daysCount - 6].close : prevClose;
            } else if (currentPeriod === '1M') {
                // ~21 trading days ago
                prevClose = daysCount > 21 ? validQuotes[daysCount - 22].close : prevClose;
            } else if (currentPeriod === '6M') {
                // ~126 trading days ago
                prevClose = daysCount > 126 ? validQuotes[daysCount - 127].close : prevClose;
            } else if (currentPeriod === '1Y') {
                // First element or chartPreviousClose
                prevClose = daysCount > 0 ? validQuotes[0].close : prevClose;
            }
            
            // Fallback for divide by zero or missing prev
            if (!prevClose) prevClose = price;

            const changeVal = price - prevClose;
            const changePct = (changeVal / prevClose) * 100;
            const isUp = changeVal >= 0;

            // Extract last 7 days for the visual Sparkline trend (always 7 days regardless of period for short-term momentum)
            const trendQuotes = validQuotes.slice(-7);
            const trend = trendQuotes.map((q: any) => q.close);

            let valStr = price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            let chgStr = `${isUp ? '+' : ''}${changeVal.toFixed(2)} (${changePct.toFixed(2)}%)`;

            let trendDesc = '변동성 소화 중';
            if (trend.length > 2) {
                const first = trend[0];
                const last = trend[trend.length - 1];
                if (last > first * 1.05) trendDesc = '단기 강한 랠리';
                else if (last < first * 0.95) trendDesc = '단기 하락 전환';
                else if (last > first) trendDesc = '완만한 상승 추세';
                else trendDesc = '단기 횡보장';
            }

            return {
                name: defaultName,
                value: symbol.includes('KRW') ? price.toFixed(2) : symbol.includes('=F') || symbol.includes('BTC') ? `$${valStr}` : (symbol.includes('^TN') || symbol.includes('^IR') ? `${price.toFixed(2)}%` : valStr),
                change: (symbol.includes('^TN') || symbol.includes('^IR')) ? `${isUp ? '+' : ''}${changeVal.toFixed(2)}%` : chgStr,
                isUp,
                trend,
                desc,
                trendDesc
            };
        };

        setIndices([
            mapData('^KS11', 'KOSPI'),
            mapData('^KQ11', 'KOSDAQ'),
            mapData('^GSPC', 'S&P 500'),
            mapData('^IXIC', 'NASDAQ'),
            mapData('^SOX', 'PHLX 반도체 (SOX)'),
        ]);

        const tnx = data[symbols.indexOf('^TNX')];
        const irx = data[symbols.indexOf('^IRX')];
        let spreadData: IndicatorData = { name: '미 장단기 금리차 (10y-3m)', value: '-', change: '-', isUp: true, trend: [], desc: '침체 시그널 가늠 (10y-3m)' };
        
        if (tnx && irx && tnx.quotes && irx.quotes) {
            const priceSpread = tnx.meta.regularMarketPrice - irx.meta.regularMarketPrice;
            
            const getSpreadAtDaysAgo = (daysRaw: number) => {
                const tnxValid = tnx.quotes.filter((q: any) => q.close !== null);
                const irxValid = irx.quotes.filter((q: any) => q.close !== null);
                const tIndex = tnxValid.length - 1 - daysRaw;
                const iIndex = irxValid.length - 1 - daysRaw;
                
                if (tIndex >= 0 && iIndex >= 0 && tnxValid[tIndex] && irxValid[iIndex]) {
                    return tnxValid[tIndex].close - irxValid[iIndex].close;
                }
                return tnx.meta.chartPreviousClose - irx.meta.chartPreviousClose;
            }

            let prevSpread = priceSpread;
            if (currentPeriod === '1D') prevSpread = getSpreadAtDaysAgo(1);
            else if (currentPeriod === '1W') prevSpread = getSpreadAtDaysAgo(5);
            else if (currentPeriod === '1M') prevSpread = getSpreadAtDaysAgo(21);
            else if (currentPeriod === '6M') prevSpread = getSpreadAtDaysAgo(126);
            else if (currentPeriod === '1Y') prevSpread = tnx.meta.chartPreviousClose - irx.meta.chartPreviousClose;

            const chgSpread = priceSpread - prevSpread;
            
            const tnxValid = tnx.quotes.filter((q: any) => q.close !== null);
            const irxValid = irx.quotes.filter((q: any) => q.close !== null);
            const spreadTrend = [];
            for(let i=1; i<=7; i++) {
                if (tnxValid.length - i >= 0 && irxValid.length - i >= 0) {
                    spreadTrend.unshift(tnxValid[tnxValid.length-i].close - irxValid[irxValid.length-i].close);
                }
            }

            spreadData = {
                name: '미 장단기 금리차 (10y-3m)',
                value: `${priceSpread.toFixed(2)}%`,
                change: `${chgSpread >= 0 ? '+' : ''}${chgSpread.toFixed(2)}%`,
                isUp: chgSpread >= 0,
                trend: spreadTrend,
                desc: '경기 침체 및 통화 정책 시그널',
                trendDesc: priceSpread < 0 ? '수익률 곡선 역전 (-)' : '정상화 (+)'
            };
        }

        setMacros([
            mapData('KRW=X', '원/달러 환율', '외국인 수급 방향성 가늠자'),
            spreadData,
            mapData('^TNX', '미 10년물 국채 금리', '글로벌 유동성 및 장기 성장 기대치'),
            mapData('^VIX', 'VIX (공포 지수)', '옵션 시장 기반 투자자 불안 심리')
        ]);

        setCommodities([
            mapData('BTC-USD', '비트코인 (BTC/USD)', '글로벌 초단기 유동성 및 위험 선호도'),
            mapData('GC=F', '국제 금 (Gold)', '인플레이션 헷지 및 안전 자산 척도'),
            mapData('CL=F', '국제 유가 (WTI)', '에너지 물가 및 인플레이션 압력'),
            mapData('HG=F', '구리 (Dr. Copper)', '실물 경기 회복의 선행 지표')
        ]);
    }

    return (
        <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
            {/* Header */}
            <header className="shrink-0 flex items-center justify-between p-6 border-b border-border bg-card/50 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-primary/10 rounded-xl">
                        <Globe className="text-primary" size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-extrabold tracking-tight">글로벌 매크로 관제</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">Yahoo Finance 실시간 수집 거시 지표 및 통계 모니터링</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {/* Period Selector */}
                    <div className="flex bg-muted/50 p-1 rounded-lg border border-border">
                        {(['1D', '1W', '1M', '6M', '1Y'] as PeriodType[]).map((p) => (
                            <button
                                key={p}
                                onClick={() => setPeriod(p)}
                                className={`px-4 py-1.5 text-[13px] font-bold rounded-md transition-colors ${
                                    period === p 
                                    ? 'bg-background text-foreground shadow-sm' 
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>

                    {/* Sync Status */}
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={fetchMacroData} 
                            disabled={loading}
                            className="p-2 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-50 transition-colors"
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <div className="text-xs font-mono bg-muted/50 px-3 py-1.5 rounded-lg border border-border">
                            <span className="text-muted-foreground">Last Sync: </span>
                            <span className="font-bold text-foreground">{loading ? '동기화 중...' : lastSync}</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-6xl mx-auto space-y-8">
                    
                    {/* 섹션 1: 주요 증시 및 반도체 지수 */}
                    <section>
                        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <span className="w-1.5 h-6 bg-primary rounded-full inline-block"></span>
                            글로벌 증시 및 반도체 지수
                        </h2>
                        <div className="grid grid-cols-5 gap-4">
                            {indices.map((idx, i) => (
                                <div key={i} className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-primary/30 transition-colors">
                                    <div className="text-[13px] font-bold text-muted-foreground tracking-wider mb-2">{idx.name}</div>
                                    <div className="flex items-end justify-between">
                                        <div>
                                            <div className="text-xl font-extrabold font-mono">{idx.value}</div>
                                            <div className={`text-xs font-bold flex items-center gap-0.5 mt-0.5 ${idx.isUp ? 'text-red-500' : 'text-blue-500'}`}>
                                                {idx.isUp ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} {idx.change}
                                            </div>
                                        </div>
                                        <div className="pb-1" title="최근 1주일 추세 (7 Trading Days)">
                                            <Sparkline data={idx.trend} isUp={idx.isUp} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {loading && indices.length === 0 && Array.from({length:5}).map((_,i) => (
                                <div key={i} className="animate-pulse bg-muted rounded-xl h-[100px]"></div>
                            ))}
                        </div>
                    </section>
                    
                    {/* 섹션 2: 외환, 금리, 공포지수 */}
                    <section>
                        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <span className="w-1.5 h-6 bg-amber-500 rounded-full inline-block"></span>
                            외환 &amp; 매크로 지표 (유동성/위험 선호도)
                        </h2>
                        <div className="grid grid-cols-4 gap-4">
                            {macros.map((idx, i) => (
                                <div key={i} className="bg-muted/10 border border-border rounded-xl p-5 space-y-3">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="text-[13px] font-bold text-foreground mb-0.5">{idx.name}</div>
                                            <div className="text-[11px] text-muted-foreground line-clamp-1">{idx.desc || '-'}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-end justify-between pt-1">
                                        <div>
                                            <div className="text-xl font-extrabold font-mono tracking-tighter">{idx.value}</div>
                                            <div className={`text-xs font-bold flex items-center gap-0.5 mt-0.5 ${idx.isUp ? 'text-red-500' : 'text-blue-500'}`}>
                                                {idx.isUp ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} {idx.change}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end shrink-0" title="최근 1주일 추세 (7 Trading Days)">
                                            <Sparkline data={idx.trend} isUp={idx.isUp} />
                                            <span className="text-[10px] text-muted-foreground mt-1.5 opacity-80">{idx.trendDesc}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {loading && macros.length === 0 && Array.from({length:4}).map((_,i) => (
                                <div key={i} className="animate-pulse bg-muted rounded-xl h-[120px]"></div>
                            ))}
                        </div>
                    </section>
                    
                    {/* 섹션 3: 원자재 및 대체 자산 (위험/안전 선호의 바로미터) */}
                    <section>
                        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <span className="w-1.5 h-6 bg-purple-500 rounded-full inline-block"></span>
                            원자재 &amp; 대체 자산 (크립토)
                        </h2>
                        <div className="grid grid-cols-4 gap-4">
                            {commodities.map((idx, i) => (
                                <div key={i} className="bg-muted/10 border border-border rounded-xl p-5 space-y-3">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="text-[13px] font-bold text-foreground mb-0.5">{idx.name}</div>
                                            <div className="text-[11px] text-muted-foreground line-clamp-1">{idx.desc || '-'}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-end justify-between pt-1">
                                        <div>
                                            <div className="text-xl font-extrabold font-mono tracking-tighter">{idx.value}</div>
                                            <div className={`text-xs font-bold flex items-center gap-0.5 mt-0.5 ${idx.isUp ? 'text-red-500' : 'text-blue-500'}`}>
                                                {idx.isUp ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} {idx.change}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end shrink-0" title="최근 1주일 추세 (7 Trading Days)">
                                            <Sparkline data={idx.trend} isUp={idx.isUp} />
                                            <span className="text-[10px] text-muted-foreground mt-1.5 opacity-80">{idx.trendDesc}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {loading && commodities.length === 0 && Array.from({length:4}).map((_,i) => (
                                <div key={i} className="animate-pulse bg-muted rounded-xl h-[120px]"></div>
                            ))}
                        </div>
                    </section>

                    {/* 정보 박스 */}
                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 mt-8">
                        <h3 className="text-sm font-bold text-primary mb-2 flex items-center gap-2">
                            <ArrowRight size={16} /> MAIIS 추세 분석 (Feature Extraction) 연결
                        </h3>
                        <p className="text-[13px] text-foreground/80 leading-relaxed">
                            우측 상단의 <strong>[1D · 1W · 1M · 6M · 1Y]</strong> 기간 버튼을 누르면 과거 수집된 Historical Data와 비교하여 상승/하락률을 즉시 재계산합니다. (※ 미니 스파크라인 차트는 언제나 최근 1주일의 단기 모멘텀을 고정으로 보여줍니다)<br/>
                            에이전트는 이 <strong>다중 타임프레임(Multi-Timeframe)</strong> 데이터 모두를 프롬프트로 주입받아, "단기는 하락장이나 장기 상승 추세는 유효함"과 같이 심층적인 시황 분석을 수행합니다.
                        </p>
                    </div>

                </div>
            </div>
        </div>
    )
}
