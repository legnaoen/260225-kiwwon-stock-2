import React, { useEffect, useRef, useState, useMemo } from 'react'
import { createChart, IChartApi, ISeriesApi, Time, CandlestickSeries, SeriesMarker, createSeriesMarkers } from 'lightweight-charts'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { cn } from '../utils'
import { useSignalStore } from '../store/useSignalStore'

interface ChartDataPoint {
    time: Time
    open: number
    high: number
    low: number
    close: number
}

interface StockChartProps {
    stockCode: string
    stockName: string
    className?: string
}

export const StockChart: React.FC<StockChartProps> = ({ stockCode, stockName, className }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const chartRef = useRef<IChartApi | null>(null)
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
    const markersPluginRef = useRef<any>(null)

    const chartDataRef = useRef<ChartDataPoint[]>([])

    // Initialize Chart
    useEffect(() => {
        if (!chartContainerRef.current) return

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight,
                })
            }
        }

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { color: 'transparent' },
                textColor: 'rgba(255, 255, 255, 0.9)',
            },
            grid: {
                vertLines: { color: 'rgba(197, 203, 206, 0.1)' },
                horzLines: { color: 'rgba(197, 203, 206, 0.1)' },
            },
            rightPriceScale: {
                borderColor: 'rgba(197, 203, 206, 0.2)',
            },
            timeScale: {
                borderColor: 'rgba(197, 203, 206, 0.2)',
                timeVisible: true,
                fixLeftEdge: true,
            },
            autoSize: true,
        })
        chartRef.current = chart

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#ef4444',
            downColor: '#3b82f6',
            borderVisible: false,
            wickUpColor: '#ef4444',
            wickDownColor: '#3b82f6',
        })
        candleSeriesRef.current = candlestickSeries

        window.addEventListener('resize', handleResize)

        return () => {
            window.removeEventListener('resize', handleResize)
            chart.remove()
        }
    }, [])

    // Add Theme Toggle listener for chart text colors
    useEffect(() => {
        const isDark = document.documentElement.classList.contains('dark')
        if (chartRef.current) {
            chartRef.current.applyOptions({
                layout: { textColor: isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)' }
            })
        }
    }, [])

    const fetchChartData = async () => {
        if (!stockCode || !chartRef.current || !candleSeriesRef.current) return

        setIsLoading(true)
        setError(null)
        try {
            const result = await window.electronAPI.getChartData({ stk_cd: stockCode })
            if (result.success) {
                const rawData = result.data?.stk_dt_pole_chart_qry || result.data?.output2 || result.data?.Body || result.data?.list || []

                const processed: ChartDataPoint[] = rawData.reverse().map((day: any) => {
                    const close = Number(day.cur_prc || day.stck_clpr || day.clpr || day.stck_clsprc || day.cls_prc || day.close || 0)
                    let open = Number(day.open_pric || day.stck_opnprc || day.opn_prc || day.open || 0)
                    let high = Number(day.high_pric || day.stck_hgprc || day.hg_prc || day.high || 0)
                    let low = Number(day.low_pric || day.stck_lwprc || day.low_prc || day.low || 0)

                    if (open === 0) open = close
                    if (high === 0 || high < Math.max(open, close)) high = Math.max(open, close)
                    low = (low === 0 || low > Math.min(open, close)) ? Math.min(open, close) : low

                    // Format date to YYYY-MM-DD which lightweight-charts expects
                    let dateStr = String(day.dt || day.stck_bsop_date || day.date || '')
                    if (dateStr.length === 8) {
                        dateStr = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`
                    }

                    return {
                        time: dateStr as Time,
                        open,
                        high,
                        low,
                        close
                    }
                }).filter((d: ChartDataPoint) => d.close > 0)

                // Remove duplicates by time
                const uniqueData = processed.filter((v, i, a) => a.findIndex(t => (t.time === v.time)) === i)
                // Sort by time
                uniqueData.sort((a, b) => (a.time as string).localeCompare(b.time as string))

                if (uniqueData.length > 0) {
                    chartDataRef.current = uniqueData
                    candleSeriesRef.current.setData(uniqueData)

                    // Calculate Disparity and assign Depression Markers
                    const markers: SeriesMarker<Time>[] = []
                    for (let i = 0; i < uniqueData.length; i++) {
                        if (i < 19) continue
                        let sum = 0
                        for (let j = 0; j < 20; j++) {
                            sum += uniqueData[i - j].close
                        }
                        const ma20 = sum / 20
                        const disparity = (uniqueData[i].close / ma20) * 100

                        if (disparity < 95) {
                            markers.push({
                                time: uniqueData[i].time,
                                position: 'belowBar',
                                color: '#a855f7',
                                shape: 'arrowUp',
                                size: 1
                            })
                        }
                    }
                    if (!markersPluginRef.current) {
                        markersPluginRef.current = createSeriesMarkers(candleSeriesRef.current, markers)
                    } else {
                        markersPluginRef.current.setMarkers(markers)
                    }

                    // Store the sum of the last 19 complete days for other components
                    if (uniqueData.length >= 20) {
                        let sum = 0
                        // Since uniqueData is sorted oldest to newest, the last one is today (index: length - 1)
                        // So the previous 19 days are from (length - 20) to (length - 2)
                        for (let j = uniqueData.length - 20; j < uniqueData.length - 1; j++) {
                            sum += uniqueData[j].close
                        }
                        useSignalStore.getState().setPrevious19DaysSum(stockCode, sum)
                    }

                    const totalPoints = uniqueData.length
                    if (totalPoints > 80) {
                        chartRef.current.timeScale().setVisibleLogicalRange({
                            from: totalPoints - 80, // 약 4개월치 영업일
                            to: totalPoints - 1,
                        })
                    } else {
                        chartRef.current.timeScale().fitContent()
                    }
                } else {
                    setError('차트 데이터가 없습니다.')
                }
            } else {
                setError(result.error?.return_msg || '차트 데이터를 불러올 수 없습니다.')
            }
        } catch (err) {
            console.error('Chart fetch error:', err)
            setError('차트 데이터를 요청하는 중 오류가 발생했습니다.')
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchChartData()
    }, [stockCode])

    // Real-time update for the chart
    useEffect(() => {
        if (!stockCode) return

        const cleanup = window.electronAPI.onRealTimeData((wsData: any) => {
            // Ensure data is for the currently selected stock
            if (wsData.stk_cd === stockCode || wsData.stk_cd === stockCode.replace(/[^0-9]/g, '')) {
                const currentPrice = Math.abs(Number(wsData.cur_prc || 0))
                if (currentPrice === 0 || !candleSeriesRef.current || chartDataRef.current.length === 0) return

                const data = chartDataRef.current
                const lastBar = data[data.length - 1]

                // lightweight-charts needs the same time to update the existing candle, 
                // or a new time to add a new candle.
                // Assuming the real-time data comes during today's market, we update the last candle.
                const updatedBar: ChartDataPoint = {
                    ...lastBar,
                    close: currentPrice,
                    high: Math.max(lastBar.high, currentPrice),
                    low: Math.min(lastBar.low, currentPrice)
                }

                chartDataRef.current[data.length - 1] = updatedBar
                candleSeriesRef.current.update(updatedBar)
            }
        })

        return () => {
            cleanup()
        }
    }, [stockCode])

    return (
        <div className={cn("flex flex-col h-full relative group w-full", className)}>
            {!stockCode && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-12 text-muted-foreground border border-dashed rounded-2xl bg-muted/5">
                    <p className="text-sm">종목을 선택하면 차트가 표시됩니다.</p>
                </div>
            )}
            {isLoading && stockCode && (
                <div className="absolute top-4 right-4 z-10 bg-background/50 rounded-full p-1 border">
                    <RefreshCw size={16} className="animate-spin text-primary" />
                </div>
            )}
            {error && stockCode && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/90 text-destructive gap-4 text-center p-8 backdrop-blur-sm">
                    <AlertCircle size={48} />
                    <p className="text-xl font-bold">{error}</p>
                </div>
            )}
            <div ref={chartContainerRef} className={cn("flex-1 w-full relative h-full min-h-0", !stockCode && "opacity-0 pointer-events-none")} />
        </div>
    )
}
