import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Search, Plus, X, RefreshCw, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '../utils'
import { matchChoseong } from '../utils/hangul'
import { useLayoutStore } from '../store/useLayoutStore'
import { useSignalStore } from '../store/useSignalStore'
import { useBackgroundSignalFetcher } from '../hooks/useBackgroundSignalFetcher'
import { StockChart } from './StockChart'
import { StockNotes } from './StockNotes'

interface WatchlistItem {
    code: string
    name: string
    price: number
    change: string
    changeRate: number
    volume: number
}

interface MasterStock {
    code: string
    name: string
    lastPrice: number
}

export default function Watchlist() {
    const { previous19DaysSum } = useSignalStore()
    const { enqueueSymbols } = useBackgroundSignalFetcher()

    const [masterList, setMasterList] = useState<MasterStock[]>([])
    const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
    const [isLoadingMaster, setIsLoadingMaster] = useState(false)
    const [isLoadingData, setIsLoadingData] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [isSearching, setIsSearching] = useState(false)
    const [selectedStock, setSelectedStock] = useState<{ code: string, name: string } | null>(null)
    const searchRef = useRef<HTMLDivElement>(null)

    const { chartHeight, setChartHeight } = useLayoutStore()
    const isDragging = useRef(false)
    const startY = useRef(0)
    const startHeight = useRef(0)

    const handleResizeStart = (e: React.MouseEvent) => {
        isDragging.current = true
        startY.current = e.clientY
        startHeight.current = chartHeight

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return
            const delta = e.clientY - startY.current
            const newHeight = Math.max(150, Math.min(startHeight.current + delta, 800))
            setChartHeight(newHeight)
        }

        const handleMouseUp = () => {
            isDragging.current = false
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = 'default'
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = 'row-resize'
    }

    const fetchMaster = async () => {
        if (!window.electronAPI?.getAllStocks) return
        setIsLoadingMaster(true)
        try {
            const kospi = await window.electronAPI.getAllStocks('0')
            const kosdaq = await window.electronAPI.getAllStocks('10')
            if (kospi.success && kosdaq.success) {
                const combined = [...kospi.data, ...kosdaq.data].map((s: any) => ({
                    code: s.code || s.stk_cd,
                    name: s.name || s.stk_nm,
                    lastPrice: Number(s.lastPrice || 0)
                }))
                setMasterList(combined)
            }
        } catch (err) {
            console.error('Master fetch error:', err)
        } finally {
            setIsLoadingMaster(false)
        }
    }

    const fetchData = async (symbols?: string[]) => {
        if (!window.electronAPI?.getWatchlistSymbols) return
        const targetSymbols = symbols || (await window.electronAPI.getWatchlistSymbols())
        if (targetSymbols.length === 0) {
            setWatchlist([])
            setSelectedStock(null)
            return
        }

        setIsLoadingData(true)
        try {
            const result = await window.electronAPI.getWatchlist(targetSymbols)
            if (result.success) {
                console.log('Watchlist Result:', result.data);

                let rawData = result.data;
                if (typeof rawData === 'string') try { rawData = JSON.parse(rawData); } catch (e) { }

                const body = rawData?.Body || rawData

                // Try various field names for watchlist list
                let rawList = body?.atn_stk_infr || body?.output1 || body?.list || []
                if (!Array.isArray(rawList)) rawList = [rawList].filter(Boolean)

                const mapped = rawList.map((item: any) => ({
                    code: item.stk_cd || item.pdno || '',
                    name: item.stk_nm || item.prdt_nm || '',
                    price: Math.abs(Number(item.cur_prc || item.prpr || 0)),
                    change: String(item.pred_pre || item.prdy_vrss || '0'),
                    changeRate: Number(item.flu_rt || item.prdy_ctrt || 0),
                    volume: Number(item.trde_qty || item.acml_vol || 0)
                }))

                setWatchlist(mapped)
                if (mapped.length > 0 && !selectedStock) {
                    setSelectedStock({ code: mapped[0].code, name: mapped[0].name })
                }
                window.electronAPI.wsRegister(targetSymbols)
                enqueueSymbols(targetSymbols)
            } else {
                setError(result.error?.message || result.error || '관심종목 데이터를 가져오지 못했습니다.');
            }
        } catch (err: any) {
            console.error('Watchlist fetch error:', err)
            setError('관심종목 조회 중 오류가 발생했습니다: ' + err.message)
        } finally {
            setIsLoadingData(false)
        }
    }

    useEffect(() => {
        fetchMaster()
        fetchData()

        const cleanup = window.electronAPI.onRealTimeData((wsData: any) => {
            if (wsData.stk_cd) {
                setWatchlist(prev => prev.map(item => {
                    const itemNumericCode = item.code.replace(/[^0-9]/g, '')
                    const wsNumericCode = wsData.stk_cd.replace(/[^0-9]/g, '')

                    if (itemNumericCode === wsNumericCode) {
                        return {
                            ...item,
                            price: wsData.cur_prc ? Math.abs(Number(wsData.cur_prc)) : item.price,
                            change: wsData.prdy_vrss || item.change,
                            changeRate: wsData.prdy_ctrt ? Number(wsData.prdy_ctrt) : item.changeRate,
                            volume: wsData.acml_vol ? Number(wsData.acml_vol) : item.volume
                        }
                    }
                    return item
                }))
            }
        })

        const handleRefresh = () => fetchData()
        window.addEventListener('kiwoom:refresh-data', handleRefresh)

        return () => {
            cleanup()
            window.removeEventListener('kiwoom:refresh-data', handleRefresh)
        }
    }, [])

    const filteredStocks = useMemo(() => {
        if (!searchQuery.trim()) return []
        const query = searchQuery.toLowerCase()
        return masterList
            .filter(s => s.code.includes(query) || matchChoseong(s.name, query))
            .slice(0, 50)
    }, [searchQuery, masterList])

    const toggleWatchlist = async (stock: MasterStock) => {
        const current = await window.electronAPI.getWatchlistSymbols()
        const newSymbols = current.includes(stock.code)
            ? current.filter((c: string) => c !== stock.code)
            : [...current, stock.code]

        await window.electronAPI.saveWatchlistSymbols(newSymbols)
        setSearchQuery('')
        setIsSearching(false)
        fetchData(newSymbols)
    }

    const removeStock = async (code: string) => {
        const current = await window.electronAPI.getWatchlistSymbols()
        const newSymbols = current.filter((c: string) => c !== code)
        await window.electronAPI.saveWatchlistSymbols(newSymbols)
        fetchData(newSymbols)
    }

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setIsSearching(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    return (
        <div className="flex-1 flex flex-col animate-in bg-muted/20 fade-in slide-in-from-bottom-4 duration-500 overflow-hidden h-full min-h-0">
            {/* Header / Search Section */}
            <div className="flex flex-col shrink-0 p-4 pb-4 z-20">
                <div className="relative w-full max-w-2xl" ref={searchRef}>
                    <div className="relative">
                        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="종목명, 코드, 초성 검색"
                            className="w-full bg-background border border-border rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value)
                                setIsSearching(true)
                            }}
                            onFocus={() => setIsSearching(true)}
                        />
                        {isLoadingMaster && (
                            <RefreshCw size={14} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
                        )}
                    </div>

                    {isSearching && searchQuery && (
                        <div className="absolute top-full mt-2 w-full bg-background border border-border rounded-xl shadow-xl z-50 max-h-80 overflow-auto">
                            {filteredStocks.length > 0 ? (
                                <div className="p-1">
                                    {filteredStocks.map(stock => (
                                        <button
                                            key={stock.code}
                                            onClick={() => toggleWatchlist(stock)}
                                            className="w-full flex items-center justify-between p-3 hover:bg-muted/50 rounded-lg text-sm"
                                        >
                                            <div className="flex flex-col items-start">
                                                <span className="font-semibold text-[13px]">{stock.name}</span>
                                                <span className="text-[10px] text-muted-foreground">{stock.code}</span>
                                            </div>
                                            <Plus size={16} className="text-muted-foreground" />
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {error && (
                <div className="bg-destructive/10 text-destructive p-4 rounded-xl flex items-center gap-3 border border-destructive/20 shrink-0">
                    <AlertCircle size={18} />
                    <p className="text-sm font-medium">{error}</p>
                    <button onClick={() => fetchData()} className="ml-auto text-xs underline font-bold">다시 시도</button>
                </div>
            )}

            {/* Split Layout */}
            <div className="flex-1 min-h-0 flex bg-background border-t border-border overflow-hidden">
                {/* Left side: Watchlist List */}
                <div className="flex-1 w-[45%] flex flex-col border-r border-border overflow-hidden bg-background shrink-0 min-w-[350px] relative">
                    <div className="overflow-auto flex-1">
                        <table className="w-full table-fixed text-left text-sm border-collapse tabular-nums">
                            <thead className="bg-muted/30 border-b border-border sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3 font-semibold text-xs text-muted-foreground w-auto">종목명</th>
                                    <th className="px-4 py-3 font-semibold text-xs text-muted-foreground text-right w-[120px]">현재가</th>
                                    <th className="px-4 py-3 font-semibold text-xs text-muted-foreground text-right w-[100px]">등락률</th>
                                    <th className="px-4 py-3 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {watchlist.map((stock) => {
                                    const numericCode = stock.code.replace(/[^0-9]/g, '')
                                    const sum19 = previous19DaysSum[numericCode]
                                    let isDepressed = false
                                    if (sum19 !== undefined && sum19 > 0) {
                                        const ma20 = (sum19 + stock.price) / 20
                                        if ((stock.price / ma20) * 100 < 95) isDepressed = true
                                    }

                                    return (
                                        <tr
                                            key={stock.code}
                                            className={cn(
                                                "hover:bg-muted/40 transition-colors cursor-pointer group",
                                                selectedStock?.code === stock.code && "bg-primary/5"
                                            )}
                                            onClick={() => setSelectedStock({ code: stock.code, name: stock.name })}
                                        >
                                            <td className="px-4 py-2.5">
                                                <div className="flex flex-col gap-0.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={cn("font-bold text-[13px] leading-none", selectedStock?.code === stock.code ? "text-primary" : "group-hover:text-primary")}>{stock.name}</span>
                                                        {isDepressed && <span className="text-[10px] font-bold bg-[#a855f7] text-white px-1 py-0.5 rounded shadow-sm leading-none">침체</span>}
                                                    </div>
                                                    <span className="text-[10px] text-muted-foreground font-mono leading-none">{stock.code}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-mono font-bold text-[13px] whitespace-nowrap overflow-hidden">
                                                ₩ {stock.price.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-2.5 text-right whitespace-nowrap overflow-hidden">
                                                <div className={cn(
                                                    "inline-flex items-center gap-1 font-bold text-[13px]",
                                                    stock.changeRate > 0 ? "text-rise" : stock.changeRate < 0 ? "text-fall" : "text-muted-foreground"
                                                )}>
                                                    {stock.changeRate > 0 ? <TrendingUp size={14} /> : stock.changeRate < 0 ? <TrendingDown size={14} /> : null}
                                                    <span>{stock.changeRate > 0 ? '+' : ''}{stock.changeRate}%</span>
                                                </div>
                                            </td>
                                            <td className="px-2 py-2.5 text-right">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); removeStock(stock.code) }}
                                                    className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                                {watchlist.length === 0 && !isLoadingData && (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">등록된 관심종목이 없습니다.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {isLoadingData && (
                        <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10"><RefreshCw size={24} className="animate-spin text-primary" /></div>
                    )}
                </div>

                {/* Right side: Chart and Notes */}
                <div className="flex-1 min-w-0 flex flex-col bg-background">
                    {/* 상단 고정 영역: 차트 */}
                    <div
                        style={{ height: chartHeight }}
                        className="shrink-0 bg-background pt-1 pl-1 relative"
                    >
                        <StockChart
                            stockCode={selectedStock?.code || ''}
                            stockName={selectedStock?.name || ''}
                            className="h-full w-full"
                        />
                        {/* Resizer handle */}
                        <div
                            className="absolute bottom-0 left-0 right-0 h-[3px] bg-border hover:bg-primary/50 cursor-row-resize translate-y-1/2 z-20 transition-colors"
                            onMouseDown={handleResizeStart}
                        />
                    </div>

                    {/* 하단 스크롤 영역: 부가 정보 */}
                    <div className="flex flex-col flex-1 overflow-y-auto min-h-0 bg-background">
                        <div className="flex gap-6 border-b border-border/50 px-4 pt-4 sticky top-0 z-10 bg-background">
                            <button className="text-[13px] font-bold text-primary border-b-[3px] border-primary pb-3 -mb-[1.5px]">노트</button>
                            <button className="text-[13px] font-bold text-muted-foreground/60 hover:text-foreground pb-3 -mb-[1.5px] transition-colors">예비 1</button>
                            <button className="text-[13px] font-bold text-muted-foreground/60 hover:text-foreground pb-3 -mb-[1.5px] transition-colors">예비 2</button>
                        </div>
                        <div className="flex-1 flex flex-col p-4 bg-muted/10 relative">
                            <StockNotes stockCode={selectedStock?.code || ''} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
