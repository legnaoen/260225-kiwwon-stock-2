import React, { useEffect, useState, useMemo, useRef } from 'react'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { cn } from '../utils'

interface ChartDataPoint {
    date: string
    open: number
    high: number
    low: number
    close: number
    ma10?: number
    ma20?: number
    ma120?: number
    ma200?: number
    disparity?: number
    signal?: 'depression' | 'overheat'
}

interface StockChartProps {
    stockCode: string
    stockName: string
    className?: string
}

export const StockChart: React.FC<StockChartProps> = ({ stockCode, stockName, className }) => {
    const [data, setData] = useState<ChartDataPoint[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [hoverIndex, setHoverIndex] = useState<number | null>(null)
    const [showDebug, setShowDebug] = useState(false)
    const [debugData, setDebugData] = useState<any>(null)
    const [visibleCount, setVisibleCount] = useState(60) // Number of visible candles
    const [scrollOffset, setScrollOffset] = useState(0) // How far we've scrolled back
    const containerRef = useRef<HTMLDivElement>(null)
    const [dimensions, setDimensions] = useState({ width: 800, height: 300 })

    useEffect(() => {
        if (!containerRef.current) return
        const observer = new ResizeObserver(entries => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect
                if (width > 0 && height > 0) {
                    setDimensions({ width, height })
                }
            }
        })
        observer.observe(containerRef.current)
        return () => observer.disconnect()
    }, [])

    const calculateMA = (array: any[], period: number, index: number) => {
        if (index < period - 1) return undefined
        const slice = array.slice(index - (period - 1), index + 1)
        const sum = slice.reduce((acc, curr) => acc + curr.close, 0)
        return Math.round(sum / period)
    }

    const fetchChartData = async () => {
        if (!stockCode) return

        setIsLoading(true)
        setError(null)
        try {
            const result = await window.electronAPI.getChartData({ stk_cd: stockCode })
            if (result.success) {
                // Try all common Kiwoom REST API output field names
                const rawData = result.data?.stk_dt_pole_chart_qry || result.data?.output2 || result.data?.Body || result.data?.list || []
                setDebugData(rawData[0])

                const processed = rawData.reverse().map((day: any, idx: number) => {
                    // Log the first item's keys once to help identify field names
                    if (idx === 0) console.log('Chart Data Sample Keys:', Object.keys(day), day);

                    // Kiwoom REST API ka10081 Exact Fields from User's Python Reference:
                    // open_pric: 시가, high_pric: 고가, low_pric: 저가, cur_prc: 종가(현재가), dt: 날짜

                    const close = Number(day.cur_prc || day.stck_clpr || day.clpr || day.stck_clsprc || day.cls_prc || day.close || 0)
                    let open = Number(day.open_pric || day.stck_opnprc || day.opn_prc || day.open || 0)
                    let high = Number(day.high_pric || day.stck_hgprc || day.hg_prc || day.high || 0)
                    let low = Number(day.low_pric || day.stck_lwprc || day.low_prc || day.low || 0)

                    // IF fields are still 0, it means the mapping is still not hitting. 
                    // Use close as fallback ONLY if we truly can't find anything else.
                    if (open === 0) open = close
                    if (high === 0 || high < Math.max(open, close)) high = Math.max(open, close)
                    low = (low === 0 || low > Math.min(open, close)) ? Math.min(open, close) : low

                    return {
                        date: day.dt || day.stck_bsop_date || day.date || '',
                        open,
                        high,
                        low,
                        close
                    }
                }).filter((d: any) => d.close > 0) // Filter out clearly wrong data

                const withIndicators = processed.map((point: any, index: number, array: any[]) => {
                    const ma10 = calculateMA(array, 10, index)
                    const ma20 = calculateMA(array, 20, index)
                    const ma120 = calculateMA(array, 120, index)
                    const ma200 = calculateMA(array, 200, index)

                    let disparity: number | undefined = undefined
                    let signal: 'depression' | 'overheat' | undefined = undefined

                    if (ma20) {
                        disparity = Number(((point.close / ma20) * 100).toFixed(2))
                        if (disparity < 95) signal = 'depression' // Trigger depression below 95%
                        else if (disparity > 105) signal = 'overheat'
                    }

                    return { ...point, ma10, ma20, ma120, ma200, disparity, signal }
                })

                setData(withIndicators)
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
        setHoverIndex(null)
    }, [stockCode])

    const visibleData = useMemo(() => {
        if (data.length === 0) return []
        const start = Math.max(0, data.length - visibleCount - scrollOffset)
        const end = Math.max(0, data.length - scrollOffset)
        return data.slice(start, end)
    }, [data, visibleCount, scrollOffset])

    const chartMetrics = useMemo(() => {
        if (visibleData.length < 2) return null

        const margin = { top: 20, right: 60, bottom: 20, left: 10 }
        const width = Math.max(dimensions.width, 300)
        const height = Math.max(dimensions.height, 200)

        const highs = visibleData.map(d => d.high)
        const lows = visibleData.map(d => d.low)
        const visibleMax = Math.max(...highs)
        const visibleMin = Math.min(...lows)
        const range = (visibleMax - visibleMin) || 1

        // Add 10% padding to top and bottom
        const yMax = visibleMax + (range * 0.1)
        const yMin = visibleMin - (range * 0.1)
        const yRange = yMax - yMin

        const getX = (i: number) => (i / (visibleData.length - 1)) * (width - margin.left - margin.right) + margin.left
        const getY = (p: number) => height - margin.bottom - ((p - yMin) / yRange) * (height - margin.top - margin.bottom)

        const candleWidth = Math.max(2, (width - margin.left - margin.right) / visibleData.length * 0.8)

        return { width, height, margin, getX, getY, candleWidth, yMin, yMax, yRange, visibleMax, visibleMin }
    }, [visibleData])

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!chartMetrics || visibleData.length === 0) return
        const svg = e.currentTarget
        const rect = svg.getBoundingClientRect()
        const x = (e.clientX - rect.left) * (chartMetrics.width / rect.width)

        const { width, margin } = chartMetrics
        const index = Math.round(((x - margin.left) / (width - margin.left - margin.right)) * (visibleData.length - 1))

        if (index >= 0 && index < visibleData.length) {
            setHoverIndex(index)
        }
    }

    const handleWheel = (e: React.WheelEvent) => {
        if (e.deltaY < 0) {
            // Zoom In
            setVisibleCount(prev => Math.max(20, prev - 10))
        } else {
            // Zoom Out
            setVisibleCount(prev => Math.min(200, prev + 10))
        }
    }

    const chartContent = useMemo(() => {
        if (!chartMetrics) return null
        const { width, height, margin, getX, getY, candleWidth, yMin, yMax, yRange, visibleMax, visibleMin } = chartMetrics

        const renderMALine = (period: number, color: string, dataKey: keyof ChartDataPoint) => {
            const points = visibleData.map((d, i) => {
                const val = d[dataKey] as number | undefined
                return val ? { x: getX(i), y: getY(val) } : null
            }).filter(p => p !== null) as { x: number, y: number }[]

            if (points.length < 2) return null
            const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
            return <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.8" />
        }

        return (
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full h-full overflow-visible cursor-crosshair select-none"
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHoverIndex(null)}
                onWheel={handleWheel}
            >
                {/* Horizontal Grid Lines */}
                {[0, 0.25, 0.5, 0.75, 1].map(p => {
                    const price = yMin + yRange * p
                    const y = getY(price)
                    return (
                        <g key={p}>
                            <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke="var(--border)" strokeOpacity="0.2" />
                            <text x={width - 5} y={y + 4} fontSize="11" fill="var(--muted-foreground)" textAnchor="end" className="font-mono font-bold">
                                {Math.round(price).toLocaleString()}
                            </text>
                        </g>
                    )
                })}

                {/* Vertical Cursor Guide */}
                {hoverIndex !== null && (
                    <line x1={getX(hoverIndex)} y1={margin.top} x2={getX(hoverIndex)} y2={height - margin.bottom} stroke="var(--primary)" strokeOpacity="0.3" strokeDasharray="3 3" />
                )}

                {/* Candles */}
                {visibleData.map((d, i) => {
                    const isUp = d.close >= d.open
                    const color = isUp ? '#ef4444' : '#3b82f6'
                    const x = getX(i)
                    return (
                        <g key={i}>
                            <line x1={x} y1={getY(d.high)} x2={x} y2={getY(d.low)} stroke={color} strokeWidth="2" />
                            <rect
                                x={x - candleWidth / 2}
                                y={getY(Math.max(d.open, d.close))}
                                width={candleWidth}
                                height={Math.max(1, Math.abs(getY(d.open) - getY(d.close)))}
                                fill={color}
                            />
                            {/* Depression Signal Arrow */}
                            {d.signal === 'depression' && (
                                <path
                                    d={`M ${x} ${getY(d.low) + 15} L ${x - 6} ${getY(d.low) + 25} L ${x + 6} ${getY(d.low) + 25} Z`}
                                    fill="#a855f7"
                                />
                            )}
                        </g>
                    )
                })}

                {/* Moving Averages */}
                {renderMALine(10, '#94a3b8', 'ma10')}
                {renderMALine(20, '#22c55e', 'ma20')}
                {renderMALine(120, '#ef4444', 'ma120')}
                {renderMALine(200, '#64748b', 'ma200')}

                {/* High/Low Labels */}
                <g>
                    {visibleData.map((d, i) => d.high === visibleMax && (
                        <text key={`max-${i}`} x={getX(i)} y={getY(d.high) - 8} fontSize="11" fill="#ef4444" fontWeight="bold" textAnchor="middle">
                            ▲ 최고 {d.high.toLocaleString()}
                        </text>
                    ))}
                    {visibleData.map((d, i) => d.low === visibleMin && (
                        <text key={`min-${i}`} x={getX(i)} y={getY(d.low) + 16} fontSize="11" fill="#3b82f6" fontWeight="bold" textAnchor="middle">
                            ▼ 최저 {d.low.toLocaleString()}
                        </text>
                    ))}
                </g>

                {/* Current Price Marker */}
                {visibleData.length > 0 && (
                    <g transform={`translate(${width - margin.right}, ${getY(visibleData[visibleData.length - 1].close)})`}>
                        <path d="M 0 -10 L 55 -10 L 55 10 L 0 10 L -6 0 Z" fill="#ef4444" />
                        <text x="8" y="4" fontSize="11" fill="white" fontWeight="bold" className="font-mono">
                            {visibleData[visibleData.length - 1].close.toLocaleString()}
                        </text>
                    </g>
                )}
            </svg>
        )
    }, [visibleData, chartMetrics, hoverIndex])

    if (!stockCode) {
        return (
            <div className={cn("flex flex-col items-center justify-center p-12 text-muted-foreground border border-dashed rounded-2xl bg-muted/5", className)}>
                <p className="text-sm">종목을 선택하면 차트가 표시됩니다.</p>
            </div>
        )
    }

    const hoveredData = hoverIndex !== null ? visibleData[hoverIndex] : visibleData[visibleData.length - 1]

    return (
        <div className={cn("flex flex-col h-full relative group w-full", className)}>
            {isLoading && (
                <div className="absolute top-4 right-4 z-10 bg-background/50 rounded-full p-1 border">
                    <RefreshCw size={16} className="animate-spin text-primary" />
                </div>
            )}
            <div className="flex-1 w-full relative" ref={containerRef}>
                {showDebug && debugData && (
                    <div className="absolute inset-0 z-50 bg-black/95 text-green-400 p-8 font-mono text-sm overflow-auto select-text border-2 border-primary/30 rounded-xl">
                        <div className="flex justify-between items-center mb-6 pb-4 border-b border-green-500/30">
                            <span className="text-xl font-black">RAW CHART DATA (FIRST ITEM)</span>
                            <button onClick={() => setShowDebug(false)} className="bg-red-500 text-white px-4 py-2 rounded-lg font-bold hover:brightness-110">CLOSE</button>
                        </div>
                        <pre className="text-base whitespace-pre-wrap">
                            {JSON.stringify(debugData, null, 2)}
                        </pre>
                        <div className="mt-8 p-4 bg-primary/10 rounded-lg border border-primary/20 text-white font-bold">
                            <h4 className="text-lg mb-2">💡 필드 구조 분석 팁</h4>
                            <p className="opacity-80">위 목록에서 시가(Open), 고가(High), 저가(Low), 종가(Close)에 해당하는 숫자를 찾으세요. </p>
                            <p className="opacity-80 mt-1">예: "stck_opnprc"가 45000이라면 이것이 '시가' 필드입니다.</p>
                        </div>
                    </div>
                )}
                {error ? (
                    <div className="h-full flex flex-col items-center justify-center text-destructive gap-4 text-center p-8">
                        <AlertCircle size={48} />
                        <p className="text-xl font-bold">{error}</p>
                    </div>
                ) : visibleData.length > 1 ? (
                    chartContent
                ) : !isLoading && (
                    <div className="h-full flex items-center justify-center text-muted-foreground font-bold text-lg">
                        표시할 데이터가 부족합니다.
                    </div>
                )}
            </div>
        </div>
    )
}
