import React, { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, CandlestickSeries } from 'lightweight-charts';

interface IntradayChartProps {
    ticker?: string;
    intradayData: any[]; // The AI predictions to display as markers
}

export default function IntradayChart({ 
    ticker = '122630', // Default: KODEX 레버리지 (시장 등락과 동행하며 거래량이 많음)
    intradayData = []
}: IntradayChartProps) {
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
                    const date = new Date(time * 1000);
                    return date.toLocaleString('ko-KR', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    });
                }
            },
            grid: {
                vertLines: { color: gridColor, style: 3 },
                horzLines: { color: gridColor, style: 3 },
            },
            crosshair: {
                mode: 0,
            },
            rightPriceScale: {
                borderColor: gridColor,
            },
            timeScale: {
                borderColor: gridColor,
                timeVisible: true,
                secondsVisible: false,
                tickMarkFormatter: (time: number) => {
                    // time is a unix timestamp in seconds
                    const date = new Date(time * 1000);
                    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                }
            },
            watermark: { visible: false } // Remove TradingView logo (fallback for old API)
        });

        chartRef.current = chart;

        // 2. Add Candlestick Series (Korean Colors)
        const candlestickSeriesInstance = chart.addSeries(CandlestickSeries, {
            upColor: '#ef4444', // Red
            downColor: '#3b82f6', // Blue
            borderVisible: false,
            wickUpColor: '#ef4444',
            wickDownColor: '#3b82f6',
        });
        seriesRef.current = candlestickSeriesInstance;

        // 3. Fetch 5m chart data and apply it
        const loadChartData = async () => {
            try {
                // Fetch last 3 days to have context on the 5m chart
                const rawData = await window.electronAPI.getChart5m(ticker, 3);
                
                // data from KiwoomService.getOhlcv5m is already sorted by time (ascending)
                // Filter out corrupted data or duplicates just in case
                const uniqueData = new Map();
                rawData.forEach((c: any) => {
                    // ensure valid numbers
                    if (c.time && c.open && c.high && c.low && c.close) {
                        // Keep time in seconds (UNIX timestamp) which is IData format
                        // Or if Kiwoom returns raw string, we parse it
                        // Kiwoom return format: { time: number, open: number, high: number, low: number, close: number, volume: number }
                        uniqueData.set(c.time, {
                            time: c.time as Time,
                            open: c.open,
                            high: c.high,
                            low: c.low,
                            close: c.close
                        });
                    }
                });

                const formattedData = Array.from(uniqueData.values()).sort((a, b) => (a.time as number) - (b.time as number));
                if (formattedData.length > 0) {
                    candlestickSeriesInstance.setData(formattedData);
                    
                    // 4. Attach Markers
                    const markers: any[] = [];
                    intradayData.forEach(row => {
                        // AI Prediction
                        // "INTRADAY_2024-03-30_0930" matches "date" and "time_slot"
                        // Try to convert to timestamp to match candle
                        if (!row.date || !row.time_slot) return;
                        
                        // Parse date String
                        const dateString = `${row.date}T${row.time_slot}:00+09:00`; // KST timezone
                        let timeSec = Math.floor(new Date(dateString).getTime() / 1000);

                        // Find closest candle time in the chart data (within 10 minutes)
                        const closestCandle = formattedData.find(c => Math.abs((c.time as number) - timeSec) < 600);
                        if (closestCandle) {
                            timeSec = closestCandle.time as number;
                        }

                        if (row.predict === 'UP' || row.predict === 'LONG') {
                            markers.push({
                                time: timeSec as Time,
                                position: 'belowBar',
                                color: '#ef4444',
                                shape: 'arrowUp',
                                text: 'LONG',
                                size: 1.5,
                            });
                        } else if (row.predict === 'DOWN' || row.predict === 'SHORT') {
                            markers.push({
                                time: timeSec as Time,
                                position: 'aboveBar',
                                color: '#3b82f6',
                                shape: 'arrowDown',
                                text: 'SHORT',
                                size: 1.5,
                            });
                        }
                    });

                    // Sort markers by time
                    markers.sort((a, b) => (a.time as number) - (b.time as number));
                    candlestickSeriesInstance.setMarkers(markers);
                    
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
    }, [ticker, intradayData]);

    return (
        <div ref={chartContainerRef} className="w-full h-full" />
    );
}
