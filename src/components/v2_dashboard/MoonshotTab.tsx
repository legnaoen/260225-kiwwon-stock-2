import React, { useState, useEffect } from 'react'
import { Rocket, ShieldAlert, Flame, Activity, Zap, CheckCircle2, ChevronRight, Lock, Archive, History, BookOpen, TrendingUp, TrendingDown, Telescope, Database, Filter, BrainCircuit, XCircle, Search, Fingerprint, LayoutGrid, Table, Copy, Check, Settings, Loader2 } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

const DUMMY_MOONSHOTS = [
    {
        id: '1',
        name: '한미반도체',
        code: '042700',
        marketCap: '8조 5000억',
        weight: '무거움',
        tbpScore: 85,
        trend: 'AI / HBM 후공정',
        signals: ['🔥 CAPEX +300%', '💰 스마트머니 매집'],
        originalThesis: '글로벌 AI 반도체 수요 급증에 따른 글로벌 벤더들의 HBM 증설 필수 요건. 독점적 후공정 장비 공급 지위.',
        entryDate: '2024.01.15',
        entryPrice: 55000,
        currentPrice: 135000,
        returnRate: 145.45,
        trackType: 'A',
        trackBadge: 'A안'
    },
    {
        id: '2',
        name: '제룡전기',
        code: '033100',
        marketCap: '7500억',
        weight: '가벼움',
        tbpScore: 92,
        trend: '전력 인프라 슈퍼사이클',
        signals: ['📈 흑자 턴어라운드', '🔥 OPM 20% 점프'],
        originalThesis: '미국 전력망 교체 주기 및 AI 데이터센터 가동으로 인한 변압기 숏티지. 북미 수출 비중 급증에 따른 폭발적 이익 레버리지.',
        entryDate: '2024.02.20',
        entryPrice: 20000,
        currentPrice: 65000,
        returnRate: 225.00,
        trackType: 'B',
        trackBadge: 'B안'
    },
    {
        id: '3',
        name: '실리콘투',
        code: '257720',
        marketCap: '1조 2000억',
        weight: '적절함',
        tbpScore: 95,
        trend: 'K-뷰티 글로벌 침투',
        signals: ['📈 매분기 서프라이즈', '💰 기관/외국인 연속 순매수'],
        originalThesis: '미국/유럽향 인디 브랜드 화장품 수출의 독보적 플랫폼. 물류 인프라 선점에 따른 구조적 성장.',
        entryDate: '2024.03.05',
        entryPrice: 8500,
        currentPrice: 8100,
        returnRate: -4.70,
        trackType: 'A',
        trackBadge: 'A안'
    }
]

const DUMMY_ARCHIVE = [
    {
        id: '101',
        name: '에코프로',
        code: '086520',
        buyDate: '2023.01.10',
        sellDate: '2023.08.15',
        duration: '7개월',
        returnRate: 850,
        success: true,
        originalThesis: '글로벌 전기차 침투율 급증과 배터리 핵심 소재(양극재) 내재화 및 수직계열화 구축 기반의 독점 프리미엄 부여.',
        sellReason: '가설 적중 및 목표 초과 달성. 개인투자자 광기 지표(FOMO) 과열 및 스마트머니 대량 이탈 포착으로 분할 익절 완료.',
        trackType: 'A',
        trackBadge: 'A안'
    },
    {
        id: '102',
        name: '에디슨EV',
        code: '136510',
        buyDate: '2021.05.02',
        sellDate: '2021.08.20',
        duration: '3개월',
        returnRate: -35,
        success: false,
        originalThesis: '전기버스 시장 점유율 확대 및 쌍용차 인수 기대감에 따른 폭발적 기업가치 레벨업 전환 기대.',
        sellReason: '투자 가설 심각한 훼손. M&A 불확실성 지속 및 재무제표 현금흐름 경색 징후 발생 인지 즉시 컷오프(손절) 실행.',
        trackType: 'B',
        trackBadge: 'B안'
    }
]

