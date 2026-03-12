import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TrendingUp, RefreshCw, Calendar, FileText, BarChart2, PieChart, Info, ShieldCheck, AlertCircle, Beaker, CheckCircle2, Newspaper, Rss } from 'lucide-react'
import { cn } from '../utils'
import { StockChart } from './StockChart'
import { StockNotes } from './StockNotes'
import { StockFinancials } from './StockFinancials'
import { StockAiReport } from './StockAiReport'

import { useLayoutStore } from '../store/useLayoutStore'
import { useTagStore } from '../store/useTagStore'
import { useRef } from 'react'

// 데이터 구조 정의
interface RisingStock {
    code: string
    name: string
    changeRate: number
    tradingValue?: number
    source?: 'RISING' | 'TRADING_VALUE' | 'BOTH'
    aiScore?: number
    reason?: string
    sector?: string
    tags?: string[]
}

interface DailyReport {
    date: string
    summary: string
    stocks: RisingStock[]
}

export default function RisingStocksReport() {
    const today = new Date().toISOString().split('T')[0]
    const [selectedDate, setSelectedDate] = useState<string>(today)
    const [selectedStock, setSelectedStock] = useState<{ code: string, name: string } | null>(null)
    const [activeTab, setActiveTab] = useState<'report' | 'news' | 'dart' | 'notes' | 'financials'>('report')
    const [sortOrder, setSortOrder] = useState<'score' | 'rate' | 'value'>('score')
    
    const [reports, setReports] = useState<DailyReport[]>([])
    const [realtimeRisingStocks, setRealtimeRisingStocks] = useState<RisingStock[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [evaluatingStock, setEvaluatingStock] = useState<{ code: string, name: string } | null>(null)
    const [testStatus, setTestStatus] = useState<string | null>(null)
    const [isTesting, setIsTesting] = useState(false)
    const [rawData, setRawData] = useState<{ news: any[], disclosures: any[], collectedAt?: string } | null>(null)
    const [rawDataLoading, setRawDataLoading] = useState(false)
    const [batchStatus, setBatchStatus] = useState<{ step: string, current: number, total: number, message: string } | null>(null)

    const { chartHeight, setChartHeight } = useLayoutStore()
    const { tags: tagStoreData } = useTagStore()
    const isDragging = useRef(false)
    const startY = useRef(0)
    const startHeight = useRef(0)

    // 섹션 이동을 위한 Refs
    const summaryRef = useRef<HTMLDivElement>(null)
    const outlookRef = useRef<HTMLDivElement>(null)
    const themesRef = useRef<HTMLDivElement>(null)
    const stocksRef = useRef<HTMLDivElement>(null)

    const scrollToSection = (ref: React.RefObject<HTMLDivElement>) => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

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

    // AI 분석 실시간 상태 구독
    React.useEffect(() => {
        if (!window.electronAPI?.onAiTradeEvaluationUpdate) return
        const unsubscribe = window.electronAPI.onAiTradeEvaluationUpdate((data: any) => {
            if (data.isEvaluating) {
                setEvaluatingStock(data.stock)
            } else {
                setEvaluatingStock(null)
            }
        })
        return () => unsubscribe()
    }, [])

    // 일괄 분석 진행률 구독
    React.useEffect(() => {
        if (!window.electronAPI?.onBatchProgress) return
        const unsubscribe = window.electronAPI.onBatchProgress((data: any) => {
            setBatchStatus(data)
            if (data.step === 'COMPLETE') {
                setTimeout(() => setBatchStatus(null), 5000)
                loadReportDetails(selectedDate)
            }
        })
        return () => unsubscribe()
    }, [selectedDate])

    // selectedStock 변경 시 원본 데이터(뉴스/공시) 로드 및 없을 경우 자동 수집
    React.useEffect(() => {
        if (!selectedStock || !selectedDate) { setRawData(null); return }
        const load = async () => {
            setRawDataLoading(true)
            try {
                // 1. 먼저 DB에서 기존 데이터 확인
                const res = await window.electronAPI?.getRawData?.({ date: selectedDate, stockCode: selectedStock.code })
                
                if (res?.success) {
                    setRawData(res.data)
                } else if (selectedDate === today) {
                    // 2. DB에 없고 오늘 날짜라면 즉시 수집 시도
                    console.log(`[RisingStocksReport] No raw data in DB for ${selectedStock.name}. Attempting auto collection...`)
                    
                    // 뉴스 수집
                    const newsRes = await window.electronAPI.collectNews({ 
                        date: today,
                        stockCode: selectedStock.code,
                        stockName: selectedStock.name 
                    })
                    
                    // 공시 수집
                    const dartRes = await window.electronAPI.collectDisclosures({ 
                        date: today,
                        stockCode: selectedStock.code,
                        stockName: selectedStock.name
                    })

                    setRawData({
                        news: newsRes.success ? (newsRes.data ?? []) : [],
                        disclosures: dartRes.success ? (dartRes.data ?? []) : [],
                        collectedAt: new Date().toISOString()
                    })
                } else {
                    setRawData(null)
                }
            } catch (err) {
                console.error('Error in auto raw data collection:', err)
                setRawData(null)
            }
            finally { setRawDataLoading(false) }
        }
        load()
    }, [selectedStock?.code, selectedDate])

    // 실시간 주도주 가져오기 (키움 API - 통합)
    const fetchRealtimeStocks = async (): Promise<RisingStock[]> => {
        setIsLoading(true)
        try {
            const result = await window.electronAPI.getCombinedTopStocks({ risingLimit: 50, tradingValueLimit: 50 })
            const rawList: any[] = result.data || []

            const etfKeywords = ['ETF', 'ETN', 'KODEX', 'TIGER', 'ACE', 'KBSTAR', 'ARIRANG', 'HANARO', 'SOL', 'KOSEF', 'KINDEX', 'KB스타', '스팩', 'SPAC']
            const mapped: RisingStock[] = rawList
                .filter((s: any) => {
                    const name = (s.name || '').replace(/\s+/g, '')
                    return name && !etfKeywords.some(kw => name.toUpperCase().includes(kw.toUpperCase()))
                })
                .map((s: any) => ({
                    code: String(s.code).replace(/[^0-9]/g, ''),
                    name: s.name.trim(),
                    changeRate: s.changeRate || 0,
                    tradingValue: s.tradingValue || 0,
                    source: s.source
                }))
                .filter(s => s.code)

            // DB에서 오늘 분석된 데이터도 함께 가져와서 병합
            let dbAnalysisMap = new Map<string, any>()
            try {
                const dbRes = await window.electronAPI.getRisingStocksByDate(today)
                if (dbRes.success && dbRes.data) {
                    dbRes.data.forEach((s: any) => {
                        const cleanCode = String(s.stock_code).replace(/[^0-9]/g, '')
                        dbAnalysisMap.set(cleanCode, s)
                    })
                }
            } catch (e) {
                console.warn('Failed to fetch DB analysis for merge:', e)
            }

            const merged = mapped.map(m => {
                const cleanCode = m.code.replace(/[^0-9]/g, '')
                const analyzed = dbAnalysisMap.get(cleanCode) || dbAnalysisMap.get(m.code)
                let parsedTags: string[] = []
                if (analyzed) {
                    try { parsedTags = analyzed.tags ? JSON.parse(analyzed.tags) : [] } catch (e) { }
                    parsedTags.forEach(t => useTagStore.getState().addTag(cleanCode, t))
                }
                return analyzed ? { 
                    ...m, 
                    aiScore: analyzed.ai_score,
                    reason: analyzed.reason,
                    sector: analyzed.theme_sector,
                    tags: parsedTags
                } : m
            })

            setRealtimeRisingStocks(merged)
            
            setReports(prev => {
                const existing = prev.find(r => r.date === today)
                const todayReport: DailyReport = {
                    date: today,
                    summary: existing?.summary || '당일 실시간 주도주 정보입니다.',
                    stocks: merged
                }
                const others = prev.filter(r => r.date !== today)
                return [todayReport, ...others]
            })

            return merged
        } catch (err) {
            console.error('Failed to fetch realtime stocks:', err)
            return []
        } finally {
            setIsLoading(false)
        }
    }

    // DB에서 저장된 리포트 내역(날짜 목록) 가져오기
    const fetchSavedReports = async () => {
        if (!window.electronAPI?.getReportHistory) return
        try {
            const result = await window.electronAPI.getReportHistory()
            if (result.success && result.data) {
                const dates = result.data.map((d: any) => d.date)
                
                // 각 날짜별로 기본 구조 생성 (상세 데이터는 선택 시 로드)
                const historyReports: DailyReport[] = dates.map((date: string) => ({
                    date,
                    summary: '데이터 로딩 중...',
                    stocks: []
                }))
                
                setReports(prev => {
                    // 오늘 데이터(실시간)는 유지하면서 히스토리 합치기
                    const todayData = prev.find(r => r.date === today)
                    const filteredHistory = historyReports.filter(r => r.date !== today)
                    return todayData ? [todayData, ...filteredHistory] : filteredHistory
                })
            }
        } catch (err) {
            console.error('Failed to fetch report history:', err)
        }
    }

    // 특정 날짜의 상세 데이터(리포트 & 종목리스트) 로드
    const loadReportDetails = async (date: string) => {
        if (!window.electronAPI) return
        
        try {
            const marketRes = await window.electronAPI.getMarketDailyReport(date)
            const stocksRes = await window.electronAPI.getRisingStocksByDate(date)
            
            setReports(prev => {
                const existing = prev.find(r => r.date === date)
                
                // DB에서 가져온 AI 분석 완료 종목
                const dbStocks: RisingStock[] = stocksRes.success && stocksRes.data
                    ? stocksRes.data.map((s: any) => {
                        const cleanCode = String(s.stock_code).replace(/[^0-9]/g, '')
                        let parsedTags: string[] = []
                        try { parsedTags = s.tags ? JSON.parse(s.tags) : [] } catch (e) { }
                        
                        // 자동 태그 저장
                        if (parsedTags.length > 0) {
                            parsedTags.forEach(t => useTagStore.getState().addTag(cleanCode, t))
                        }

                        return {
                            code: cleanCode,
                            name: s.stock_name,
                            changeRate: s.change_rate,
                            tradingValue: s.trading_value,
                            source: s.source,
                            aiScore: s.ai_score,
                            reason: s.reason,
                            sector: s.theme_sector,
                            tags: parsedTags
                        }
                    })
                    : []

                let mergedStocks: RisingStock[]
                if (date === today && existing && existing.stocks.length > 0) {
                    // 오늘 날짜 + 실시간 데이터가 이미 있는 경우: 실시간 목록에 DB AI 데이터를 병합
                    mergedStocks = existing.stocks.map(realtime => {
                        const analyzed = dbStocks.find(d => d.code === realtime.code)
                        return analyzed ? { 
                            ...realtime, 
                            aiScore: analyzed.aiScore,
                            reason: analyzed.reason,
                            sector: analyzed.sector,
                            tags: analyzed.tags
                        } : realtime
                    })
                    // DB에만 있고 실시간에 없는 종목도 누락없이 병합
                    const realtimeCodes = new Set(existing.stocks.map(s => s.code))
                    const extraFromDb = dbStocks.filter(d => !realtimeCodes.has(d.code))
                    mergedStocks = [...mergedStocks, ...extraFromDb]
                } else {
                    // 과거 날짜이거나 실시간 데이터가 없는 경우: DB 데이터 그대로 사용
                    mergedStocks = dbStocks
                }

                const summary = marketRes.success && marketRes.data
                    ? marketRes.data.market_summary
                    : (date === today ? '당일 실시간 급등주 정보입니다.' : '저장된 시장 총평이 없습니다.')

                const newReport: DailyReport = {
                    date,
                    summary,
                    stocks: mergedStocks
                }

                if (existing) {
                    return prev.map(r => r.date === date ? newReport : r)
                } else {
                    // 기존에 없던 날짜면 추가 (날짜순 정렬 유지하면 좋음)
                    return [...prev, newReport].sort((a, b) => b.date.localeCompare(a.date))
                }
            })
        } catch (err) {
            console.error(`Failed to load details for ${date}:`, err)
        }
    }

    React.useEffect(() => {
        fetchRealtimeStocks()
        fetchSavedReports()
    }, [])

    React.useEffect(() => {
        if (selectedDate) {
            loadReportDetails(selectedDate)
        }
    }, [selectedDate])

    // 개별 종목 AI 분석 실행
    const handleRunAnalysis = async (stock: RisingStock) => {
        if (!window.electronAPI?.runStockAnalysis) return
        if (evaluatingStock) return // 이미 분석 중인 경우 방지

        try {
            const result = await window.electronAPI.runStockAnalysis({
                code: stock.code,
                name: stock.name,
                changeRate: stock.changeRate,
                tradingValue: stock.tradingValue,
                source: stock.source
            })

            if (result.success) {
                // 분석 성공 시 해당 날짜 데이터 다시 로드
                loadReportDetails(selectedDate)
            } else {
                alert(`분석 실패: ${result.error}`)
            }
        } catch (err) {
            console.error('Analysis execution error:', err)
        }
    }

    // 시장 총평 AI 분석 실행
    const handleRunMarketReport = async () => {
        if (!window.electronAPI?.runMarketReport) return
        if (evaluatingStock) return

        try {
            const result = await window.electronAPI.runMarketReport(selectedDate)
            if (result.success) {
                loadReportDetails(selectedDate)
            } else {
                alert(`시장 총평 생성 실패: ${result.error}`)
            }
        } catch (err) {
            console.error('Market report execution error:', err)
        }
    }

    // 전체 일괄 분석 실행
    const handleRunBatchAnalysis = async () => {
        if (!window.electronAPI?.runBatchReport) return
        if (batchStatus || evaluatingStock) return

        try {
            const result = await window.electronAPI.runBatchReport()
            if (!result.success) {
                alert(`일괄 분석 중 오류: ${result.error}`)
            }
        } catch (err) {
            console.error('Batch report execution error:', err)
        }
    }

    // 수동 뉴스 수집
    const handleManualNewsCollect = async () => {
        if (!selectedStock || !selectedDate || !window.electronAPI.collectNews) return;
        setRawDataLoading(true);
        try {
            const res = await window.electronAPI.collectNews({ 
                date: selectedDate,
                stockCode: selectedStock.code,
                stockName: selectedStock.name 
            });
            if (!res.success) alert(`뉴스 수집 실패`);
            setRawData(prev => ({
                news: res.data ?? [],
                disclosures: prev?.disclosures ?? [],
                collectedAt: new Date().toISOString()
            }));
        } catch (err: any) {
            alert(`뉴스 수집 중 오류: ${err.message}`);
        } finally {
            setRawDataLoading(false);
        }
    };

    // 수동 공시 수집
    const handleManualDartCollect = async () => {
        if (!selectedStock || !selectedDate || !window.electronAPI.collectDisclosures) return;
        setRawDataLoading(true);
        try {
            const res = await window.electronAPI.collectDisclosures({ 
                date: selectedDate,
                stockCode: selectedStock.code,
                stockName: selectedStock.name
            });
            if (!res.success) alert(`공시 수집 실패`);
            setRawData(prev => ({
                news: prev?.news ?? [],
                disclosures: res.data ?? [],
                collectedAt: new Date().toISOString()
            }));
        } catch (err: any) {
            alert(`공시 수집 중 오류: ${err.message}`);
        } finally {
            setRawDataLoading(false);
        }
    };

    // 현재 선택된 날짜의 리포트 데이터
    const currentReport = reports.find(r => r.date === selectedDate) || {
        date: selectedDate,
        summary: selectedDate === today ? '당일 실시간 주도주 정보입니다. AI 분석 버튼을 눌러 리포트를 생성하세요.' : '해당 일자의 리포트가 없습니다.',
        stocks: selectedDate === today ? realtimeRisingStocks : []
    }

    // 전체 시스템 자동 테스트 시나리오
    const runSystemTest = async () => {
        if (isTesting || isLoading || evaluatingStock) return
        setIsTesting(true)
        
        try {
            // STEP 1: 데이터 수급 테스트 - 반환값을 직접 사용 (React 클로저 문제 우회)
            setTestStatus("단계 1/4: 실시간 주도주 데이터를 수집 중...")
            const freshStocks = await fetchRealtimeStocks()
            await new Promise(resolve => setTimeout(resolve, 1000))

            // 반환된 배열을 직접 사용 (state 아님)
            const target = freshStocks[0]
            if (!target) {
                setTestStatus("오류: 분석할 종목 데이터가 없습니다. 장시간 중인지 확인하세요.")
                setTimeout(() => { setIsTesting(false); setTestStatus(null); }, 3000)
                return
            }

            // STEP 2: 종목 자동 선택
            setTestStatus(`단계 2/4: 분석 대상 선정 [${target.name}]`)
            setSelectedDate(today)
            setSelectedStock({ code: target.code, name: target.name })
            await new Promise(resolve => setTimeout(resolve, 1000))

            // STEP 3: AI 종목 분석 테스트
            setTestStatus(`단계 3/4: [${target.name}] AI 심층 분석 중 (뉴스/공시/차트 수집)...`)
            const analysisResult = await window.electronAPI.runStockAnalysis({
                code: target.code,
                name: target.name,
                changeRate: target.changeRate
            })
            
            if (!analysisResult.success) throw new Error(analysisResult.error)
            await loadReportDetails(today)
            await new Promise(resolve => setTimeout(resolve, 1000))

            // STEP 4: 시장 총평 생성 테스트
            setTestStatus("단계 4/4: 당일 시장 전체 요약 리포트 생성 중...")
            const marketResult = await window.electronAPI.runMarketReport(today)
            
            if (!marketResult.success) throw new Error(marketResult.error)
            await loadReportDetails(today)
            
            setTestStatus("✅ 모든 시스템 테스트가 성공적으로 완료되었습니다!")
        } catch (err: any) {
            console.error('Test system error:', err)
            setTestStatus(`❌ 테스트 실패: ${err.message}`)
        } finally {
            setTimeout(() => {
                setIsTesting(false)
                setTestStatus(null)
            }, 4000)
        }
    }

    return (
        <div className="flex h-full overflow-hidden">
            {/* 왼쪽 패널: 리포트 리스트 */}
            <div className="w-[320px] shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
                <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <TrendingUp size={18} className="text-primary" />
                            <h2 className="text-sm font-bold">급등주 리포트</h2>
                        </div>
                        <button 
                            onClick={runSystemTest}
                            disabled={isTesting || isLoading || !!evaluatingStock}
                            className={cn(
                                "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold transition-all border",
                                isTesting 
                                    ? "bg-primary/10 border-primary/30 text-primary animate-pulse" 
                                    : "bg-muted/50 border-border text-muted-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary"
                            )}
                        >
                            <Beaker size={12} />
                            테스트
                        </button>
                    </div>
                    <button 
                        onClick={() => fetchRealtimeStocks()}
                        disabled={isLoading || isTesting}
                        className="p-1.5 hover:bg-muted rounded-lg transition-colors group"
                    >
                        <RefreshCw size={14} className={cn("text-muted-foreground group-active:rotate-180 transition-transform", isLoading && "animate-spin")} />
                    </button>
                </div>

                <div className="px-4 py-2 border-b border-border bg-muted/5 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">정렬 기준</span>
                        <div className="flex bg-muted/50 rounded-md p-0.5">
                            {[
                                { id: 'score', label: 'AI 점수', color: 'bg-primary' },
                                { id: 'rate', label: '상승률', color: 'bg-destructive' },
                                { id: 'value', label: '거래대금', color: 'bg-indigo-500' }
                            ].map((opt) => (
                                <button
                                    key={opt.id}
                                    onClick={() => setSortOrder(opt.id as any)}
                                    className={cn(
                                        "px-2 py-1 text-[9px] font-bold rounded transition-all",
                                        sortOrder === opt.id ? `${opt.color} text-white shadow-sm` : "text-muted-foreground hover:bg-muted"
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-4">
                    {reports.length === 0 && !isLoading && (
                        <div className="text-center py-10 text-muted-foreground text-xs">데이터가 없습니다.</div>
                    )}
                    {reports.map((report) => (
                        <div key={report.date} className="space-y-1">
                            <button 
                                onClick={() => {
                                    setSelectedDate(report.date)
                                    setSelectedStock(null)
                                }}
                                className={cn(
                                    "w-full px-3 py-2.5 flex items-center justify-between text-[10px] font-bold rounded-xl mb-2 transition-all",
                                    (selectedDate === report.date && selectedStock === null)
                                        ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                                        : "text-muted-foreground bg-muted/10 hover:bg-muted/20"
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <Calendar size={12} />
                                    {report.date} 주도주 리포트
                                </div>
                                <div className="flex items-center gap-1 opacity-80">
                                    <FileText size={10} />
                                    시황 총평
                                </div>
                            </button>
                            
                            {[...report.stocks]
                                .sort((a, b) => {
                                    if (sortOrder === 'score') return (b.aiScore || 0) - (a.aiScore || 0) || b.changeRate - a.changeRate
                                    if (sortOrder === 'rate') return b.changeRate - a.changeRate
                                    if (sortOrder === 'value') return (b.tradingValue || 0) - (a.tradingValue || 0)
                                    return 0
                                })
                                .map((stock) => (
                                <div 
                                    key={stock.code} 
                                    onClick={() => {
                                        setSelectedDate(report.date)
                                        setSelectedStock({ code: stock.code, name: stock.name })
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            setSelectedDate(report.date)
                                            setSelectedStock({ code: stock.code, name: stock.name })
                                        }
                                    }}
                                    className={cn(
                                        "w-full p-2.5 rounded-xl flex items-center gap-2.5 transition-all text-left border mb-1.5 cursor-pointer relative overflow-hidden group/item",
                                        (selectedStock?.code === stock.code && selectedDate === report.date)
                                            ? "bg-primary/5 border-primary/30 shadow-sm ring-1 ring-primary/10"
                                            : "hover:bg-muted/50 border-transparent"
                                    )}
                                >
                                    <div className={cn(
                                        "absolute left-0 top-0 bottom-0 w-1 opacity-60",
                                        stock.source === 'BOTH' ? "bg-indigo-500" :
                                        stock.source === 'RISING' ? "bg-destructive" :
                                        "bg-blue-500"
                                    )} title={stock.source} />

                                    {/* AI Score Badge */}
                                    <div className="relative shrink-0">
                                        {stock.aiScore ? (
                                            <div 
                                                className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm transition-colors"
                                                style={{ 
                                                    backgroundColor: stock.aiScore >= 80 ? '#22C55E' : 
                                                                     stock.aiScore >= 60 ? '#EAB308' : 
                                                                     stock.aiScore >= 40 ? '#F97316' : '#EF4444',
                                                }}
                                            >
                                                <span className="text-white font-bold text-[11px] font-mono">
                                                    {stock.aiScore}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                                                {evaluatingStock?.code === stock.code ? (
                                                    <RefreshCw size={12} className="text-primary animate-spin" />
                                                ) : (
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            handleRunAnalysis(stock)
                                                        }}
                                                        className="w-full h-full flex items-center justify-center hover:bg-primary/20 rounded-lg transition-colors group/btn"
                                                    >
                                                        <ShieldCheck size={12} className="text-muted-foreground group-hover/btn:text-primary" />
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Stock Info */}
                                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="text-[11px] font-bold truncate">{stock.name}</span>
                                            <span className={cn(
                                                "text-[11px] font-mono font-bold",
                                                (stock.changeRate || 0) > 0 ? "text-destructive" : (stock.changeRate || 0) < 0 ? "text-blue-500" : "text-muted-foreground"
                                            )}>
                                                {Number(stock.changeRate) > 0 ? '+' : ''}
                                                {Number(stock.changeRate || 0).toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5 whitespace-nowrap overflow-hidden">
                                            <span className="text-[9px] text-muted-foreground font-mono opacity-60">{stock.code}</span>
                                            {stock.tradingValue && (
                                                <span className="text-[9px] font-medium text-indigo-500/80">
                                                    {Math.round(stock.tradingValue / 100)}억
                                                </span>
                                            )}
                                            {(() => {
                                                const storeTags = tagStoreData[stock.code] || []
                                                const aiTags = stock.tags || []
                                                const merged = [...new Set([...storeTags, ...aiTags])]
                                                if (merged.length === 0) return null
                                                return (
                                                    <span className="text-[9px] font-medium text-primary/70 truncate">
                                                        #{merged[0]}{merged.length > 1 ? ` +${merged.length - 1}` : ''}
                                                    </span>
                                                )
                                            })()}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* 오른쪽 패널: 상세 정보 */}
            <div className="flex-1 flex flex-col overflow-hidden bg-background">
                {selectedStock ? (
                    <>
                        {/* 상단: 차트 영역 */}
                        <div 
                            style={{ height: chartHeight }}
                            className="shrink-0 border-b border-border relative bg-background"
                        >
                             <StockChart stockCode={selectedStock.code} stockName={selectedStock.name} className="h-full w-full" />
                             {/* Resizer handle */}
                             <div
                                className="absolute bottom-0 left-0 right-0 h-[3px] bg-border hover:bg-primary/50 cursor-row-resize translate-y-1/2 z-20 transition-colors"
                                onMouseDown={handleResizeStart}
                             />
                             {/* Floating Analyze Button for Detail View */}
                             <div className="absolute top-4 right-4 z-20">
                                <button 
                                    onClick={() => {
                                        const stock = currentReport.stocks.find(s => s.code === selectedStock.code)
                                        if (stock) handleRunAnalysis(stock)
                                    }}
                                    disabled={!!evaluatingStock}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-2 rounded-full font-bold text-xs transition-all shadow-lg",
                                        evaluatingStock?.code === selectedStock.code
                                            ? "bg-primary text-white animate-pulse"
                                            : "bg-background/80 backdrop-blur-md border border-border hover:bg-primary hover:text-white hover:border-primary"
                                    )}
                                >
                                    {evaluatingStock?.code === selectedStock.code ? (
                                        <>
                                            <RefreshCw size={14} className="animate-spin" />
                                            AI 분석 중...
                                        </>
                                    ) : (
                                        <>
                                            <ShieldCheck size={14} />
                                            AI 즉시 분석
                                        </>
                                    )}
                                </button>
                             </div>
                        </div>

                        {/* 하단: 상세 탭 영역 */}
                        <div className="flex-1 flex flex-col overflow-hidden shadow-2xl z-10">
                            <div className="flex items-center px-6 border-b border-border space-x-1 bg-muted/20 overflow-x-auto">
                                {[
                                    { id: 'report', name: 'AI 리포트', icon: FileText },
                                    { id: 'news', name: '뉴스', icon: Newspaper },
                                    { id: 'dart', name: 'DART 공시', icon: Rss },
                                    { id: 'notes', name: '노트', icon: PieChart },
                                    { id: 'financials', name: '재무', icon: BarChart2 }
                                ].map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id as any)}
                                        className={cn(
                                            "flex items-center gap-2 px-6 py-4 text-[11px] font-bold border-b-2 transition-all relative top-[1px]",
                                            activeTab === tab.id
                                                ? "border-primary text-primary bg-background"
                                                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                        )}
                                    >
                                        <tab.icon size={14} />
                                        {tab.name}
                                    </button>
                                ))}
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-background">
                                {activeTab === 'report' && <StockAiReport symbol={selectedStock.code} name={selectedStock.name} />}
                                {activeTab === 'notes' && <StockNotes stockCode={selectedStock.code} stockName={selectedStock.name} />}
                                {activeTab === 'financials' && <StockFinancials stockCode={selectedStock.code} stockName={selectedStock.name} />}

                                {/* 뉴스 탭 */}
                                {activeTab === 'news' && (
                                    <div className="space-y-3">
                                        {rawData?.collectedAt && (
                                            <div className="flex justify-end mb-1">
                                                <span className="text-[10px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full font-mono">
                                                    수집 시점: {new Date(rawData.collectedAt).toLocaleString('ko-KR')}
                                                </span>
                                            </div>
                                        )}
                                        {rawDataLoading ? (
                                            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
                                                <RefreshCw size={16} className="animate-spin" /> 뉴스 데이터 로딩 중...
                                            </div>
                                        ) : !rawData || rawData.news.length === 0 ? (
                                            <div className="text-center py-8 text-muted-foreground text-sm">
                                                <Newspaper size={32} className="mx-auto mb-2 opacity-30" />
                                                <p>수집된 뉴스가 없습니다.</p>
                                                <button 
                                                    onClick={handleManualNewsCollect}
                                                    disabled={rawDataLoading}
                                                    className="mt-4 px-4 py-2 bg-primary/10 text-primary rounded-xl text-xs font-bold hover:bg-primary/20 transition-all flex items-center gap-2 mx-auto"
                                                >
                                                    <RefreshCw size={14} className={cn(rawDataLoading && "animate-spin")} />
                                                    뉴스 수동 수집 실행
                                                </button>
                                                <p className="text-[10px] mt-2 opacity-60">네이버 API 키가 정상적으로 등록되어 있는지 확인하세요.</p>
                                            </div>
                                        ) : rawData.news.map((item: any, idx: number) => (
                                            <div key={idx} className="p-4 bg-card border border-border/60 rounded-2xl space-y-1.5 hover:border-primary/30 transition-colors">
                                                <div className="flex items-start justify-between gap-2">
                                                    <a href={item.link || item.originallink} target="_blank" rel="noopener noreferrer"
                                                        className="text-sm font-bold leading-tight hover:text-primary transition-colors line-clamp-2">
                                                        {item.title}
                                                    </a>
                                                    <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                                                        {item.pubDate ? new Date(item.pubDate).toLocaleDateString('ko-KR') : ''}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{item.description}</p>
                                            </div>
                                        ))}
                                        {rawData && rawData.news.length > 0 && (
                                            <div className="flex justify-center pt-2">
                                                <button 
                                                    onClick={handleManualNewsCollect}
                                                    disabled={rawDataLoading}
                                                    className="text-[10px] text-primary hover:underline flex items-center gap-1"
                                                >
                                                    <RefreshCw size={10} className={cn(rawDataLoading && "animate-spin")} />
                                                    뉴스 다시 수집하기
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* DART 공시 탭 */}
                                {activeTab === 'dart' && (
                                    <div className="space-y-3">
                                        {rawData?.collectedAt && (
                                            <div className="flex justify-end mb-1">
                                                <span className="text-[10px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full font-mono">
                                                    수집 시점: {new Date(rawData.collectedAt).toLocaleString('ko-KR')}
                                                </span>
                                            </div>
                                        )}
                                        {rawDataLoading ? (
                                            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
                                                <RefreshCw size={16} className="animate-spin" /> 공시 데이터 로딩 중...
                                            </div>
                                        ) : !rawData || rawData.disclosures.length === 0 ? (
                                            <div className="text-center py-8 text-muted-foreground text-sm">
                                                <Rss size={32} className="mx-auto mb-2 opacity-30" />
                                                <p>수집된 공시가 없습니다.</p>
                                                <button 
                                                    onClick={handleManualDartCollect}
                                                    disabled={rawDataLoading}
                                                    className="mt-4 px-4 py-2 bg-amber-500/10 text-amber-600 rounded-xl text-xs font-bold hover:bg-amber-500/20 transition-all flex items-center gap-2 mx-auto"
                                                >
                                                    <RefreshCw size={14} className={cn(rawDataLoading && "animate-spin")} />
                                                    DART 공시 수동 수집 실행
                                                </button>
                                                <p className="text-[10px] mt-2 opacity-60">DART API 키와 법인코드 동기화 여부를 확인하세요.</p>
                                            </div>
                                        ) : rawData.disclosures.map((item: any, idx: number) => (
                                            <div key={idx} className="p-4 bg-card border border-border/60 rounded-2xl space-y-1 hover:border-amber-500/30 transition-colors">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-black text-amber-500 font-mono">
                                                        {item.rcept_dt ? `${item.rcept_dt.slice(0,4)}-${item.rcept_dt.slice(4,6)}-${item.rcept_dt.slice(6,8)}` : ''}
                                                    </span>
                                                    {item.rcept_no && (
                                                        <a href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`}
                                                            target="_blank" rel="noopener noreferrer"
                                                            className="text-[10px] text-primary hover:underline">
                                                            원문 보기 →
                                                        </a>
                                                    )}
                                                </div>
                                                <p className="text-sm font-bold leading-tight">{item.report_nm}</p>
                                                {item.flr_nm && <p className="text-xs text-muted-foreground">제출: {item.flr_nm}</p>}
                                            </div>
                                        ))}
                                        {rawData && rawData.disclosures.length > 0 && (
                                            <div className="flex justify-center pt-2">
                                                <button 
                                                    onClick={handleManualDartCollect}
                                                    disabled={rawDataLoading}
                                                    className="text-[10px] text-amber-600 hover:underline flex items-center gap-1"
                                                >
                                                    <RefreshCw size={10} className={cn(rawDataLoading && "animate-spin")} />
                                                    공시 다시 수집하기
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar bg-background scroll-smooth">
                        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-400">
                             {/* 슬림 헤더 & 빠른 내비게이션 */}
                             <div className="sticky top-[-16px] z-30 bg-background/95 backdrop-blur-sm border-b border-border/40 py-2 -mx-4 px-4 flex items-center justify-between mb-6 shadow-sm">
                                 <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                                     {[
                                         { label: '마켓 서머리', ref: summaryRef, icon: FileText },
                                         { label: '시황 전망', ref: outlookRef, icon: TrendingUp },
                                         { label: '주도 테마', ref: themesRef, icon: BarChart2 },
                                         { label: '주요 종목', ref: stocksRef, icon: Info }
                                     ].map((tab, i) => (
                                         <button
                                             key={i}
                                             onClick={() => scrollToSection(tab.ref)}
                                             className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all whitespace-nowrap"
                                         >
                                             <tab.icon size={13} />
                                             {tab.label}
                                         </button>
                                     ))}
                                 </div>
                                 <div className="flex items-center gap-2">
                                     <button 
                                        onClick={handleRunBatchAnalysis}
                                        disabled={!!evaluatingStock || !!batchStatus}
                                        className={cn(
                                            "flex items-center gap-1.5 px-4 py-1.5 rounded-full font-bold text-[11px] transition-all",
                                             batchStatus
                                                 ? "bg-primary text-white animate-pulse"
                                                 : "bg-indigo-600 text-white hover:bg-indigo-700"
                                        )}
                                     >
                                        {batchStatus ? <RefreshCw size={12} className="animate-spin" /> : <FileText size={12} />}
                                        리포트 생성
                                     </button>
                                     
                                     <button 
                                        onClick={handleRunMarketReport}
                                        disabled={!!batchStatus || !!evaluatingStock}
                                        className="p-1.5 text-muted-foreground hover:bg-muted rounded-full transition-colors"
                                        title="시장 총평만 다시 생성"
                                     >
                                          <RefreshCw size={14} className={cn(evaluatingStock?.code === 'MARKET' && "animate-spin")} />
                                     </button>
                                 </div>
                             </div>

                             {(() => {
                                 let parsed: any = { summary_lines: [], market_outlook: '', top_themes: [] };
                                 try {
                                     const raw = currentReport.summary || '';
                                     if (raw.startsWith('{')) {
                                         const p = JSON.parse(raw);
                                         parsed = {
                                             summary_lines: p.summary_lines || (p.market_summary ? [p.market_summary] : []),
                                             market_outlook: p.market_outlook || '',
                                             top_themes: p.top_themes || []
                                         };
                                     } else {
                                         parsed.summary_lines = [raw];
                                     }
                                 } catch (e) {
                                     parsed.summary_lines = [currentReport.summary];
                                 }

                                 return (
                                    <div className="space-y-12 pb-20">
                                        {/* 섹션 1: 마켓 서머리 - 고밀도 넘버링 리스트 */}
                                        <section ref={summaryRef} className="scroll-mt-20">
                                            <div className="flex items-center gap-2 mb-4">
                                                <div className="w-1.5 h-4 bg-indigo-500 rounded-full" />
                                                <h3 className="text-base font-black">Today's Market 3-Line Summary</h3>
                                            </div>
                                            <div className="bg-indigo-500/[0.03] border-l-2 border-indigo-500/30 py-4 px-6 space-y-3">
                                                {parsed.summary_lines.length > 0 ? parsed.summary_lines.map((line: string, i: number) => (
                                                    <div key={i} className="flex gap-3 text-[14px] leading-relaxed">
                                                        <span className="text-indigo-500 font-black font-mono">0{i+1}</span>
                                                        <p className="text-foreground/95 font-semibold tracking-tight">{line}</p>
                                                    </div>
                                                )) : <p className="text-muted-foreground text-xs italic">리포트가 작성되지 않았습니다.</p>}
                                            </div>
                                        </section>

                                        {/* 섹션 2: 시황 전망 */}
                                        <section ref={outlookRef} className="scroll-mt-20">
                                            <div className="flex items-center gap-2 mb-4">
                                                <div className="w-1.5 h-4 bg-amber-500 rounded-full" />
                                                <h3 className="text-base font-black">Market Outlook & Strategy</h3>
                                            </div>
                                            <div className="pl-4 border-l-2 border-amber-500/20">
                                                 <div className="text-[14px] text-foreground/90 leading-relaxed font-medium">
                                                     <ReactMarkdown
                                                         remarkPlugins={[remarkGfm]}
                                                         components={{
                                                             p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
                                                             strong: ({ children }) => <strong className="font-black text-foreground underline decoration-amber-500/20 underline-offset-4">{children}</strong>,
                                                         }}
                                                     >
                                                         {parsed.market_outlook || '시황 분석 데이터가 존재하지 않습니다.'}
                                                     </ReactMarkdown>
                                                 </div>
                                             </div>
                                        </section>

                                        {/* 섹션 3: 주도 테마 - 고밀도 랭킹 리스트 */}
                                        <section ref={themesRef} className="scroll-mt-20">
                                            <div className="flex items-center gap-2 mb-5">
                                                <div className="w-1.5 h-4 bg-emerald-500 rounded-full" />
                                                <h3 className="text-base font-black">Theme Ranking & Issues</h3>
                                            </div>
                                            
                                            <div className="space-y-1">
                                                {parsed.top_themes.length > 0 ? parsed.top_themes.map((theme: any, idx: number) => (
                                                    <div key={idx} className="group/theme py-5 border-b border-border/40 last:border-0 transition-colors">
                                                         <div className="mb-3">
                                                             <div className="flex items-center gap-3 mb-2">
                                                                 <span className="text-lg font-black font-mono text-muted-foreground/30 italic">#{idx+1}</span>
                                                                 <span className="text-sm font-black text-foreground">{theme.theme_name}</span>
                                                                 <div className={cn(
                                                                     "px-2 py-0.5 rounded-full text-[9px] font-black uppercase flex items-center gap-1",
                                                                     theme.rating?.toLowerCase().includes('good') ? "bg-emerald-500/10 text-emerald-600" :
                                                                     theme.rating?.toLowerCase().includes('caution') ? "bg-rose-500/10 text-rose-600" :
                                                                     "bg-amber-500/10 text-amber-600"
                                                                 )}>
                                                                     {theme.rating || 'NORMAL'}
                                                                 </div>
                                                             </div>
                                                             <div className="pl-9 space-y-3">
                                                                 <p className="text-[13px] text-foreground/80 font-medium leading-relaxed whitespace-pre-wrap">
                                                                     {theme.issue}
                                                                 </p>
                                                                 
                                                                 <div className="bg-muted/30 rounded-lg px-4 py-2.5 border border-border/40">
                                                                     <div className="flex items-center gap-2 mb-1.5">
                                                                         <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Next Outlook</span>
                                                                         <div className="h-[1px] flex-1 bg-border/40"></div>
                                                                     </div>
                                                                     <p className="text-[11px] font-extrabold text-primary leading-normal">
                                                                         {theme.outlook}
                                                                     </p>
                                                                 </div>
                                                             </div>
                                                         </div>
                                                        
                                                        {/* 테마 연계 종목 - 공간 최적화 뱃지 */}
                                                        <div className="pl-9 flex flex-wrap gap-1.5">
                                                            {theme.leading_stocks?.map((name: string, i: number) => {
                                                                const stock = currentReport.stocks.find(s => s.name === name);
                                                                return (
                                                                    <div 
                                                                        key={i} 
                                                                        onClick={() => stock && setSelectedStock({ code: stock.code, name: stock.name })}
                                                                        className={cn(
                                                                            "px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all cursor-pointer",
                                                                            stock ? "bg-muted/30 border-border hover:border-primary/50 hover:bg-primary/[0.02]" : "bg-muted/10 border-dashed border-border/40 text-muted-foreground cursor-default"
                                                                        )}
                                                                    >
                                                                        {name}
                                                                        {stock && (
                                                                            <span className={cn("ml-1.5 font-mono", stock.changeRate > 0 ? "text-destructive" : "text-blue-500")}>
                                                                                {stock.changeRate > 0 ? '+' : ''}{stock.changeRate.toFixed(1)}%
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )) : <p className="text-muted-foreground text-xs py-4 pl-4 border-l border-dashed">주도 테마 정보가 없습니다.</p>}
                                            </div>
                                        </section>

                                        {/* 섹션 4: 주요 종목별 특징 */}
                                        <section ref={stocksRef} className="scroll-mt-20">
                                            <div className="flex items-center gap-2 mb-6">
                                                <div className="w-1.5 h-4 bg-primary/60 rounded-full" />
                                                <h3 className="text-base font-black">Featured Stocks Analysis</h3>
                                            </div>
                                            <div className="space-y-0.5">
                                                {currentReport.stocks.filter(s => s.reason).map((s, idx) => (
                                                    <div 
                                                        key={s.code} 
                                                        className="py-4 border-b border-border/40 last:border-0 hover:bg-muted/[0.01] transition-colors"
                                                    >
                                                        <div className="flex items-center gap-2 mb-2.5">
                                                             <div className="w-1.5 h-3.5 bg-primary/40 rounded-full" />
                                                             <strong className="text-[14px] text-foreground font-black tracking-tight">{s.name}</strong>
                                                             <span className="text-[10px] px-2 py-0.5 rounded-sm bg-muted text-foreground/70 font-bold border border-border/40">{s.sector || '테마 미분류'}</span>
                                                            {s.aiScore && (
                                                                <span 
                                                                    className="ml-auto text-[10px] font-bold font-mono px-1.5 py-0.5 rounded text-white"
                                                                    style={{ backgroundColor: s.aiScore >= 80 ? '#22C55E' : s.aiScore >= 60 ? '#EAB308' : '#EF4444' }}
                                                                >
                                                                    {s.aiScore} pts
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="pl-3 text-[12px] text-muted-foreground leading-relaxed">
                                                            <ReactMarkdown components={{ p: ({ children }) => <p className="opacity-90">{children}</p> }}>
                                                                {s.reason || ''}
                                                            </ReactMarkdown>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    </div>
                                 )
                             })()}
                         </div>
                     </div>
                 )}
             </div>            {/* 테스트 진행 알림 토스트 */}
            {testStatus && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className={cn(
                        "flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl border backdrop-blur-md min-w-[400px]",
                        testStatus.includes('❌') ? "bg-destructive/10 border-destructive/20 text-destructive" :
                        testStatus.includes('✅') ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : 
                        "bg-background/80 border-border text-foreground"
                    )}>
                        {testStatus.includes('❌') ? <AlertCircle size={20} /> : 
                         testStatus.includes('✅') ? <CheckCircle2 size={20} className="animate-bounce" /> : 
                         <RefreshCw size={20} className="animate-spin text-primary" />}
                        <div className="flex-1">
                            <div className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-0.5">System Analysis Test</div>
                            <div className="text-sm font-bold">{testStatus}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* 일괄 분석 진행률 토스트 */}
            {batchStatus && (
                <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="bg-background/90 backdrop-blur-xl border border-indigo-500/30 rounded-[32px] p-1 shadow-2xl min-w-[500px]">
                        <div className="px-6 py-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                                        <RefreshCw size={16} className="animate-spin" />
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-black text-indigo-500 uppercase tracking-widest leading-none mb-1">Batch Analysis Process</div>
                                        <div className="text-sm font-bold leading-none">{batchStatus.message}</div>
                                    </div>
                                </div>
                                <div className="text-xs font-mono font-bold text-indigo-500">
                                    {Math.round((batchStatus.current / batchStatus.total) * 100)}%
                                </div>
                            </div>
                            
                            {/* Progress bar */}
                            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-indigo-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                                    style={{ width: `${(batchStatus.current / batchStatus.total) * 100}%` }}
                                />
                            </div>

                            {/* Phase labels */}
                            <div className="flex justify-between text-[9px] font-black text-muted-foreground uppercase tracking-tighter px-1">
                                <span className={cn(batchStatus.step === 'STOCKS' && "text-indigo-500")}>1. List</span>
                                <span className={cn(batchStatus.step === 'DATA' && "text-indigo-500")}>2. Data</span>
                                <span className={cn(batchStatus.step === 'ANALYSIS' && "text-indigo-500")}>3. AI Batch</span>
                                <span className={cn(batchStatus.step === 'SUMMARY' && "text-indigo-500")}>4. Summary</span>
                                <span className={cn(batchStatus.step === 'COMPLETE' && "text-emerald-500")}>5. Done</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
