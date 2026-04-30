import React, { useState, useEffect, useRef } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { cn, parseNumber } from '../utils'
import { useAccountStore } from '../store/useAccountStore'
import { useLayoutStore } from '../store/useLayoutStore'
import { useSignalStore } from '../store/useSignalStore'
import { useBackgroundSignalFetcher } from '../hooks/useBackgroundSignalFetcher'
import { StockChart } from './StockChart'
import { StockNotes } from './StockNotes'
import { StockSchedules } from './StockSchedules'
import { StockFinancials } from './StockFinancials'
import { StockAiReport } from './StockAiReport'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/Table'
import { Card, CardContent } from './ui/Card'
import { ProfitBadge, ProfitText } from './ui/ProfitDisplay'
import { useHoldingHistoryStore } from '../store/useHoldingHistoryStore'
import { Calendar } from 'lucide-react'
import { useMarketStore } from '../store/useMarketStore'

interface Stock {
    code: string
    name: string
    price: number
    qty: number
    value: number
    profit: string
    avgPrice: number
}

interface Summary {
    totalPurchase: number
    totalEvaluation: number
    totalProfit: number
    profitRate: number
    deposit: number
}

export default function Holdings() {
    const { selectedAccount, setSelectedAccount, accountList, setAccountList } = useAccountStore()
    const { previous19DaysSum } = useSignalStore()
    const { enqueueSymbols } = useBackgroundSignalFetcher()

    const [data, setData] = useState<{ holdings: Stock[], summary: Summary }>({
        holdings: [],
        summary: { totalPurchase: 0, totalEvaluation: 0, totalProfit: 0, profitRate: 0, deposit: 0 }
    })
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [selectedStock, setSelectedStock] = useState<{ code: string, name: string } | null>(null)
    const [activeInfoTab, setActiveInfoTab] = useState<'report' | 'notes' | 'schedules' | 'financials'>('notes')
    const [debugData, setDebugData] = useState<any>(null)
    const [showDebug, setShowDebug] = useState(false)

    const { chartHeight, setChartHeight } = useLayoutStore()
    const { history, fetchHistory } = useHoldingHistoryStore()
    const { tradingDays } = useMarketStore()
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

    const fetchData = async (accountNo: string, showLoading = true) => {
        if (!accountNo || !window.electronAPI?.getHoldings) return
        if (showLoading) setIsLoading(true)
        setError(null)
        try {
            console.log('Holdings: Fetching data for account:', accountNo)
            // kt00018 하나로 보유종목 + 예수금(prsm_dpst_aset_amt) 모두 처리
            const hResult = await window.electronAPI.getHoldings({ accountNo })

            setDebugData((prev: any) => ({ ...prev, holdings: hResult.data }))

            if (hResult.success) {
                console.log('Holdings Result:', hResult.data);

                let hData = hResult.data || hResult;
                if (typeof hData === 'string') try { hData = JSON.parse(hData); } catch (e) { }

                const hBody = hData?.Body || hData

                // 보유 종목 리스트
                const listData = hBody?.acnt_evlt_remn_indv_tot || hBody?.output1 || hBody?.list || hBody?.grid || []
                const list = Array.isArray(listData) ? listData : [listData].filter(Boolean)

                // 개별 종목 파싱
                const holdings = list.map((item: any) => ({
                    code: item.stk_cd || item.pdno || '',
                    name: item.stk_nm || item.prdt_nm || '',
                    price: parseNumber(item.cur_prc || item.prpr || 0),
                    qty: parseNumber(item.rmnd_qty || item.hldg_qty || 0),
                    value: parseNumber(item.evlt_amt || item.evlt_pric || 0),
                    profit: String(item.prft_rt || item.evlt_erng_rt || '0'),
                    avgPrice: parseNumber(item.pchs_avg_pric || 0)
                }))

                // 총 평가금액: kt00018 body의 tot_evlt_amt 우선, 없으면 개별 합산 폴백
                const apiTotalEval = parseNumber(hBody?.tot_evlt_amt || hBody?.tot_evl_amt || 0)
                const totalEvaluation = apiTotalEval > 0
                    ? apiTotalEval
                    : holdings.reduce((sum, h) => sum + h.value, 0)

                // D+2 예수금: kt00018 body의 prsm_dpst_aset_amt (추정 예수금 자산)
                const deposit = parseNumber(
                    hBody?.prsm_dpst_aset_amt || 0
                )

                setData({
                    holdings,
                    summary: {
                        totalPurchase: parseNumber(hBody?.tot_pur_amt || hBody?.pchs_amt_tot || 0),
                        totalEvaluation,
                        totalProfit: parseNumber(hBody?.tot_evlt_pl || hBody?.evlt_erng_amt_tot || 0),
                        profitRate: parseNumber(hBody?.tot_prft_rt || hBody?.evlt_erng_rt_tot || 0),
                        deposit
                    }
                })

                // Removed raw holdings[0] auto-selection to defer it to the sorted list useEffect

                // Enqueue for background signal check
                const symbols = holdings.map((h: any) => h.code).filter((c: any) => !!c)
                if (symbols.length > 0) {
                    enqueueSymbols(symbols)
                }

                // Fetch updated history from DB after backend syncs it in getHoldings IPC
                fetchHistory();
            } else {
                const hError = hResult.error?.message || JSON.stringify(hResult.error) || '보유종목 조회 실패'
                setError(`${hError}`)
            }
        } catch (err: any) {
            console.error('FetchData error:', err)
            setError('데이터를 가져오는 중 오류가 발생했습니다: ' + err.message)
        } finally {
            if (showLoading) setIsLoading(false)
        }
    }

    // WebSocket subscription management (Depends on symbol list string, NOT full array)
    useEffect(() => {
        const symbols = data.holdings.map((h: any) => h.code).filter((c: any) => !!c)
        if (symbols.length > 0 && window.electronAPI?.wsRegister) {
            window.electronAPI.wsRegister(symbols)
        }

        return () => {
            if (symbols.length > 0 && window.electronAPI?.wsUnregister) {
                window.electronAPI.wsUnregister(symbols)
            }
        }
    }, [data.holdings.map((h: any) => h.code).join(',')])

    // Real-time listener (Depends on nothing, runs once)
    useEffect(() => {
        const cleanup = window.electronAPI.onRealTimeData((wsData: any) => {
            if (wsData.stk_cd) {
                setData(prev => {
                    let hasChanged = false
                    const newHoldings = prev.holdings.map(item => {
                        const itemNumericCode = item.code.replace(/[^0-9]/g, '')
                        const wsNumericCode = wsData.stk_cd.replace(/[^0-9]/g, '')

                        if (itemNumericCode === wsNumericCode) {
                            const newPrice = wsData.cur_prc ? Math.abs(Number(wsData.cur_prc)) : item.price
                            if (newPrice !== item.price) {
                                hasChanged = true
                                return { ...item, price: newPrice }
                            }
                        }
                        return item
                    })

                    if (!hasChanged) return prev
                    return { ...prev, holdings: newHoldings }
                })
            }
        })

        return () => {
            cleanup()
        }
    }, [])

    useEffect(() => {
        fetchHistory();
    }, []);

    // Auto-select top stock based on UI sorting logic
    useEffect(() => {
        if (data.holdings.length === 0) {
            if (selectedStock) setSelectedStock(null);
            return;
        }

        const exists = selectedStock ? data.holdings.some(h => h.code === selectedStock.code) : false;
        if (exists) return; // Only auto-select if no valid stock is currently selected

        const groups: Record<string, Stock[]> = {}
        data.holdings.forEach(stock => {
            const cleanCode = stock.code.replace(/^A/i, '').trim();
            let date = history[cleanCode] || '알 수 없음'
            if (stock.name.includes('(폐)')) {
                date = '상장폐지 / 거래정지'
            }
            if (!groups[date]) groups[date] = []
            groups[date].push(stock)
        })

        const sortedDates = Object.keys(groups).sort((a, b) => {
            if (a === '상장폐지 / 거래정지') return 1;
            if (b === '상장폐지 / 거래정지') return -1;
            if (a === '알 수 없음' && b !== '알 수 없음') return 1;
            if (b === '알 수 없음' && a !== '알 수 없음') return -1;
            return b.localeCompare(a)
        })

        if (sortedDates.length > 0) {
            const topGroup = groups[sortedDates[0]]
            if (topGroup && topGroup.length > 0) {
                const topStock = topGroup[0];
                setSelectedStock({ code: topStock.code, name: topStock.name });
            }
        }
    }, [data.holdings, history, selectedStock]);

    // React to manual refresh events via window event listener,
    // ensuring we ALWAYS use the latest selectedAccount from the store context.
    useEffect(() => {
        const handleRefresh = () => {
            if (selectedAccount) {
                console.log('Holdings: Manual refresh triggered for:', selectedAccount)
                fetchData(selectedAccount)
            }
        }
        window.addEventListener('kiwoom:refresh-data', handleRefresh)
        return () => window.removeEventListener('kiwoom:refresh-data', handleRefresh)
    }, [selectedAccount])

    // React to global account changes and setup robust background polling
    useEffect(() => {
        if (selectedAccount) {
            console.log('Holdings: Account selected. Fetching exact kt00018 data...')
            fetchData(selectedAccount, true)

            // 10-second automatic polling timer
            const intervalId = setInterval(() => {
                // Fetch exact evaluations and profits SILENTLY in the background
                fetchData(selectedAccount, false)
            }, 10000)

            // Clean up the timer immediately if user leaves Holdings screen or changes account
            return () => clearInterval(intervalId)
        }
    }, [selectedAccount])

    return (
        <div className="flex-1 flex flex-col animate-in bg-background fade-in slide-in-from-bottom-4 duration-500 overflow-hidden h-full min-h-0">
            {/* Header Area */}
            <div className="px-8 py-6 border-b flex items-center justify-between shrink-0 bg-background">
                <div className="flex flex-col gap-1 relative">
                    {isLoading && (
                        <div className="absolute -left-6 top-1/2 -translate-y-1/2 flex items-center">
                            <RefreshCw size={14} className="animate-spin text-muted-foreground/50" />
                        </div>
                    )}
                    <h1 className="text-2xl font-bold tracking-tight">Portfolio Holdings</h1>
                    <span className="text-sm text-muted-foreground">실시간 보유 종목 및 평가 수익 현황</span>
                </div>
            </div>

            {/* Top Asset Bar (Divider Based) */}
            <div className="border-b bg-muted/10 w-full overflow-x-auto scrollbar-hide shrink-0">
                <div className="px-8 py-4 flex flex-row items-center justify-start gap-8 min-w-max">
                    <div className="flex flex-col gap-1 shrink-0">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">평가금액</span>
                        <span className="text-xl tabular-nums tracking-tight font-bold">₩ {data.summary.totalEvaluation.toLocaleString()}</span>
                    </div>
                    <div className="w-px h-10 bg-border shrink-0" />
                    <div className="flex flex-col gap-1 shrink-0">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">예수금</span>
                        <span className="text-xl tabular-nums tracking-tight font-bold text-primary">₩ {data.summary.deposit.toLocaleString()}</span>
                    </div>
                    <div className="w-px h-10 bg-border shrink-0" />
                    <div className="flex flex-col gap-1 shrink-0">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">평가손익</span>
                        <div className="flex items-center gap-2">
                            <ProfitText value={data.summary.totalProfit} prefix="₩ " className="text-xl data-mono tracking-tight font-bold" />
                            <ProfitBadge value={data.summary.profitRate} suffix="%" />
                        </div>
                    </div>
                </div>
            </div>

            {error && (
                <div className="bg-destructive/5 text-destructive font-medium px-8 py-3 border-b border-destructive/20 flex items-center gap-3 shrink-0 text-sm">
                    <AlertCircle size={16} />
                    <p>{error}</p>
                    <button onClick={() => fetchData(selectedAccount)} className="ml-auto underline font-bold opacity-80 hover:opacity-100 transition-opacity">다시 시도</button>
                </div>
            )}

            {showDebug && (
                <div className="bg-black/80 text-green-400 p-4 rounded-xl border border-green-500/30 font-mono text-[10px] overflow-auto max-h-60 whitespace-pre shrink-0">
                    {JSON.stringify(debugData, null, 2)}
                </div>
            )}

            {/* Split Layout */}
            <div className="flex-1 min-h-0 flex bg-background border-t border-border overflow-hidden">
                {/* Left side: Holdings List */}
                <div className="flex-1 w-[45%] flex flex-col border-r border-border overflow-hidden bg-background shrink-0 min-w-[350px] [&>div.overflow-auto]:overflow-x-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-auto px-2">종목명</TableHead>
                                <TableHead className="text-right w-[75px] px-2">현재가</TableHead>
                                <TableHead className="text-right w-[45px] px-2">수량</TableHead>
                                <TableHead className="text-right w-[85px] px-2">평가금액</TableHead>
                                <TableHead className="text-right w-[60px] px-2">수익률</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {(() => {
                                // Group holdings by date
                                const groups: Record<string, Stock[]> = {}
                                data.holdings.forEach(stock => {
                                    const cleanCode = stock.code.replace(/^A/i, '').trim();
                                    let date = history[cleanCode] || '알 수 없음'
                                    
                                    // 상장폐지/정지 종목 분리
                                    if (stock.name.includes('(폐)')) {
                                        date = '상장폐지 / 거래정지'
                                    }

                                    if (!groups[date]) groups[date] = []
                                    groups[date].push(stock)
                                })

                                // Sort dates in descending order (newest first)
                                const sortedDates = Object.keys(groups).sort((a, b) => {
                                    if (a === '상장폐지 / 거래정지') return 1;
                                    if (b === '상장폐지 / 거래정지') return -1;
                                    if (a === '알 수 없음' && b !== '알 수 없음') return 1;
                                    if (b === '알 수 없음' && a !== '알 수 없음') return -1;
                                    return b.localeCompare(a)
                                })

                                if (data.holdings.length === 0 && !isLoading) {
                                    return (
                                        <TableRow>
                                            <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">보유 종목이 없습니다.</TableCell>
                                        </TableRow>
                                    )
                                }

                                return sortedDates.map(date => {
                                    // Calculate trading days difference (+N일)
                                    let diff = -1;
                                    let diffTag = '';
                                    if (tradingDays && tradingDays.length > 0 && date !== '알 수 없음' && date !== '상장폐지 / 거래정지') {
                                        const startIndex = tradingDays.indexOf(date);
                                        const todayStr = new Date().toLocaleDateString('sv-SE');
                                        let todayIndex = tradingDays.indexOf(todayStr);

                                        // 만약 오늘 날짜가 리스트에 없다면 가장 최근 거래일을 오늘로 간주
                                        if (todayIndex === -1 && tradingDays.length > 0) {
                                            todayIndex = tradingDays.length - 1;
                                        }

                                        if (startIndex !== -1 && todayIndex !== -1) {
                                            diff = todayIndex - startIndex;
                                            // 음수 방지 (데이터 정합성 문제 대비)
                                            if (diff < 0) diff = 0;
                                            diffTag = diff === 0 ? ' (오늘)' : ` (+${diff}거래일)`;
                                        }
                                    }

                                    return (
                                        <React.Fragment key={date}>
                                            {/* Date Group Header */}
                                            <TableRow className="bg-muted/30 hover:bg-muted/30 border-y border-border/50">
                                                <TableCell colSpan={5} className="py-1.5 px-3">
                                                    <div className="flex items-center justify-between w-full">
                                                        <div className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                                                            <Calendar size={12} className="text-primary/70" />
                                                            <span>{date}</span>
                                                            <span className="text-primary font-bold">{diffTag}</span>
                                                            <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] ml-1">{groups[date].length}종목</span>
                                                        </div>
                                                        {diff === 3 && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (confirm('D+3 자동매도 로직을 즉시 실행하시겠습니까? (상한가 조건부지정가 매도)')) {
                                                                        window.electronAPI.executeD3AutoSell();
                                                                    }
                                                                }}
                                                                className="text-[10px] bg-primary/10 text-primary hover:bg-primary/20 px-2 py-0.5 rounded border border-primary/20 font-bold transition-colors"
                                                            >
                                                                D+3 수동주문 실행
                                                            </button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>

                                            {/* Grouped Stocks */}
                                            {groups[date].map((stock) => {
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
                                                    <tr
                                                        key={stock.code}
                                                        className={cn(
                                                            "hover:bg-muted/40 transition-colors cursor-pointer group",
                                                            selectedStock?.code === stock.code && "bg-primary/5"
                                                        )}
                                                        onClick={() => setSelectedStock({ code: stock.code, name: stock.name })}
                                                    >
                                                        <TableCell className="px-2">
                                                            <div className="flex flex-col gap-0.5">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className={cn("font-bold text-[13px] leading-none", selectedStock?.code === stock.code ? "text-primary" : "group-hover:text-primary")}>{stock.name}</span>
                                                                    {isDepressed && <span className="text-[10px] font-bold bg-[#a855f7] text-white px-1 py-0.5 rounded shadow-sm leading-none">침체</span>}
                                                                </div>
                                                                <span className="text-[10px] text-muted-foreground font-mono leading-none">{stock.code}</span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono font-semibold text-[13px] whitespace-nowrap overflow-hidden text-clip px-2">
                                                            ₩ {stock.price.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell className="text-right text-muted-foreground text-[13px] whitespace-nowrap overflow-hidden text-clip px-2">
                                                            {stock.qty.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-[13px] whitespace-nowrap overflow-hidden text-clip px-2">
                                                            ₩ {stock.value.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell className="text-right whitespace-nowrap overflow-hidden text-clip px-2">
                                                            <ProfitText value={stock.profit} suffix="%" className="text-[13px] font-bold" />
                                                        </TableCell>
                                                    </tr>
                                                )
                                            })}
                                        </React.Fragment>
                                    )
                                })
                            })()}
                        </TableBody>
                    </Table>
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
                            {[
                                { id: 'report', name: 'AI 리포트' },
                                { id: 'notes', name: '노트' },
                                { id: 'schedules', name: 'DART' },
                                { id: 'financials', name: '재무' }
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveInfoTab(tab.id as any)}
                                    className={cn(
                                        "text-[13px] font-bold pb-3 -mb-[1.5px] transition-all",
                                        activeInfoTab === tab.id ? "text-primary border-b-[3px] border-primary" : "text-muted-foreground/60 hover:text-foreground"
                                    )}
                                >
                                    {tab.name}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1 flex flex-col p-4 bg-muted/10 relative">
                            {activeInfoTab === 'report' && <StockAiReport symbol={selectedStock?.code || ''} name={selectedStock?.name || ''} />}
                            {activeInfoTab === 'notes' && <StockNotes stockCode={selectedStock?.code || ''} stockName={selectedStock?.name || ''} />}
                            {activeInfoTab === 'schedules' && <StockSchedules stockCode={selectedStock?.code || ''} stockName={selectedStock?.name || ''} />}
                            {activeInfoTab === 'financials' && <StockFinancials stockCode={selectedStock?.code || ''} stockName={selectedStock?.name || ''} />}
                        </div>
                    </div>
                </div>
            </div>
        </div >
    )
}
