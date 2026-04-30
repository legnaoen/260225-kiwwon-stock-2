import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Brain, X, ShieldAlert, Sparkles, Clock, Target, ArrowUpRight, ArrowDownRight, Minus, Activity, ChevronRight, Search, Settings, Trash2, Link2, Copy } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

// ── Layout persistence ──
const LAYOUT_KEY = 'market-agent-layout'
interface Layout { chartPct: number; topH: number }
const defaultLayout: Layout = { chartPct: 0.6, topH: 200 }
function loadLayout(): Layout { try { const r = localStorage.getItem(LAYOUT_KEY); return r ? JSON.parse(r) : defaultLayout } catch { return defaultLayout } }
function saveLayout(l: Layout) { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)) }

// ── Drag Handles ──
function DragH({ onDrag }: { onDrag: (dx: number) => void }) {
    const down = useCallback((e: React.MouseEvent) => {
        e.preventDefault(); let lx = e.clientX
        const mv = (ev: MouseEvent) => { onDrag(ev.clientX - lx); lx = ev.clientX }
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.body.style.cursor = '' }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); document.body.style.cursor = 'col-resize'
    }, [onDrag])
    return <div onMouseDown={down} className="w-2 shrink-0 cursor-col-resize flex items-center justify-center group hover:bg-indigo-500/10 rounded transition-colors"><div className="w-[2px] h-8 bg-border/40 group-hover:bg-indigo-500/50 rounded-full transition-colors" /></div>
}

function DragV({ onDrag }: { onDrag: (dy: number) => void }) {
    const down = useCallback((e: React.MouseEvent) => {
        e.preventDefault(); let ly = e.clientY
        const mv = (ev: MouseEvent) => { onDrag(ev.clientY - ly); ly = ev.clientY }
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.body.style.cursor = '' }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); document.body.style.cursor = 'row-resize'
    }, [onDrag])
    return <div onMouseDown={down} className="h-2 shrink-0 cursor-row-resize flex justify-center items-center group hover:bg-indigo-500/10 mx-4 rounded transition-colors"><div className="h-[2px] w-12 bg-border/40 group-hover:bg-indigo-500/50 rounded-full transition-colors" /></div>
}

import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, Area } from 'recharts'
import IntradayChart from './IntradayChart'
import { useLivePriceStore } from '../../store/useLivePriceStore'

