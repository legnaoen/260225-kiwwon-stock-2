import React, { useState, useEffect, useRef } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { cn, parseNumber } from '../utils'
import { useAccountStore } from '../store/useAccountStore'
import { useLayoutStore } from '../store/useLayoutStore'
import { StockChart } from './StockChart'

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
    const [data, setData] = useState<{ holdings: Stock[], summary: Summary }>({
        holdings: [],
        summary: { totalPurchase: 0, totalEvaluation: 0, totalProfit: 0, profitRate: 0, deposit: 0 }
    })
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [selectedStock, setSelectedStock] = useState<{ code: string, name: string } | null>(null)
    const [debugData, setDebugData] = useState<any>(null)
    const [showDebug, setShowDebug] = useState(false)

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

    const fetchData = async (accountNo: string) => {
        if (!accountNo || !window.electronAPI?.getHoldings) return
        setIsLoading(true)
        setError(null)
        try {
            console.log('Holdings: Fetching data for account:', accountNo)
            const hResult = await window.electronAPI.getHoldings({ accountNo })
            // kt00016 provides deposit (entr_to) and other summary metrics
            const dResult = await window.electronAPI.getDeposit({ accountNo })

            setDebugData(prev => ({ ...prev, holdings: hResult.data, deposit: dResult.data }))

            if (hResult.success && dResult.success) {
                console.log('Holdings Result:', hResult.data);
                console.log('Deposit Result:', dResult.data);

                const hBody = hResult.data?.Body || hResult.data
                const dBody = dResult.data?.Body || dResult.data

                // Use the key from the Python reference for holdings list
                const listData = hBody.acnt_evlt_remn_indv_tot || hBody.output1 || hBody.list || hBody.grid || []
                const list = Array.isArray(listData) ? listData : [listData].filter(Boolean)

                // Pick the most recent record from kt00016 for current deposit
                const dList = dBody.daily_acnt_prft_tot || dBody.list || dBody.output1 || []
                const dRecord = Array.isArray(dList) && dList.length > 0 ? dList[dList.length - 1] : dBody

                const deposit = parseNumber(dRecord?.entr_to || dBody?.entr_to || dBody?.d2_entra || 0)

                const holdings = list.map((item: any) => ({
                    code: item.stk_cd || item.pdno || '',
                    name: item.stk_nm || item.prdt_nm || '',
                    price: parseNumber(item.cur_prc || item.prpr || 0),
                    qty: parseNumber(item.rmnd_qty || item.hldg_qty || 0),
                    value: parseNumber(item.evlt_amt || item.evlt_pric || 0),
                    profit: String(item.prft_rt || item.evlt_erng_rt || '0'),
                    avgPrice: parseNumber(item.pchs_avg_pric || 0)
                }))

                setData({
                    holdings,
                    summary: {
                        totalPurchase: parseNumber(hBody.tot_pur_amt || hBody.pchs_amt_tot || 0),
                        totalEvaluation: parseNumber(hBody.tot_evlt_amt || hBody.tot_evl_amt || hBody.evlt_amt_tot || 0),
                        totalProfit: parseNumber(hBody.tot_evlt_pl || hBody.evlt_erng_amt_tot || 0),
                        profitRate: parseNumber(hBody.tot_prft_rt || hBody.evlt_erng_rt_tot || 0),
                        deposit
                    }
                })

                if (holdings.length > 0 && !selectedStock) {
                    setSelectedStock({ code: holdings[0].code, name: holdings[0].name })
                }

                // Register for real-time
                const symbols = holdings.map((h: any) => h.code).filter((c: any) => !!c)
                if (symbols.length > 0) {
                    window.electronAPI.wsRegister(symbols)
                }
            } else {
                const hError = hResult.error?.message || JSON.stringify(hResult.error) || '보유종목 조회 실패'
                const dError = dResult.error?.message || JSON.stringify(dResult.error) || '예수금 조회 실패'
                setError(`${hError} / ${dError}`)
            }
        } catch (err: any) {
            console.error('FetchData error:', err)
            setError('데이터를 가져오는 중 오류가 발생했습니다: ' + err.message)
        } finally {
            setIsLoading(false)
        }
    }

    // Real-time listener
    useEffect(() => {
        const cleanup = window.electronAPI.onRealTimeData((wsData: any) => {
            if (wsData.stk_cd) {
                setData(prev => {
                    const newHoldings = prev.holdings.map(item => {
                        if (item.code === wsData.stk_cd) {
                            const newPrice = wsData.cur_prc ? Math.abs(Number(wsData.cur_prc)) : item.price
                            const newValue = newPrice * item.qty
                            let newProfit = item.profit
                            if (item.avgPrice > 0) {
                                const rate = ((newPrice - item.avgPrice) / item.avgPrice) * 100
                                newProfit = (rate >= 0 ? '+' : '') + rate.toFixed(2)
                            }
                            return { ...item, price: newPrice, value: newValue, profit: newProfit }
                        }
                        return item
                    })
                    const totalEval = newHoldings.reduce((sum, h) => sum + h.value, 0)
                    const totalProfit = totalEval - prev.summary.totalPurchase
                    const totalRate = prev.summary.totalPurchase > 0 ? (totalProfit / prev.summary.totalPurchase) * 100 : 0
                    return {
                        ...prev,
                        holdings: newHoldings,
                        summary: {
                            ...prev.summary,
                            totalEvaluation: totalEval,
                            totalProfit: totalProfit,
                            profitRate: Number(totalRate.toFixed(2))
                        }
                    }
                })
            }
        })

        return () => {
            cleanup()
        }
    }, [])

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

    // React to global account changes
    useEffect(() => {
        if (selectedAccount) {
            console.log('Holdings: Account changed/initialized to:', selectedAccount)
            fetchData(selectedAccount)
        }
    }, [selectedAccount])

    return (
        <div className="flex-1 flex flex-col animate-in bg-muted/20 fade-in slide-in-from-bottom-4 duration-500 overflow-hidden h-full min-h-0">
            {/* Header & Summary Section */}
            <div className="flex flex-col shrink-0 p-4 pb-4">
                <div className="flex items-center gap-4 text-sm relative">
                    {isLoading && (
                        <div className="absolute -left-4 flex items-center">
                            <RefreshCw size={14} className="animate-spin text-primary" />
                        </div>
                    )}

                    {/* 계좌 정보 등의 요약 카드화 */}
                    <div className="bg-background border border-border rounded-xl px-5 py-4 flex flex-col gap-2 min-w-[200px] shadow-sm">
                        <span className="text-muted-foreground text-xs font-medium">평가금액</span>
                        <span className="text-lg font-bold">₩ {data.summary.totalEvaluation.toLocaleString()}</span>
                    </div>

                    <div className="bg-background border border-border rounded-xl px-5 py-4 flex flex-col gap-2 min-w-[200px] shadow-sm">
                        <span className="text-muted-foreground text-xs font-medium">평가손익</span>
                        <div className="flex items-center gap-2">
                            <span className={cn("text-lg font-bold", data.summary.totalProfit >= 0 ? "text-rise" : "text-fall")}>
                                {data.summary.totalProfit >= 0 ? '+' : ''}₩ {data.summary.totalProfit.toLocaleString()}
                            </span>
                            <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded", data.summary.profitRate >= 0 ? "bg-rise/10 text-rise" : "bg-fall/10 text-fall")}>
                                {data.summary.profitRate >= 0 ? '+' : ''}{data.summary.profitRate}%
                            </span>
                        </div>
                    </div>

                    <div className="bg-background border border-border rounded-xl px-5 py-4 flex flex-col gap-2 min-w-[200px] shadow-sm">
                        <span className="text-muted-foreground text-xs font-medium">예수금</span>
                        <span className="text-lg font-bold text-primary">₩ {data.summary.deposit.toLocaleString()}</span>
                    </div>
                </div>
            </div>

            {error && (
                <div className="bg-destructive/10 text-destructive p-4 rounded-xl flex items-center gap-3 border border-destructive/20 shrink-0">
                    <AlertCircle size={18} />
                    <p className="text-sm font-medium">{error}</p>
                    <button onClick={() => fetchData(selectedAccount)} className="ml-auto text-xs underline font-bold">다시 시도</button>
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
                <div className="flex-1 w-[45%] flex flex-col border-r border-border overflow-hidden bg-background shrink-0 min-w-[350px]">
                    <div className="overflow-auto flex-1">
                        <table className="w-full text-left text-sm border-collapse">
                            <thead className="bg-muted/30 border-b border-border sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3 font-semibold text-xs text-muted-foreground">종목명</th>
                                    <th className="px-4 py-3 font-semibold text-xs text-muted-foreground text-right w-[100px]">현재가</th>
                                    <th className="px-4 py-3 font-semibold text-xs text-muted-foreground text-right w-[80px]">수량</th>
                                    <th className="px-4 py-3 font-semibold text-xs text-muted-foreground text-right w-[100px]">평가금액</th>
                                    <th className="px-4 py-3 font-semibold text-xs text-muted-foreground text-right w-[80px]">수익률</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {data.holdings.map((stock) => (
                                    <tr
                                        key={stock.code}
                                        className={cn(
                                            "hover:bg-muted/40 transition-colors cursor-pointer group",
                                            selectedStock?.code === stock.code && "bg-primary/5"
                                        )}
                                        onClick={() => setSelectedStock({ code: stock.code, name: stock.name })}
                                    >
                                        <td className="px-4 py-2.5">
                                            <div className="flex flex-col">
                                                <span className={cn("font-bold text-[13px]", selectedStock?.code === stock.code ? "text-primary" : "group-hover:text-primary")}>{stock.name}</span>
                                                <span className="text-[10px] text-muted-foreground font-mono">{stock.code}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-[13px]">₩ {stock.price.toLocaleString()}</td>
                                        <td className="px-4 py-2.5 text-right text-muted-foreground text-[13px]">{stock.qty.toLocaleString()}</td>
                                        <td className="px-4 py-2.5 text-right font-medium text-[13px]">₩ {stock.value.toLocaleString()}</td>
                                        <td className={cn("px-4 py-2.5 text-right font-bold text-[13px]", stock.profit.startsWith('+') ? "text-rise" : "text-fall")}>
                                            {stock.profit}%
                                        </td>
                                    </tr>
                                ))}
                                {data.holdings.length === 0 && !isLoading && (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">보유 종목이 없습니다.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
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
                            <div className="absolute top-4 right-4">
                                <button className="bg-blue-500 hover:bg-blue-600 text-white text-[13px] font-bold px-4 py-1.5 rounded-md shadow-sm transition-colors">
                                    + 노트 추가
                                </button>
                            </div>
                            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/70 text-[13px] min-h-[150px]">
                                <p>아직 노트가 없습니다.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
