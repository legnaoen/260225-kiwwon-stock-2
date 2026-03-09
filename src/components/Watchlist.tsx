import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Search, Plus, X, RefreshCw, AlertCircle, TrendingUp, TrendingDown, Filter, ChevronDown, Check, GripVertical } from 'lucide-react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { cn } from '../utils'
import { matchChoseong } from '../utils/hangul'
import { useLayoutStore } from '../store/useLayoutStore'
import { useSignalStore } from '../store/useSignalStore'
import { useTagStore } from '../store/useTagStore'
import { useBackgroundSignalFetcher } from '../hooks/useBackgroundSignalFetcher'
import { StockChart } from './StockChart'
import { StockNotes } from './StockNotes'
import { StockSchedules } from './StockSchedules'
import { StockFinancials } from './StockFinancials'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/Table'
import { ProfitText } from './ui/ProfitDisplay'

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
    const [activeInfoTab, setActiveInfoTab] = useState<'notes' | 'schedules' | 'financials'>('notes')
    const searchRef = useRef<HTMLDivElement>(null)

    const { tags: tagData, getAllTags } = useTagStore()
    const allAvailableTags = useMemo(() => getAllTags(), [tagData, getAllTags])
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false)
    const [tagSearchQuery, setTagSearchQuery] = useState('')
    const tagDropdownRef = useRef<HTMLDivElement>(null)

    const toggleFilterTag = (tag: string) => {
        setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
    }

    const filteredTagsForDropdown = useMemo(() => {
        return allAvailableTags.filter(tag => tag.toLowerCase().includes(tagSearchQuery.toLowerCase()))
    }, [allAvailableTags, tagSearchQuery])

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

                // Sort results according to the original targetSymbols order
                const sorted = mapped.sort((a: any, b: any) => {
                    const idxA = targetSymbols.indexOf(a.code)
                    const idxB = targetSymbols.indexOf(b.code)
                    if (idxA === -1 && idxB === -1) return 0
                    if (idxA === -1) return 1
                    if (idxB === -1) return -1
                    return idxA - idxB
                })

                setWatchlist(sorted)
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

    const onDragEnd = async (result: DropResult) => {
        if (!result.destination) return

        // Skip if filtering or searching
        if (selectedTags.length > 0 || searchQuery.trim() !== '') return

        const items = Array.from(watchlist)
        const [reorderedItem] = items.splice(result.source.index, 1)
        items.splice(result.destination.index, 0, reorderedItem)

        setWatchlist(items)

        // Save new order to store
        const newSymbols = items.map(item => item.code)
        await window.electronAPI.saveWatchlistSymbols(newSymbols)
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
            if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
                setIsTagDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const displayedWatchlist = useMemo(() => {
        if (selectedTags.length === 0) return watchlist;
        return watchlist.filter(stock => {
            const stockNumericCode = stock.code.replace(/[^0-9]/g, '')
            const stockTags = tagData[stockNumericCode] || []
            // OR condition
            return selectedTags.some(tag => stockTags.includes(tag))
        })
    }, [watchlist, selectedTags, tagData])

    return (
        <div className="flex-1 flex flex-col animate-in bg-muted/20 fade-in slide-in-from-bottom-4 duration-500 overflow-hidden h-full min-h-0">
            {/* Header / Search Section */}
            <div className="flex shrink-0 p-4 gap-4 z-20 items-center justify-between border-b border-border/50 bg-background/50 backdrop-blur">
                {/* Tag Filter Dropdown Section */}
                <div className="flex items-center gap-2 flex-1 relative" ref={tagDropdownRef}>
                    <button
                        onClick={() => setIsTagDropdownOpen(!isTagDropdownOpen)}
                        className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-bold transition-all border shadow-sm",
                            selectedTags.length > 0
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-foreground border-border hover:border-primary/50"
                        )}
                    >
                        <Filter size={14} />
                        <span>Filter {selectedTags.length > 0 && `(${selectedTags.length})`}</span>
                        <ChevronDown size={14} className={cn("transition-transform", isTagDropdownOpen && "rotate-180")} />
                    </button>

                    {selectedTags.length > 0 && (
                        <button
                            onClick={() => setSelectedTags([])}
                            className="bg-muted hover:bg-muted/80 text-muted-foreground p-2 rounded-lg transition-colors border border-border"
                            title="필터 초기화"
                        >
                            <X size={14} />
                        </button>
                    )}

                    {isTagDropdownOpen && (
                        <div className="absolute top-full left-0 mt-2 w-[240px] bg-background border border-border rounded-xl shadow-2xl z-[60] flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="p-2 border-b border-border bg-muted/30">
                                <div className="relative">
                                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                        type="text"
                                        placeholder="태그 검색..."
                                        className="w-full bg-background border border-border rounded-md py-1.5 pl-8 pr-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                                        value={tagSearchQuery}
                                        onChange={(e) => setTagSearchQuery(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <div className="max-h-[300px] overflow-y-auto p-1 py-2 custom-scrollbar">
                                {filteredTagsForDropdown.length > 0 ? (
                                    filteredTagsForDropdown.map(tag => {
                                        const isSelected = selectedTags.includes(tag)
                                        return (
                                            <button
                                                key={tag}
                                                onClick={() => toggleFilterTag(tag)}
                                                className={cn(
                                                    "w-full flex items-center justify-between px-3 py-2 rounded-md text-[12px] font-medium transition-colors mb-0.5",
                                                    isSelected ? "bg-primary/10 text-primary font-bold" : "text-foreground hover:bg-muted"
                                                )}
                                            >
                                                <span>#{tag}</span>
                                                {isSelected && <Check size={14} />}
                                            </button>
                                        )
                                    })
                                ) : (
                                    <div className="py-8 text-center text-[12px] text-muted-foreground">태그가 없습니다.</div>
                                )}
                            </div>
                            {selectedTags.length > 0 && (
                                <div className="p-2 border-t border-border bg-muted/50 flex justify-between items-center text-[11px] px-3">
                                    <span className="text-muted-foreground">{selectedTags.length}개 선택됨</span>
                                    <button onClick={() => setSelectedTags([])} className="text-primary font-bold hover:underline">초기화</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Selected Tags Display (Small Pills) */}
                    <div className="flex items-center gap-1.5 ml-2 overflow-x-auto no-scrollbar max-w-[calc(100%-180px)]">
                        {selectedTags.map(tag => (
                            <span key={tag} className="shrink-0 flex items-center gap-1 bg-primary/5 text-primary border border-primary/10 px-2 py-0.5 rounded-full text-[10px] font-bold">
                                #{tag}
                                <button onClick={() => toggleFilterTag(tag)} className="hover:text-foreground opacity-60 hover:opacity-100">
                                    <X size={10} />
                                </button>
                            </span>
                        ))}
                    </div>
                </div>

                {/* Search Section */}
                <div className="relative w-[280px] shrink-0" ref={searchRef}>
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="종목명, 코드, 초성 검색"
                            className="w-full bg-background border border-border rounded-lg py-2 pl-9 pr-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/50 shadow-sm"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value)
                                setIsSearching(true)
                            }}
                            onFocus={() => setIsSearching(true)}
                        />
                        {isLoadingMaster && (
                            <RefreshCw size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
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
                <div className="flex-1 w-[45%] flex flex-col border-r border-border overflow-hidden bg-background shrink-0 min-w-[350px] relative [&>div.overflow-auto]:overflow-x-hidden">
                    <DragDropContext onDragEnd={onDragEnd}>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-auto pl-10">종목명</TableHead>
                                    <TableHead className="text-right w-[85px] px-2">현재가</TableHead>
                                    <TableHead className="text-right w-[80px] px-2">등락률</TableHead>
                                    <TableHead className="w-8 px-1"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <Droppable
                                droppableId="watchlist"
                                isDropDisabled={!!searchQuery || selectedTags.length > 0}
                            >
                                {(provided) => (
                                    <TableBody {...provided.droppableProps} ref={provided.innerRef}>
                                        {displayedWatchlist.map((stock, index) => {
                                            const numericCode = stock.code.replace(/[^0-9]/g, '')
                                            const sum19 = previous19DaysSum[numericCode]
                                            let isDepressed = false
                                            if (sum19 !== undefined && sum19 > 0) {
                                                const ma20 = (sum19 + stock.price) / 20
                                                if ((stock.price / ma20) * 100 < 95) {
                                                    isDepressed = true
                                                }
                                            }

                                            return (
                                                <Draggable
                                                    key={stock.code}
                                                    draggableId={stock.code}
                                                    index={index}
                                                    isDragDisabled={!!searchQuery || selectedTags.length > 0}
                                                >
                                                    {(provided, snapshot) => (
                                                        <TableRow
                                                            ref={provided.innerRef}
                                                            {...provided.draggableProps}
                                                            className={cn(
                                                                "hover:bg-muted/40 transition-colors cursor-pointer group",
                                                                selectedStock?.code === stock.code && "bg-primary/5",
                                                                snapshot.isDragging && "bg-muted shadow-2xl z-50 opacity-90 border-y border-primary/20"
                                                            )}
                                                            onClick={() => setSelectedStock({ code: stock.code, name: stock.name })}
                                                        >
                                                            <TableCell className="relative">
                                                                <div className="flex items-center gap-2">
                                                                    <div
                                                                        {...provided.dragHandleProps}
                                                                        className="p-1 -ml-2 rounded hover:bg-muted-foreground/10 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors cursor-grab active:cursor-grabbing"
                                                                    >
                                                                        <GripVertical size={14} />
                                                                    </div>
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className={cn("font-bold text-[13px] leading-none", selectedStock?.code === stock.code ? "text-primary" : "group-hover:text-primary")}>{stock.name}</span>
                                                                            {isDepressed && <span className="text-[10px] font-bold bg-[#a855f7] text-white px-1 py-0.5 rounded shadow-sm leading-none">침체</span>}
                                                                        </div>
                                                                        <span className="text-[10px] text-muted-foreground font-mono leading-none">{stock.code}</span>
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono font-bold text-[13px] whitespace-nowrap overflow-hidden px-2">
                                                                ₩ {stock.price.toLocaleString()}
                                                            </TableCell>
                                                            <TableCell className="text-right whitespace-nowrap overflow-hidden px-2">
                                                                <div className={cn(
                                                                    "inline-flex items-center gap-1 font-bold text-[13px]",
                                                                    stock.changeRate > 0 ? "text-rise" : stock.changeRate < 0 ? "text-fall" : "text-muted-foreground"
                                                                )}>
                                                                    {stock.changeRate > 0 ? <TrendingUp size={14} /> : stock.changeRate < 0 ? <TrendingDown size={14} /> : null}
                                                                    <ProfitText value={stock.changeRate} suffix="%" colorful={false} />
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-right px-1">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); removeStock(stock.code) }}
                                                                    className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                </Draggable>
                                            )
                                        })}
                                        {provided.placeholder}
                                        {displayedWatchlist.length === 0 && !isLoadingData && (
                                            <TableRow>
                                                <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                                                    {watchlist.length === 0 ? "등록된 관심종목이 없습니다." : "선택한 태그에 해당하는 종목이 없습니다."}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                )}
                            </Droppable>
                        </Table>
                    </DragDropContext>
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
                            <button
                                onClick={() => setActiveInfoTab('notes')}
                                className={cn(
                                    "text-[13px] font-bold pb-3 -mb-[1.5px] transition-all",
                                    activeInfoTab === 'notes' ? "text-primary border-b-[3px] border-primary" : "text-muted-foreground/60 hover:text-foreground"
                                )}
                            >
                                노트
                            </button>
                            <button
                                onClick={() => setActiveInfoTab('schedules')}
                                className={cn(
                                    "text-[13px] font-bold pb-3 -mb-[1.5px] transition-all flex items-center gap-1.5",
                                    activeInfoTab === 'schedules' ? "text-primary border-b-[3px] border-primary" : "text-muted-foreground/60 hover:text-foreground"
                                )}
                            >
                                DART
                            </button>
                            <button
                                onClick={() => setActiveInfoTab('financials')}
                                className={cn(
                                    "text-[13px] font-bold pb-3 -mb-[1.5px] transition-all flex items-center gap-1.5",
                                    activeInfoTab === 'financials' ? "text-primary border-b-[3px] border-primary" : "text-muted-foreground/60 hover:text-foreground"
                                )}
                            >
                                재무
                            </button>
                            <button className="text-[13px] font-bold text-muted-foreground/60 hover:text-foreground pb-3 -mb-[1.5px] transition-colors">예비</button>
                        </div>
                        <div className="flex-1 flex flex-col p-4 bg-muted/10 relative">
                            {activeInfoTab === 'notes' && <StockNotes stockCode={selectedStock?.code || ''} stockName={selectedStock?.name || ''} />}
                            {activeInfoTab === 'schedules' && <StockSchedules stockCode={selectedStock?.code || ''} stockName={selectedStock?.name || ''} />}
                            {activeInfoTab === 'financials' && <StockFinancials stockCode={selectedStock?.code || ''} stockName={selectedStock?.name || ''} />}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