// ── Chart ──
function PerformanceChart({ redrawKey, history }: { redrawKey: number, history: any[] }) {
    const [chartData, setChartData] = useState<any[]>([])

    useEffect(() => {
        const loadChart = async () => {
            try {
                const res = await window.electronAPI.getChartData({ stk_cd: '069500' });
                const d = res?.data || res;
                let pList = d?.stk_dt_pole_chart_qry || d?.output2 || d?.Body || d?.list || [];
                if (!Array.isArray(pList)) pList = [];
                pList = pList.slice(0, 30).reverse();

                // 1. 날짜와 가격 추출
                const mappedList = pList.map((item: any) => {
                    const dateStr = String(item.dt || item.stck_bsop_date || item.date || item.trd_dt);
                    const fmtDate = dateStr.length === 8 ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}` : dateStr;
                    const curPrice = Math.abs(Number(item.cur_prc || item.clprc || item.close || 0));
                    return { fmtDate, curPrice };
                });

                // 2. 최초 예측일 탐색 및 비교 시작점(index) 결정
                let startIndex = 0;
                if (history && history.length > 0) {
                    const historyDates = history.map(h => h.date).sort();
                    const earliestDate = historyDates[0];
                    const foundIndex = mappedList.findIndex(m => m.fmtDate >= earliestDate);
                    // 시각적 흐름(기준선 100)을 명확히 주기 위해 예측시작일 직전 거래일을 100으로 시작 (가능할 경우)
                    if (foundIndex !== -1) {
                        startIndex = Math.max(0, foundIndex - 1);
                    }
                }

                const filteredList = mappedList.slice(startIndex);
                if (filteredList.length === 0) return;

                const basePrice = filteredList[0].curPrice || 1;
                let aBase = 100;
                const formattedData: any[] = [];

                for (let i = 0; i < filteredList.length; i++) {
                    const { fmtDate, curPrice } = filteredList[i];
                    
                    const kospiValue = 100 + ((curPrice - basePrice) / basePrice) * 100;

                    const matchedHistory = history.filter(h => h.date === fmtDate);
                    let dailyReturn = 0;
                    for (const mh of matchedHistory) {
                        if (mh && mh.t1_final !== null && mh.t1_final !== undefined) {
                            dailyReturn += mh.t1_final;
                        }
                    }
                    if (dailyReturn !== 0) {
                        aBase = aBase * (1 + dailyReturn / 100);
                    }
                    
                    formattedData.push({
                        date: fmtDate.substring(5), // MM-DD
                        fullDate: fmtDate,
                        kospi: Number(kospiValue.toFixed(2)),
                        agent: Number(aBase.toFixed(2))
                    });
                }

                setChartData(formattedData);
            } catch (err) {
                console.warn('Failed to fetch KODEX 200 chart', err);
            }
        }
        loadChart();
    }, [history, redrawKey])

    if (chartData.length === 0) {
        return <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground bg-muted/5 rounded animate-pulse">Loading Chart Data...</div>
    }

    const minV = Math.floor(Math.min(...chartData.map(d => Math.min(d.kospi, d.agent))) - 1);
    const maxV = Math.ceil(Math.max(...chartData.map(d => Math.max(d.kospi, d.agent))) + 1);
    const isDark = document.documentElement.classList.contains('dark');

    return (
        <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                <defs>
                    <linearGradient id="colorAgent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isDark ? '#818cf8' : '#4f46e5'} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={isDark ? '#818cf8' : '#4f46e5'} stopOpacity={0}/>
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} />
                <XAxis dataKey="date" tick={{fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b'}} axisLine={false} tickLine={false} minTickGap={15} />
                <YAxis domain={[minV, maxV]} tick={{fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b'}} axisLine={false} tickLine={false} tickFormatter={(val) => val.toFixed(1)} />
                <RechartsTooltip 
                    contentStyle={{ backgroundColor: isDark ? '#1e293b' : '#ffffff', borderColor: isDark ? '#334155' : '#e2e8f0', borderRadius: '6px', fontSize: '11px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                    labelStyle={{ color: isDark ? '#94a3b8' : '#64748b', marginBottom: '4px' }}
                    labelFormatter={(label, items) => items[0]?.payload?.fullDate || label}
                />
                <Line type="monotone" dataKey="kospi" name="KOSPI (KODEX 200)" stroke={isDark ? '#94a3b8' : '#64748b'} strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={{r: 4}} />
                <Area type="monotone" dataKey="agent" name="Agent (누적 수익)" stroke={isDark ? '#818cf8' : '#4f46e5'} strokeWidth={2} fillOpacity={1} fill="url(#colorAgent)" activeDot={{r: 4, strokeWidth: 0}} />
            </ComposedChart>
        </ResponsiveContainer>
    )
}

// ══════════════════════════════════════════
export default function MarketAgentTab({ onNavigate }: { onNavigate?: (tabId: string, entityId?: string) => void } = {}) {
    const [selectedTrade, setSelectedTrade] = useState<any | null>(null)
    const [showKnowledgeBase, setShowKnowledgeBase] = useState(false)
    const [showSettings, setShowSettings] = useState(false)
    const [showPerformancePopup, setShowPerformancePopup] = useState(false)
    const [detailedStats, setDetailedStats] = useState<any>(null)
    const [showDigestModal, setShowDigestModal] = useState(false)
    const [digestContent, setDigestContent] = useState('')
    const [isDigestLoading, setIsDigestLoading] = useState(false)

    // 복수선택 삭제 팝업 state
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [deleteModalTarget, setDeleteModalTarget] = useState<'classic' | 'intraday'>('classic')
    const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(new Set())
    const [showMoreMenu, setShowMoreMenu] = useState(false)
    const moreMenuRef = React.useRef<HTMLDivElement>(null)

    // Settings States
    const [telegramEnabled, setTelegramEnabled] = useState(true)
    const [cciPeriod, setCciPeriod] = useState(20)
    const [cciOverboughtEnabled, setCciOverboughtEnabled] = useState(true)
    const [cciOverboughtLimit, setCciOverboughtLimit] = useState(80)
    const [cciOversoldEnabled, setCciOversoldEnabled] = useState(true)
    const [cciOversoldLimit, setCciOversoldLimit] = useState(-120)

    const saveAgentSettings = async (updates: any) => {
        await window.electronAPI.saveMarketConditionSettings({
            telegramEnabled, cciPeriod, 
            cciOverboughtEnabled, cciOverboughtLimit,
            cciOversoldEnabled, cciOversoldLimit,
            ...updates
        })
    }

    const handleFetchDigest = async () => {
        setIsDigestLoading(true)
        setShowDigestModal(true)
        try {
            const result = await window.electronAPI.getIntradayTechnicalDigest()
            setDigestContent(result)
        } catch (e: any) {
            setDigestContent('오류가 발생했습니다: ' + e.message)
        } finally {
            setIsDigestLoading(false)
        }
    }

    const handleCopyFullContext = (trade: any) => {
        let content = "=== [Source Data] ===\n"
        try {
            const srcs = JSON.parse(trade.sources_json || '[]')
            if (srcs.length > 0) {
                content += srcs.join('\n') + "\n\n"
            } else {
                content += "No source data\n\n"
            }
        } catch {
            content += "Parse error\n\n"
        }
        
        content += "=== [Main AI Rationale] ===\n"
        content += (trade.rationale || "분석 내용 없음") + "\n\n"
        
        if (trade.comments_json) {
            content += "=== [Swarm AI Comments] ===\n"
            try {
                const comments = JSON.parse(trade.comments_json)
                comments.forEach((c: any) => {
                    content += `[${c.name} / ${c.predict}] ${c.comment}\n`
                })
            } catch {
                content += "Parse error\n"
            }
            content += "\n"
        }

        const fallbackCopy = () => {
            const textArea = document.createElement("textarea");
            textArea.value = content;
            textArea.style.position = "fixed";
            textArea.style.left = "-999999px";
            textArea.style.top = "-999999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                alert('소스 데이터와 AI 분석 내용이 클립보드에 복사되었습니다.');
            } catch (err) {
                alert('보안 정책상 복사에 실패했습니다. 설정에서 권한을 확인해주세요.');
            }
            textArea.remove();
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(content).then(() => {
                alert('소스 데이터와 AI 분석 내용이 클립보드에 복사되었습니다.');
            }).catch(err => {
                fallbackCopy();
            });
        } else {
            fallbackCopy();
        }
    }

    const [layout, setLayout] = useState<Layout>(loadLayout)
    const [chartRedraw, setChartRedraw] = useState(0)
    const [knowledgeTab, setKnowledgeTab] = useState<'RULES'|'DAILY'|'WEEKLY'|'MONTHLY'>('RULES')
    const [retrospectives, setRetrospectives] = useState<any[]>([])
    const [isRetroRunning, setIsRetroRunning] = useState(false)
    const [autoWeeklyReview, setAutoWeeklyReview] = useState(true)
    const [autoMonthlyReview, setAutoMonthlyReview] = useState(true)
    const [returnView, setReturnView] = useState<'T+1' | 'T+5' | 'T+20'>('T+1')
    const [topViewMode, setTopViewMode] = useState<'chart' | 'report'>('chart')

    const topRef = useRef<HTMLDivElement>(null)

    const loadRetrospectives = useCallback(async (type: 'DAILY'|'WEEKLY'|'MONTHLY') => {
        try {
            const res = await window.electronAPI.getMarketRetrospectives(type, 10)
            if (res.success && res.data) setRetrospectives(res.data)
        } catch (e) {
            console.error('Failed to load retrospectives', e)
        }
    }, [])

    useEffect(() => {
        if (showKnowledgeBase) {
            if (knowledgeTab === 'DAILY' || knowledgeTab === 'WEEKLY' || knowledgeTab === 'MONTHLY') {
                loadRetrospectives(knowledgeTab)
            }
        }
    }, [showKnowledgeBase, knowledgeTab, loadRetrospectives])

    const handleRunRetrospective = async (type: 'DAILY'|'WEEKLY'|'MONTHLY') => {
        setIsRetroRunning(true)
        try {
            await window.electronAPI.runMarketRetrospective(type)
            await loadRetrospectives(type)
        } finally {
            setIsRetroRunning(false)
        }
    }

    const handleDeletePrediction = async (id: string, tableName: 'agent_predictions' | 'intraday_predictions') => {
        if (window.confirm(`이 리포트(${id})를 정말 삭제하시겠습니까?\n삭제 시 복구할 수 없습니다.`)) {
            try {
                const result = await window.electronAPI.deleteMarketPrediction(id, tableName);
                if (result.success) {
                    if (tableName === 'agent_predictions') setSelectedTrade(null);
                    if (tableName === 'intraday_predictions') setSelectedIntraday(null);
                    fetchData();
                } else {
                    alert(`삭제 실패: ${result.error}`);
                }
            } catch (err: any) {
                alert(`삭제 중 오류 발생: ${err.message}`);
            }
        }
    }

    // Save layout on change (debounced via ref)
    const saveTimer = useRef<any>(null)
    const persistLayout = useCallback((next: Layout) => {
        setLayout(next)
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => saveLayout(next), 300)
    }, [])

    // Horizontal drag: chart ↔ report width ratio
    const onDragH = useCallback((dx: number) => {
        if (!topRef.current) return
        const containerW = topRef.current.clientWidth
        setLayout(prev => {
            const next = { ...prev, chartPct: Math.max(0.25, Math.min(0.85, prev.chartPct + dx / containerW)) }
            if (saveTimer.current) clearTimeout(saveTimer.current)
            saveTimer.current = setTimeout(() => saveLayout(next), 300)
            return next
        })
        setChartRedraw(p => p + 1)
    }, [])

    // Vertical drag: top section height
    const onDragV = useCallback((dy: number) => {
        setLayout(prev => {
            const next = { ...prev, topH: Math.max(100, Math.min(500, prev.topH + dy)) }
            if (saveTimer.current) clearTimeout(saveTimer.current)
            saveTimer.current = setTimeout(() => saveLayout(next), 300)
            return next
        })
        setChartRedraw(p => p + 1)
    }, [])

    const [history, setHistory] = useState<any[]>([])
    const [historyFilter, setHistoryFilter] = useState<'ALL' | 'A' | 'P' | 'B'>('ALL')
    const [latest, setLatest] = useState<any | null>(null)
    const [stats, setStats] = useState({ total: 0, wins: 0, winRate: 0, totalReturn: 0 })
    const [activeRules, setActiveRules] = useState<string[]>([])
    const [isRunning, setIsRunning] = useState(false)
    const [decisionTab, setDecisionTab] = useState<'classic' | 'intraday'>('classic')
    const [intradayData, setIntradayData] = useState<any[]>([])
    const [intradayFilters, setIntradayFilters] = useState<string[]>(['UP', 'DOWN', 'HOLD'])
    const [showIntradayFilterMenu, setShowIntradayFilterMenu] = useState(false)
    const [selectedIntraday, setSelectedIntraday] = useState<any | null>(null)
    const livePrices = useLivePriceStore(state => state.prices)
    // Graph RAG: 시장에 영향을 주는 이슈 edges
    const [marketEdges, setMarketEdges] = useState<any[]>([])

    useEffect(() => {
        const fetchMarketEdges = async () => {
            try {
                const api = window.electronAPI as any;
                if (api.getMarketKnowledgeEdges) {
                    const res = await api.getMarketKnowledgeEdges();
                    if (res.success && res.data) setMarketEdges(res.data);
                }
            } catch (e) { /* silent fail */ }
        };
        fetchMarketEdges();
    }, []);

    const calculatedStats = useMemo(() => {
        let total = 0;
        let wins = 0;
        let totalReturn = 0;

        history.filter(t => historyFilter === 'ALL' || t.cycle === historyFilter).forEach(t => {
            if (t.predict === 'HOLD') return;

            let finalReturn: number | null = null;

            if (returnView === 'T+1') {
                finalReturn = t.t1_final;
                if (finalReturn === null && t.entry_price && t.entry_price > 0) {
                    const code = t.predict === 'LONG' ? '069500' : t.predict === 'SHORT' ? '114800' : null;
                    if (code && livePrices[code]) {
                        finalReturn = ((livePrices[code] - t.entry_price) / t.entry_price) * 100;
                    }
                }
            } else if (returnView === 'T+5') {
                finalReturn = t.t5_final;
            } else if (returnView === 'T+20') {
                finalReturn = t.t20_final;
            }

            if (finalReturn !== null && finalReturn !== undefined) {
                total++;
                totalReturn += finalReturn;
                if (finalReturn > 0) {
                    wins++;
                }
            }
        });

        return {
            total,
            wins,
            winRate: total > 0 ? wins / total : 0,
            totalReturn
        }
    }, [historyFilter, history, returnView, livePrices]);

    const filteredIntradayData = useMemo(() => {
        return intradayData.filter(t => {
            const actualPos = (t.position || t.predict || '').toUpperCase();
            const isUp = actualPos.includes('UP') || actualPos.includes('LONG') || (actualPos.includes('200') && !actualPos.includes('HOLD') && !actualPos.includes('인버스'));
            const isDown = actualPos.includes('DOWN') || actualPos.includes('SHORT') || (actualPos.includes('인버스') && !actualPos.includes('HOLD'));
            const isHold = !isUp && !isDown;

            if (isUp && !intradayFilters.includes('UP')) return false;
            if (isDown && !intradayFilters.includes('DOWN')) return false;
            if (isHold && !intradayFilters.includes('HOLD')) return false;
            return true;
        });
    }, [intradayData, intradayFilters]);

    const intradayStats = useMemo(() => {
        let total = 0;
        let wins = 0;
        let totalReturn = 0;

        filteredIntradayData.forEach(t => {
            const actualPos = (t.position || t.predict || '').toUpperCase();
            const isHold = actualPos.includes('HOLD') || actualPos === '- HOLD' || !actualPos || actualPos === '관망';
            // 승패는 관망(HOLD)을 포함한 모든 평가(result)가 완료된 건수를 대상으로 셈
            if (t.result) {
                total++;
                if (t.result === 'HIT') {
                    wins++;
                }
                // 수익률은 실제 포지션(롱/숏)에 진입한 경우에만 최종 합산.
                if (!isHold && t.return_pct !== null && t.return_pct !== undefined) {
                    totalReturn += t.return_pct;
                }
            }
        });

        return {
            total,
            wins,
            winRate: total > 0 ? wins / total : 0,
            totalReturn
        }
    }, [intradayData]);

    const fetchData = async () => {
        try {
            const [histRes, latRes, statRes, rulesRes, setRes, detStatRes] = await Promise.all([
                window.electronAPI.getMarketConditionHistory(30),
                window.electronAPI.getMarketConditionLatest(),
                window.electronAPI.getMarketConditionStats(),
                window.electronAPI.getMarketConditionRules(),
                window.electronAPI.getMarketConditionSettings(),
                window.electronAPI.getDetailedMarketConditionStats()
            ])
            if (histRes.success && histRes.data) setHistory(histRes.data)
            if (latRes.success && latRes.data) setLatest(latRes.data)
            if (statRes.success && statRes.data) setStats(statRes.data)
            if (rulesRes.success && rulesRes.data) setActiveRules(rulesRes.data)
            if (detStatRes?.success && detStatRes.data) setDetailedStats(detStatRes.data)
            if (setRes.success && setRes.data) {
                setTelegramEnabled(setRes.data.telegramEnabled !== false)
                setAutoWeeklyReview(setRes.data.autoWeeklyReview !== false)
                setAutoMonthlyReview(setRes.data.autoMonthlyReview !== false)
                if (setRes.data.cciPeriod !== undefined) setCciPeriod(setRes.data.cciPeriod)
                if (setRes.data.cciOverboughtEnabled !== undefined) setCciOverboughtEnabled(setRes.data.cciOverboughtEnabled)
                if (setRes.data.cciOverboughtLimit !== undefined) setCciOverboughtLimit(setRes.data.cciOverboughtLimit)
                if (setRes.data.cciOversoldEnabled !== undefined) setCciOversoldEnabled(setRes.data.cciOversoldEnabled)
                if (setRes.data.cciOversoldLimit !== undefined) setCciOversoldLimit(setRes.data.cciOversoldLimit)
            }
        } catch(e) { console.error('Failed to fetch MCA data', e) }

        // 장중 예측 데이터 로드
        try {
            const intradayRes = await window.electronAPI.getIntradayPredictions()
            if (intradayRes?.success && intradayRes.data) setIntradayData(intradayRes.data)
        } catch(e) { console.error('Failed to fetch intraday data', e) }
    }

    useEffect(() => {
        fetchData()
        const unsubComplete = window.electronAPI.onMarketConditionComplete(() => {
            setIsRunning(false)
            fetchData()
        })
        const unsubPerf = window.electronAPI.onMarketConditionPerformanceUpdated(() => {
            fetchData() // Refresh chart / table when performance updates (like entry_price)
        })

        let unsubRt: (() => void) | null = null;
        window.electronAPI.wsRegister(['069500', '114800']).catch(e => console.error('WS:', e));
        unsubRt = window.electronAPI.onRealTimeData((data) => {
            // websocket.ts emits: { stk_cd, cur_prc, ... }
            if (data && data.stk_cd && data.cur_prc) {
                const code = data.stk_cd.replace(/[^0-9]/g, '');
                const priceStr = String(data.cur_prc).replace(/[^0-9-]/g, '');
                const currentPrice = Math.abs(Number(priceStr));
                
                if (code && currentPrice > 0) {
                    useLivePriceStore.getState().updatePrice(code, currentPrice);
                }
            }
        });

        return () => {
            unsubComplete()
            unsubPerf()
            if (unsubRt) unsubRt();
            if (window.electronAPI?.wsUnregister) {
                window.electronAPI.wsUnregister(['069500', '114800']).catch(e => console.error('WS Unregister:', e));
            }
        }
    }, [decisionTab])

    const handleRunCycleA = async () => {
        setIsRunning(true)
        await window.electronAPI.runMarketConditionAgent('A')
    }

    const getPredictIcon = (p: string) => {
        if (p === '상승' || p === 'LONG') return <ArrowUpRight className="text-rose-500 w-3.5 h-3.5" />
        if (p === '하락' || p === 'SHORT') return <ArrowDownRight className="text-blue-500 w-3.5 h-3.5" />
        return <Minus className="text-muted-foreground w-3.5 h-3.5" />
    }
    const getPositionStyle = (pos: string) => {
        if (pos.includes('200')) return 'text-rose-500 bg-rose-500/10 border-rose-500/20'
        if (pos.includes('인버스')) return 'text-blue-500 bg-blue-500/10 border-blue-500/20'
        return 'text-muted-foreground bg-muted/50 border-border'
    }

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            {/* ── Header Row ── */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <Sparkles className="text-indigo-400 w-4 h-4" />
                        <span className="text-sm font-bold tracking-tight">Market AI</span>
                        <span className="hidden xl:inline text-xs text-muted-foreground ml-1">KOSPI Directional Agent</span>
                    </div>

                    {/* Top Panel Tab Switcher */}
                    <div className="flex items-center bg-muted/30 p-0.5 rounded-lg border border-border/50">
                        <button onClick={() => setTopViewMode('chart')} className={cn("px-3 py-1 text-xs font-bold transition-all rounded-md flex items-center gap-1.5", topViewMode === 'chart' ? "bg-background text-foreground shadow-sm ring-1 ring-border/50" : "text-muted-foreground hover:text-foreground")} title="KODEX 200 일봉 및 5분봉 실시간 대조">
                            📈 일봉·분봉
                        </button>
                        <button onClick={() => setTopViewMode('report')} className={cn("px-3 py-1 text-xs font-bold transition-all rounded-md flex items-center gap-1.5", topViewMode === 'report' ? "bg-background text-foreground shadow-sm ring-1 ring-border/50" : "text-muted-foreground hover:text-foreground")} title="AI 누적 성과 및 최신 리포트 보기">
                            📝 성과·리포트
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1">
                        <button disabled={isRunning} onClick={handleRunCycleA} className="px-3 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/30 rounded text-xs font-bold transition-colors disabled:opacity-50">
                            수동 실행 (A)
                        </button>
                        <button disabled={isRunning} onClick={async () => { 
                            alert("성과 채점을 요청합니다. 잠시만 기다려주세요.");
                            const res = await window.electronAPI.runTracker(); 
                            if (!res.success) {
                                alert("채점 중 오류가 발생했습니다: " + res.error);
                            } else {
                                alert("채점이 완료되었습니다.");
                            }
                            await fetchData(); 
                        }} className="px-2 py-1 bg-violet-500/10 hover:bg-violet-500/20 text-violet-500 border border-violet-500/30 rounded text-xs font-bold transition-colors" title="과거 기록을 최신 5분봉 기준으로 다시 채점하여 비어있는 고점 기록을 복구합니다.">
                            🔄 성과 재평가
                        </button>
                        <button onClick={() => setShowPerformancePopup(true)} className="px-2 py-1 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-500 border border-fuchsia-500/30 rounded text-xs font-bold transition-colors" title="주기별 상세 성적 평가 리포트">
                            📊 성적 평가
                        </button>
                        <button onClick={async () => {
                            try {
                                alert("이미지 분석 테스트 파이프라인을 백그라운드에서 백엔드 콘솔로 실행합니다. 터미널을 확인하세요!");
                                const res = await window.electronAPI.runImageAnalysisTest();
                                alert("분석 결과:\n\n" + res);
                            } catch(e: any) {
                                alert("이미지 분석 테스트 중 오류가 발생했습니다: \n" + e.message);
                            }
                        }} className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded text-xs font-bold transition-colors" title="로컬 AI(Gemma등) Vision을 통한 5분봉 차트 분석 테스트">
                            📸 이미지 테스트
                        </button>
                        
                    </div>
                        <button onClick={() => setShowKnowledgeBase(true)} className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 rounded text-xs font-semibold transition-colors">
                            <Brain className="w-3.5 h-3.5" /> Knowledge
                        </button>
                        <button onClick={() => setShowSettings(true)} className="flex flex-shrink-0 items-center justify-center w-7 h-7 bg-muted/30 hover:bg-muted/50 border border-border/50 text-muted-foreground rounded transition-colors ml-1">
                            <Settings className="w-4 h-4" />
                        </button>
                    </div>
            </div>

            {/* ── Top: Chart + Report (horizontally draggable) ── */}
            <div ref={topRef} className="flex px-4 pt-3" style={{ height: layout.topH }}>
                {topViewMode === 'chart' ? (
                    <>
                        {/* 1. KODEX 200 일봉 */}
                        <div className="flex flex-col min-w-0 flex-1 overflow-hidden border border-border/20 rounded-lg bg-muted/5 p-1.5">
                            <div className="flex items-center mb-2 px-1">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">KODEX 200 일봉 (Daily)</span>
                            </div>
                            <div className="flex-1 min-h-0 bg-background rounded border border-border/40 overflow-hidden">
                                <IntradayChart ticker="069500" timeframe="D" />
                            </div>
                        </div>

                        {/* 구분용 DragH 재활용하지 않고 고정 여백 처리 (플렉스로 5:5 배분) */}
                        <div className="w-2 shrink-0"></div>

                        {/* 2. KODEX 200 5분봉 */}
                        <div className="flex flex-col min-w-0 flex-1 overflow-hidden border border-border/20 rounded-lg bg-muted/5 p-1.5">
                            <div className="flex items-center mb-2 px-1">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">KODEX 200 5분봉 (5M)</span>
                                <div className="flex items-center gap-3 text-xs ml-auto pr-1">
                                    <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-rose-500" /><span className="text-muted-foreground text-[10px]">LONG</span></div>
                                    <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-blue-500" /><span className="text-muted-foreground text-[10px]">SHORT</span></div>
                                </div>
                            </div>
                            <div className="flex-1 min-h-0 bg-background rounded border border-border/40 overflow-hidden">
                                <IntradayChart ticker="069500" intradayData={intradayData} timeframe="5m" />
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        {/* Left: Chart */}
                        <div className="flex flex-col min-w-0 overflow-hidden border border-border/20 rounded-lg bg-muted/5 p-1.5" style={{ width: `${layout.chartPct * 100}%` }}>
                            <div className="flex items-center gap-4 mb-2">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider ml-1">Cumulative Performance (30D)</span>
                                <div className="flex items-center gap-3 text-xs ml-auto pr-1">
                                    <div className="flex items-center gap-1.5"><div className="w-5 h-0 border-t-[1.5px] border-dashed border-slate-400/50" /><span className="text-muted-foreground">KOSPI</span></div>
                                    <div className="flex items-center gap-1.5"><div className="w-5 h-[2px] bg-indigo-500 rounded" /><span className="text-indigo-400 font-bold">Agent</span></div>
                                </div>
                            </div>
                            <div className="flex-1 min-h-0 bg-background rounded border border-border/40 overflow-hidden">
                                <PerformanceChart redrawKey={chartRedraw} history={history} />
                            </div>
                        </div>

                        {/* Horizontal Drag Handle */}
                        <DragH onDrag={onDragH} />

                        {/* Right: Latest Report + Market Edges */}
                        <div className="flex-1 min-w-0 flex flex-col overflow-hidden gap-2">
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Latest Report</span>
                                <span className="text-xs text-muted-foreground opacity-50 ml-auto">{latest ? `${latest.date} · 장전(A)` : 'No Data'}</span>
                            </div>
                            {latest ? (
                            <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-muted/20 border border-border/40 rounded-lg text-sm leading-relaxed space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className={cn("px-1.5 py-0.5 rounded border text-xs font-bold", getPositionStyle(latest.position || ''))}>
                                        {getPredictIcon(latest.predict === 'LONG' ? '상승' : latest.predict === 'SHORT' ? '하락' : '대기')}
                                        {latest.position || latest.predict} {latest.predict !== 'HOLD' && '매수'}
                                    </span>
                                    <span className="text-xs text-muted-foreground ml-auto font-mono">신뢰도 {((latest.confidence || 0) * 100).toFixed(0)}%</span>
                                    {(latest.t5_predict || latest.t1_target_return) && (
                                        <div className="w-full flex items-center gap-2 mt-1 mb-0.5 whitespace-nowrap overflow-x-auto">
                                            <span className="text-[10px] uppercase font-bold text-muted-foreground">T+1 목표</span>
                                            <span className={cn("text-[11px] font-bold", latest.predict === 'LONG' ? 'text-rose-500' : latest.predict === 'SHORT' ? 'text-blue-500' : 'text-slate-400')}>{latest.t1_target_return ? `${latest.t1_target_return>0?'+':''}${latest.t1_target_return}%` : '-'}</span>
                                            <div className="w-px h-3 bg-border/50 mx-0.5" />
                                            <span className="text-[10px] uppercase font-bold text-muted-foreground">T+5 목표</span>
                                            <span className={cn("text-[11px] font-bold", latest.t5_predict === 'LONG' ? 'text-rose-500' : latest.t5_predict === 'SHORT' ? 'text-blue-500' : 'text-slate-400')}>{latest.t5_target_return ? `${latest.t5_target_return>0?'+':''}${latest.t5_target_return}%` : '-'}</span>
                                            <div className="w-px h-3 bg-border/50 mx-0.5" />
                                            <span className="text-[10px] uppercase font-bold text-muted-foreground">T+20 목표</span>
                                            <span className={cn("text-[11px] font-bold", latest.t20_predict === 'LONG' ? 'text-rose-500' : latest.t20_predict === 'SHORT' ? 'text-blue-500' : 'text-slate-400')}>{latest.t20_target_return ? `${latest.t20_target_return>0?'+':''}${latest.t20_target_return}%` : '-'}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="border-b border-border/30" />
                                <div className="text-sm text-foreground/90 leading-relaxed max-w-none prose prose-sm dark:prose-invert">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{latest.rationale}</ReactMarkdown>
                                </div>
                                <div className="flex flex-wrap gap-1 pt-1">
                                    {latest.indicators_json && (() => {
                                        try {
                                            const inds = JSON.parse(latest.indicators_json);
                                            return inds.map((ind: string, i: number) => (
                                                <span key={i} className="px-1.5 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded text-xs text-indigo-400">{ind}</span>
                                            ));
                                        } catch { return null; }
                                    })()}
                                </div>
                            </div>
                            ) : (
                                <div className="flex-1 flex items-center justify-center border border-border/40 rounded-lg text-sm text-muted-foreground bg-muted/20">
                                    {isRunning ? 'AI 판단 중...' : '보고서가 없습니다.'}
                                </div>
                            )}

                            {/* Graph RAG: 시장 영향 이슈 패널 */}
                            {marketEdges.length > 0 && (
                                <div className="border border-border/40 rounded-lg bg-muted/10 p-3">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <Link2 className="w-3.5 h-3.5 text-indigo-400" />
                                        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">시장 영향 요인 (Knowledge Graph)</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {marketEdges.map((edge: any, i: number) => (
                                            <button
                                                key={i}
                                                onClick={() => onNavigate?.('issue-agent', edge.source_id)}
                                                className={cn(
                                                    "flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold rounded-full border transition-all shadow-sm",
                                                    edge.relation === 'BENEFITS'
                                                        ? "bg-rose-500/5 border-rose-500/20 text-rose-500 hover:bg-rose-500/15"
                                                        : "bg-blue-500/5 border-blue-500/20 text-blue-500 hover:bg-blue-500/15"
                                                )}
                                                title={edge.logical_path || ''}
                                            >
                                                {edge.relation === 'BENEFITS' ? '↑' : '↓'}
                                                {edge.issue_name || edge.source_id}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Vertical Drag Handle (top ↔ table) */}
            <DragV onDrag={onDragV} />

            {/* ── Decision Log Table (with Tab) ── */}
            <div className="flex-1 flex flex-col overflow-hidden select-none">
                <div className="flex items-center justify-between px-4 py-2 relative z-20">
                    {/* Tab Switcher */}
                    <div className="flex items-center gap-1 bg-muted/30 rounded p-0.5">
                        <button
                            onClick={() => setDecisionTab('classic')}
                            className="px-3 py-1 text-xs font-bold rounded transition-colors bg-background text-foreground shadow-sm"
                        >
                            📊 장전 예측
                        </button>
                    </div>
                    <div className="flex items-center gap-3">
                        {decisionTab === 'classic' && (
                            <>
                                <div className="flex items-center gap-4 px-3 py-1 bg-muted/30 rounded border border-border/50 text-xs">
                                    <div><span className="text-muted-foreground uppercase font-bold mr-1.5">Win</span><span className="font-mono font-bold">{(calculatedStats.winRate * 100).toFixed(1)}%</span> <span className="opacity-50">({calculatedStats.wins}/{calculatedStats.total})</span></div>
                                    <div className="w-px h-3 bg-border/60" />
                                    <div><span className="text-muted-foreground uppercase font-bold mr-1.5">Return</span><span className={cn("font-mono font-bold", calculatedStats.totalReturn > 0 ? "text-rose-500" : calculatedStats.totalReturn < 0 ? "text-blue-500" : "")}>{calculatedStats.totalReturn > 0 ? '+' : ''}{calculatedStats.totalReturn.toFixed(2)}%</span></div>
                                </div>
                                <div className="flex bg-muted/30 rounded p-0.5" title="표시 주기 선택">
                                    {['T+1', 'T+5', 'T+20'].map(opt => (
                                        <button
                                            key={opt}
                                            onClick={() => setReturnView(opt as any)}
                                            className={cn(
                                                "px-2.5 py-1 text-[10px] font-bold rounded transition-colors",
                                                returnView === opt ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex bg-muted/30 rounded p-0.5 ml-1" title="표시 사이클 선택">
                                    {['ALL', 'A'].map(opt => {
                                        const labelMap = { 'ALL': '전체', 'A': 'A(장전)' };
                                        return (
                                        <button
                                            key={opt}
                                            onClick={() => setHistoryFilter(opt as any)}
                                            className={cn(
                                                "px-2.5 py-1 text-[10px] font-bold rounded transition-colors",
                                                historyFilter === opt ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            {(labelMap as any)[opt]}
                                        </button>
                                    )})}
                                </div>
                            </>
                        )}

                        <div className="relative flex items-center" ref={moreMenuRef}>
                            <button
                                onClick={() => setShowMoreMenu(v => !v)}
                                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors text-xs font-medium border border-border/40 opacity-80 hover:opacity-100"
                            >
                                <span>더보기</span>
                                <span className="text-[10px] opacity-60">⋯</span>
                            </button>
                            {showMoreMenu && (
                                <div
                                    className="absolute right-0 top-full mt-1 z-[100] bg-background dark:bg-[#0f172a] shadow-lg border border-border/60 rounded-lg min-w-[140px] py-1"
                                    onMouseLeave={() => setShowMoreMenu(false)}
                                >
                                    <button
                                        onClick={() => {
                                            setDeleteModalTarget(decisionTab as 'classic' | 'intraday')
                                            setSelectedDeleteIds(new Set())
                                            setShowDeleteModal(true)
                                            setShowMoreMenu(false)
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs hover:bg-rose-500/10 text-rose-500 flex items-center gap-2 transition-colors"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        항목 삭제...
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex-1 overflow-auto px-4">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="sticky top-0 z-10 bg-background">
                            <tr className="text-xs uppercase text-muted-foreground border-b border-border/60">
                                <th className="py-2 pr-4 font-bold">Date</th>
                                <th className="py-2 pr-4 font-bold text-center w-16">Cycle</th>
                                <th className="py-2 pr-4 font-bold">Position</th>
                                <th className="py-2 pr-4 font-bold text-right">{returnView} Peak</th>
                                <th className="py-2 pr-4 font-bold text-right">{returnView}</th>
                                <th className="py-2 pr-4 font-bold">Smart Report Summary</th>
                                <th className="py-2 font-bold">Indicators</th>
                                <th className="py-2 w-8"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.filter(t => historyFilter === 'ALL' || t.cycle === historyFilter).map((t) => (
                                <tr key={t.id} onClick={() => setSelectedTrade(t)} className="border-b border-border/20 hover:bg-accent/30 cursor-pointer transition-colors group">
                                    <td className="py-2 pr-4 font-mono text-muted-foreground">{t.date}</td>
                                    <td className="py-2 pr-4 text-center text-xs font-medium">장전(A)</td>
                                    <td className="py-2 pr-4">
                                        {(() => {
                                            const vPredict = returnView === 'T+5' && t.t5_predict ? t.t5_predict : returnView === 'T+20' && t.t20_predict ? t.t20_predict : t.predict;
                                            const vPosition = returnView === 'T+1' && t.position ? t.position : (vPredict === 'LONG' ? 'KODEX 200 (상승)' : vPredict === 'SHORT' ? 'KODEX 인버스 (하락)' : '관망 (HOLD)');
                                            return (
                                                <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold", getPositionStyle(vPosition))}>
                                                    {getPredictIcon(vPredict)} {vPosition}
                                                </span>
                                            );
                                        })()}
                                    </td>
                                    <td className="py-2 pr-4 font-mono text-right opacity-60">
                                        {returnView === 'T+1' && (t.t1_peak === null ? '-' : `${t.t1_peak > 0 ? '+' : ''}${t.t1_peak?.toFixed(1)}%`)}
                                        {returnView === 'T+5' && (t.t5_peak === null ? '-' : `${t.t5_peak > 0 ? '+' : ''}${t.t5_peak?.toFixed(1)}%`)}
                                        {returnView === 'T+20' && (t.t20_peak === null ? '-' : `${t.t20_peak > 0 ? '+' : ''}${t.t20_peak?.toFixed(1)}%`)}
                                    </td>
                                    <td className="py-2 pr-4 font-mono text-right font-bold">
                                        {(() => {
                                            const vPredict = returnView === 'T+5' && t.t5_predict ? t.t5_predict : returnView === 'T+20' && t.t20_predict ? t.t20_predict : t.predict;
                                            if (vPredict === 'HOLD') {
                                                return <span className="text-muted-foreground font-normal">-</span>;
                                            }

                                            const code = t.predict === 'LONG' ? '069500' : t.predict === 'SHORT' ? '114800' : null;
                                            const isPending = t.t1_final === null;
                                            let liveVal = t.t1_final;
                                            let isLive = false;
                                            
                                            if (isPending && returnView === 'T+1' && t.entry_price && t.entry_price > 0 && code && livePrices[code]) {
                                                liveVal = ((livePrices[code] - t.entry_price) / t.entry_price) * 100;
                                                isLive = true;
                                            }

                                            if (returnView === 'T+1' && isPending && !isLive) {
                                                return <span className="text-xs text-indigo-400 animate-pulse">⏳ 대기</span>;
                                            }

                                            return (
                                                <>
                                                    {returnView === 'T+1' && liveVal !== null && (
                                                        <span className={cn(liveVal > 0 ? "text-rose-500" : "text-blue-500", isLive && "animate-pulse brightness-125")}>
                                                            {isLive && <span className="text-[10px] bg-indigo-500 text-white px-1 rounded mr-1 animate-none">🔴 RUNNING</span>}
                                                            {liveVal > 0 ? '+' : ''}{liveVal.toFixed(2)}%
                                                        </span>
                                                    )}
                                                    {returnView === 'T+5' && (t.t5_final === null ? '-' : <span className={t.t5_final > 0 ? "text-rose-500" : "text-blue-500"}>{t.t5_final > 0 ? '+' : ''}{t.t5_final?.toFixed(2)}%</span>)}
                                                    {returnView === 'T+20' && (t.t20_final === null ? '-' : <span className={t.t20_final > 0 ? "text-rose-500" : "text-blue-500"}>{t.t20_final > 0 ? '+' : ''}{t.t20_final?.toFixed(2)}%</span>)}
                                                </>
                                            );
                                        })()}
                                    </td>
                                    <td className="py-2 pr-4">
                                        {t.swarm_sentiment ? (
                                            <div className="flex items-center gap-1.5">
                                                <span className={cn("text-[10px] uppercase font-bold px-1.5 py-0.5 rounded", 
                                                    t.swarm_sentiment.includes('UP') ? "bg-rose-500/10 text-rose-500" :
                                                    t.swarm_sentiment.includes('DOWN') ? "bg-blue-500/10 text-blue-500" : "bg-muted/30 text-muted-foreground"
                                                )}>
                                                    {t.swarm_sentiment.split(' ')[0]}
                                                </span>
                                                <span className="text-xs text-muted-foreground opacity-80">{t.swarm_sentiment.split(' ')[1]}</span>
                                                
                                                {/* 이견 충돌 경고 */}
                                                {((t.predict === 'LONG' && t.swarm_sentiment.includes('DOWN')) || (t.predict === 'SHORT' && t.swarm_sentiment.includes('UP'))) && (
                                                    <span className="text-amber-500 ml-1" title="메인 AI와 군집의 예측이 엇갈렸습니다."><ShieldAlert className="w-3.5 h-3.5" /></span>
                                                )}
                                            </div>
                                        ) : <span className="text-xs text-muted-foreground opacity-50">-</span>}
                                    </td>
                                    <td className="py-2">
                                        <div className="flex gap-1 overflow-hidden" style={{ maxWidth: 150 }}>
                                            {(()=>{
                                                try {
                                                    const inds = JSON.parse(t.indicators_json || '[]');
                                                    return inds.map((ind: string, i: number) => <span key={i} className="px-1.5 py-0.5 bg-muted/50 border border-border/40 rounded text-xs text-muted-foreground whitespace-nowrap">{ind}</span>);
                                                } catch { return null; }
                                            })()}
                                        </div>
                                    </td>
                                    <td className="py-2"><ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Modal: Trade Detail ── */}
            {selectedTrade && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedTrade(null)} />
                    <div className="relative bg-background border border-border/50 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh] ring-1 ring-white/5 animate-in zoom-in-95 duration-150">
                        <div className="flex justify-between items-center px-4 py-3 border-b border-border/40 bg-muted/30 rounded-t-xl">
                            <div className="flex items-center gap-2">
                                <Search className="w-4 h-4 text-indigo-400" />
                                <span className="text-sm font-bold">Trade Intel</span>
                                <span className="text-xs text-muted-foreground px-2 py-0.5 bg-background rounded border border-border/50">{selectedTrade.date} · {selectedTrade.id}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => handleDeletePrediction(selectedTrade.id, 'agent_predictions')} className="p-1 hover:bg-rose-500/10 hover:text-rose-500 rounded text-muted-foreground transition-colors" title="리포트 삭제">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => setSelectedTrade(null)} className="p-1 hover:bg-muted rounded text-muted-foreground transition-colors"><X className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="p-5 overflow-y-auto space-y-4">
                            <div className="flex gap-4 p-3 bg-muted/20 rounded-lg border border-border/40 text-sm">
                                <div className="flex-1">
                                    <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Position</div>
                                    <span className={cn("inline-flex px-2 py-0.5 rounded font-bold border text-xs", getPositionStyle(selectedTrade.position || ''))}>{selectedTrade.position || selectedTrade.predict} ({selectedTrade.predict === 'LONG' ? '상승' : selectedTrade.predict === 'SHORT' ? '하락' : '대기'})</span>
                                </div>
                                <div className="w-px bg-border/40" />
                                <div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">Entry Price</div><div className="font-mono">{selectedTrade.entry_price ? selectedTrade.entry_price.toLocaleString() : '-'}</div></div>
                                <div className="w-px bg-border/40" />
                                <div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">T+1 Peak</div><div className="font-mono">{selectedTrade.t1_peak === null ? '-' : `${Number(selectedTrade.t1_peak).toFixed(2)}%`}</div></div>
                                <div className="w-px bg-border/40" />
                                <div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">T+1 Final</div><div className="font-mono font-bold">{selectedTrade.t1_final === null ? 'Running' : `${Number(selectedTrade.t1_final).toFixed(2)}%`}</div></div>
                                {selectedTrade.t5_final !== null && (<><div className="w-px bg-border/40" /><div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">T+5 {selectedTrade.t5_predict && <span className="opacity-70 text-[9px]">({selectedTrade.t5_predict})</span>}</div><div className="font-mono"><span className="opacity-50">{selectedTrade.t5_peak > 0 ? '+' : ''}{Number(selectedTrade.t5_peak).toFixed(2)}%</span> / <span className="font-bold">{selectedTrade.t5_final > 0 ? '+' : ''}{Number(selectedTrade.t5_final).toFixed(2)}%</span></div></div></>)}
                                {selectedTrade.t20_final !== null && (<><div className="w-px bg-border/40" /><div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">T+20 {selectedTrade.t20_predict && <span className="opacity-70 text-[9px]">({selectedTrade.t20_predict})</span>}</div><div className="font-mono"><span className="opacity-50">{selectedTrade.t20_peak > 0 ? '+' : ''}{Number(selectedTrade.t20_peak).toFixed(2)}%</span> / <span className="font-bold">{selectedTrade.t20_final > 0 ? '+' : ''}{Number(selectedTrade.t20_final).toFixed(2)}%</span></div></div></>)}
                            </div>

                            {/* Quick Anchor Tabs */}
                            <div className="flex items-center gap-2 border-b border-border/40 pb-3">
                                <button onClick={() => document.getElementById('trade-rationale')?.scrollIntoView({ behavior: 'smooth' })} className="px-3 py-1.5 text-xs font-bold bg-muted/30 hover:bg-muted focus:ring-1 ring-border rounded-md text-muted-foreground hover:text-foreground transition-all">🧠 메인 AI 분석</button>
                                {selectedTrade.comments_json && <button onClick={() => document.getElementById('trade-swarm')?.scrollIntoView({ behavior: 'smooth' })} className="px-3 py-1.5 text-xs font-bold bg-muted/30 hover:bg-muted focus:ring-1 ring-border rounded-md text-muted-foreground hover:text-foreground transition-all">👥 군집 AI 의견</button>}
                                <button onClick={() => document.getElementById('trade-source')?.scrollIntoView({ behavior: 'smooth' })} className="px-3 py-1.5 text-xs font-bold bg-muted/30 hover:bg-muted focus:ring-1 ring-border rounded-md text-muted-foreground hover:text-foreground transition-all">📊 소스 데이터</button>
                                <div className="flex-1"></div>
                                <button onClick={() => handleCopyFullContext(selectedTrade)} className="px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 bg-muted/20 border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-all shadow-sm" title="AI 판단 근거 및 분석 전문 클립보드 복사">
                                    <Copy className="w-3.5 h-3.5" />
                                    전체 복사
                                </button>
                            </div>
                            <div id="trade-rationale" className="scroll-mt-4">
                                <div className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5"><Brain className="w-3.5 h-3.5" /> Main AI Rationale</div>
                                <div className="p-3 bg-primary/5 border border-primary/10 rounded-lg text-sm text-foreground/90 leading-relaxed max-w-none prose prose-sm dark:prose-invert">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedTrade.rationale}</ReactMarkdown>
                                </div>
                            </div>

                            {selectedTrade.comments_json && (
                            <div id="trade-swarm" className="scroll-mt-4 pt-4 border-t border-border/20">
                                <div className="text-xs font-bold text-indigo-400 uppercase mb-2 flex items-center justify-between">
                                    <div className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Swarm Local Sentiment</div>
                                    {selectedTrade.swarm_sentiment && (
                                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/30 rounded text-[10px] text-indigo-400">
                                            종합: {selectedTrade.swarm_sentiment}
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    {(() => {
                                        try {
                                            const comments = JSON.parse(selectedTrade.comments_json);
                                            return comments.map((c: any, i: number) => (
                                                <div key={i} className="flex gap-3 p-3 bg-muted/10 border border-border/40 rounded-xl group/comment">
                                                    <div className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-background border border-border/50 text-base shadow-sm" title={c.id}>
                                                        {c.id === 'SYSTEM_CONTEXT' ? '🖥️' : c.name.includes('모멘텀') ? '🐂' : c.name.includes('역발상') ? '🐻' : c.name.includes('데이 퀀트') ? '📊' : c.name.includes('기관 딜러') ? '🏦' : '🤖'}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start mb-1">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="text-xs font-bold text-foreground/80">{c.name}</span>
                                                                <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold border", 
                                                                    c.predict === 'INFO' ? "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" :
                                                                    c.predict === 'UP' || c.predict === 'LONG' ? "text-rose-500 bg-rose-500/10 border-rose-500/20" :
                                                                    c.predict === 'DOWN' || c.predict === 'SHORT' ? "text-blue-500 bg-blue-500/10 border-blue-500/20" : "text-slate-400 bg-slate-500/10 border-slate-500/20"
                                                                )}>
                                                                    {c.predict}
                                                                </span>
                                                            </div>
                                                            {c.winRate !== null && c.winRate !== undefined && (
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className={cn("text-[10px] font-mono", c.winRate >= 60 ? "text-amber-500 font-bold" : "text-muted-foreground opacity-60")}>
                                                                        🎯 적중률 {c.winRate}%
                                                                    </span>
                                                                    {c.weight !== undefined && (
                                                                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted/50 text-foreground/70 border border-border/40">
                                                                            입김 {Number(c.weight).toFixed(1)}x
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {c.id === 'SYSTEM_CONTEXT' ? (
                                                            <pre className="text-[11px] font-mono text-indigo-400 bg-[#0d0d0d] p-3 rounded-lg border border-border/40 whitespace-pre-wrap overflow-x-auto mt-2 leading-relaxed">
                                                                {c.comment}
                                                            </pre>
                                                        ) : (
                                                            <div className="text-sm text-foreground/80 leading-relaxed bg-muted/40 p-3 rounded-lg rounded-tl-none border border-transparent group-hover/comment:border-border/40 transition-colors">
                                                                {c.comment}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ));
                                        } catch { return <div className="text-xs text-muted-foreground opacity-50 p-2">댓글 파싱 오류 발생</div> }
                                    })()}
                                </div>
                            </div>
                            )}

                            <div id="trade-source" className="scroll-mt-4 pt-4 border-t border-border/20">
                                <div className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Source Data Summaries</div>
                                <div className="p-3 bg-[#0d0d0d] border border-black/50 rounded-lg font-mono text-xs text-gray-400 space-y-1 mb-3">
                                    {(()=>{
                                        try {
                                            const srcs = JSON.parse(selectedTrade.sources_json || '[]');
                                            if (srcs.length === 0) return <span className="opacity-50">No source data</span>;
                                            return srcs.map((s: string, i: number) => <div key={i}><span className="text-indigo-500/60 mr-1.5">&gt;</span>{s}</div>);
                                        } catch { return <span className="opacity-50">Parse error</span>; }
                                    })()}
                                </div>
                                <div className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Raw Pipeline Markdown</div>
                                <pre className="p-3 bg-[#0d0d0d] border border-black/50 rounded-lg font-mono text-[10px] text-gray-400 whitespace-pre-wrap overflow-y-auto max-h-[300px] leading-relaxed">
                                    {selectedTrade.raw_context || '저장된 Raw 데이터가 없습니다 (이전 버전 데이터).'}
                                </pre>
                            </div>
                            {selectedTrade.feedback && (
                                <div className="pt-3 border-t border-border/30">
                                    <div className="text-xs font-bold text-rose-500 uppercase mb-1.5 flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> Self-Review</div>
                                    <div className="p-3 bg-rose-500/5 border border-rose-500/15 rounded-lg text-sm text-rose-400 leading-relaxed">{selectedTrade.feedback}</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Modal: Intraday Detail ── */}
            {selectedIntraday && (() => {
                const posLabel = selectedIntraday.position || (selectedIntraday.predict === 'UP' ? 'KODEX 200' : selectedIntraday.predict === 'DOWN' ? 'KODEX 인버스' : 'HOLD')
                const posStyle = posLabel.includes('200') ? 'text-rose-500 bg-rose-500/10 border-rose-500/20'
                    : posLabel.includes('인버스') ? 'text-blue-500 bg-blue-500/10 border-blue-500/20'
                    : 'text-muted-foreground bg-muted/50 border-border'
                const posIcon = posLabel.includes('200') ? '↗' : posLabel.includes('인버스') ? '↘' : '—'
                const retVal = selectedIntraday.return_pct
                return (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedIntraday(null)} />
                    <div className="relative bg-background border border-border/50 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh] ring-1 ring-white/5 animate-in zoom-in-95 duration-150">
                        <div className="flex justify-between items-center px-4 py-3 border-b border-border/40 bg-muted/30 rounded-t-xl">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-amber-400" />
                                <span className="text-sm font-bold">장중 예측 상세</span>
                                <span className="text-xs text-muted-foreground px-2 py-0.5 bg-background rounded border border-border/50">{selectedIntraday.date} · {selectedIntraday.time_slot}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => handleDeletePrediction(selectedIntraday.id, 'intraday_predictions')} className="p-1 hover:bg-rose-500/10 hover:text-rose-500 rounded text-muted-foreground transition-colors" title="리포트 삭제">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => setSelectedIntraday(null)} className="p-1 hover:bg-muted rounded text-muted-foreground transition-colors"><X className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="p-5 overflow-y-auto space-y-4">
                            <div className="flex flex-col gap-3">
                                <div className="flex gap-4 p-3 bg-muted/20 rounded-lg border border-border/40 text-sm">
                                    <div className="flex-1">
                                        <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Position</div>
                                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold', posStyle)}>
                                            {posIcon} {posLabel} ({selectedIntraday.predict === 'UP' ? '상승' : selectedIntraday.predict === 'DOWN' ? '하락' : '대기'})
                                        </span>
                                    </div>
                                    <div className="w-px bg-border/40" />
                                    <div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">Entry Price</div><div className="font-mono">{selectedIntraday.entry_price ? selectedIntraday.entry_price.toLocaleString() : '-'}</div></div>
                                    <div className="w-px bg-border/40" />
                                    <div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">Max Price</div><div className="font-mono text-amber-500">{selectedIntraday.max_price ? selectedIntraday.max_price.toLocaleString() : '-'}</div></div>
                                    <div className="w-px bg-border/40" />
                                    <div><div className="text-xs text-muted-foreground uppercase font-bold mb-1">Close Price</div><div className="font-mono opacity-80">{selectedIntraday.close_price ? selectedIntraday.close_price.toLocaleString() : '-'}</div></div>
                                    <div className="w-px bg-border/40" />
                                    <div>
                                        <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Max Return</div>
                                        <div className={cn("font-mono font-bold", selectedIntraday.max_return_pct > 0 ? "text-amber-500" : selectedIntraday.max_return_pct < 0 ? "text-blue-500/80" : "text-muted-foreground")}>
                                            {selectedIntraday.max_return_pct != null ? `${selectedIntraday.max_return_pct > 0 ? '+' : ''}${Number(selectedIntraday.max_return_pct).toFixed(2)}%` : '-'}
                                        </div>
                                    </div>
                                    <div className="w-px bg-border/40" />
                                    <div>
                                        <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Close Return</div>
                                        <div className={cn("font-mono font-bold", retVal > 0 ? "text-rose-500" : retVal < 0 ? "text-blue-500" : "")}>
                                            {retVal != null ? `${retVal > 0 ? '+' : ''}${Number(retVal).toFixed(2)}%` : '⏳'}
                                        </div>
                                    </div>
                                    <div className="w-px bg-border/40" />
                                    <div>
                                        <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Result</div>
                                        <div className="font-mono font-bold flex flex-col pt-0.5">
                                            {selectedIntraday.result === 'HIT' ? <span className="text-emerald-500">✅ HIT</span>
                                            : selectedIntraday.result === 'MISS' ? <span className="text-rose-500">❌ MISS</span>
                                            : selectedIntraday.result === 'HOLD' ? <span className="text-muted-foreground">— HOLD</span>
                                            : <span className="text-indigo-400">⏳ Pending</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-[11px] text-muted-foreground px-1 opacity-70">
                                    ※ 장중 고점 수익률이 <strong className="text-foreground">+1.0%</strong>를 넘거나 종가 수익률이 <strong className="text-foreground">+0.5%</strong>를 초과할 경우 목표 달성(HIT)으로 평가됩니다.
                                </div>
                            </div>

                            {/* Quick Anchor Tabs */}
                            <div className="flex items-center gap-2 border-b border-border/40 pb-3">
                                <button onClick={() => document.getElementById('intraday-rationale')?.scrollIntoView({ behavior: 'smooth' })} className="px-3 py-1.5 text-xs font-bold bg-muted/30 hover:bg-muted focus:ring-1 ring-border rounded-md text-muted-foreground hover:text-foreground transition-all">🧠 메인 AI 분석</button>
                                {selectedIntraday.comments_json && <button onClick={() => document.getElementById('intraday-swarm')?.scrollIntoView({ behavior: 'smooth' })} className="px-3 py-1.5 text-xs font-bold bg-muted/30 hover:bg-muted focus:ring-1 ring-border rounded-md text-muted-foreground hover:text-foreground transition-all">📝 스마트 리포트</button>}
                                {selectedIntraday.image_base64 && <button onClick={() => document.getElementById('intraday-chart')?.scrollIntoView({ behavior: 'smooth' })} className="px-3 py-1.5 text-xs font-bold bg-muted/30 hover:bg-muted focus:ring-1 ring-border rounded-md text-muted-foreground hover:text-foreground transition-all">📸 차트 스냅샷</button>}
                                <button onClick={() => document.getElementById('intraday-source')?.scrollIntoView({ behavior: 'smooth' })} className="px-3 py-1.5 text-xs font-bold bg-muted/30 hover:bg-muted focus:ring-1 ring-border rounded-md text-muted-foreground hover:text-foreground transition-all">📊 소스 데이터</button>
                                <div className="flex-1"></div>
                                <button onClick={() => handleCopyFullContext(selectedIntraday)} className="px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 bg-muted/20 border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-all shadow-sm" title="AI 판단 근거 및 분석 전문 클립보드 복사">
                                    <Copy className="w-3.5 h-3.5" />
                                    전체 복사
                                </button>
                            </div>
                            <div id="intraday-rationale" className="scroll-mt-4">
                                <div className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5"><Brain className="w-3.5 h-3.5" /> Main AI Rationale</div>
                                <div className="p-3 bg-primary/5 border border-primary/10 rounded-lg text-sm text-foreground/90 leading-relaxed max-w-none prose prose-sm dark:prose-invert">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedIntraday.rationale || '분석 내용 없음'}</ReactMarkdown>
                                </div>
                            </div>

                            {selectedIntraday.comments_json && (
                            <div id="intraday-swarm" className="scroll-mt-4 pt-4 border-t border-border/20">
                                <div className="text-xs font-bold text-indigo-400 uppercase mb-2 flex items-center justify-between">
                                    <div className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Intraday Smart Report</div>
                                    {selectedIntraday.swarm_sentiment && (
                                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/30 rounded text-[10px] text-indigo-400">
                                            종합: {selectedIntraday.swarm_sentiment}
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-col w-full">
                                    {(() => {
                                        try {
                                            const comments = JSON.parse(selectedIntraday.comments_json);
                                            return comments.map((c: any, index: number) => (
                                                <div key={index} className={cn("flex gap-3 py-4 px-2 group/comment hover:bg-muted/10 transition-colors", index > 0 && "border-t border-border/40")}>
                                                    <div className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-background border border-border/50 text-base shadow-sm" title={c.id}>
                                                        {c.id === 'SYSTEM_CONTEXT' ? '🖥️' : c.name.includes('모멘텀') ? '🐂' : c.name.includes('역발상') ? '🐻' : c.name.includes('데이 퀀트') ? '📊' : c.name.includes('기관 딜러') ? '🏦' : '🤖'}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start mb-1">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="text-xs font-bold text-foreground/80">{c.name}</span>
                                                                <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold border", 
                                                                    c.predict === 'INFO' ? "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" :
                                                                    c.predict === 'UP' || c.predict === 'LONG' ? "text-rose-500 bg-rose-500/10 border-rose-500/20" :
                                                                    c.predict === 'DOWN' || c.predict === 'SHORT' ? "text-blue-500 bg-blue-500/10 border-blue-500/20" : "text-slate-400 bg-slate-500/10 border-slate-500/20"
                                                                )}>
                                                                    {c.predict}
                                                                </span>
                                                            </div>
                                                            {c.winRate !== null && c.winRate !== undefined && (
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className={cn("text-[10px] font-mono", c.winRate >= 60 ? "text-amber-500 font-bold" : "text-muted-foreground opacity-60")}>
                                                                        🎯 적중률 {c.winRate}%
                                                                    </span>
                                                                    {c.weight !== undefined && (
                                                                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted/50 text-foreground/70 border border-border/40">
                                                                            입김 {Number(c.weight).toFixed(1)}x
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {c.id === 'SYSTEM_CONTEXT' ? (
                                                            <pre className="text-[11px] font-mono text-indigo-400 bg-[#0d0d0d] p-3 rounded-lg border border-border/40 whitespace-pre-wrap overflow-x-auto mt-2 leading-relaxed">
                                                                {c.comment}
                                                            </pre>
                                                        ) : (
                                                            <div className="text-[13px] text-foreground/90 leading-relaxed mt-1.5 break-keep">
                                                                {c.comment}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ));
                                        } catch { return <div className="text-xs text-muted-foreground opacity-50 p-2">댓글 파싱 오류 발생</div> }
                                    })()}
                                </div>
                            </div>
                            )}

                            {selectedIntraday.image_base64 && (
                            <div id="intraday-chart" className="scroll-mt-4 pt-4 border-t border-border/20">
                                <div className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Chart Snapshot</div>
                                <div className="p-1 bg-[#0d0d0d] border border-black/50 rounded-lg flex justify-center items-center overflow-hidden">
                                    <img src={`data:image/png;base64,${selectedIntraday.image_base64}`} alt="Intraday Chart Snapshot" className="max-w-full h-auto rounded opacity-90 object-contain" style={{ maxHeight: '600px' }} />
                                </div>
                            </div>
                            )}

                            <div id="intraday-source" className="scroll-mt-4 pt-4 border-t border-border/20">
                                <div className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Source Data</div>
                                <div className="p-3 bg-[#0d0d0d] border border-black/50 rounded-lg font-mono text-xs text-gray-400 space-y-1">
                                    {(() => {
                                        try {
                                            const srcs = JSON.parse(selectedIntraday.sources_json || '[]');
                                            if (srcs.length === 0) return <span className="opacity-50">No source data</span>;
                                            return srcs.map((s: string, i: number) => <div key={i}><span className="text-indigo-500/60 mr-1.5">&gt;</span>{s}</div>);
                                        } catch { return <span className="opacity-50">No source data</span>; }
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                )
            })()}

            {/* ── Drawer: Knowledge Base ── */}
            {showKnowledgeBase && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowKnowledgeBase(false)} />
                    <div className="relative w-full max-w-md h-full bg-background border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right-full duration-200">
                        <div className="flex items-center px-4 py-3 border-b border-border/50 bg-indigo-500/5">
                            <Brain className="w-4 h-4 text-indigo-500 mr-2" />
                            <span className="font-bold text-sm text-indigo-500 flex-1">Knowledge Hub</span>
                            <button onClick={() => setShowKnowledgeBase(false)} className="p-1 hover:bg-muted rounded text-muted-foreground"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="flex bg-muted/20 border-b border-border/50">
                            <button onClick={() => setKnowledgeTab('RULES')} className={cn("flex-1 py-2 text-xs font-bold uppercase transition-colors", knowledgeTab === 'RULES' ? "text-indigo-400 border-b-2 border-indigo-500" : "text-muted-foreground hover:bg-muted/30")}>지표 & 룰</button>
                            <button onClick={() => setKnowledgeTab('DAILY')} className={cn("flex-1 py-2 text-xs font-bold uppercase transition-colors", knowledgeTab === 'DAILY' ? "text-indigo-400 border-b-2 border-indigo-500" : "text-muted-foreground hover:bg-muted/30")}>일간 리캡</button>
                            <button onClick={() => setKnowledgeTab('WEEKLY')} className={cn("flex-1 py-2 text-xs font-bold uppercase transition-colors", knowledgeTab === 'WEEKLY' ? "text-indigo-400 border-b-2 border-indigo-500" : "text-muted-foreground hover:bg-muted/30")}>주간 리캡</button>
                            <button onClick={() => setKnowledgeTab('MONTHLY')} className={cn("flex-1 py-2 text-xs font-bold uppercase transition-colors", knowledgeTab === 'MONTHLY' ? "text-indigo-400 border-b-2 border-indigo-500" : "text-muted-foreground hover:bg-muted/30")}>월간 리캡</button>
                        </div>
                        <div className="p-5 flex-1 overflow-y-auto space-y-6">
                            {knowledgeTab === 'RULES' && (
                                <>
                                    <section>
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> Indicator Effectiveness</div>
                                        <div className="space-y-1.5">
                                            {[
                                                { rank: 1, name: 'PL-NXT (수급)', score: '82.0%', color: 'bg-indigo-500', highlight: true },
                                                { rank: 2, name: 'PL-Macro (금리)', score: '75.5%', color: 'bg-slate-500', highlight: false },
                                                { rank: 3, name: 'PL-News (속보)', score: '48.2%', color: '', highlight: false }
                                            ].map(item => (
                                                <div key={item.rank} className={cn("flex items-center justify-between p-2.5 rounded border border-border/40 bg-muted/20", item.rank === 3 && "opacity-50")}>
                                                    <div className="flex gap-2 items-center">
                                                        <span className={cn("w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white", item.color || "border border-border bg-transparent text-muted-foreground")}>{item.rank}</span>
                                                        <span className={cn("text-sm", item.rank === 3 && "line-through")}>{item.name}</span>
                                                    </div>
                                                    <span className={cn("text-sm font-mono font-bold", item.highlight && "text-indigo-400")}>{item.score}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                    <div className="border-b border-border/40" />
                                    <section>
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Active System Rules</div>
                                        <div className="space-y-1.5">
                                            {activeRules.length > 0 ? (
                                                activeRules.map((s, i) => <div key={i} className="text-sm p-2.5 bg-primary/5 border border-primary/10 rounded-lg leading-snug text-primary/80">• {s}</div>)
                                            ) : (
                                                <div className="text-sm text-muted-foreground p-2.5 bg-muted/30 border border-border/40 rounded-lg text-center">아직 학습된 규칙이 없습니다.</div>
                                            )}
                                        </div>
                                    </section>
                                    <div className="border-b border-border/40" />
                                    <section>
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Self-Learning Commits</div>
                                        <div className="relative pl-4 border-l-2 border-border/40 space-y-4">
                                            <div className="relative">
                                                <div className="absolute -left-[21px] top-1 w-2 h-2 bg-indigo-500 rounded-full ring-2 ring-background" />
                                                <div className="text-xs font-mono text-muted-foreground">03.24 16:00</div>
                                                <div className="text-sm font-bold mt-0.5">[FIX] 뉴스 헤드라인 신뢰도 하향</div>
                                                <div className="text-sm text-muted-foreground leading-snug mt-1">외인 수급 역행 시 뉴스 가중치 무시 로직 적용.</div>
                                            </div>
                                            <div className="relative opacity-50">
                                                <div className="absolute -left-[21px] top-1 w-2 h-2 bg-muted-foreground rounded-full ring-2 ring-background" />
                                                <div className="text-xs font-mono text-muted-foreground">03.20 16:00</div>
                                                <div className="text-sm font-bold mt-0.5">[FEAT] VIX 힛율 보정 알고리즘</div>
                                            </div>
                                        </div>
                                    </section>
                                </>
                            )}
                            {(knowledgeTab === 'DAILY' || knowledgeTab === 'WEEKLY' || knowledgeTab === 'MONTHLY') && (
                                <div className="space-y-4">
                                    <div className="p-3 bg-muted/20 border border-border/40 rounded-lg flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Clock className="w-4 h-4 text-indigo-400" />
                                                <span className="text-sm font-bold">{knowledgeTab === 'DAILY' ? '일간' : knowledgeTab === 'WEEKLY' ? '주간' : '월간'} 회고 스케줄러</span>
                                            </div>
                                            {knowledgeTab !== 'DAILY' && (
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={knowledgeTab === 'WEEKLY' ? autoWeeklyReview : autoMonthlyReview} onChange={async (e) => {
                                                        const next = e.target.checked
                                                        if (knowledgeTab === 'WEEKLY') {
                                                            setAutoWeeklyReview(next)
                                                            await window.electronAPI.saveMarketConditionSettings({ autoWeeklyReview: next })
                                                        } else {
                                                            setAutoMonthlyReview(next)
                                                            await window.electronAPI.saveMarketConditionSettings({ autoMonthlyReview: next })
                                                        }
                                                    }} />
                                                    <div className="w-7 h-4 bg-muted/50 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-500"></div>
                                                </label>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground flex justify-between items-center border-t border-border/40 pt-2">
                                            <span>실행: {knowledgeTab === 'DAILY' ? '매일 15:40' : knowledgeTab === 'WEEKLY' ? '매주 금요일 15:40' : '매월 마지막 금요일 15:50'}</span>
                                            <button disabled={isRetroRunning} onClick={() => handleRunRetrospective(knowledgeTab)} className="px-2 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded text-xs transition-colors disabled:opacity-50">
                                                {isRetroRunning ? '생성 중...' : '지금 강제 실행'}
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <div className="space-y-3">
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <Target className="w-3.5 h-3.5" /> {knowledgeTab === 'DAILY' ? '일간' : knowledgeTab === 'WEEKLY' ? '주간' : '월간'} 리포트 목록
                                        </div>
                                        {retrospectives.length === 0 ? (
                                            <div className="p-4 text-center text-xs text-muted-foreground border border-border/30 rounded-lg bg-muted/10">작성된 회고가 없습니다.</div>
                                        ) : (
                                            retrospectives.map(r => (
                                                <div key={r.id} className="border border-border/40 rounded-lg bg-muted/10 overflow-hidden">
                                                    <div className="px-3 py-2 bg-muted/30 font-mono text-xs font-bold flex justify-between items-center">
                                                        <span className="text-indigo-400">{r.target_period}</span>
                                                        <span className="text-muted-foreground opacity-50 font-normal">{r.created_at.substring(5,16)}</span>
                                                    </div>
                                                    <div className="p-3 text-sm text-foreground/80 leading-relaxed max-w-none prose prose-sm dark:prose-invert">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.content}</ReactMarkdown>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Settings Modal ── */}
            {showSettings && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
                    <div className="relative bg-background border border-border/50 rounded-xl w-full max-w-[340px] shadow-2xl flex flex-col ring-1 ring-white/5 animate-in zoom-in-95 duration-150">
                        <div className="flex justify-between items-center px-4 py-3 border-b border-border/40 bg-muted/30 rounded-t-xl">
                            <div className="flex items-center gap-2">
                                <Settings className="w-4 h-4 text-indigo-400" />
                                <span className="text-sm font-bold">Agent Settings</span>
                            </div>
                            <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-muted rounded text-muted-foreground"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <label className="flex items-center justify-between cursor-pointer p-3 bg-muted/10 border border-border/30 rounded-lg hover:bg-muted/20 transition-colors">
                                <div className="flex flex-col gap-1 pr-4">
                                    <span className="text-sm font-bold flex items-center gap-2">📱 Telegram Alert</span>
                                    <span className="text-xs text-muted-foreground leading-snug">시황 판단이 완료되면 즉시 텔레그램으로 분석 요약본을 전송합니다.</span>
                                </div>
                                <div className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none", telegramEnabled ? 'bg-indigo-500' : 'bg-muted/50')} onClick={async (e) => {
                                    e.preventDefault()
                                    const next = !telegramEnabled
                                    setTelegramEnabled(next)
                                    await saveAgentSettings({ telegramEnabled: next })
                                }}>
                                    <span className={cn("pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", telegramEnabled ? 'translate-x-4' : 'translate-x-0')} />
                                </div>
                            </label>

                            <div className="border-t border-border/40 my-2" />

                            {/* CCI Settings */}
                            <div className="space-y-3">
                                <span className="text-sm font-bold flex items-center gap-2 mb-1">
                                    <Activity className="w-4 h-4 text-indigo-400" /> 장중 시그널 (CCI) 변수
                                </span>
                                
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground text-xs">기간 (Period)</span>
                                    <input type="number" value={cciPeriod} onChange={(e) => {
                                        const v = Number(e.target.value); setCciPeriod(v); saveAgentSettings({ cciPeriod: v })
                                    }} className="w-16 h-7 text-xs bg-muted/20 border border-border/40 rounded text-center focus:outline-none focus:border-indigo-500" />
                                </div>

                                <div className="flex items-center justify-between text-sm p-2 bg-muted/10 border border-border/30 rounded-lg">
                                    <label className="flex items-center gap-2 cursor-pointer flex-1">
                                        <input type="checkbox" checked={cciOverboughtEnabled} onChange={(e) => {
                                            const v = e.target.checked; setCciOverboughtEnabled(v); saveAgentSettings({ cciOverboughtEnabled: v })
                                        }} className="w-3.5 h-3.5 rounded border-border text-indigo-500 bg-background/50 accent-indigo-500" />
                                        <span className="text-xs text-foreground/80">과매수 트리거 (매도)</span>
                                    </label>
                                    <input type="number" disabled={!cciOverboughtEnabled} value={cciOverboughtLimit} onChange={(e) => {
                                        const v = Number(e.target.value); setCciOverboughtLimit(v); saveAgentSettings({ cciOverboughtLimit: v })
                                    }} className="w-16 h-7 text-xs bg-muted/20 border border-border/40 rounded text-center focus:outline-none focus:border-indigo-500 disabled:opacity-30" />
                                </div>

                                <div className="flex items-center justify-between text-sm p-2 bg-muted/10 border border-border/30 rounded-lg">
                                    <label className="flex items-center gap-2 cursor-pointer flex-1">
                                        <input type="checkbox" checked={cciOversoldEnabled} onChange={(e) => {
                                            const v = e.target.checked; setCciOversoldEnabled(v); saveAgentSettings({ cciOversoldEnabled: v })
                                        }} className="w-3.5 h-3.5 rounded border-border text-indigo-500 bg-background/50 accent-indigo-500" />
                                        <span className="text-xs text-foreground/80">과매도 트리거 (매수)</span>
                                    </label>
                                    <input type="number" disabled={!cciOversoldEnabled} value={cciOversoldLimit} onChange={(e) => {
                                        const v = Number(e.target.value); setCciOversoldLimit(v); saveAgentSettings({ cciOversoldLimit: v })
                                    }} className="w-16 h-7 text-xs bg-muted/20 border border-border/40 rounded text-center focus:outline-none focus:border-indigo-500 disabled:opacity-30" />
                                </div>
                            </div>
                            
                            <div className="border-t border-border/40 my-2" />
                            <div className="space-y-3">
                                <span className="text-sm font-bold flex items-center gap-2 mb-1 text-rose-500">
                                    <Activity className="w-4 h-4" /> 군집 AI 성과 초기화
                                </span>
                                <div className="text-xs text-muted-foreground mb-2">
                                    모든 페르소나의 누적/장중 승률 기록을 완전히 초기화합니다. (가중치 리셋)
                                </div>
                                <button
                                    onClick={async () => {
                                        if (window.confirm("정말로 모든 군집 AI의 승률 데이터를 초기화할까요?")) {
                                            const res = await window.electronAPI.clearPersonaPerformance();
                                            if (res.success) {
                                                alert("초기화가 완료되었습니다.\n다음 평가 시 처음부터 다시 집계됩니다.");
                                            } else {
                                                alert("초기화 실패: " + res.error);
                                            }
                                        }
                                    }}
                                    className="w-full py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-bold border border-rose-500/30 rounded-lg transition-colors text-sm"
                                >
                                    기록 파기 및 리셋
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Technical Digest Modal */}
            {showDigestModal && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDigestModal(false)}>
                    <div className="bg-background border border-border/60 rounded-xl shadow-2xl w-[600px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-border/40 bg-muted/20 flex justify-between items-center">
                            <h3 className="font-bold flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-400" /> 데이터 전처리 파이프라인 열람</h3>
                            <button onClick={() => setShowDigestModal(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5"/></button>
                        </div>
                        <div className="p-6 overflow-y-auto max-h-[70vh]">
                            {isDigestLoading ? (
                                <div className="text-center text-muted-foreground py-10 flex flex-col items-center gap-3">
                                    <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin"></div>
                                    <p className="text-sm font-medium">실시간 주가 데이터를 수학적으로 연산 중입니다...</p>
                                </div>
                            ) : (
                                <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed p-4 bg-muted/30 rounded-lg text-foreground/90 border border-border/40">
                                    {digestContent || '내용이 없습니다.'}
                                </pre>
                            )}
                        </div>
                        <div className="p-4 border-t border-border/40 bg-muted/10 text-xs text-muted-foreground opacity-70">
                            이 데이터는 로컬 전담 분석 AI(Front-line Analyst)에게 전달되어 추세 예측의 핵심 사료로 사용됩니다.
                        </div>
                    </div>
                </div>
            )}

            {/* ── 복수선택 삭제 팝업 ── */}
            {showDeleteModal && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setShowDeleteModal(false)}
                >
                    <div
                        className="bg-background border border-border/60 rounded-xl shadow-2xl w-[560px] max-h-[75vh] flex flex-col overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* 헤더 */}
                        <div className="p-4 border-b border-border/40 bg-muted/20 flex items-center justify-between">
                            <h3 className="font-bold flex items-center gap-2 text-sm">
                                <Trash2 className="w-4 h-4 text-rose-400" />
                                {deleteModalTarget === 'classic' ? '장전·마감 예측' : '장중 타이밍'} 항목 삭제
                            </h3>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">{selectedDeleteIds.size}건 선택됨</span>
                                <button onClick={() => setShowDeleteModal(false)} className="text-muted-foreground hover:text-foreground">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* 전체선택 */}
                        <div className="px-4 py-2 border-b border-border/30 bg-muted/10 flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="delete-select-all"
                                className="w-3.5 h-3.5 accent-rose-500"
                                checked={(() => {
                                    const list = deleteModalTarget === 'classic' ? history : intradayData
                                    return list.length > 0 && selectedDeleteIds.size === list.length
                                })()}
                                onChange={e => {
                                    const list = deleteModalTarget === 'classic' ? history : intradayData
                                    if (e.target.checked) {
                                        setSelectedDeleteIds(new Set(list.map((r: any) => r.id)))
                                    } else {
                                        setSelectedDeleteIds(new Set())
                                    }
                                }}
                            />
                            <label htmlFor="delete-select-all" className="text-xs text-muted-foreground cursor-pointer select-none">
                                전체선택 ({deleteModalTarget === 'classic' ? history.length : intradayData.length}건)
                            </label>
                        </div>

                        {/* 항목 리스트 */}
                        <div className="overflow-y-auto flex-1 py-1">
                            {(deleteModalTarget === 'classic' ? history : intradayData).map((row: any) => {
                                const isChecked = selectedDeleteIds.has(row.id)
                                const label = deleteModalTarget === 'classic'
                                    ? `${row.date}  ${row.cycle === 'A' ? '장전(A)' : row.cycle === 'P' ? '장중(P)' : '마감(B)'}  ${row.position || row.predict}`
                                    : `${row.date}  ${row.time_slot}  ${row.position || (row.predict === 'UP' ? 'KODEX 200' : row.predict === 'DOWN' ? 'KODEX 인버스' : 'HOLD')}`
                                return (
                                    <label
                                        key={row.id}
                                        className={cn(
                                            'flex items-center gap-3 px-4 py-2 cursor-pointer select-none transition-colors text-xs hover:bg-muted/30',
                                            isChecked && 'bg-rose-500/5'
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            className="w-3.5 h-3.5 accent-rose-500 shrink-0"
                                            checked={isChecked}
                                            onChange={e => {
                                                const next = new Set(selectedDeleteIds)
                                                if (e.target.checked) next.add(row.id)
                                                else next.delete(row.id)
                                                setSelectedDeleteIds(next)
                                            }}
                                        />
                                        <span className={cn('flex-1 font-mono', isChecked ? 'text-rose-400' : 'text-foreground/80')}>
                                            {label}
                                        </span>
                                        {isChecked && <Trash2 className="w-3 h-3 text-rose-400/60 shrink-0" />}
                                    </label>
                                )
                            })}
                        </div>

                        {/* 하단 액션 */}
                        <div className="p-4 border-t border-border/40 bg-muted/10 flex items-center justify-between gap-3">
                            <p className="text-xs text-muted-foreground opacity-70">⚠️ 삭제된 항목은 복구할 수 없습니다.</p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowDeleteModal(false)}
                                    className="px-4 py-1.5 text-xs border border-border/50 text-muted-foreground rounded-lg hover:bg-muted/30 transition-colors"
                                >
                                    취소
                                </button>
                                <button
                                    disabled={selectedDeleteIds.size === 0}
                                    onClick={async () => {
                                        if (selectedDeleteIds.size === 0) return
                                        const tableName = deleteModalTarget === 'classic' ? 'agent_predictions' : 'intraday_predictions'
                                        const ids = Array.from(selectedDeleteIds)
                                        try {
                                            const res = await (window.electronAPI as any).deleteManyMarketPredictions(ids, tableName)
                                            if (res.success) {
                                                setShowDeleteModal(false)
                                                setSelectedDeleteIds(new Set())
                                                await fetchData()
                                            } else {
                                                alert('삭제 실패: ' + res.error)
                                            }
                                        } catch (err: any) {
                                            alert('삭제 중 오류: ' + err.message)
                                        }
                                    }}
                                    className="px-4 py-1.5 text-xs bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    선택 삭제 ({selectedDeleteIds.size}건)
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showPerformancePopup && detailedStats && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-background border border-border/80 rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col m-4 max-h-[90vh]">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20">
                            <h2 className="text-sm font-bold flex items-center gap-2">
                                <Target className="w-4 h-4 text-fuchsia-500" />
                                시황 AI 사이클별 상세 성적 평가
                            </h2>
                            <button onClick={() => setShowPerformancePopup(false)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto space-y-6">
                            {(['A', 'P', 'B'] as const).map(cycle => {
                                const titleMap = { 'A': '장전 예측 (시초가 진입)', 'P': '장중 단기예측 (수급 추세 진입)', 'B': '장마감 예측 (종가 베팅)' };
                                const iconMap = { 'A': '🌅', 'P': '⚡', 'B': '🌇' };
                                const results = detailedStats[cycle];
                                if (!results) return null;
                                return (
                                    <div key={cycle} className="border border-border/40 bg-muted/5 rounded-lg p-4">
                                        <h3 className="text-sm font-bold mb-3 flex items-center gap-1.5"><span className="text-lg">{iconMap[cycle]}</span> {titleMap[cycle]}</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            {Object.entries(results).map(([period, data]: [string, any]) => (
                                                <div key={period} className="bg-background border border-border/50 rounded p-4 flex flex-col gap-2 relative overflow-hidden">
                                                    <div className="flex items-center justify-between border-b border-border/30 pb-2 mb-1">
                                                        <span className="text-sm font-bold text-muted-foreground">{period === 'T+1' ? '당일 (T+1)' : period} 대상</span>
                                                        <span className="text-xs text-muted-foreground font-mono bg-muted/30 px-1.5 py-0.5 rounded">{data.wins}/{data.total} 성공</span>
                                                    </div>
                                                    <div className="flex justify-between items-center px-1">
                                                        <div className="flex flex-col">
                                                            <span className="text-[10px] uppercase text-muted-foreground">누적 적중률</span>
                                                            <span className="font-mono text-[1.4rem] tracking-tight font-bold">{(data.winRate * 100).toFixed(1)}%</span>
                                                        </div>
                                                        <div className="flex flex-col text-right">
                                                            <span className="text-[10px] uppercase text-muted-foreground">누적 수익률</span>
                                                            <span className={cn("font-mono text-[1.4rem] tracking-tight font-bold", data.totalReturn > 0 ? "text-rose-500" : data.totalReturn < 0 ? "text-blue-500" : "")}>
                                                                {data.totalReturn > 0 ? '+' : ''}{data.totalReturn.toFixed(2)}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="w-full bg-muted/50 rounded-full h-1.5 mt-2 overflow-hidden border border-border/10">
                                                        <div className={cn("h-full transition-all", data.winRate >= 0.5 ? "bg-emerald-500" : "bg-rose-500")} style={{ width: `${Math.max(2, data.winRate * 100)}%` }} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>

    )
}
