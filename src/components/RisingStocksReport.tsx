import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TrendingUp, RefreshCw, Calendar, FileText, BarChart2, PieChart, Info, ShieldCheck, AlertCircle, Beaker, CheckCircle2, Newspaper, Rss, Settings, Clock, Bell, Save, Trash2, X } from 'lucide-react'
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
    const getLocalDate = () => {
        const d = new Date()
        const offset = d.getTimezoneOffset() * 60000
        return new Date(d.getTime() - offset).toISOString().split('T')[0]
    }
    const today = getLocalDate()
    const [selectedDate, setSelectedDate] = useState<string>(today)
    const [selectedTiming, setSelectedTiming] = useState<'MORNING' | 'EVENING'>(
        new Date().getHours() < 14 ? 'MORNING' : 'EVENING'
    )
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
    const [aiReportRefreshTrigger, setAiReportRefreshTrigger] = React.useState(0)
    const [batchStatus, setBatchStatus] = useState<{ step: string, current: number, total: number, message: string } | null>(null)
    const [marketStatus, setMarketStatus] = useState<{ isLive: boolean, message: string }>({ isLive: false, message: '확인 중...' })
    
    // 장 상태 체크 (운영 원칙 9.3)
    const checkMarketStatus = () => {
        const now = new Date()
        const day = now.getDay()
        const hour = now.getHours()
        const minute = now.getMinutes()
        const timeVal = hour * 100 + minute

        const isWeekend = day === 0 || day === 6
        const isBeforeMarket = timeVal < 900
        const isAfterMarket = timeVal >= 1530

        if (isWeekend) return { isLive: false, message: '주말 (장 마감)' }
        if (isBeforeMarket) return { isLive: false, message: '장 시작 전' }
        if (isAfterMarket) return { isLive: false, message: '장 마감' }
        return { isLive: true, message: '실시간 (장중)' }
    }
    // 스케줄 설정 상태
    const [showSettings, setShowSettings] = useState(false)
    const [scheduleConfig, setScheduleConfig] = useState({
        enabled: true,
        morningTime: '10:00',
        eveningTime: '15:40',
        telegramNotify: true
    })

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

    // 스케줄 설정 로드
    React.useEffect(() => {
        const loadSettings = async () => {
            if (window.electronAPI?.getAiScheduleSettings) {
                const res = await window.electronAPI.getAiScheduleSettings()
                if (res.success && res.data) {
                    setScheduleConfig(res.data)
                }
            }
        }
        loadSettings()
    }, [])

    const saveScheduleSettings = async () => {
        if (window.electronAPI?.saveAiScheduleSettings) {
            const res = await window.electronAPI.saveAiScheduleSettings(scheduleConfig)
            if (res.success) {
                setShowSettings(false)
            } else {
                alert(`설정 저장 실패: ${res.error}`)
            }
        }
    }

    // 일괄 분석 진행률 구독
    React.useEffect(() => {
        if (!window.electronAPI?.onBatchProgress) return
        const unsubscribe = window.electronAPI.onBatchProgress((data: any) => {
            setBatchStatus(data)
            if (data.step === 'COMPLETE') {
                setTimeout(() => setBatchStatus(null), 5000)
                loadReportDetails(selectedDate, selectedTiming)
            }
        })
        return () => unsubscribe()
    }, [selectedDate, selectedTiming])

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
        const status = checkMarketStatus()
        setMarketStatus(status)
        
        setIsLoading(true)
        try {
            // 운영 원칙 9.1 & 9.2: 백엔드에서 강제 캐싱된 데이터를 가져옴
            const result = await window.electronAPI.getCombinedTopStocks({ risingLimit: 50, tradingValueLimit: 50 })
            const rawList: any[] = result.data || []
            
            // 캐시에서 가져왔는지 여부 (KiwoomService에서 fromCache 플래그를 보냄)
            const isCached = (result as any).fromCache

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
                const dbRes = await window.electronAPI.getRisingStocksByDate({ date: today, timing: selectedTiming })
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
                    const currentTags = useTagStore.getState().tags[cleanCode] || [];
                    parsedTags.forEach(t => {
                        if (!currentTags.includes(t)) {
                            useTagStore.getState().addTag(cleanCode, t);
                        }
                    });
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
            
            // [핵심 개선] 실제 거래일 기반 날짜 결정
            let reportDate = today
            if (window.electronAPI?.getTradingDays) {
                const trRes = await window.electronAPI.getTradingDays()
                if (trRes.success && trRes.data && trRes.data.length > 0) {
                    const tradingDays = trRes.data
                    if (!tradingDays.includes(today)) {
                        reportDate = tradingDays[tradingDays.length - 1]
                    }
                }
            }
            
            setReports(prev => {
                const existing = prev.find(r => r.date === reportDate)
                const isPreMarket = !status.isLive && status.message === '장 시작 전'
                
                const todayReport: DailyReport = {
                    date: reportDate,
                    // 장 시작 전일 경우 요약 문구 수정 (운영 원칙 9.3)
                    // 기존 리포트가 있더라도(DB에서 로드된 것 등), 장 시작 전이면 안내 문구를 우선시하거나 유지함
                    summary: (existing?.summary && existing.summary.startsWith('{')) 
                        ? existing.summary 
                        : (isPreMarket 
                            ? '장 시작 전입니다. 현재 보고 계신 목록은 직전 거래일 기준 급등주입니다.' 
                            : '당일 실시간 주도주 정보입니다.'),
                    stocks: merged
                }
                const others = prev.filter(r => r.date !== reportDate)
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
            if (result.success && result.data && result.data.length > 0) {
                const dates = result.data.map((d: any) => d.date)
                
                // 각 날짜별로 기본 구조 생성
                const historyReports: DailyReport[] = dates.map((date: string) => ({
                    date,
                    summary: '데이터 로딩 중...',
                    stocks: []
                }))
                
                setReports(prev => {
                    const todayData = prev.find(r => r.date === today)
                    
                    // 기존에 로드된 상세 정보가 있는 리포트들을 보존하면서 새로운 목록과 병합
                    const merged = historyReports.map(history => {
                        const existing = prev.find(p => p.date === history.date);
                        // 기존에 이미 내용({로 시작하는 JSON)이 들어있다면 그것을 유지
                        if (existing && existing.summary && existing.summary.startsWith('{')) {
                            return existing;
                        }
                        return history;
                    });

                    // 오늘 데이터 처리
                    const final = todayData && !merged.find(m => m.date === today) 
                        ? [todayData, ...merged] 
                        : merged;

                    // [핵심 개선] 앱 시작 시 데이터가 있는 가장 최근 날짜를 자동으로 선택
                    if (selectedDate === today && (!todayData || todayData.stocks.every(s => !s.aiScore))) {
                        const lastAnalyzedDate = dates.find(d => d !== today) || today
                        if (lastAnalyzedDate !== today) {
                            setSelectedDate(lastAnalyzedDate)
                        }
                    }

                    return final.sort((a, b) => b.date.localeCompare(a.date));
                })
            }
        } catch (err) {
            console.error('Failed to fetch report history:', err)
        }
    }

    // 특정 날짜의 상세 데이터(리포트 & 종목리스트) 로드
    const loadReportDetails = async (date: string, timing: string = selectedTiming) => {
        if (!window.electronAPI) return
        
        try {
            const marketRes = await window.electronAPI.getMarketDailyReport({ date, timing })
            const stocksRes = await window.electronAPI.getRisingStocksByDate({ date, timing })
            
            // 1. 데이터 파싱 및 가공 (setReports 외부에서 수행)
            const dbStocks: RisingStock[] = stocksRes.success && stocksRes.data
                ? stocksRes.data.map((s: any) => {
                    const cleanCode = String(s.stock_code).replace(/[^0-9]/g, '')
                    let parsedTags: string[] = []
                    try { parsedTags = s.tags ? JSON.parse(s.tags) : [] } catch (e) { }

                    // 자동 태그 저장
                    if (parsedTags.length > 0) {
                        const currentTags = useTagStore.getState().tags[cleanCode] || [];
                        parsedTags.forEach(t => {
                            if (!currentTags.includes(t)) {
                                useTagStore.getState().addTag(cleanCode, t);
                            }
                        });
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

            // 병합 로직을 위해 현재 상태를 잠시 참조 (함수형 업데이트 내부에서 수행하기 위함)
            
            // 2. 타이밍 보정 로직 (데이터가 없을 경우 다른 타이밍 확인)
            if (dbStocks.length === 0 && marketRes.success && !marketRes.data) {
                const otherTiming = timing === 'MORNING' ? 'EVENING' : 'MORNING';
                console.log(`[RisingStocksReport] No data for ${timing}, checking ${otherTiming}...`);
                
                const otherMarketRes = await window.electronAPI.getMarketDailyReport({ date, timing: otherTiming });
                const otherStocksRes = await window.electronAPI.getRisingStocksByDate({ date, timing: otherTiming });
                
                if (otherMarketRes.success && otherMarketRes.data) {
                    console.log(`[RisingStocksReport] Found data in ${otherTiming}.`);
                    
                    const otherDbStocks = otherStocksRes.success && otherStocksRes.data ? otherStocksRes.data.map((s: any) => {
                        const cleanCode = String(s.stock_code).replace(/[^0-9]/g, '');
                        let tags: string[] = [];
                        try { tags = s.tags ? JSON.parse(s.tags) : []; } catch(e) {}
                        return {
                            code: cleanCode,
                            name: s.stock_name,
                            changeRate: s.change_rate,
                            tradingValue: s.trading_value,
                            source: s.source,
                            aiScore: s.ai_score,
                            reason: s.reason,
                            sector: s.theme_sector,
                            tags
                        }
                    }) : [];

                    const finalReport: DailyReport = {
                        date,
                        summary: otherMarketRes.data.market_summary,
                        stocks: otherDbStocks
                    };

                    setReports(prev => {
                        const others = prev.filter(r => r.date !== date);
                        return [finalReport, ...others].sort((a, b) => b.date.localeCompare(a.date));
                    });
                    
                    setSelectedTiming(otherTiming);
                    return;
                }
            }

            // 3. 최종 상태 업데이트
            setReports(prev => {
                const existing = prev.find(r => r.date === date)
                
                let mergedStocks: RisingStock[]
                if (date === today && existing && existing.stocks.length > 0) {
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
                    const realtimeCodes = new Set(existing.stocks.map(s => s.code))
                    const extraFromDb = dbStocks.filter(d => !realtimeCodes.has(d.code))
                    mergedStocks = [...mergedStocks, ...extraFromDb]
                } else {
                    mergedStocks = dbStocks
                }

                const status = checkMarketStatus()
                const isPreMarket = date === today && !status.isLive && status.message === '장 시작 전'

                const summary = marketRes.success && marketRes.data
                    ? marketRes.data.market_summary
                    : (isPreMarket 
                        ? '장 시작 전입니다. 현재 보고 계신 목록은 직전 거래일 기준 급등주입니다.' 
                        : (date === today ? '당일 실시간 급등주 정보입니다.' : '저장된 시장 총평이 없습니다.'))

                const newReport: DailyReport = {
                    date,
                    summary,
                    stocks: mergedStocks
                }

                // 기존 상세 리포트 보존 로직 추가
                if (existing && existing.summary && existing.summary.startsWith('{') && (!newReport.summary || !newReport.summary.startsWith('{'))) {
                    return prev
                }

                const others = prev.filter(r => r.date !== date)
                return [newReport, ...others].sort((a, b) => b.date.localeCompare(a.date))
            })
        } catch (err) {
            console.error(`Failed to load details for ${date}:`, err)
        }
    }

    React.useEffect(() => {
        const init = async () => {
            // 초기 리얼타임 데이터 로드
            await fetchRealtimeStocks()
            
            // 저장된 리포트 날짜 목록 로드
            await fetchSavedReports()
            
            // [추가] 실제 거래일 목록을 가져와서 오늘이 장 운영일이 아닐 경우 보정
            if (window.electronAPI?.getTradingDays) {
                const res = await window.electronAPI.getTradingDays()
                if (res.success && res.data && res.data.length > 0) {
                    const tradingDays = res.data
                    const latestTradingDay = tradingDays[tradingDays.length - 1]
                    
                    // 오늘 날짜가 거래일 목록에 없고, 현재 선택된 날짜가 오늘이라면 최근 거래일로 자동 변경
                    if (!tradingDays.includes(today) && selectedDate === today) {
                        console.log(`[RisingStocksReport] 오늘(${today})은 비영업일입니다. 최근 거래일(${latestTradingDay})로 전환합니다.`);
                        setSelectedDate(latestTradingDay)
                    }
                }
            }
        }
        init()
    }, [])

    React.useEffect(() => {
        if (selectedDate) {
            loadReportDetails(selectedDate, selectedTiming)
        }
    }, [selectedDate, selectedTiming])

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
                source: stock.source,
                timing: selectedTiming,
                date: selectedDate
            })

            if (result.success) {
                // 분석 성공 시 해당 날짜 데이터 다시 로드
                loadReportDetails(selectedDate, selectedTiming)
                setAiReportRefreshTrigger(prev => prev + 1)
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
            const result = await window.electronAPI.runMarketReport({ date: selectedDate, timing: selectedTiming })
            if (result.success) {
                loadReportDetails(selectedDate, selectedTiming)
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
            const result = await window.electronAPI.runBatchReport({ 
                timing: selectedTiming,
                date: selectedDate
            })
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
            <div className="w-[320px] shrink-0 border-r border-border bg-card flex flex-col min-h-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
                <div className="flex items-center gap-2">
                    {/* 타이틀 제거됨 */}
                </div>
                <div className="flex items-center gap-1">
                    {/* 설정 버튼 */}
                    <div className="relative">
                        <button 
                            onClick={() => setShowSettings(!showSettings)}
                            className={cn(
                                "p-1.5 rounded-lg transition-colors group",
                                showSettings ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"
                            )}
                            title="AI 분석 스케줄 설정"
                        >
                            <Settings size={14} className={cn(showSettings && "animate-spin-slow")} />
                        </button>

                        {/* 설정 팝오버 */}
                        {showSettings && (
                            <div className="absolute right-[-20px] top-10 z-[100] w-72 bg-background border border-border rounded-2xl shadow-2xl p-5 animate-in fade-in zoom-in-95 duration-200">
                                <div className="flex items-center justify-between mb-5">
                                    <h3 className="text-[13px] font-black flex items-center gap-2">
                                        <Clock size={14} className="text-primary" />
                                        AI 분석 스케줄링
                                    </h3>
                                    <button onClick={() => setShowSettings(false)} className="text-muted-foreground hover:text-foreground">
                                        <X size={14} />
                                    </button>
                                </div>

                                <div className="space-y-5">
                                    {/* 활성화 토글 */}
                                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-xl border border-border/50">
                                        <div className="space-y-0.5">
                                            <p className="text-[11px] font-bold">자동 분석 활성</p>
                                            <p className="text-[9px] text-muted-foreground">정해진 시간에 자동 실행</p>
                                        </div>
                                        <button 
                                            onClick={() => setScheduleConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                                            className={cn(
                                                "w-10 h-5 rounded-full transition-colors relative",
                                                scheduleConfig.enabled ? "bg-primary" : "bg-muted-foreground/30"
                                            )}
                                        >
                                            <div className={cn(
                                                "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                                                scheduleConfig.enabled ? "left-6" : "left-1"
                                            )} />
                                        </button>
                                    </div>

                                    <div className={cn("space-y-4 transition-opacity", !scheduleConfig.enabled && "opacity-40 pointer-events-none")}>
                                        {/* 시간 설정 */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black text-muted-foreground uppercase flex items-center gap-1">
                                                    <TrendingUp size={10} className="text-orange-500" />
                                                    오전 분석
                                                </label>
                                                <input 
                                                    type="time" 
                                                    value={scheduleConfig.morningTime}
                                                    onChange={(e) => setScheduleConfig(prev => ({ ...prev, morningTime: e.target.value }))}
                                                    className="w-full bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-xs font-mono outline-none focus:border-primary"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black text-muted-foreground uppercase flex items-center gap-1">
                                                    <BarChart2 size={10} className="text-blue-500" />
                                                    장마감 분석
                                                </label>
                                                <input 
                                                    type="time" 
                                                    value={scheduleConfig.eveningTime}
                                                    onChange={(e) => setScheduleConfig(prev => ({ ...prev, eveningTime: e.target.value }))}
                                                    className="w-full bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-xs font-mono outline-none focus:border-primary"
                                                />
                                            </div>
                                        </div>

                                        {/* 텔레그램 알림 */}
                                        <div className="flex items-center justify-between px-3 py-2 bg-muted/20 rounded-lg">
                                            <div className="flex items-center gap-2">
                                                <Bell size={12} className="text-primary/70" />
                                                <span className="text-[10px] font-bold">텔레그램 결과 발송</span>
                                            </div>
                                            <input 
                                                type="checkbox" 
                                                checked={scheduleConfig.telegramNotify}
                                                onChange={(e) => setScheduleConfig(prev => ({ ...prev, telegramNotify: e.target.checked }))}
                                                className="w-3 h-3 rounded border-border"
                                            />
                                        </div>
                                    </div>

                                    <button 
                                        onClick={saveScheduleSettings}
                                        className="w-full py-2.5 bg-primary text-white rounded-xl text-[11px] font-black flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
                                    >
                                        <Save size={14} />
                                        설정 저장 및 적용
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <button 
                        onClick={() => fetchRealtimeStocks()}
                        disabled={isLoading || isTesting}
                        className="p-1.5 hover:bg-muted rounded-lg transition-colors group"
                        title="새로고침"
                    >
                        <RefreshCw size={14} className={cn("text-muted-foreground group-active:rotate-180 transition-transform", isLoading && "animate-spin")} />
                    </button>
                </div>
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
                                {activeTab === 'report' && (
                                    <StockAiReport 
                                        symbol={selectedStock.code} 
                                        name={selectedStock.name} 
                                        refreshTrigger={aiReportRefreshTrigger}
                                    />
                                )}
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
                                 <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                                     <div className="flex bg-muted/30 p-0.5 rounded-lg border border-border/50 shrink-0">
                                         <button 
                                             onClick={() => setSelectedTiming('MORNING')}
                                             className={cn(
                                                 "px-3 py-1 rounded-md text-[10px] font-black transition-all flex items-center gap-1.5",
                                                 selectedTiming === 'MORNING' 
                                                     ? "bg-background text-primary shadow-sm ring-1 ring-border" 
                                                     : "text-muted-foreground hover:text-foreground"
                                             )}
                                         >
                                             <Clock size={10} />
                                             오전
                                         </button>
                                         <button 
                                             onClick={() => setSelectedTiming('EVENING')}
                                             className={cn(
                                                 "px-3 py-1 rounded-md text-[10px] font-black transition-all flex items-center gap-1.5",
                                                 selectedTiming === 'EVENING' 
                                                     ? "bg-background text-primary shadow-sm ring-1 ring-border" 
                                                     : "text-muted-foreground hover:text-foreground"
                                             )}
                                         >
                                             <Clock size={10} />
                                             오후
                                         </button>
                                     </div>

                                     <div className="w-[1px] h-3 bg-border mx-1" />

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
                                            <div className="flex items-center justify-between mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-1.5 h-4 bg-indigo-500 rounded-full" />
                                                    <h3 className="text-base font-black">Today's Market 3-Line Summary</h3>
                                                </div>
                                                {marketStatus.message && (
                                                    <div className={cn(
                                                        "px-2 py-0.5 rounded-full text-[10px] font-black flex items-center gap-1",
                                                        marketStatus.isLive ? "bg-emerald-500/10 text-emerald-600 animate-pulse" : "bg-muted text-muted-foreground"
                                                    )}>
                                                        <div className={cn("w-1 h-1 rounded-full", marketStatus.isLive ? "bg-emerald-500" : "bg-muted-foreground")} />
                                                        {marketStatus.message}
                                                    </div>
                                                )}
                                            </div>
                                            
                                            {!currentReport.summary || !currentReport.summary.startsWith('{') ? (
                                                <div className="bg-indigo-500/[0.03] border border-indigo-500/10 rounded-2xl p-8 text-center space-y-4">
                                                    <div className="bg-indigo-500/10 w-12 h-12 rounded-2xl flex items-center justify-center mx-auto">
                                                        <Beaker size={24} className="text-indigo-600" />
                                                    </div>
                                                    <div className="space-y-1">
                                                         <h4 className="text-sm font-black">시장 분석 리포트가 없습니다</h4>
                                                         <p className="text-xs text-muted-foreground leading-relaxed">
                                                             {currentReport.summary || '당일 시장 상황을 종합적으로 분석하려면 아래 버튼을 누르세요.'}
                                                         </p>
                                                     </div>
                                                     <button 
                                                         onClick={handleRunBatchAnalysis}
                                                         className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 transition-all flex items-center gap-2 mx-auto"
                                                     >
                                                         <RefreshCw size={14} className={cn(batchStatus && "animate-spin")} />
                                                         AI 일괄 분석 및 리포트 생성 시작
                                                     </button>
                                                </div>
                                            ) : (
                                                <div className="bg-indigo-500/[0.03] border-l-2 border-indigo-500/30 py-4 px-6 space-y-3">
                                                    {parsed.summary_lines.length > 0 ? parsed.summary_lines.map((line: string, i: number) => (
                                                        <div key={i} className="flex gap-3 text-[14px] leading-relaxed">
                                                            <span className="text-indigo-500 font-black font-mono">0{i+1}</span>
                                                            <p className="text-foreground/95 font-semibold tracking-tight">{line}</p>
                                                        </div>
                                                    )) : <p className="text-muted-foreground text-xs italic">리포트가 작성되지 않았습니다.</p>}
                                                </div>
                                            )}
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

                                         {/* 섹션 3: AI 자아 성찰 (피드백 루프) */}
                                         {parsed.self_reflection && parsed.self_reflection.length > 5 && (
                                             <section className="scroll-mt-20">
                                                 <div className="flex items-center gap-2 mb-4">
                                                     <div className="w-1.5 h-4 bg-purple-500 rounded-full" />
                                                     <h3 className="text-base font-black">AI Self-Reflection & Lessons</h3>
                                                 </div>
                                                 <div className="bg-purple-500/[0.03] border-l-2 border-purple-500/30 py-4 px-6">
                                                     <div className="flex gap-4">
                                                         <div className="bg-purple-500/10 p-2 rounded-xl h-fit">
                                                             <Beaker size={20} className="text-purple-600" />
                                                         </div>
                                                         <div className="text-[13px] text-foreground/90 leading-relaxed font-semibold">
                                                             <p className="mb-2 text-purple-600 font-black">지난 분석에 대한 피드백 및 오늘의 교훈:</p>
                                                             <p className="whitespace-pre-wrap italic opacity-80">{parsed.self_reflection}</p>
                                                         </div>
                                                     </div>
                                                 </div>
                                             </section>
                                         )}

                                         {/* 섹션 4: 주도 테마 - 고밀도 랭킹 리스트 */}
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

                                        {/* 섹션 5: 주요 종목별 특징 */}
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
