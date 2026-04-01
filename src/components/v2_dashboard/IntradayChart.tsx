import React, { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, CandlestickSeries } from 'lightweight-charts';

interface IntradayChartProps {
    ticker?: string;
    intradayData?: any[]; // The AI predictions to display as markers
}

const EMPTY_ARRAY: any[] = [];

export default function IntradayChart({ 
    ticker = '122630', // Default: KODEX 레버리지 (시장 등락과 동행하며 거래량이 많음)
    intradayData = EMPTY_ARRAY,
    timeframe = '5m'
}: IntradayChartProps & { timeframe?: '5m' | 'D' }) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        // Determine Theme Colors
        const isDark = document.documentElement.classList.contains('dark');
        const bgColor = 'transparent'; // bg-background 
        const textColor = isDark ? '#94a3b8' : '#64748b'; // slate-400 : slate-500
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';

        // 1. Create Chart
        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: 'solid' as any, color: bgColor },
                textColor: textColor,
                attributionLogo: false
            },
            localization: {
                timeFormatter: (time: number) => {
                    if (timeframe === 'D') {
                        // For daily charts, just string format YYYY-MM-DD (TradingView usually wants unix timestamp, we handle below)
                        const d = new Date(time * 1000);
                        return d.toISOString().split('T')[0];
                    }
                    const date = new Date(time * 1000);
                    return date.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
                }
            },
            grid: {
                vertLines: { color: gridColor, style: 3 },
                horzLines: { color: gridColor, style: 3 },
            },
            crosshair: { mode: 0 },
            rightPriceScale: { borderColor: gridColor },
            timeScale: {
                borderColor: gridColor,
                timeVisible: timeframe === '5m',
                secondsVisible: false,
                tickMarkFormatter: (time: number) => {
                    const date = new Date(time * 1000);
                    if (timeframe === 'D') return `${date.getMonth() + 1}/${date.getDate()}`;
                    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                }
            },
            watermark: { visible: false }
        });

        chartRef.current = chart;

        // 2. Add Candlestick Series (Korean Colors)
        const candlestickSeriesInstance = chart.addSeries(CandlestickSeries, {
            upColor: '#ef4444', downColor: '#3b82f6', borderVisible: false,
            wickUpColor: '#ef4444', wickDownColor: '#3b82f6',
        });
        seriesRef.current = candlestickSeriesInstance;

        // 3. Fetch chart data
        const loadChartData = async () => {
            try {
                let formattedData: any[] = [];
                
                if (timeframe === 'D') {
                    const res = await window.electronAPI.getChartData({ stk_cd: ticker });
                    const d = res?.data || res;
                    let pList = d?.stk_dt_pole_chart_qry || d?.output2 || d?.Body || d?.list || [];
                    if (!Array.isArray(pList)) pList = [];
                    pList = pList.slice(0, 100).reverse(); // 일봉 100일치
                    
                    pList.forEach((item: any) => {
                        const dateStr = String(item.dt || item.stck_bsop_date || item.date || item.trd_dt);
                        if (dateStr.length === 8) {
                            const y = parseInt(dateStr.substring(0, 4));
                            const m = parseInt(dateStr.substring(4, 6)) - 1;
                            const d = parseInt(dateStr.substring(6, 8));
                            const ts = Math.floor(new Date(y, m, d).getTime() / 1000);
                            
                            formattedData.push({
                                time: ts as Time,
                                open: Math.abs(Number(item.open_pric || item.opnprc || item.open || 0)),
                                high: Math.abs(Number(item.high_pric || item.hgprc || item.high || 0)),
                                low: Math.abs(Number(item.low_pric || item.lwprc || item.low || 0)),
                                close: Math.abs(Number(item.cur_prc || item.clprc || item.close || 0)),
                            });
                        }
                    });
                } else {
                    const rawData = await window.electronAPI.getChart5m(ticker, 3);
                    const uniqueData = new Map();
                    rawData.forEach((c: any) => {
                        if (c.time && c.open && c.high && c.low && c.close) {
                            uniqueData.set(c.time, {
                                time: c.time as Time,
                                open: c.open, high: c.high, low: c.low, close: c.close
                            });
                        }
                    });
                    formattedData = Array.from(uniqueData.values()).sort((a, b) => (a.time as number) - (b.time as number));
                }

                if (formattedData.length > 0) {
                    // 데이터 중복 제거 및 시간순 정렬 (TradingView 라이브러리 엄격함)
                    formattedData = formattedData.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);
                    candlestickSeriesInstance.setData(formattedData);
                    
                    // 4. Attach Markers (5분봉에서만)
                    if (timeframe === '5m' && intradayData && intradayData.length > 0) {
                        const markers: any[] = [];
                        intradayData.forEach(row => {
                            if (!row.date || !row.time_slot) return;
                            const dateString = `${row.date}T${row.time_slot}:00+09:00`;
                            let timeSec = Math.floor(new Date(dateString).getTime() / 1000);

                            const closestCandle = formattedData.find(c => Math.abs((c.time as number) - timeSec) < 600);
                            if (closestCandle) timeSec = closestCandle.time as number;

                            if (row.predict === 'UP' || row.predict === 'LONG') {
                                markers.push({ time: timeSec as Time, position: 'belowBar', color: '#ef4444', shape: 'arrowUp', text: 'LONG', size: 1.5 });
                            } else if (row.predict === 'DOWN' || row.predict === 'SHORT') {
                                markers.push({ time: timeSec as Time, position: 'aboveBar', color: '#3b82f6', shape: 'arrowDown', text: 'SHORT', size: 1.5 });
                            }
                        });
                        markers.sort((a, b) => (a.time as number) - (b.time as number));
                        candlestickSeriesInstance.setMarkers(markers);
                    }
                    
                    chart.timeScale().fitContent();
                }
            } catch (err) {
                console.error('Failed to load intraday chart:', err);
            }
        };

        loadChartData();

        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [ticker, intradayData, timeframe]);

    return (
        <div ref={chartContainerRef} className="w-full h-full" />
    );
}
