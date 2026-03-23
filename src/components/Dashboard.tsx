import React, { useState, useEffect } from 'react'
import { ProfitBadge, ProfitText } from './ui/ProfitDisplay'
import { useAccountStore } from '../store/useAccountStore'
import { parseNumber, cn } from '../utils'
import { Activity, Terminal, BrainCircuit, Globe } from 'lucide-react'

interface Summary {
    totalEvaluation: number
    totalProfit: number
    profitRate: number
    deposit: number
    holdingsCount: number
}

// Swarm Agent mock states
const AGENTS = [
    { id: '1', name: 'Master AI', status: 'thinking', role: '시장 분석' },
    { id: '2', name: 'PM Bot Alpha', status: 'idle', role: '포트폴리오 평가' },
    { id: '3', name: 'Execution Bot', status: 'executing', role: '주문 워커' },
]

export default function Dashboard() {
    const { selectedAccount } = useAccountStore()

    const [summary, setSummary] = useState<Summary>({
        totalEvaluation: 0,
        totalProfit: 0,
        profitRate: 0,
        deposit: 0,
        holdingsCount: 0
    })

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
            if (selectedAccount) fetchData(selectedAccount)
        }
        window.addEventListener('kiwoom:refresh-data', handleRefresh)
        return () => window.removeEventListener('kiwoom:refresh-data', handleRefresh)
    }, [selectedAccount])

    useEffect(() => {
        if (selectedAccount) {
            fetchData(selectedAccount)
            const intervalId = setInterval(() => {
                fetchData(selectedAccount)
            }, 10000)
            return () => clearInterval(intervalId)
        }
    }, [selectedAccount])

    const totalAssets = summary.totalEvaluation + summary.deposit

    return (
        <div className="flex-1 flex flex-col bg-background h-full overflow-hidden">
            
            {/* Header / Title Area */}
            <div className="px-8 py-6 border-b flex items-center justify-between shrink-0">
                <div className="flex flex-col gap-1">
                    <h1 className="text-2xl font-bold tracking-tight">Command Center</h1>
                    <span className="text-sm text-muted-foreground">Kiwoom System V2 Dashboard</span>
                </div>
                {/* Global Status */}
                <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-full border">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm font-medium">System Online</span>
                </div>
            </div>

            {/* Top Asset Bar (Divider Based) */}
            <div className="border-b bg-muted/10 w-full overflow-x-auto scrollbar-hide shrink-0">
                <div className="px-8 py-4 flex flex-row items-center justify-between gap-8 min-w-max">
                    <div className="flex flex-col gap-1 shrink-0">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Assets</span>
                        <span className="text-xl tabular-nums tracking-tight font-bold">₩ {totalAssets.toLocaleString()}</span>
                    </div>
                    <div className="w-px h-10 bg-border shrink-0" />
                    <div className="flex flex-col gap-1 shrink-0">
                        <span className="text-xs font-medium text-muted-foreground">예평금액</span>
                        <span className="text-base tabular-nums font-semibold">₩ {summary.totalEvaluation.toLocaleString()}</span>
                    </div>
                    <div className="w-px h-10 bg-border shrink-0" />
                    <div className="flex flex-col gap-1 shrink-0">
                        <span className="text-xs font-medium text-muted-foreground">D+2 예수금</span>
                        <span className="text-base tabular-nums font-semibold text-primary">₩ {summary.deposit.toLocaleString()}</span>
                    </div>
                    <div className="w-px h-10 bg-border shrink-0" />
                    <div className="flex flex-col gap-1 shrink-0">
                        <span className="text-xs font-medium text-muted-foreground">보유 종목수</span>
                        <span className="text-base tabular-nums font-semibold">{summary.holdingsCount}</span>
                    </div>
                    <div className="w-px h-10 bg-border shrink-0" />
                    <div className="flex flex-col gap-1 shrink-0">
                        <span className="text-xs font-medium text-muted-foreground">총 수익률</span>
                        <div className="flex items-center gap-2">
                            <ProfitText value={summary.totalProfit} prefix="₩ " className="text-base data-mono" />
                            <ProfitBadge value={summary.profitRate} suffix="%" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Area (Divider Splitted Grid) */}
            <div className="flex-1 flex flex-col md:flex-row min-h-0">
                
                {/* Left Area: Macro & Terminal (75%) */}
                <div className="flex-1 flex flex-col border-r min-w-0">
                    
                    {/* Macro Ecosystem Section */}
                    <div className="flex-1 flex flex-col relative overflow-hidden group">
                        <div className="px-6 py-4 border-b flex items-center gap-2 font-medium text-sm text-foreground bg-muted/5">
                            <Globe size={16} className="text-muted-foreground" />
                            Macro Ecosystem <span className="text-xs text-muted-foreground font-normal ml-auto">V2 Phase 1</span>
                        </div>
                        <div className="p-6 flex-1 flex flex-col items-center justify-center bg-muted/10">
                            <h3 className="text-lg font-bold text-muted-foreground/60 mb-2 font-mono tracking-wider">WAITING_FOR_DATA_STREAM</h3>
                            <p className="text-sm text-muted-foreground/50">MaiisMacroService connection pending...</p>
                        </div>
                    </div>

                    {/* Terminal Event Stream Section */}
                    <div className="h-64 flex flex-col border-t">
                        <div className="px-6 py-3 flex items-center border-b justify-between bg-muted/5">
                            <div className="flex items-center gap-2">
                                <Terminal size={14} className="text-muted-foreground" />
                                <span className="text-sm font-semibold text-foreground">Event Bus Stream</span>
                            </div>
                        </div>
                        <div className="p-6 font-mono text-sm flex-1 bg-black/5 dark:bg-black/30 text-foreground/80 overflow-y-auto space-y-2">
                            <div className="flex gap-4"><span className="text-muted-foreground/60 w-28 shrink-0">[10:05:22.012]</span><span>[Master AI] Context built from pre-market themes...</span></div>
                            <div className="flex gap-4"><span className="text-muted-foreground/60 w-28 shrink-0">[10:05:22.450]</span><span className="text-purple-600 dark:text-purple-400">Thinking: Running portfolio evaluation against new thesis...</span></div>
                            <div className="flex gap-4"><span className="text-muted-foreground/60 w-28 shrink-0">[10:05:23.100]</span><span className="text-blue-600 dark:text-blue-400 font-medium">Execution: Target order generated. Awaiting user approval.</span></div>
                            <div className="flex gap-4 opacity-50"><span className="text-muted-foreground/60 w-28 shrink-0">[{new Date().toISOString().substring(11,23)}]</span><span>Waiting for tick stream... </span></div>
                        </div>
                    </div>
                </div>

                {/* Right Area: Agent Swarm (25%) */}
                <div className="flex flex-col w-80 bg-card shrink-0">
                    <div className="px-6 py-4 border-b flex items-center justify-between text-sm font-medium w-full bg-muted/5">
                        <span className="flex items-center gap-2">
                            <BrainCircuit size={16} className="text-muted-foreground" />
                            Agent Swarm Status
                        </span>
                    </div>
                    <div className="p-6 flex-1 overflow-y-auto scrollbar-hide space-y-4 bg-muted/5">
                        {AGENTS.map(agent => (
                            <div key={agent.id} className="flex flex-col gap-2 p-4 rounded-lg border bg-background shadow-sm">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-semibold">{agent.name}</span>
                                    <span className={cn(
                                        "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full tracking-wider",
                                        agent.status === 'thinking' && "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
                                        agent.status === 'executing' && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                                        agent.status === 'idle' && "bg-muted text-muted-foreground"
                                    )}>
                                        {agent.status}
                                    </span>
                                </div>
                                <span className="text-xs text-muted-foreground">{agent.role}</span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    )
}