export default function MoonshotTab() {
    // 시뮬레이션: API 동기화 클릭 시 받아오는 더미 데이터 풀
    const DUMMY_ALL_FETCHED = [
        { code: '042700', name: '한미반도체', price: 135000, volume: '2500만', conditionId: '101', tag: 'A안' },
        { code: '098765', name: '휴젤', price: 250000, volume: '150만', conditionId: '101', tag: 'A안' },
        { code: '112233', name: '하나마이크론', price: 24000, volume: '800만', conditionId: '102', tag: 'A안' },
        { code: '033100', name: '제룡전기', price: 65000, volume: '600만', conditionId: '201', tag: 'B안' },
        { code: '554433', name: '씨어스테크놀로지', price: 12500, volume: '1800만', conditionId: '201', tag: 'B안' },
        { code: '998877', name: '알테오젠', price: 180000, volume: '1100만', conditionId: '202', tag: 'B안' },
        { code: '009150', name: '삼성전기', price: 664000, volume: '210만', conditionId: '301', tag: 'C안' },
    ]

    const [viewMode, setViewMode] = useState<'scanner' | 'active' | 'archive'>('scanner') // scanner를 기본값으로
    const [selectedStock, setSelectedStock] = useState(DUMMY_MOONSHOTS[1])
    // Scanner States
    const [selectedConditionA, setSelectedConditionA] = useState(() => localStorage.getItem('moonshot_condA') || '101')
    const [selectedConditionB, setSelectedConditionB] = useState(() => localStorage.getItem('moonshot_condB') || '201')
    const [selectedConditionC, setSelectedConditionC] = useState(() => localStorage.getItem('moonshot_condC') || '301')
    const [isScanning, setIsScanning] = useState(false)
    const [reportFilter, setReportFilter] = useState<'all' | 'passed' | 'failed'>('all')
    const [reportViewStyle, setReportViewStyle] = useState<'table' | 'card'>('table')
    const [selectedDetail, setSelectedDetail] = useState<any | null>(null)
    const [activeModalStep, setActiveModalStep] = useState<number>(3)
    const [isCopied, setIsCopied] = useState(false)

    // Playground 상태
    const [showPlayground, setShowPlayground] = useState(false)
    const [playgroundLogs, setPlaygroundLogs] = useState<{time: string, msg: string, json?: any}[]>([])
    const [showConditionSettings, setShowConditionSettings] = useState(false)

    // 실시간 동기화 상태
    const [isSyncing, setIsSyncing] = useState(false)
    const [realtimeConditions, setRealtimeConditions] = useState<any[]>([])
    // 조건검색 결과 (useEffect보다 반드시 먼저 선언되어야 함)
    const [syncedStocks, setSyncedStocks] = useState<any[]>([])
    const [scannedResults, setScannedResults] = useState<any[]>([])

    // WebSocket 리스너 및 초기화
    useEffect(() => {
        const { electronAPI } = window as any
        if (!electronAPI) return;

        // 1. 조건검색 결과 수신 리스너 (preload에 정의된 onConditionSearchMatched 사용)
        const unsubscribeMatch = electronAPI.onConditionSearchMatched?.((data: {seq: string, stocks: any[]}) => {
            console.log('[MoonshotTab] condition-matched 수신:', data?.seq, '종목수:', data?.stocks?.length)
            if (!data || !data.stocks) return
            const cleanSeq = data.seq ? data.seq.toString().trim() : '';
            setSyncedStocks(prev => {
                const newStocks = (data.stocks || []).map((s: any) => {
                    let tag = '기타안'
                    if (window.sessionStorage.getItem('condA')?.trim() === cleanSeq) tag = 'A안'
                    else if (window.sessionStorage.getItem('condB')?.trim() === cleanSeq) tag = 'B안'
                    else if (window.sessionStorage.getItem('condC')?.trim() === cleanSeq) tag = 'C안'
                    return {
                        id: (s.code || Math.random().toString()) + '-' + cleanSeq,
                        conditionId: cleanSeq,
                        tag,
                        code: s.code,
                        name: s.name || '(이름 없음)',
                        price: s.price || 0,
                        volume: '-',
                        timestamp: new Date().toLocaleTimeString('ko-KR')
                    }
                }).filter((s: any) => s.code)
                const merged = [...prev];
                for (const ns of newStocks) {
                    if (!merged.find(m => m.code === ns.code && m.conditionId === ns.conditionId)) {
                        merged.push(ns);
                    }
                }
                console.log('[MoonshotTab] syncedStocks 업데이트:', merged.length, '종목')
                return merged;
            })
            setIsSyncing(false)
        })

        // 2. 조건식 목록 수신 리스너
        const unsubscribeList = electronAPI.onConditionList?.((conditions: any[]) => {
            if (conditions && conditions.length > 0) setRealtimeConditions(conditions)
        })

        // 3. 이미 로드된 조건식 목록 가져오기
        const init = async () => {
            try {
                if (electronAPI.connectConditionWs) await electronAPI.connectConditionWs()
                const conditions = await electronAPI.getConditionList?.()
                if (conditions && conditions.length > 0) setRealtimeConditions(conditions)
            } catch (e) {
                console.error('[MoonshotTab] init error:', e)
            }
        }
        init()

        return () => {
            if (unsubscribeMatch) unsubscribeMatch()
            if (unsubscribeList) unsubscribeList()
        }
    }, [])


    // Storage Sync: Closure 방지(sessionStorage) & 앱 재시작 시 영구 보존(localStorage)
    useEffect(() => { 
        window.sessionStorage.setItem('condA', selectedConditionA)
        window.localStorage.setItem('moonshot_condA', selectedConditionA)
    }, [selectedConditionA])
    
    useEffect(() => { 
        window.sessionStorage.setItem('condB', selectedConditionB)
        window.localStorage.setItem('moonshot_condB', selectedConditionB)
    }, [selectedConditionB])
    
    useEffect(() => { 
        window.sessionStorage.setItem('condC', selectedConditionC)
        window.localStorage.setItem('moonshot_condC', selectedConditionC)
    }, [selectedConditionC])

    // 실시간 목록 최초 수신 시 selected 자동 지정 (유효하지 않은 조건식일 때만 교체)
    useEffect(() => {
        if (realtimeConditions.length >= 3) {
            const getIndex = (c: any) => Array.isArray(c) ? c[0].toString() : (c.conditionIndex?.toString() || '');
            const validIds = realtimeConditions.map(c => getIndex(c));
            
            // 현재 선택된 ID가 실제 키움서버 리스트에 없다면(예: '101', '201' 등 과거 더미값이거나 지워진 조건식)
            if (!validIds.includes(selectedConditionA)) setSelectedConditionA(getIndex(realtimeConditions[0]));
            if (!validIds.includes(selectedConditionB)) setSelectedConditionB(getIndex(realtimeConditions[1]));
            if (!validIds.includes(selectedConditionC)) setSelectedConditionC(getIndex(realtimeConditions[2]));
        }
    }, [realtimeConditions])

    const handleTestTool = async (toolName: string) => {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0]
        const newLog = {
            time: timestamp,
            msg: `[요청 발송] ${toolName} 단위 테스트 실행 (Phase 0)...`
        }
        setPlaygroundLogs(prev => [...prev, newLog])
        
        if (toolName.includes('조건검색')) {
            try {
                const { electronAPI } = window as any
                if (!electronAPI || !electronAPI.connectConditionWs) {
                    throw new Error("electronAPI 연동이 불가능합니다.")
                }
                
                await electronAPI.connectConditionWs()
                // 조건을 조회할 충분한 웹소켓 수립 및 응답 대기시간(1.5초) 부여
                setTimeout(async () => {
                    const conditions = await electronAPI.getConditionList()
                    setPlaygroundLogs(prev => [...prev, {
                        time: new Date().toISOString().split('T')[1].split('.')[0],
                        msg: `[응답 수신] ${toolName} 실제 데이터 수신 완료.`,
                        json: { 
                            status: "WebSocket Connected & Fetched", 
                            totalConditionsFound: conditions?.length || 0,
                            conditionsList: conditions || []
                        }
                    }])
                }, 1500)
            } catch (err: any) {
                setPlaygroundLogs(prev => [...prev, {
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    msg: `[에러] ${toolName} 실패: ${err.message}`
                }])
            }
            return
        }

        setTimeout(() => {
            const resultData = toolName.includes('매매동향') 
                ? { status: "Rate Limit 방어 상태 정상", foreigner_net: "+12,340,000,000", institution_net: "+5,420,000,000" }
                : toolName.includes('로컬 DB') 
                ? { historyFound: true, report_memory: "25년 12월 04일 컷오프 (재무 악화). 현재 재진입 추적." }
                : toolName.includes('기본정보')
                ? { _credit_ratio: "1.23%", PER: 12.4, EPS: 450, fetchStatus: "success" }
                : { module: "selenium_bypass", isCaptchaBlocked: false, headlines: ["[단독] 경쟁사 무상증자...", "신사업 본격화..."] }
                
            setPlaygroundLogs(prev => [...prev, {
                time: new Date().toISOString().split('T')[1].split('.')[0],
                msg: `[응답 수신] ${toolName} 작업 완료.`,
                json: resultData
            }])
        }, 600)
    }

    // Data for Scanner (Realtime Fallback to Dummy)

    const activeConditions = realtimeConditions.length > 0 
        ? realtimeConditions.map(c => {
            const id = Array.isArray(c) ? c[0].toString() : (c.conditionIndex?.toString() || '');
            const name = Array.isArray(c) ? c[1] : (c.conditionName || '');
            return { id, name };
        })
        : [];
        
    const DUMMY_CONDITIONS_A = activeConditions.length > 0 ? activeConditions : [
        { id: '101', name: '[기본] 기관/외인 바닥권 연속 매집 (박스권)' },
        { id: '102', name: '[응용] 시가총액 5000억 이하 연기금 딥 매집' },
        { id: '103', name: '[응용] 20일선 눌림목 + 외인 순매수 지속' }
    ]
    const DUMMY_CONDITIONS_B = activeConditions.length > 0 ? activeConditions : [
        { id: '201', name: '[기본] 120일선 갭돌파 & 거래대금 1000% 폭증' },
        { id: '202', name: '[응용] 역사적 신고가 임박 + 거래량 폭발' },
        { id: '203', name: '[응용] 하락추세 돌파 + 52주 신저가 V자 반등' }
    ]
    const DUMMY_CONDITIONS_C = activeConditions.length > 0 ? activeConditions : [
        { id: '301', name: '[기본] 대세 랠리 중간 탑승 (5>20>60 정배열)' },
        { id: '302', name: '[응용] 역사적 신고가 직하단 20일선 눌림목' }
    ]

    const handleSyncKiwom = async () => {
        setScannedResults([])
        const { electronAPI } = window as any
        
        if (electronAPI && electronAPI.startConditionSearch) {
            // 실제 연동 모드 (realtimeConditions 로드 여부와 무관하게 시도)
            setIsSyncing(true)
            setSyncedStocks([]) // 초기화
            console.log('[MoonshotTab] 조건검색 시작 - A:', selectedConditionA, 'B:', selectedConditionB, 'C:', selectedConditionC)
            try {
                // A, B, C안의 식을 각각 별도 TR로 순차 요청 (키움서버 TR 동시요청 제한 대비)
                if (selectedConditionA) {
                    console.log('[MoonshotTab] A안 검색 요청:', selectedConditionA)
                    await electronAPI.startConditionSearch(selectedConditionA)
                    await new Promise(r => setTimeout(r, 600)) // 600ms 간격
                }
                if (selectedConditionB && selectedConditionB !== selectedConditionA) {
                    console.log('[MoonshotTab] B안 검색 요청:', selectedConditionB)
                    await electronAPI.startConditionSearch(selectedConditionB)
                    await new Promise(r => setTimeout(r, 600))
                }
                if (selectedConditionC && selectedConditionC !== selectedConditionA && selectedConditionC !== selectedConditionB) {
                    console.log('[MoonshotTab] C안 검색 요청:', selectedConditionC)
                    await electronAPI.startConditionSearch(selectedConditionC)
                }
                
                // 타임아웃 세팅 (중간에 데이터 다 오면 리스너 쪽에서 false 해제됨)
                setTimeout(() => setIsSyncing(false), 10000)
            } catch (err: any) {
                console.error("조건검색 요청 중 에러:", err)
                setIsSyncing(false)
            }
        } else {
            // 더미 폴백 모드
            setIsSyncing(true)
            setTimeout(() => {
                const fetched = DUMMY_ALL_FETCHED.filter(s => 
                    s.conditionId === selectedConditionA || 
                    s.conditionId === selectedConditionB || 
                    s.conditionId === selectedConditionC
                )
                setSyncedStocks(fetched)
                setIsSyncing(false)
            }, 800)
        }
    }

    const handleStartValidation = () => {
        setIsScanning(true)
        setTimeout(() => {
            const results = syncedStocks.map((stock, i) => ({
                ...stock,
                status: i % 2 === 0 ? 'passed' : 'failed',
                narrative: i % 2 === 0 
                    ? '글로벌 메가트렌드(AI/전력망/바이오 등) 연계 확인. 대형 CAPEX 사이클 초입 등 강력 훼손조건 설정 가능.' 
                    : '정치 테마나 일회성 경영권 분쟁으로 파악됨. 실질적 밸류에이션 점프 근거 희박.',
                tbpScore: i % 2 === 0 ? Math.floor(Math.random() * 20) + 80 : Math.floor(Math.random() * 40) + 20,
                inputData: "[Dart 공시] 최근 3분기 연속 영업이익률 상승 (전년동기대비 +45%)\n[키움 조건검색] 120일 선 거래량 동반 갭돌파 포착\n[수급 흐름] 기관/외국인 쌍끌이 순매수 5거래일 연속 진행 중\n[뉴스 플로우] \"글로벌 공급망 재편의 최대 수혜 확인...\" (서울경제)",
                prompt: "당신은 월스트리트 출신의 딥 밸류 퀀트 애널리스트입니다.\n아래의 종목 데이터, 차트 시그널, 뉴스 플로우를 종합적으로 분석하여 해당 종목이 단기 펌핑용 약세 테마인지, 구조적 메가트렌드에 올라탄 텐베거(10-bagger) 초입인지 판별하십시오.\n판단 기준은 '가시적 촉매(Catalyst)', '수급 연속성', '펀더멘탈 증분' 입니다.",
                rawResult: i % 2 === 0 
                    ? "[최종 판정: 편입 승인]\n\n1. 가시적 촉매 (Catalyst)\n대형 CAPEX 사이클의 초입 단계로 글로벌 산업 구조 재편 트렌드와 정확히 일치함.\n\n2. 수급 연속성\n일회성이 아닌 꾸준한 쌍끌이 매집 패턴이 확인되며, 스마트 머니의 유입이 뚜렷함.\n\n3. 펀더멘탈 증분\n단순 테마가 아닌 실질적인 영업이익률 점프가 동반되어 밸류에이션 정당성이 훼손불가능하게 확보됨.\n\n결론: 주포의 단기 엑시트가 아닌 장기 상승 랠리의 1파 구간으로 샌드박스로의 편입을 강력히 권고합니다."
                    : "[최종 판정: 편입 탈락]\n\n1. 가시적 촉매 (Catalyst)\n실질적 밸류에이션 상승 근거가 부족하며 경영권 분쟁이나 인맥 관련의 소동성 재료일 확률이 높음.\n\n2. 수급 연속성\n주도 수급 주체가 불분명하고 특정 창구에서의 기계적 펌핑이 짙게 의심됨.\n\n3. 펀더멘탈 증분\n실적 개선 가시성이 전혀 보이지 않으며 최근 자금조달(CB/BW) 이력이 불안감을 가중시킴.\n\n결론: 텐베거 요건에 절대 부합하지 않으며 리스크가 매우 높은 단기성 종목으로 컷오프 처리합니다."
            }))
            setScannedResults(results)
            setIsScanning(false)
        }, 1500)
    }

    const totalCount = scannedResults.length
    const passedCount = scannedResults.filter(r => r.status === 'passed').length
    const failedCount = scannedResults.filter(r => r.status === 'failed').length
    const filteredResults = scannedResults.filter(r => {
        if (reportFilter === 'all') return true
        return r.status === reportFilter
    })

    const handleCopyAll = () => {
        if (!selectedDetail) return
        const textToCopy = `[종목 정보]
종목명: ${selectedDetail.name} (${selectedDetail.code})
전략: ${selectedDetail.tag}
판독점수: ${selectedDetail.tbpScore}
판정상태: ${selectedDetail.status === 'passed' ? '승인' : '탈락'}

[1. 분석을 위해 수집·할당된 데이터]
${selectedDetail.inputData}

[2. AI 분석 프롬프트]
${selectedDetail.prompt}

[3. LLM 추론 상세 결과]
${selectedDetail.rawResult}
`
        navigator.clipboard.writeText(textToCopy)
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
    }

    return (
        <div className="flex flex-col h-full w-full bg-background overflow-hidden p-6 gap-4">
            
            {/* Top Navigation & Status Bar */}
            <div className="flex items-center justify-between pb-2">
                <div className="flex items-center gap-6">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Rocket className="text-primary" /> 
                            Project Moonshot 
                        </h1>
                        <p className="text-muted-foreground mt-1 text-sm">텐베거(10-Bagger) 시스템 : 패러다임과 실적 폭발성에만 집중합니다.</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* 테스트 대시보드 진입점 */}
                    <button 
                        onClick={() => setShowPlayground(true)}
                        className="hidden md:flex px-4 py-2 bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 rounded-xl font-bold text-sm transition-colors items-center gap-2"
                    >
                        <span className="text-lg leading-none">🧪</span> 개발자 테스트 (Playground)
                    </button>
                    
                    {/* 탭 토글 영역 */}
                    <div className="flex p-1 bg-muted/50 rounded-xl border">
                    <button 
                        onClick={() => setViewMode('scanner')}
                        className={cn(
                            "px-6 py-2 rounded-lg font-bold text-sm transition-all flex items-center gap-2",
                            viewMode === 'scanner' ? "bg-background shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Telescope size={16} /> 신규 발굴 (Scanner)
                    </button>
                    <button 
                        onClick={() => setViewMode('active')}
                        className={cn(
                            "px-6 py-2 rounded-lg font-bold text-sm transition-all flex items-center gap-2",
                            viewMode === 'active' ? "bg-background shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Activity size={16} /> Active Tracking
                    </button>
                    <button 
                        onClick={() => setViewMode('archive')}
                        className={cn(
                            "px-6 py-2 rounded-lg font-bold text-sm transition-all flex items-center gap-2",
                            viewMode === 'archive' ? "bg-background shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Archive size={16} /> History Archive
                    </button>
                    </div>
                </div>
            </div>

            {/* 메인 컨텐츠 영역 분기 */}
            {viewMode === 'scanner' && (
                <div className="flex-1 flex flex-col lg:flex-row min-h-0 bg-card border rounded-2xl shadow-sm overflow-hidden">
                    {/* 좌측 패널 (검색 옵션 + 1차 목록) */}
                    <div className="flex flex-col w-full lg:w-1/3 border-r bg-background/30 overflow-hidden">
                        
                        {/* 상단: 검색식 설정 */}
                        <div className="p-5 border-b shrink-0">
                            <div className="flex items-center space-x-2 mb-4">
                                <Filter className="w-4 h-4 text-primary" />
                                <h2 className="text-sm font-bold">1단계: 키움 서버사이드 포집</h2>
                            </div>
                            <div className="space-y-3">
                                {/* 현재 설정 요약 */}
                                <div className="bg-muted/20 p-3.5 rounded-xl border text-[11px] font-medium space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-blue-500 font-bold">[A안]</span>
                                        <span className="text-muted-foreground truncate w-40 text-right">{DUMMY_CONDITIONS_A.find(c => c.id === selectedConditionA)?.name || '지정 안됨'}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-orange-500 font-bold">[B안]</span>
                                        <span className="text-muted-foreground truncate w-40 text-right">{DUMMY_CONDITIONS_B.find(c => c.id === selectedConditionB)?.name || '지정 안됨'}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-purple-600 font-bold">[C안]</span>
                                        <span className="text-muted-foreground truncate w-40 text-right">{DUMMY_CONDITIONS_C.find(c => c.id === selectedConditionC)?.name || '지정 안됨'}</span>
                                    </div>
                                </div>
                                <div className="flex gap-2 mt-2">
                                    <button onClick={() => setShowConditionSettings(true)} className="flex-1 py-2 bg-background border hover:bg-muted text-xs font-bold rounded-xl transition-colors flex justify-center items-center space-x-1.5 shadow-sm active:scale-95">
                                        <Settings className="w-3.5 h-3.5" />
                                        <span>설정 변경</span>
                                    </button>
                                    <button onClick={handleSyncKiwom} disabled={isSyncing} className={cn("flex-[2] py-2 text-xs font-bold rounded-xl transition-colors flex justify-center items-center space-x-1.5 shadow-sm active:scale-95", isSyncing ? "bg-muted text-muted-foreground select-none pointer-events-none" : "bg-primary/10 text-primary hover:bg-primary/20")}>
                                        {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                                        <span>{isSyncing ? '서버 포집 중...' : '일괄 검색 실행'}</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* 하단: 통과 종목 테이블 */}
                        <div className="p-5 flex-1 flex flex-col min-h-0">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-sm font-bold">1차 필터 통과 종목</h2>
                                <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full font-bold">{syncedStocks.length} 종목</span>
                            </div>
                            <div className="flex-1 overflow-y-auto scrollbar-hide">
                                {syncedStocks.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                                        상단에서 일괄 검색을 실행해주세요.
                                    </div>
                                ) : (
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-muted-foreground bg-muted/50 uppercase sticky top-0">
                                            <tr>
                                                <th className="px-3 py-2 font-semibold">전략</th>
                                                <th className="px-3 py-2 font-semibold">종목명</th>
                                                <th className="px-3 py-2 font-semibold text-right">현재가</th>
                                                <th className="px-3 py-2 font-semibold text-right">거래량</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {syncedStocks.map((stock) => (
                                                <tr key={stock.code} className="hover:bg-muted/30 transition-colors">
                                                    <td className="px-3 py-2.5">
                                                        <span className={cn(
                                                            "text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap",
                                                            stock.tag.includes('A안') ? "bg-blue-500/20 text-blue-400" : 
                                                            stock.tag.includes('B안') ? "bg-orange-500/20 text-orange-400" :
                                                            "bg-purple-500/20 text-purple-400"
                                                        )}>{stock.tag}</span>
                                                    </td>
                                                    <td className="px-3 py-2.5 font-bold">{stock.name}</td>
                                                    <td className="px-3 py-2.5 text-right font-medium">{stock.price.toLocaleString()}</td>
                                                    <td className="px-3 py-2.5 text-right text-muted-foreground">{stock.volume}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                            <button 
                                onClick={handleStartValidation}
                                disabled={isScanning || syncedStocks.length === 0}
                                className={cn(
                                    "mt-4 w-full py-3 rounded-lg font-bold flex justify-center items-center space-x-2 transition-all",
                                    isScanning ? "bg-primary/20 text-primary cursor-wait" : "bg-primary hover:bg-primary/90 text-primary-foreground"
                                )}
                            >
                                {isScanning ? (
                                    <>
                                        <Activity className="w-5 h-5 animate-pulse" />
                                        <span>LLM 딥 스캐닝 중...</span>
                                    </>
                                ) : (
                                    <>
                                        <BrainCircuit className="w-5 h-5" />
                                        <span>2단계: 네이버 뉴스 LLM 검증 시작</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* 우측 패널 (LLM 검증 리포트) */}
                    <div className="flex flex-col w-full lg:w-2/3 flex-1 min-h-[500px] overflow-hidden">
                        <div className="p-5 border-b bg-muted/30 flex justify-between items-center">
                            <div className="flex items-center space-x-2">
                                <Fingerprint className="w-5 h-5 text-primary" />
                                <h2 className="text-base font-bold">LLM 내러티브 컷오프 리포트</h2>
                            </div>
                            
                            {scannedResults.length > 0 && (
                                <div className="flex items-center space-x-4">
                                    <div className="flex items-center space-x-1.5 text-xs font-bold">
                                        <button 
                                            onClick={() => setReportFilter('all')}
                                            className={cn("px-3 py-1.5 rounded-full transition-colors border", reportFilter === 'all' ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:bg-muted")}
                                        >전체 <span className="text-[10px] opacity-80">{totalCount}</span></button>
                                        <button 
                                            onClick={() => setReportFilter('passed')}
                                            className={cn("px-3 py-1.5 rounded-full transition-colors border", reportFilter === 'passed' ? "bg-green-500 text-white border-green-500" : "bg-card text-muted-foreground hover:bg-muted")}
                                        >승인 <span className="text-[10px] opacity-80">{passedCount}</span></button>
                                        <button 
                                            onClick={() => setReportFilter('failed')}
                                            className={cn("px-3 py-1.5 rounded-full transition-colors border", reportFilter === 'failed' ? "bg-red-500 text-white border-red-500" : "bg-card text-muted-foreground hover:bg-muted")}
                                        >탈락 <span className="text-[10px] opacity-80">{failedCount}</span></button>
                                    </div>
                                    <div className="flex items-center p-1 bg-background border rounded-lg">
                                        <button 
                                            onClick={() => setReportViewStyle('table')}
                                            className={cn("p-1.5 rounded-md transition-colors", reportViewStyle === 'table' ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                                        >
                                            <Table className="w-4 h-4" />
                                        </button>
                                        <button 
                                            onClick={() => setReportViewStyle('card')}
                                            className={cn("p-1.5 rounded-md transition-colors", reportViewStyle === 'card' ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                                        >
                                            <LayoutGrid className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="p-5 overflow-y-auto flex-1 bg-background/50 scrollbar-hide">
                            {scannedResults.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
                                    <Search className="w-12 h-12 opacity-20" />
                                    <p className="text-sm">종목을 스캔하여 내러티브 진위 여부를 확인하세요.</p>
                                </div>
                            ) : (
                                <>
                                    {reportViewStyle === 'table' ? (
                                        <table className="w-full text-sm text-left">
                                            <thead className="text-xs text-muted-foreground bg-muted/50 uppercase sticky top-0">
                                                <tr>
                                                    <th className="px-3 py-2 font-semibold text-center w-12">판정</th>
                                                    <th className="px-3 py-2 font-semibold text-center w-14">전략</th>
                                                    <th className="px-3 py-2 font-semibold w-28">종목정보</th>
                                                    <th className="px-3 py-2 font-semibold text-center w-20">스코어</th>
                                                    <th className="px-3 py-2 font-semibold">AI 내러티브 요약</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border bg-card/50">
                                                {filteredResults.map((result) => (
                                                    <tr 
                                                        key={result.code} 
                                                        onClick={() => { setSelectedDetail(result); setActiveModalStep(3); }}
                                                        className={cn("transition-colors cursor-pointer hover:bg-muted/50", result.status !== 'passed' && "opacity-80 text-muted-foreground")}
                                                    >
                                                        <td className="px-3 py-3 text-center">
                                                            {result.status === 'passed' ? <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" /> : <XCircle className="w-5 h-5 text-red-500 mx-auto" />}
                                                        </td>
                                                        <td className="px-3 py-3 text-center">
                                                            <span className={cn(
                                                                "text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap",
                                                                result.tag?.includes('A안') ? "bg-blue-500/20 text-blue-400" :
                                                                result.tag?.includes('B안') ? "bg-orange-500/20 text-orange-400" :
                                                                "bg-purple-500/20 text-purple-400"
                                                            )}>{result.tag}</span>
                                                        </td>
                                                        <td className="px-3 py-3">
                                                            <div className="flex flex-col">
                                                                <span className="font-bold flex-1">{result.name}</span>
                                                                <span className="text-xs text-muted-foreground font-mono mt-0.5">{result.code}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3 font-black text-lg text-center">
                                                            <span className={result.status === 'passed' ? "text-primary" : "text-muted-foreground"}>{result.tbpScore}</span>
                                                        </td>
                                                        <td className="px-3 py-3 text-sm leading-relaxed p-4">
                                                            {result.narrative}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                                            {filteredResults.map((result) => (
                                                <div 
                                                    key={result.code} 
                                                    onClick={() => { setSelectedDetail(result); setActiveModalStep(3); }}
                                                    className={cn(
                                                    "p-4 rounded-xl border flex flex-col gap-3 cursor-pointer transition-all hover:shadow-md",
                                                    result.status === 'passed' ? "bg-card border-green-500/30 hover:border-green-500/60" : "bg-muted/50 border-red-500/20 opacity-90 hover:border-red-500/40"
                                                )}>
                                                    <div className="flex justify-between items-start">
                                                        <div className="flex items-center space-x-3">
                                                            {result.status === 'passed' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <XCircle className="w-5 h-5 text-red-500" />}
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <span className={cn(
                                                                        "text-[10px] px-1.5 py-0.5 rounded font-bold",
                                                                        result.tag?.includes('A안') ? "bg-blue-500/20 text-blue-400" :
                                                                        result.tag?.includes('B안') ? "bg-orange-500/20 text-orange-400" :
                                                                        "bg-purple-500/20 text-purple-400"
                                                                    )}>{result.tag}</span>
                                                                </div>
                                                                <div className="flex items-center space-x-2">
                                                                    <span className="text-base font-bold">{result.name}</span>
                                                                    <span className="text-xs text-muted-foreground">{result.code}</span>
                                                                </div>
                                                                <div className={cn("text-xs font-bold mt-1", result.status === 'passed' ? "text-green-500" : "text-red-500")}>
                                                                    {result.status === 'passed' ? 'Sandbox 편입 승인' : '단발성 테마 컷오프'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-xs text-muted-foreground mb-1">TBP 스코어</div>
                                                            <div className={cn("text-lg font-black", result.status === 'passed' ? "text-primary" : "text-muted-foreground")}>{result.tbpScore}</div>
                                                        </div>
                                                    </div>
                                                    <div className="bg-background p-3 rounded-lg border flex-1">
                                                        <div className="text-xs font-bold text-muted-foreground mb-1">AI Analyst 의견</div>
                                                        <p className="text-sm leading-relaxed">{result.narrative}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {viewMode === 'active' && (
                <div className="flex-1 flex gap-6 min-h-0">
                    {/* 좌측 메인 대시보드 (Active Tracking) */}
                    <div className="flex-1 flex flex-col min-w-0 space-y-6 overflow-y-auto pr-2 scrollbar-hide">
                        {/* 1. Action Summary Header (상태 요약) */}
                        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-primary/10 rounded-full text-primary"><ShieldAlert size={24} /></div>
                                <div>
                                    <h3 className="font-bold text-lg">포트폴리오 상태 요약</h3>
                                    <p className="text-xs text-muted-foreground mt-0.5">현재 추적/편입 중인 종목들 중 리뷰(조치)가 필요한 종목 현황</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
                                    <Activity className="text-green-500" size={16} />
                                    <span className="text-green-500 font-bold text-sm tracking-tight">3종목 순항 (가설 유지)</span>
                                </div>
                                <div className="flex items-center gap-2 px-4 py-2 bg-red-500/5 border border-red-500/20 rounded-lg opacity-60">
                                    <div className="w-2 h-2 rounded-full bg-red-500" />
                                    <span className="text-red-500/80 font-bold text-sm tracking-tight">0종목 편출 대기 (위험)</span>
                                </div>
                            </div>
                        </div>

                        {/* 2. Mega-Trend Matrix */}
                        <div className="grid grid-cols-3 gap-4">
                            {[
                                { title: 'AI / HBM 밸류체인', icon: Zap, value: '확장중', color: 'text-amber-500' },
                                { title: '전력 / 인프라', icon: Flame, value: '초과수요', color: 'text-red-500' },
                                { title: 'K-뷰티 / 플랫폼', icon: Activity, value: '침투율 급증', color: 'text-blue-500' },
                            ].map((idx, i) => (
                                <div key={i} className="bg-card border rounded-xl p-4 flex items-center gap-4 shadow-sm">
                                    <div className={`p-3 rounded-full bg-muted ${idx.color}`}>
                                        <idx.icon size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-sm">{idx.title}</h3>
                                        <p className="text-xs text-muted-foreground font-medium mt-1">{idx.value}</p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* 3. Candidate List */}
                        <div className="flex-1 bg-card border rounded-xl flex flex-col min-h-0 overflow-hidden shadow-sm">
                            <div className="p-4 border-b bg-muted/30">
                                <h2 className="font-bold text-sm">Track M 캔디데이트 (추적 종목)</h2>
                            </div>
                            <div className="overflow-y-auto w-full p-2">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold text-left">종목명 / 시총</th>
                                            <th className="px-4 py-3 font-semibold text-right">편입 정보</th>
                                            <th className="px-4 py-3 font-semibold text-right">현재가 / 수익률</th>
                                            <th className="px-4 py-3 font-semibold text-center">TBP 스코어</th>
                                            <th className="px-4 py-3 font-semibold text-left">메가 트렌드 & 시그널</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {DUMMY_MOONSHOTS.map((stock) => (
                                            <tr 
                                                key={stock.id} 
                                                onClick={() => setSelectedStock(stock)}
                                                className={cn(
                                                    "border-b last:border-b-0 cursor-pointer transition-colors",
                                                    selectedStock?.id === stock.id ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30 border-l-2 border-l-transparent"
                                                )}
                                            >
                                                {/* 종목 & 시총 */}
                                                <td className="px-4 py-4 text-left">
                                                    <div className="font-bold text-base flex items-center gap-2">
                                                        {stock.name} 
                                                        <span className="text-xs text-muted-foreground font-normal">{stock.code}</span>
                                                        <span className={cn(
                                                            "text-[10px] px-1.5 py-0.5 rounded font-bold ml-1",
                                                            stock.trackType === 'A' ? "bg-blue-500/20 text-blue-400" : "bg-orange-500/20 text-orange-400"
                                                        )}>{stock.trackBadge}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-xs font-medium mt-1">
                                                        <div className={cn("w-1.5 h-1.5 rounded-full", stock.weight === '가벼움' ? 'bg-green-500' : 'bg-amber-500')} />
                                                        <span className="text-muted-foreground">{stock.marketCap}</span>
                                                    </div>
                                                </td>

                                                {/* 편입 정보 (Added Date / Base Price) */}
                                                <td className="px-4 py-4 text-right">
                                                    <div className="text-sm font-bold">{stock.entryPrice.toLocaleString()}원</div>
                                                    <div className="text-xs text-muted-foreground mt-1 font-mono">{stock.entryDate}</div>
                                                </td>

                                                {/* 현재가 & 수익률 */}
                                                <td className="px-4 py-4 text-right">
                                                    <div className="text-sm font-bold">{stock.currentPrice.toLocaleString()}원</div>
                                                    <div className={cn(
                                                        "text-xs font-bold mt-1",
                                                        stock.returnRate > 0 ? "text-green-500" : stock.returnRate < 0 ? "text-red-500" : "text-muted-foreground"
                                                    )}>
                                                        {stock.returnRate > 0 ? '+' : ''}{stock.returnRate}%
                                                    </div>
                                                </td>

                                                {/* TBP 스코어 */}
                                                <td className="px-4 py-4">
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span className="font-mono text-lg font-bold">{stock.tbpScore}</span>
                                                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                                            <div 
                                                                className={cn("h-full", stock.tbpScore > 90 ? "bg-green-500" : "bg-primary")} 
                                                                style={{ width: `${stock.tbpScore}%` }} 
                                                            />
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* 메가 트렌드 & 시ਗ널 */}
                                                <td className="px-4 py-4 text-left">
                                                    <div className="font-medium text-xs text-muted-foreground mb-1.5">{stock.trend}</div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {stock.signals.map((s, i) => (
                                                            <span key={i} className="px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded text-[10px] font-bold">
                                                                {s}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* 우측 사이드 패널: Conviction Lock-up */}
                    <div className="w-[380px] shrink-0 flex flex-col bg-card border rounded-2xl overflow-hidden shadow-lg h-full">
                        <div className="bg-primary p-6 text-primary-foreground relative overflow-hidden shrink-0">
                            <div className="absolute right-[-20px] top-[-20px] opacity-10">
                                <Lock size={120} />
                            </div>
                            <div className="relative z-10">
                                <div className="flex items-center gap-2 mb-4 opacity-80">
                                    <ShieldAlert size={16} />
                                    <span className="text-xs font-bold tracking-widest uppercase">Conviction Lock-up</span>
                                </div>
                                <h2 className="text-3xl font-bold">{selectedStock.name}</h2>
                                <div className="flex items-center gap-2 mt-3">
                                    <span className="bg-primary-foreground/20 px-2 py-1 rounded text-xs font-mono">{selectedStock.code}</span>
                                    <span className="px-2 py-1 rounded text-xs font-bold text-green-300">Target: 300% 상승</span>
                                </div>
                                {/* 상세 정보 요약 블록 추가 */}
                                <div className="mt-5 grid grid-cols-2 gap-4 bg-black/20 p-3 rounded-xl border border-white/10">
                                    <div>
                                        <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-wider">Current / Return</p>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-lg font-bold">{selectedStock.currentPrice.toLocaleString()}</span>
                                            <span className={cn("text-sm font-bold", selectedStock.returnRate > 0 ? "text-green-400" : "text-red-400")}>
                                                {selectedStock.returnRate > 0 ? '+' : ''}{selectedStock.returnRate}%
                                            </span>
                                        </div>
                                    </div>
                                    <div className="border-l border-white/10 pl-4">
                                        <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-wider">Entry Info</p>
                                        <div className="text-sm font-bold">{selectedStock.entryPrice.toLocaleString()}</div>
                                        <div className="text-[10px] font-mono opacity-60 mt-0.5">{selectedStock.entryDate} 편입</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 flex-1 overflow-y-auto space-y-6 scrollbar-hide">
                            {/* 최초 투자 논리 */}
                            <div>
                                <h3 className="flex items-center gap-2 text-sm font-bold text-muted-foreground mb-3 uppercase">
                                    <CheckCircle2 size={16} />
                                    Original Thesis (투자가설)
                                </h3>
                                <blockquote className="border-l-4 border-primary pl-4 py-3 text-sm font-medium leading-relaxed bg-muted/30 rounded-r-lg">
                                    "{selectedStock.originalThesis}"
                                </blockquote>
                            </div>
                            <div className="w-full h-px bg-border my-2" />
                            {/* AI 심사 로깅 */}
                            <div>
                                <h3 className="flex items-center gap-2 text-sm font-bold text-muted-foreground mb-3 uppercase">
                                    <Activity size={16} />
                                    Daily AI Review Log
                                </h3>
                                <div className="space-y-4">
                                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs font-mono opacity-60">오늘 장마감 검증 요약</span>
                                            <span className="text-[10px] font-bold text-green-500 bg-green-500/20 px-2 py-0.5 rounded">STRONG HOLD</span>
                                        </div>
                                        <p className="text-xs leading-relaxed text-foreground">
                                            주가 하락(-4.5%)은 거시적 지수 영향에 기인함. 외인/기관 연속 매수 지표는 우상향 중. 메인 내러티브 훼손 없으며, 오버행 이슈 무관함. 기계적 손절 로직 우회 처리 완료.
                                        </p>
                                    </div>
                                    <div className="bg-muted p-4 rounded-xl border">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs font-mono opacity-60">어제 장마감 검증 요약</span>
                                            <span className="text-[10px] font-bold text-green-600 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded">HOLD</span>
                                        </div>
                                        <p className="text-xs leading-relaxed text-muted-foreground">
                                            거래량 감소하며 횡보 중이나 동종 섹터 대비 하방 경직성 발현 중.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {viewMode === 'archive' && (
                /* Archive 히스토리 화면 */
                <div className="flex-1 flex flex-col min-h-0 bg-card border rounded-2xl p-6 overflow-hidden">
                    <div className="mb-6 flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <History className="text-primary" /> 관리 이력 및 복기 (Hall of Fame & Graveyard)
                            </h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                과거 텐베거 후보군들의 발굴, 보유, 편출(매도) 내역과 AI의 사후 분석 로그입니다.
                            </p>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 scrollbar-hide pr-2">
                        {DUMMY_ARCHIVE.map((arc, i) => (
                            <div key={i} className="flex gap-4 border rounded-xl p-5 bg-background shadow-sm relative overflow-hidden transition-all hover:border-primary/50 group">
                                {/* Success Indicator Strip */}
                                <div className={cn("absolute left-0 top-0 bottom-0 w-2", arc.success ? "bg-green-500" : "bg-red-500")} />
                                
                                {/* 좌측 종목/수익률 요약 */}
                                <div className="w-[200px] shrink-0 border-r pr-6 pl-2 flex flex-col justify-center">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="text-lg font-bold">{arc.name}</h3>
                                        <span className="text-xs text-muted-foreground font-mono">{arc.code}</span>
                                    </div>
                                    <div className="mb-2">
                                         <span className={cn(
                                            "text-[10px] px-1.5 py-0.5 rounded font-bold",
                                            arc.trackType === 'A' ? "bg-blue-500/20 text-blue-400" : "bg-orange-500/20 text-orange-400"
                                        )}>{arc.trackBadge}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mb-4">보유기간: {arc.duration} <br/> ({arc.buyDate} ~ {arc.sellDate})</p>
                                    <div className="flex items-center gap-2">
                                        {arc.success ? <TrendingUp className="text-green-500" size={24} /> : <TrendingDown className="text-red-500" size={24} />}
                                        <span className={cn("text-2xl font-bold font-mono tracking-tighter", arc.success ? "text-green-500" : "text-red-500")}>
                                            {arc.returnRate > 0 ? '+' : ''}{arc.returnRate}%
                                        </span>
                                    </div>
                                </div>

                                {/* 우측 복기 리포트 */}
                                <div className="flex-1 pl-2 space-y-4">
                                    <div>
                                        <h4 className="text-xs font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-1">
                                            <BookOpen size={14}/> 최초 투자 가설
                                        </h4>
                                        <p className="text-sm border-b pb-3 border-border/50 text-foreground/80 leading-relaxed">
                                            {arc.originalThesis}
                                        </p>
                                    </div>
                                    <div className={cn("p-3 rounded-lg border", arc.success ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20")}>
                                        <h4 className={cn("text-xs font-bold uppercase mb-1.5", arc.success ? "text-green-600" : "text-red-600")}>
                                            최종 결과 및 매도 사유 (복기)
                                        </h4>
                                        <p className="text-sm font-medium leading-relaxed">
                                            {arc.sellReason}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 상세 리포트 모달 */}
            {selectedDetail && (
                <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6">
                    <div className="bg-card w-full max-w-6xl border rounded-2xl shadow-xl flex flex-col h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        
                        {/* Modal Header (Integrated Summary) */}
                        <div className="px-6 py-4 border-b flex flex-col sm:flex-row sm:items-center justify-between bg-muted/30 shrink-0 gap-4">
                            <div className="flex items-center gap-4">
                                <Search className="w-5 h-5 text-primary hidden sm:block" />
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            "text-[10px] px-2 py-0.5 rounded font-black whitespace-nowrap",
                                            selectedDetail.tag?.includes('A안') ? "bg-blue-500/20 text-blue-500 dark:text-blue-400" :
                                            selectedDetail.tag?.includes('B안') ? "bg-orange-500/20 text-orange-500 dark:text-orange-400" :
                                            "bg-purple-500/20 text-purple-600 dark:text-purple-400"
                                        )}>{selectedDetail.tag}</span>
                                        <span className={cn("text-[10px] px-2 py-0.5 rounded font-black whitespace-nowrap", selectedDetail.status === 'passed' ? "bg-green-500/20 text-green-600 dark:text-green-400" : "bg-red-500/20 text-red-600 dark:text-red-400")}>
                                            {selectedDetail.status === 'passed' ? 'Sandbox 편입 승인 (합격)' : '단발성 컷오프 (탈락)'}
                                        </span>
                                    </div>
                                    <h3 className="text-2xl font-black flex items-baseline gap-2">
                                        {selectedDetail.name} 
                                        <span className="text-sm font-medium text-muted-foreground font-mono">{selectedDetail.code}</span>
                                    </h3>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-4 sm:gap-6">
                                <div className="flex items-center gap-4 border-r pr-4 sm:pr-6 border-border/70">
                                    <button 
                                        onClick={handleCopyAll}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-background border hover:bg-muted/50 rounded-lg text-xs font-bold transition-colors"
                                    >
                                        {isCopied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                                        {isCopied ? <span className="text-green-500">복사 완료!</span> : "전체 전문 복사"}
                                    </button>
                                    <div className="text-right">
                                        <div className="text-[10px] text-muted-foreground font-bold mb-0.5 uppercase tracking-wider">TBP 스코어 (TenBagger Potential)</div>
                                        <div className={cn("text-3xl leading-none font-black tracking-tighter", selectedDetail.status === 'passed' ? "text-primary" : "text-muted-foreground")}>{selectedDetail.tbpScore}</div>
                                    </div>
                                </div>
                                <button onClick={() => setSelectedDetail(null)} className="p-2 hover:bg-muted rounded-full transition-colors flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
                                    닫기 <XCircle className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Modal Content (Master-Detail Flex Container) */}
                        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
                                
                            {/* Left Panel: Step Navigation */}
                            <div className="w-full lg:w-[280px] shrink-0 flex flex-col gap-2 relative bg-muted/10 border-r p-6 overflow-y-auto scrollbar-hide">
                                <div className="hidden lg:block absolute left-[39px] top-16 bottom-6 w-0.5 bg-border -z-10"></div>
                                <div className="text-[11px] font-black text-muted-foreground uppercase tracking-wider mb-2 pl-2">AI 하네스 리서치 궤적</div>
                                    
                                    <button 
                                        onClick={() => setActiveModalStep(1)}
                                        className={cn("text-left p-3 rounded-xl transition-all relative flex flex-col gap-1", activeModalStep === 1 ? "bg-card shadow-sm border border-primary/20 ring-1 ring-primary" : "hover:bg-muted/50")}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={cn("hidden lg:block w-2.5 h-2.5 rounded-full z-10", activeModalStep === 1 ? "bg-primary ring-4 ring-primary/20" : "bg-muted-foreground")}></div>
                                            <span className={cn("text-xs font-black", activeModalStep === 1 ? "text-primary" : "text-muted-foreground")}>STEP 1</span>
                                        </div>
                                        <div className={cn("lg:pl-5 text-sm font-bold", activeModalStep === 1 ? "text-foreground" : "text-muted-foreground")}>로컬 핀스크리닝</div>
                                        <div className="lg:pl-5 text-[10px] text-muted-foreground font-medium">초기 노이즈 필터링 완료</div>
                                    </button>

                                    <button 
                                        onClick={() => setActiveModalStep(2)}
                                        className={cn("text-left p-3 rounded-xl transition-all relative flex flex-col gap-1", activeModalStep === 2 ? "bg-card shadow-sm border border-primary/20 ring-1 ring-primary" : "hover:bg-muted/50")}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={cn("hidden lg:block w-2.5 h-2.5 rounded-full z-10", activeModalStep === 2 ? "bg-primary ring-4 ring-primary/20" : "bg-muted-foreground")}></div>
                                            <span className={cn("text-xs font-black", activeModalStep === 2 ? "text-primary" : "text-muted-foreground")}>STEP 2</span>
                                        </div>
                                        <div className={cn("lg:pl-5 text-sm font-bold", activeModalStep === 2 ? "text-foreground" : "text-muted-foreground")}>다기연 자율 리서치</div>
                                        <div className="lg:pl-5 text-[10px] text-muted-foreground font-medium">결측 데이터 추가 수집 완료</div>
                                    </button>

                                    <button 
                                        onClick={() => setActiveModalStep(3)}
                                        className={cn("text-left p-3 rounded-xl transition-all relative flex flex-col gap-1", activeModalStep === 3 ? "bg-card shadow-sm border border-primary/20 ring-1 ring-primary" : "hover:bg-muted/50")}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={cn("hidden lg:block w-2.5 h-2.5 rounded-full z-10", activeModalStep === 3 ? "bg-primary ring-4 ring-primary/20" : "bg-muted-foreground")}></div>
                                            <span className={cn("text-xs font-black", activeModalStep === 3 ? "text-primary" : "text-muted-foreground")}>STEP 3</span>
                                        </div>
                                        <div className={cn("lg:pl-5 text-sm font-bold", activeModalStep === 3 ? "text-foreground" : "text-muted-foreground")}>내러티브 최종 심사</div>
                                        <div className="lg:pl-5 text-[10px] text-muted-foreground font-medium">최종 3척도 판정 산출 완료</div>
                                    </button>
                                </div>

                                {/* Right Panel: Action Content */}
                                <div className="flex-1 bg-background p-6 lg:p-8 overflow-y-auto scrollbar-hide">
                                    {activeModalStep === 1 && (
                                        <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                            <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground border-b pb-3">
                                                <Database className="w-4 h-4" /> [Step 1] HTS/로컬 AI 기초 스크리닝 데이터
                                            </div>
                                            <div className="text-[15px] text-foreground font-medium whitespace-pre-wrap leading-relaxed w-full">
                                                {selectedDetail.inputData}
                                            </div>
                                        </div>
                                    )}

                                    {activeModalStep === 2 && (
                                        <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                            <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground border-b pb-3">
                                                <Search className="w-4 h-4" /> [Step 2] AI 타겟형 결측치 탐지 및 자율 크롤링 스크립트 실행 로그
                                            </div>
                                            <div className="text-[13px] font-mono leading-loose space-y-4 p-4 bg-muted/30 rounded-lg border">
                                                <div className="text-orange-600 dark:text-orange-400 font-bold">
                                                    [System] 로컬 AI 스크리닝 통과. 단기 테마성 노이즈 아님.
                                                </div>
                                                <div className="text-primary font-bold">
                                                    [Agent-Node] 결측치 탐지 발동: 현재 수집된 기본 재무/뉴스만으로는 텐베거 내러티브 3척도(확장성/희소성) 검증이 불충분함.<br/>
                                                    [Agent-Action] 추가 심층 웹서치 쿼리 자율 생성: <span className="underline">"{selectedDetail.name} 신사업 점유율 상승 기관 리포트 OR 밸류체인 진입"</span>
                                                </div>
                                                <div className="text-muted-foreground">
                                                    <span className="animate-pulse font-bold">Executing Scraper...</span> 네이버/구글 2차 맵핑 스크래핑 완료 (심층 기사 및 레포트 3건 추가 획득).<br/>
                                                    [Status] 최종 High-End LLM 문맥 버퍼(Context Buffer) 결속 완료. Step 3로 판단 이관 승인.
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {activeModalStep === 3 && (
                                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                            <div className="space-y-3">
                                                <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground border-b pb-3">
                                                    <BrainCircuit className="w-4 h-4" /> 하이엔드 AI 종합 평가 프롬프트 (클라우드 모델)
                                                </div>
                                                <div className="text-[13px] text-muted-foreground whitespace-pre-wrap leading-relaxed w-full bg-muted/50 p-4 rounded-xl border">
                                                    {selectedDetail.prompt}
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground border-b pb-3">
                                                    <Fingerprint className="w-4 h-4" /> LLM 추론 상세 결과 (최종 판정 Raw Log)
                                                </div>
                                                <div className={cn(
                                                    "p-6 rounded-xl border border-border/80 text-[15px] font-medium whitespace-pre-wrap leading-loose min-h-[200px]",
                                                    selectedDetail.status === 'passed' ? "bg-green-500/5 text-green-950 dark:text-green-50" : "bg-red-500/5 text-red-950 dark:text-red-50"
                                                )}>
                                                    {selectedDetail.rawResult}
                                                </div>
                                            </div>
                                            
                                            {selectedDetail.status === 'passed' && (
                                                <div className="pt-2 flex justify-end">
                                                    <button className="px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl flex items-center space-x-2 transition-transform active:scale-[0.98] shadow-md">
                                                        <span>이 종목을 Moonshot Sandbox로 이동</span>
                                                        <ChevronRight className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
            )}

            {/* Developer Playground Modal */}
            {showPlayground && (
                <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-6">
                    <div className="bg-card w-full max-w-5xl border rounded-2xl shadow-xl flex flex-col h-[80vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-6 py-4 border-b flex items-center justify-between bg-muted/30 shrink-0">
                            <div className="flex items-center gap-3">
                                <span className="text-xl">🧪</span>
                                <div>
                                    <h2 className="text-lg font-black tracking-tight">AI Toolbelt Playground</h2>
                                    <p className="text-[11px] text-muted-foreground font-bold mt-0.5">백엔드 연동 전 단일 파이프라인(OpenAPI, DB, 크롤러) 모듈 무결성 테스트 보드</p>
                                </div>
                            </div>
                            <button onClick={() => { setShowPlayground(false); setPlaygroundLogs([]); }} className="px-4 py-2 hover:bg-muted font-bold text-sm rounded-lg transition-colors text-muted-foreground">
                                닫기
                            </button>
                        </div>
                        
                        <div className="flex-1 flex min-h-0 overflow-hidden">
                            {/* Left: Tools */}
                            <div className="w-full md:w-[320px] bg-muted/10 border-r p-6 overflow-y-auto scrollbar-hide flex flex-col gap-3 shrink-0">
                                <div className="text-[11px] font-black text-muted-foreground uppercase tracking-wider mb-2">테스트 가능 모듈 (Phase 0)</div>
                                
                                <button onClick={() => handleTestTool("키움 조건검색 (TR: condition)")} className="text-left p-4 rounded-xl border bg-background hover:border-primary/50 transition-colors shadow-sm active:scale-[0.98]">
                                    <div className="text-sm font-bold text-foreground">1. 키움 조건검색 호출</div>
                                    <div className="text-[10px] text-muted-foreground mt-1">REST API 수신 결과 패스스루 확인</div>
                                </button>
                                
                                <button onClick={() => handleTestTool("투자자매매동향 (TR: opt10059)")} className="text-left p-4 rounded-xl border bg-background hover:border-primary/50 transition-colors shadow-sm active:scale-[0.98]">
                                    <div className="text-sm font-bold text-foreground">2. 스마트머니 수급 조회</div>
                                    <div className="text-[10px] text-muted-foreground mt-1">외인/기관 대금 (Rate limit 방어 검증)</div>
                                </button>
                                
                                <button onClick={() => handleTestTool("주식기본정보 (TR: opt10001)")} className="text-left p-4 rounded-xl border bg-background hover:border-primary/50 transition-colors shadow-sm active:scale-[0.98]">
                                    <div className="text-sm font-bold text-foreground">3. 펀더멘털 및 신용 추출</div>
                                    <div className="text-[10px] text-muted-foreground mt-1">과열 징후(신용비율), PER 추출 확인</div>
                                </button>
                                
                                <button onClick={() => handleTestTool("로컬 DB 히스토리 쿼리")} className="text-left p-4 rounded-xl border bg-background hover:border-primary/50 transition-colors shadow-sm active:scale-[0.98]">
                                    <div className="text-sm font-bold text-foreground">4. 내부 DB 리서치 기억 모듈</div>
                                    <div className="text-[10px] text-muted-foreground mt-1">과거 6개월 컷오프 이력 JSON 요약 테스트</div>
                                </button>
                                
                                <button onClick={() => handleTestTool("DART/네이버 크롤러 봇")} className="text-left p-4 rounded-xl border bg-background hover:border-primary/50 transition-colors shadow-sm active:scale-[0.98]">
                                    <div className="text-sm font-bold text-foreground">5. 우회 데이터 크롤링</div>
                                    <div className="text-[10px] text-muted-foreground mt-1">캡차 차단 회피 및 헤드라인 수집 무결성</div>
                                </button>
                            </div>
                            
                            {/* Right: Log Output */}
                            <div className="flex-1 bg-slate-50 dark:bg-slate-900/50 p-6 font-mono text-[13px] overflow-y-auto relative scrollbar-hide">
                                <div className="absolute top-4 right-4 text-[10px] font-bold text-muted-foreground/40 select-none">SYSTEM CONSOLE V1.0</div>
                                {playgroundLogs.length === 0 ? (
                                    <div className="text-muted-foreground/60 text-center flex flex-col items-center justify-center h-full gap-4 pb-10">
                                        <div className="opacity-30 text-5xl">💻</div>
                                        <div className="font-medium text-sm">
                                            좌측 패널에서 테스트할 모듈을 선택하여 REST API를 발송하십시오.<br/><br/>
                                            <span className="animate-pulse opacity-70">Waiting for execution...</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4 pb-6">
                                        {playgroundLogs.map((log, idx) => (
                                            <div key={idx} className="space-y-1.5 animate-in fade-in slide-in-from-bottom-2">
                                                <div className="flex gap-4 opacity-90 select-none">
                                                    <span className="text-muted-foreground">[{log.time}]</span>
                                                    <span className={log.msg.includes('요청') ? "text-amber-600 dark:text-amber-400 font-bold" : "text-blue-600 dark:text-blue-400 font-bold"}>$&gt; {log.msg}</span>
                                                </div>
                                                {log.json && (
                                                    <pre className="bg-white dark:bg-[#0a0a0a] p-3.5 rounded-lg border shadow-sm text-slate-800 dark:text-slate-300 text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap ml-[85px] ring-1 ring-black/5 dark:ring-white/5">
                                                        {JSON.stringify(log.json, null, 2)}
                                                    </pre>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Condition Settings Modal */}
            {showConditionSettings && (
                <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-6">
                    <div className="bg-card w-full max-w-md border rounded-2xl shadow-xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-5 py-4 border-b flex items-center justify-between bg-muted/30">
                            <h2 className="text-base font-bold flex items-center gap-2">
                                <Settings className="w-4 h-4 text-primary" /> 조건검색 매핑 설정
                            </h2>
                            <button onClick={() => setShowConditionSettings(false)} className="p-1 hover:bg-muted text-muted-foreground rounded-lg transition-colors">
                                <XCircle className="w-5 h-5" />
                            </button>
                        </div>
                        
                        {/* Content */}
                        <div className="p-6 space-y-5">
                            <div>
                                <label className="block text-xs font-bold text-blue-500 mb-2">[A안] 수급/베이스캠프 연동 식</label>
                                <select 
                                    className="w-full bg-background border rounded-lg px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
                                    value={selectedConditionA}
                                    onChange={(e) => setSelectedConditionA(e.target.value)}
                                >
                                    {DUMMY_CONDITIONS_A.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-orange-500 mb-2">[B안] 모멘텀/거래대금 연동 식</label>
                                <select 
                                    className="w-full bg-background border rounded-lg px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
                                    value={selectedConditionB}
                                    onChange={(e) => setSelectedConditionB(e.target.value)}
                                >
                                    {DUMMY_CONDITIONS_B.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-purple-600 mb-2">[C안] 대세 상승 중간 탑승 탐지</label>
                                <select 
                                    className="w-full bg-background border rounded-lg px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
                                    value={selectedConditionC}
                                    onChange={(e) => setSelectedConditionC(e.target.value)}
                                >
                                    {DUMMY_CONDITIONS_C.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                        </div>
                        
                        {/* Footer */}
                        <div className="px-5 py-4 border-t bg-muted/10 flex justify-end">
                            <button onClick={() => setShowConditionSettings(false)} className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold rounded-xl transition-colors shadow-sm active:scale-95">
                                적용 완료
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
