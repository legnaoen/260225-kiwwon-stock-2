import React, { useState, useEffect } from 'react'
import { Card, CardContent } from './ui/Card'
import { ProfitBadge, ProfitText } from './ui/ProfitDisplay'
import { useAccountStore } from '../store/useAccountStore'
import { useAutoTradeStore, OrderInfo } from '../store/useAutoTradeStore'
import { useScheduleStore, ScheduleEvent } from '../store/useScheduleStore'
import { parseNumber, cn } from '../utils'
import { Activity, Play, Square } from 'lucide-react'

interface Summary {
    totalEvaluation: number
    totalProfit: number
    profitRate: number
    deposit: number
    holdingsCount: number
}

export default function Dashboard() {
    const { selectedAccount } = useAccountStore()
    const isRunning = useAutoTradeStore(state => state.isRunning)
    const setIsRunning = useAutoTradeStore(state => state.setIsRunning)
    const orders = useAutoTradeStore(state => state.orders)

    const getEventsByDate = useScheduleStore(state => state.getEventsByDate)

    // For auto-trade today stats
    const todayOrders = orders // Assuming orders are today's
    const completedOrders = todayOrders.filter(o => o.status === '체결')
    const pendingOrders = todayOrders.filter(o => o.status !== '체결' && o.status !== '거부' && o.remain_qty > 0)

    // For schedule
    const todayString = new Date().toLocaleDateString('sv-SE')
    const todayEvents = getEventsByDate(todayString)

    const [summary, setSummary] = useState<Summary>({
        totalEvaluation: 0,
        totalProfit: 0,
        profitRate: 0,
        deposit: 0,
        holdingsCount: 0
    })

    const [autoTradeSettings, setAutoTradeSettings] = useState({
        timeHours: '09',
        timeMinutes: '00',
        buyLimit: '0'
    })

    const fetchAutoTradeSettings = async () => {
        if (!window.electronAPI?.getAutoTradeSettings) return
        try {
            const saved = await window.electronAPI.getAutoTradeSettings()
            if (saved) {
                setAutoTradeSettings({
                    timeHours: saved.timeHours || '09',
                    timeMinutes: saved.timeMinutes || '00',
                    buyLimit: saved.buyLimit || '0'
                })
            }
        } catch (err) {
            console.error('Failed to fetch auto trade settings:', err)
        }
    }

    const fetchData = async (accountNo: string) => {
        if (!accountNo || !window.electronAPI?.getHoldings) return
        try {
            const hResult = await window.electronAPI.getHoldings({ accountNo })
            const dResult = await window.electronAPI.getDeposit({ accountNo })

            if (hResult.success && dResult.success) {
                let hData = hResult.data
                let dData = dResult.data
                if (typeof hData === 'string') try { hData = JSON.parse(hData) } catch (e) { }
                if (typeof dData === 'string') try { dData = JSON.parse(dData) } catch (e) { }

                const hBody = hData?.Body || hData
                const dBody = dData?.Body || dData

                const listData = hBody?.acnt_evlt_remn_indv_tot || hBody?.output1 || hBody?.list || hBody?.grid || []
                const list = Array.isArray(listData) ? listData : [listData].filter(Boolean)

                const dList = dBody?.daily_acnt_prft_tot || dBody?.list || dBody?.output1 || []
                const dRecord = Array.isArray(dList) && dList.length > 0 ? dList[dList.length - 1] : (Object.keys(dBody || {}).length > 0 ? dBody : dData)

                const deposit = parseNumber(dRecord?.entr_to || dBody?.entr_to || dBody?.d2_entra || 0)
                const totalEvaluation = parseNumber(hBody.tot_evlt_amt || hBody.tot_evl_amt || hBody.evlt_amt_tot || 0)
                const totalProfit = parseNumber(hBody.tot_evlt_pl || hBody.evlt_erng_amt_tot || 0)
                const profitRate = parseNumber(hBody.tot_prft_rt || hBody.evlt_erng_rt_tot || 0)

                setSummary({
                    totalEvaluation,
                    totalProfit,
                    profitRate,
                    deposit,
                    holdingsCount: list.length
                })
            }
        } catch (err) {
            console.error('Dashboard FetchData error:', err)
        }
    }

    useEffect(() => {
        const handleRefresh = () => {
            if (selectedAccount) {
                fetchData(selectedAccount)
            }
        }
        window.addEventListener('kiwoom:refresh-data', handleRefresh)
        return () => window.removeEventListener('kiwoom:refresh-data', handleRefresh)
    }, [selectedAccount])

    useEffect(() => {
        if (selectedAccount) {
            fetchData(selectedAccount)
            fetchAutoTradeSettings()
            const intervalId = setInterval(() => {
                fetchData(selectedAccount)
            }, 10000)
            return () => clearInterval(intervalId)
        }
    }, [selectedAccount])

    const totalAssets = summary.totalEvaluation + summary.deposit

    return (
        <div className="flex-1 flex flex-col p-6 bg-background h-full overflow-y-auto min-h-0">
            <h1 className="text-2xl font-bold mb-6 tracking-tight shrink-0">DASHBOARD</h1>

            {/* 계좌 요약 (Asset Summary) - Ticker Style */}
            <Card className="mb-6 bg-muted/20 border-border/50 shadow-sm shrink-0">
                <CardContent className="p-4 overflow-x-auto scrollbar-thin">
                    <div className="flex flex-row items-center justify-between font-mono text-sm leading-none min-w-max gap-6">
                        <div className="flex flex-col gap-1.5 items-start shrink-0">
                            <span className="text-[11px] text-muted-foreground font-sans font-medium uppercase tracking-wider">Total Assets</span>
                            <div className="flex items-baseline gap-2">
                                <span className="text-xl font-bold tracking-tight">₩ {totalAssets.toLocaleString()}</span>
                            </div>
                        </div>

                        <div className="w-px h-10 bg-border shrink-0" />

                        <div className="flex flex-col gap-1.5 items-start shrink-0">
                            <span className="text-[11px] text-muted-foreground font-sans font-medium uppercase">평가자산</span>
                            <span className="text-base font-semibold">₩ {summary.totalEvaluation.toLocaleString()}</span>
                        </div>

                        <div className="w-px h-10 bg-border shrink-0" />

                        <div className="flex flex-col gap-1.5 items-start shrink-0">
                            <span className="text-[11px] text-muted-foreground font-sans font-medium uppercase">예수금</span>
                            <span className="text-base font-semibold text-primary">₩ {summary.deposit.toLocaleString()}</span>
                        </div>

                        <div className="w-px h-10 bg-border shrink-0" />

                        <div className="flex flex-col gap-1.5 items-start shrink-0">
                            <span className="text-[11px] text-muted-foreground font-sans font-medium uppercase">손익</span>
                            <div className="flex items-center gap-1.5">
                                <ProfitText value={summary.totalProfit} prefix="₩ " className="text-base" />
                                <ProfitBadge value={summary.profitRate} suffix="%" />
                            </div>
                        </div>

                        <div className="w-px h-10 bg-border shrink-0" />

                        <div className="flex flex-col gap-1.5 items-start shrink-0">
                            <span className="text-[11px] text-muted-foreground font-sans font-medium uppercase">보유 종목</span>
                            <span className="text-base font-semibold">{summary.holdingsCount} 종목</span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Split Middle Section */}
            <div className="flex gap-6 mb-6 shrink-0 h-[220px]">
                {/* 왼쪽: 자동매매 */}
                <Card className="flex-1 bg-muted/10 border-border/50 flex flex-col">
                    <CardContent className="p-5 flex flex-col h-full relative overflow-hidden">
                        <h2 className="text-sm font-bold flex items-center gap-2 mb-4 tracking-tight">
                            <div className="w-1.5 h-4 bg-primary rounded-sm shadow-[0_0_8px_rgba(var(--primary),0.5)]"></div>
                            자동매매 (Auto-Trade)
                        </h2>

                        <div className="flex-1 flex flex-col justify-center gap-3">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-muted-foreground font-medium">상태</span>
                                <div className="flex items-center gap-2">
                                    <div className={cn(
                                        "w-2 h-2 rounded-full",
                                        isRunning ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" : "bg-muted-foreground"
                                    )} />
                                    <span className={cn("font-bold font-mono tracking-widest", isRunning ? "text-green-500" : "text-muted-foreground")}>
                                        {isRunning ? 'RUNNING' : 'STOPPED'}
                                    </span>
                                </div>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-muted-foreground font-medium">자동매수실행 시간</span>
                                <span className="font-mono font-semibold">{autoTradeSettings.timeHours}:{autoTradeSettings.timeMinutes}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-muted-foreground font-medium">종목별매수금 설정액</span>
                                <span className="font-mono font-semibold">₩ {parseInt(autoTradeSettings.buyLimit).toLocaleString()}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* 오른쪽: 오늘 일정 */}
                <Card className="flex-1 bg-muted/10 border-border/50 flex flex-col">
                    <CardContent className="p-5 flex flex-col h-full">
                        <h2 className="text-sm font-bold flex items-center gap-2 mb-4 tracking-tight">
                            <div className="w-1.5 h-4 bg-amber-500 rounded-sm shadow-[0_0_8px_rgba(245,158,11,0.5)]"></div>
                            오늘 일정 (Today's Schedule)
                        </h2>

                        <div className="flex-1 overflow-y-auto pr-2 space-y-2.5 scrollbar-thin">
                            {todayEvents.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-sm text-muted-foreground/50 font-medium">
                                    오늘 등록된 일정이 없습니다
                                </div>
                            ) : (
                                todayEvents.map((event: ScheduleEvent) => (
                                    <div key={event.id} className="flex gap-3 items-start text-[13px] bg-background/50 p-2.5 rounded-lg border border-border/40">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                                        <div className="flex flex-col gap-0.5 min-w-0">
                                            <span className="font-semibold truncate">{event.title}</span>
                                            {event.code && <span className="text-[10px] text-muted-foreground font-mono">{event.code}</span>}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* 하단 넓은 영역: AI 분석 및 시장 맥락 */}
            <Card className="flex-1 bg-muted/5 border-border/30 border-dashed flex flex-col min-h-[300px] shrink-0 relative group">
                <CardContent className="p-0 flex-1 flex flex-col items-center justify-center opacity-40 group-hover:opacity-60 transition-opacity">
                    <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                        <Activity size={24} className="text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-bold tracking-widest text-muted-foreground mb-1">AI INSIGHTS & MARKET BRIEFING</h3>
                    <p className="text-xs text-muted-foreground/60 font-medium">준비 중입니다. (Phase 2 예정)</p>
                </CardContent>
            </Card>
        </div>
    )
}
