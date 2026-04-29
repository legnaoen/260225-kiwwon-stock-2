import React, { useState, useEffect } from 'react'
import { Rocket, ShieldAlert, Flame, Activity, Zap, CheckCircle2, ChevronRight, Lock, Archive, History, BookOpen, TrendingUp, TrendingDown, Telescope, Database, Filter, BrainCircuit, XCircle, Search, Fingerprint, LayoutGrid, Table, Copy, Check, Settings, Loader2, Terminal, AlertCircle, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
        status: '가설 순항',
        statusColor: 'text-green-500',
        trend: 'AI / HBM 밸류체인',
        signals: ['🟢 외인 3일 연속 매집', '🟢 20일선 지지 반등'],
        bullCase: '글로벌 AI 반도체 수요 급증에 따른 글로벌 벤더들의 HBM 증설 필수 요건. 독점적 후공정 장비 공급 지위.',
        bearCase: '시총이 너무 무거워 추가 상승 탄력이 둔화되고 있으며, 경쟁사의 TC 본더 진입 가능성이 거론됨.',
        milestones: [
            { text: '마이크론 등 신규 글로벌 고객사 수주 공시', checked: true },
            { text: '월간 수출 데이터 연속 상승 지속', checked: false }
        ],
        investThesis: '글로벌 HBM CAPEX 확장의 최대 수혜주로서 실적 고도화의 1등 벤더 프리미엄 지속 구간',
        invalidation: '외국인 지분율의 구조적 이탈 발생 시 또는 전방 데이터센터 CAPEX 컷 사인 발생 시',
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
        status: '목표 초과 달성',
        statusColor: 'text-blue-500',
        trend: '전력 인프라 슈퍼사이클',
        signals: ['🟢 신고가 돌파 직전', '🟡 거래량 감소 (매물 소화)'],
        bullCase: '미국 전력망 교체 주기 및 AI 데이터센터 가동으로 인한 변압기 숏티지. 북미 수출 급증에 따른 레버리지.',
        bearCase: '최근 단기 급등으로 밸류에이션 부담 가중 및 테마주 엮임으로 인한 변동성 심화 우려.',
        milestones: [
            { text: '분기별 북미향 수출 비중 우상향 유지', checked: true },
            { text: 'OPM(영업이익률) 25% 이상 달성', checked: true }
        ],
        investThesis: '북미 전력망 교체 슈퍼사이클의 최대 레버리지 수혜주로, 실적 폭발성이 단기 테마를 압도함.',
        invalidation: '원/달러 환율의 급격한 하락 또는 월별 수출 잠정치 YOY 하락 전환 시',
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
        status: '경고 누적 (1/3)',
        statusColor: 'text-orange-500',
        trend: 'K-뷰티 / 플랫폼',
        signals: ['🔴 5일선 하향 이탈 경고', '🔴 수급 이탈 점진 가속'],
        bullCase: '미국/유럽향 인디 브랜드 화장품 수출의 독보적 유통 플랫폼. 물류 인프라 선점에 따른 구조적 진입장벽 구축.',
        bearCase: '단기 실적 피크아웃 우려 및 기관의 차익 실현 출회 조짐.',
        milestones: [
            { text: '미국 외 유럽, 아시아 등 신규 국가 매출 비중 30% 돌파', checked: false },
            { text: '운반비 상승분 판가 전가 방어율 확인', checked: false }
        ],
        investThesis: '단순 테마가 아닌 K-인디 뷰티 브랜드 엑셀러레이터이자 독점적 인프라로서 플랫폼 가치 부여 가능.',
        invalidation: '주요 벤더사(고객)들의 직접 수출 이탈 또는 분기 영업이익률의 구조적 하향 시 즉시 컷오프',
        entryDate: '2024.03.05',
        entryPrice: 8500,
        currentPrice: 8100,
        returnRate: -4.70,
        trackType: 'C',
        trackBadge: 'C안'
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

    const [viewMode, setViewMode] = useState<'scanner' | 'active' | 'archive'>('active') // active를 기본값으로
    
    // Active Tracking 탭의 동적 상태 관리를 위한 State
    const [activeStocks, setActiveStocks] = useState<any[]>([])
    const [selectedStockId, setSelectedStockId] = useState<string | null>(null)
    const selectedStock = activeStocks.find(s => s.id === selectedStockId) || activeStocks[0] || null

    const [archiveStocks, setArchiveStocks] = useState<any[]>([])
    const [selectedArchiveId, setSelectedArchiveId] = useState<string | number | null>(null)
    const selectedArchive = archiveStocks.find(s => s.id === selectedArchiveId) || archiveStocks[0] || null

    useEffect(() => {
        if (viewMode === 'archive') {
            const fetchArchive = async () => {
                const { electronAPI } = window as any;
                if (!electronAPI || !electronAPI.invoke) return;
                try {
                    const res = await electronAPI.invoke('moonshot:get-archive');
                    if (res) setArchiveStocks(res);
                } catch (e) { console.error(e); }
            }
            fetchArchive();
        }
    }, [viewMode])

    useEffect(() => {
        if (viewMode === 'active') {
            const fetchActiveStocks = async () => {
                const { electronAPI } = window as any;
                if (!electronAPI || !electronAPI.invoke) return;
                try {
                    const res = await electronAPI.invoke('moonshot:get-active-tracking');
                    if (res.success && res.data) {
                        const mapped = res.data.map((row: any) => {
                            const returnRate = row.entry_price > 0 ? ((row.current_price - row.entry_price) / row.entry_price * 100).toFixed(1) : 0;
                            let statusColor = "bg-green-500/10 text-green-600";
                            let statusText = "가설 검증중";
                            if (row.is_invalidated) {
                                statusText = "가설 훼손컷";
                                statusColor = "bg-red-500/10 text-red-600";
                            } else if (Number(returnRate) > 5) {
                                statusText = "가설 순항중";
                            }
                            let milestones = [];
                            try { milestones = JSON.parse(row.milestones_json || '[]'); } catch(e){}
                            if (typeof milestones[0] === 'string') {
                                // transform old string array
                                milestones = milestones.map((m: string) => ({ desc: m, checked: false }));
                            }

                            return {
                                id: row.stock_code,
                                code: row.stock_code,
                                name: row.stock_name,
                                trackType: row.tag.replace('안', ''),
                                trackBadge: row.tag,
                                marketCap: 'N/A',
                                weight: '가벼움',
                                entryPrice: row.entry_price,
                                currentPrice: row.current_price,
                                entryDate: row.entry_date,
                                returnRate: Number(returnRate),
                                status: statusText,
                                statusColor,
                                trend: row.mega_trend || '',
                                dailyAction: 'AI 데일리 복기 대기중',
                                tbpScore: row.tbp_score || 0,
                                isInvalidated: !!row.is_invalidated,
                                originalThesis: row.narrative || '이전 버전에서 편입된 종목이라 제미나이 최종 심사평 데이터가 DB에 없습니다. (재검증 후 신규 편입 시 정상 표시됩니다.)',
                                dailyNarrative: row.latest_daily_narrative || null,
                                dailyVerdict: row.latest_verdict || null,
                                dailyReviewedAt: row.latest_reviewed_at || null,
                                bullCase: row.bull_case,
                                bearCase: row.bear_case,
                                invalidationCondition: row.invalidation_condition,
                                milestones: milestones,
                                signals: []
                            };
                        });
                        setActiveStocks(mapped);
                    }
                } catch (e) {
                    console.error('Fetch active tracking error:', e);
                }
            };
            fetchActiveStocks();
        }
    }, [viewMode]);
    
    const toggleMilestone = (milestoneIndex: number) => {
        setActiveStocks(prev => prev.map(stock => {
            if(stock.id === selectedStockId) {
                const newMilestones = [...stock.milestones];
                newMilestones[milestoneIndex] = {...newMilestones[milestoneIndex], checked: !newMilestones[milestoneIndex].checked};
                return {...stock, milestones: newMilestones};
            }
            return stock;
        }));
    };

    const toggleInvalidation = () => {
        setActiveStocks(prev => prev.map(stock => {
            if(stock.id === selectedStockId) {
                return {...stock, isInvalidated: !stock.isInvalidated};
            }
            return stock;
        }));
    };

    const handleDeleteActiveTracking = async () => {
        if (!selectedStock) return;
        if (!confirm(`[${selectedStock.name}] 종목을 액티브 트래킹 명부에서 완전히 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
        
        const { electronAPI } = window as any;
        if (!electronAPI || !electronAPI.invoke) return;

        try {
            const res = await electronAPI.invoke('moonshot:delete-active-tracking', selectedStock.code);
            if (res.success) {
                setActiveStocks(prev => prev.filter(s => s.code !== selectedStock.code));
                setSelectedStockId(null);
            } else {
                alert('삭제 실패: ' + res.error);
            }
        } catch(e: any) {
            alert('IPC 에러: ' + e.message);
        }
    };

    const handleDeleteArchive = async (arc: any, e: React.MouseEvent) => {
        e.stopPropagation(); // 행 선택 이벤트 차단
        if (!confirm(`[${arc.stock_name}] 항목을 히스토리에서 삭제하시겠습니까?\nAI가 자동으로 정리한 내용만 남기려면 확인하세요.`)) return;

        const { electronAPI } = window as any;
        if (!electronAPI || !electronAPI.invoke) return;

        try {
            const res = await electronAPI.invoke('moonshot:delete-archive', arc.id);
            if (res.success) {
                setArchiveStocks(prev => prev.filter(s => s.id !== arc.id));
                if (selectedArchive?.id === arc.id) setSelectedArchiveId(null);
            } else {
                alert('삭제 실패: ' + res.error);
            }
        } catch(e: any) {
            alert('IPC 에러: ' + e.message);
        }
    };


    // Scanner States
    const [selectedConditionA, setSelectedConditionA] = useState(() => localStorage.getItem('moonshot_condA') || '101')
    const [selectedConditionB, setSelectedConditionB] = useState(() => localStorage.getItem('moonshot_condB') || '201')
    const [selectedConditionC, setSelectedConditionC] = useState(() => localStorage.getItem('moonshot_condC') || '301')
    const [isScanning, setIsScanning] = useState(false)
    const [reportFilter, setReportFilter] = useState<'all' | 'passed' | 'failed'>('all')
    const [reportViewStyle, setReportViewStyle] = useState<'table' | 'card'>('table')
    const [selectedDetail, setSelectedDetail] = useState<any | null>(null)
    const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null)
    const [activeModalStep, setActiveModalStep] = useState<number>(3)
    const [isCopied, setIsCopied] = useState(false)
    const [ignoreCooldown, setIgnoreCooldown] = useState(false)
    const [isRunningTracker, setIsRunningTracker] = useState(false)
    const [trackerLogs, setTrackerLogs] = useState<{time: string, step: string, msg: string, type: string}[]>([]);
    const [playgroundLogs, setPlaygroundLogs] = useState<any[]>([]);

    // Settings 상태
    const [showSettings, setShowSettings] = useState(false);
    const [moonshotSettings, setMoonshotSettings] = useState({
        scannerCronTime: '15:00',
        trackerCronTime: '15:30',
        enabled: true
    });
    const [showConditionSettings, setShowConditionSettings] = useState(false);

    useEffect(() => {
        const fetchSettings = async () => {
            const { electronAPI } = window as any;
            if (electronAPI && electronAPI.invoke) {
                const s = await electronAPI.invoke('moonshot:get-settings');
                if (s) {
                    setMoonshotSettings(s);
                    // 저장된 조건식 ID 복원 (실제 키움 조건식 목록이 로드되기 전이므로 localStorage 덮어쓰기)
                    if (s.conditions && s.conditions.length >= 1) setSelectedConditionA(s.conditions[0]);
                    if (s.conditions && s.conditions.length >= 2) setSelectedConditionB(s.conditions[1]);
                    if (s.conditions && s.conditions.length >= 3) setSelectedConditionC(s.conditions[2]);
                }
            }
        };
        fetchSettings();
    }, []);

    const handleSaveSettings = async () => {
        const { electronAPI } = window as any;
        if (electronAPI && electronAPI.invoke) {
            // A/B/C안 조건식 ID를 conditions 배열로 묶어서 함께 저장 → 백엔드 크론이 사용
            const settingsToSave = {
                ...moonshotSettings,
                conditions: [selectedConditionA, selectedConditionB, selectedConditionC].filter(Boolean)
            };
            await electronAPI.invoke('moonshot:save-settings', settingsToSave);
        }
        setShowSettings(false);
        alert('Moonshot AI 스케줄 설정이 저장되었습니다.');
    };

    const handleSaveConditionSettings = async () => {
        localStorage.setItem('moonshot_condA', selectedConditionA);
        localStorage.setItem('moonshot_condB', selectedConditionB);
        localStorage.setItem('moonshot_condC', selectedConditionC);
        
        const { electronAPI } = window as any;
        if (electronAPI && electronAPI.invoke) {
            const settingsToSave = {
                ...moonshotSettings,
                conditions: [selectedConditionA, selectedConditionB, selectedConditionC].filter(Boolean)
            };
            await electronAPI.invoke('moonshot:save-settings', settingsToSave);
        }
        setShowConditionSettings(false);
        alert('조건검색 매핑이 시스템에 저장되었습니다.');
    };

    const handleRunDailyTracker = async () => {
        const { electronAPI } = window as any;
        if (!electronAPI?.runMoonshotDailyTracker) return;
        setIsRunningTracker(true);
        setTrackerLogs([]);

        const unsub = electronAPI.onMoonshotTrackerProgress?.((log: any) => {
            setTrackerLogs(prev => [...prev, log]);
        });

        try {
            const res = await electronAPI.runMoonshotDailyTracker();
            if (!res.success) {
                alert('데일리 리뷰 실패: ' + res.error);
            } else {
                // ✅ Fix: viewMode 토글 없이 직접 DB 재조회 후 상태 갱신
                const refetchRes = await electronAPI.invoke('moonshot:get-active-tracking');
                if (refetchRes.success && refetchRes.data) {
                    const mapped = refetchRes.data.map((row: any) => {
                        const returnRate = row.entry_price > 0
                            ? ((row.current_price - row.entry_price) / row.entry_price * 100).toFixed(1)
                            : 0;
                        let statusColor = "bg-green-500/10 text-green-600";
                        let statusText = "가설 검증중";
                        if (row.is_invalidated) {
                            statusText = "가설 훼손컷";
                            statusColor = "bg-red-500/10 text-red-600";
                        } else if (Number(returnRate) > 5) {
                            statusText = "가설 순항중";
                        }
                        let milestones = [];
                        try { milestones = JSON.parse(row.milestones_json || '[]'); } catch(e){}
                        if (typeof milestones[0] === 'string') {
                            milestones = milestones.map((m: string) => ({ desc: m, checked: false }));
                        }
                        return {
                            id: row.stock_code,
                            code: row.stock_code,
                            name: row.stock_name,
                            trackType: row.tag.replace('안', ''),
                            trackBadge: row.tag,
                            marketCap: 'N/A',
                            weight: '가벼움',
                            entryPrice: row.entry_price,
                            currentPrice: row.current_price,
                            entryDate: row.entry_date,
                            returnRate: Number(returnRate),
                            status: statusText,
                            statusColor,
                            trend: row.mega_trend || '',
                            dailyAction: 'AI 데일리 복기 완료',
                            tbpScore: row.tbp_score || 0,
                            isInvalidated: !!row.is_invalidated,
                            originalThesis: row.narrative || '이전 버전에서 편입된 종목입니다.',
                            dailyNarrative: row.latest_daily_narrative || null,
                            dailyVerdict: row.latest_verdict || null,
                            dailyReviewedAt: row.latest_reviewed_at || null,
                            bullCase: row.bull_case,
                            bearCase: row.bear_case,
                            invalidationCondition: row.invalidation_condition,
                            milestones,
                            signals: []
                        };
                    });
                    setActiveStocks(mapped);
                }
            }
        } catch(e: any) {
            alert('IPC 에러: ' + e.message);
        } finally {
            setIsRunningTracker(false);
            unsub?.();
        }
    };


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
                const newStocks = (data.stocks || [])
                    .filter((s: any) => s.name && !s.name.includes('리츠'))
                    .map((s: any) => {
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

        if (toolName.includes('매매동향')) {
            try {
                const { electronAPI } = window as any
                if (!electronAPI || !electronAPI.getSmartMoneyFlow) throw new Error("electronAPI 연동이 불가능합니다.")
                
                const testCode = '005930'; // 삼성전자 테스트
                setPlaygroundLogs(prev => [...prev, {
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    msg: `[조회중...] ${testCode} 종목 60일 매매동향 조회 (opt10059)`
                }])

                const flowData = await electronAPI.getSmartMoneyFlow(testCode)
                setPlaygroundLogs(prev => [...prev, {
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    msg: `[응답 수신] ${toolName} 실제 데이터 수신 완료.`,
                    json: { status: "Rate Limit 방어 상태 정상", rowCount: flowData?.length || 0, dataPreview: flowData?.slice(0, 5) || [] }
                }])
            } catch (err: any) {
                setPlaygroundLogs(prev => [...prev, { time: new Date().toISOString().split('T')[1].split('.')[0], msg: `[에러] ${toolName}: ${err.message}` }])
            }
            return
        }

        if (toolName.includes('기본정보')) {
            try {
                const { electronAPI } = window as any
                if (!electronAPI || !electronAPI.getFundamentalInfo) throw new Error("electronAPI 연동이 불가능합니다.")
                
                const testCode = '005930'; // 삼성전자 테스트
                setPlaygroundLogs(prev => [...prev, {
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    msg: `[조회중...] ${testCode} 종목 펀더멘털 조회 (opt10001)`
                }])

                const fundData = await electronAPI.getFundamentalInfo(testCode)
                setPlaygroundLogs(prev => [...prev, {
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    msg: `[응답 수신] ${toolName} 실제 데이터 수신 완료.`,
                    json: { status: "success", data: fundData }
                }])
            } catch (err: any) {
                setPlaygroundLogs(prev => [...prev, { time: new Date().toISOString().split('T')[1].split('.')[0], msg: `[에러] ${toolName}: ${err.message}` }])
            }
            return
        }

        setTimeout(() => {
            const resultData = toolName.includes('로컬 DB') 
                ? { historyFound: true, report_memory: "25년 12월 04일 컷오프 (재무 악화). 현재 재진입 추적." }
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

    useEffect(() => {
        const { electronAPI } = window as any;
        if (!electronAPI?.onMoonshotEvalStart) return;

        const us1 = electronAPI.onMoonshotEvalStart((code: string) => {
            setScannedResults(prev => {
                const exist = prev.find(p => p.code === code);
                if (exist) return prev;
                const stock = syncedStocks.find(s => s.code === code);
                if (!stock) return prev;
                return [...prev, {
                    code: stock.code, name: stock.name, tag: stock.tag,
                    status: 'pending' as any, tbpScore: 0,
                    narrative: '', inputData: '', rawResult: '', prompt: '',
                    harnessLogs: []
                }];
            });
            setSelectedDetailId(code);
        });

        const us2 = electronAPI.onMoonshotProgressLog(({code, log}: any) => {
            setScannedResults(prev => prev.map(p => {
                if (p.code === code) {
                    return { ...p, harnessLogs: [...(p.harnessLogs||[]), log] };
                }
                return p;
            }));
        });

        const us3 = electronAPI.onMoonshotEvalComplete(({code, result}: any) => {
            setScannedResults(prev => prev.map(p => p.code === code ? result : p));
        });

        return () => {
            us1(); us2(); us3();
        };
    }, [syncedStocks]);

    const handleStartValidation = async (targetTrack: 'all' | 'A' | 'B' | 'C' = 'all') => {
        const { electronAPI } = window as any;
        if (!electronAPI?.validateMoonshotStocks) return;

        const targetStocks = targetTrack === 'all' 
            ? syncedStocks 
            : syncedStocks.filter(s => s.tag.includes(`${targetTrack}안`));

        if (targetStocks.length === 0) {
            alert(`해당 트랙(${targetTrack}안) 조건에 맞는 종목이 없습니다.`);
            return;
        }

        setIsScanning(true);
        setScannedResults([]);
        
        try {
            const res = await electronAPI.validateMoonshotStocks(targetStocks, ignoreCooldown);
            if (!res.success) {
                console.error("Moonshot Validation Error:", res.error);
                alert("평가 중 에러가 발생했습니다: " + res.error);
            }
        } catch (error) {
            console.error("IPC Error:", error);
        } finally {
            setIsScanning(false);
        }
    }

    const totalCount = scannedResults.length
    const passedCount = scannedResults.filter(r => r.status === 'passed').length
    const failedCount = scannedResults.filter(r => r.status === 'failed').length
    const filteredResults = scannedResults.filter(r => {
        if (reportFilter === 'all') return true
        return r.status === reportFilter
    })

    // Moonshot 통계 계산 (viewMode 기반 동적 렌더링)
    let displayTotalCount = 0;
    let displayWinRate = "0.0";
    let displaySumReturn = 0;
    let displayAvgReturn = "0.0";
    let displayAvgDays = "0.0";

    if (viewMode === 'archive') {
        displayTotalCount = archiveStocks.length;
        const wCount = archiveStocks.filter(a => a.success).length;
        displayWinRate = displayTotalCount > 0 ? ((wCount / displayTotalCount) * 100).toFixed(1) : "0.0";
        
        let sumR = 0;
        let sumDays = 0;
        let validDays = 0;
        archiveStocks.forEach(arc => {
            sumR += Number(arc.return_rate) || 0;
            if (arc.buy_date && arc.sell_date) {
                try {
                    const b = new Date(arc.buy_date.replace(/[./]/g, '-').split(' ')[0]);
                    const s = new Date(arc.sell_date.replace(/[./]/g, '-').split(' ')[0]);
                    if (!isNaN(b.getTime()) && !isNaN(s.getTime())) {
                        sumDays += Math.max(0, Math.floor((s.getTime() - b.getTime()) / (1000 * 3600 * 24)));
                        validDays++;
                    }
                } catch(e) {}
            }
        });
        displaySumReturn = sumR;
        displayAvgReturn = displayTotalCount > 0 ? (sumR / displayTotalCount).toFixed(1) : "0.0";
        displayAvgDays = validDays > 0 ? (sumDays / validDays).toFixed(1) : "0.0";
    } else if (viewMode === 'active') {
        displayTotalCount = activeStocks.length;
        const wCount = activeStocks.filter(a => a.returnRate > 0).length;
        displayWinRate = displayTotalCount > 0 ? ((wCount / displayTotalCount) * 100).toFixed(1) : "0.0";
        
        let sumR = 0;
        let sumDays = 0;
        let validDays = 0;
        const now = new Date();
        activeStocks.forEach(arc => {
            sumR += Number(arc.returnRate) || 0;
            if (arc.entryDate) {
                try {
                    const b = new Date(arc.entryDate.replace(/[./]/g, '-').split(' ')[0]);
                    if (!isNaN(b.getTime())) {
                        sumDays += Math.max(0, Math.floor((now.getTime() - b.getTime()) / (1000 * 3600 * 24)));
                        validDays++;
                    }
                } catch(e) {}
            }
        });
        displaySumReturn = sumR;
        displayAvgReturn = displayTotalCount > 0 ? (sumR / displayTotalCount).toFixed(1) : "0.0";
        displayAvgDays = validDays > 0 ? (sumDays / validDays).toFixed(1) : "0.0";
    }

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
                    {viewMode === 'scanner' ? (
                        <div>
                            <h1 className="text-2xl font-bold flex items-center gap-2">
                                <Rocket className="text-primary" /> 
                                Project Moonshot 
                            </h1>
                            <p className="text-muted-foreground mt-1 text-sm">텐베거(10-Bagger) 시스템 : 패러다임과 실적 폭발성에만 집중합니다.</p>
                        </div>
                    ) : (
                        <div className="flex items-center gap-4 bg-muted/20 border px-4 py-2.5 rounded-xl">
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-muted-foreground font-bold">보유</span>
                                <span className="text-sm font-black font-mono">{displayTotalCount}</span>
                            </div>
                            <div className="w-px h-3 bg-border"></div>
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-muted-foreground font-bold">총수익률</span>
                                <span className={cn("text-sm font-black font-mono", displaySumReturn > 0 ? "text-red-500" : displaySumReturn < 0 ? "text-blue-500" : "")}>
                                    {displaySumReturn > 0 ? '+' : ''}{displaySumReturn.toFixed(1)}%
                                </span>
                            </div>
                            <div className="w-px h-3 bg-border"></div>
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-muted-foreground font-bold">평균수익률</span>
                                <span className={cn("text-sm font-black font-mono", Number(displayAvgReturn) > 0 ? "text-red-500" : Number(displayAvgReturn) < 0 ? "text-blue-500" : "")}>
                                    {Number(displayAvgReturn) > 0 ? '+' : ''}{displayAvgReturn}%
                                </span>
                            </div>
                            <div className="w-px h-3 bg-border"></div>
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-muted-foreground font-bold">승률</span>
                                <span className="text-sm font-black font-mono text-primary">{displayWinRate}%</span>
                            </div>
                            <div className="w-px h-3 bg-border"></div>
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-muted-foreground font-bold">보유기간</span>
                                <span className="text-sm font-black font-mono">{displayAvgDays}일</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4">

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

                    {/* 설정 버튼 */}
                    <button 
                        onClick={() => setShowSettings(true)}
                        className="p-2 hover:bg-muted rounded-xl transition-colors text-muted-foreground flex items-center justify-center border shadow-sm bg-background ml-2"
                        title="자동화 크론 스케줄 설정"
                    >
                        <Settings size={20} />
                    </button>
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
                                            {syncedStocks.map((stock) => {
                                                const result = scannedResults.find(r => r.code === stock.code);
                                                return (
                                                <tr 
                                                    key={stock.code} 
                                                    onClick={() => setSelectedDetailId(stock.code)}
                                                    className={cn(
                                                        "transition-colors cursor-pointer",
                                                        selectedDetailId === stock.code ? "bg-primary/5 border-l-2 border-primary" : "hover:bg-muted/30 border-l-2 border-transparent"
                                                    )}
                                                >
                                                    <td className="px-3 py-2.5">
                                                        <span className={cn(
                                                            "text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap",
                                                            stock.tag.includes('A안') ? "bg-blue-500/20 text-blue-400" : 
                                                            stock.tag.includes('B안') ? "bg-orange-500/20 text-orange-400" :
                                                            "bg-purple-500/20 text-purple-400"
                                                        )}>{stock.tag}</span>
                                                    </td>
                                                    <td className="px-3 py-2.5 font-bold flex items-center gap-1.5">
                                                        {stock.name}
                                                        {result && (
                                                            <span>
                                                                {result.status === 'passed' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : 
                                                                 result.status === 'pending' ? <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" /> : 
                                                                 <XCircle className="w-3.5 h-3.5 text-red-500" />}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right font-medium">{(stock.price || 0).toLocaleString()}</td>
                                                    <td className="px-3 py-2.5 text-right text-muted-foreground">{stock.volume}</td>
                                                </tr>
                                            )})}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                            
                            <div className="mt-4 flex items-center gap-2 mb-2 ml-1">
                                <input 
                                    type="checkbox" 
                                    id="ignoreCooldown" 
                                    checked={ignoreCooldown} 
                                    onChange={e => setIgnoreCooldown(e.target.checked)} 
                                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                />
                                <label htmlFor="ignoreCooldown" className="text-xs font-bold text-muted-foreground cursor-pointer select-none">
                                    쿨타임 및 편입 무시 (강제 재검증 / 개발자 테스트용)
                                </label>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <button 
                                    onClick={() => handleStartValidation('A')}
                                    disabled={isScanning || syncedStocks.length === 0}
                                    className={cn(
                                        "py-2.5 rounded-lg text-sm font-bold flex justify-center items-center space-x-2 transition-all",
                                        isScanning ? "opacity-50 cursor-not-allowed" : "bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
                                    )}
                                >
                                    <BrainCircuit className="w-4 h-4" />
                                    <span>[A안] 검증 시작</span>
                                </button>
                                <button 
                                    onClick={() => handleStartValidation('B')}
                                    disabled={isScanning || syncedStocks.length === 0}
                                    className={cn(
                                        "py-2.5 rounded-lg text-sm font-bold flex justify-center items-center space-x-2 transition-all",
                                        isScanning ? "opacity-50 cursor-not-allowed" : "bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/20"
                                    )}
                                >
                                    <BrainCircuit className="w-4 h-4" />
                                    <span>[B안] 검증 시작</span>
                                </button>
                                <button 
                                    onClick={() => handleStartValidation('C')}
                                    disabled={isScanning || syncedStocks.length === 0}
                                    className={cn(
                                        "py-2.5 rounded-lg text-sm font-bold flex justify-center items-center space-x-2 transition-all",
                                        isScanning ? "opacity-50 cursor-not-allowed" : "bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                                    )}
                                >
                                    <BrainCircuit className="w-4 h-4" />
                                    <span>[C안] 검증 시작</span>
                                </button>
                                <button 
                                    onClick={() => handleStartValidation('all')}
                                    disabled={isScanning || syncedStocks.length === 0}
                                    className={cn(
                                        "py-2.5 rounded-lg text-sm font-bold flex justify-center items-center space-x-2 transition-all",
                                        isScanning ? "bg-primary/20 text-primary cursor-wait" : "bg-primary hover:bg-primary/90 text-primary-foreground"
                                    )}
                                >
                                    {isScanning ? (
                                        <>
                                            <Activity className="w-4 h-4 animate-pulse" />
                                            <span>스캐닝 중...</span>
                                        </>
                                    ) : (
                                        <>
                                            <BrainCircuit className="w-4 h-4" />
                                            <span>[전체] 검증 시작</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 우측 패널 (Harness Console & Report - Light/Premium Theme) */}
                    <div className="flex flex-col w-full lg:w-2/3 flex-1 min-h-[500px] overflow-hidden bg-background">
                        <div className="p-5 border-b bg-muted/20 flex justify-between items-center">
                            <div className="flex items-center space-x-2">
                                <BrainCircuit className="w-5 h-5 text-primary" />
                                <h2 className="text-base font-bold tracking-tight">AI 자율 리서치 궤적 (Harness Log)</h2>
                            </div>
                            <div className="flex items-center gap-4 text-xs font-bold">
                                <span className={cn("flex items-center gap-1.5", isScanning ? "text-primary animate-pulse" : "text-muted-foreground")}>
                                    {isScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                    {isScanning ? '딥 스캐닝 진행 중...' : '검증 대기'}
                                </span>
                            </div>
                        </div>

                        <div className="p-6 flex-1 overflow-y-auto scrollbar-hide">
                            {(!selectedDetailId && scannedResults.length === 0) ? (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4 pt-10">
                                    <Database className="w-12 h-12 opacity-20" />
                                    <p className="text-sm">좌측 목록에서 종목을 선택하여 실시간 검증 궤적을 확인하세요.</p>
                                </div>
                            ) : (() => {
                                const activeResult = scannedResults.find(r => r.code === selectedDetailId);
                                if (!activeResult) return (
                                    <div className="h-full flex flex-col justify-center items-center text-muted-foreground">
                                        <Loader2 className="w-8 h-8 animate-spin opacity-50 mb-4" />
                                        <span className="text-sm font-medium">데이터 로딩 중...</span>
                                    </div>
                                );
                                
                                return (
                                    <div className="max-w-3xl mx-auto w-full flex flex-col gap-8 pb-10">
                                        {/* 헤더 섹션 */}
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1.5">
                                                    <span className={cn(
                                                        "text-[10px] px-2 py-0.5 rounded font-bold border",
                                                        activeResult.tag.includes('A안') ? "bg-blue-500/10 text-blue-600 border-blue-500/20" : 
                                                        activeResult.tag.includes('B안') ? "bg-orange-500/10 text-orange-600 border-orange-500/20" :
                                                        "bg-purple-500/10 text-purple-600 border-purple-500/20"
                                                    )}>{activeResult.tag}</span>
                                                    <span className="text-xs text-muted-foreground font-mono">{activeResult.code}</span>
                                                </div>
                                                <h2 className="text-2xl font-black flex items-center gap-3">
                                                    {activeResult.name}
                                                    {activeResult.status === 'passed' ? (
                                                        <div className="flex items-center gap-2">
                                                            <span className="bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-500 px-2.5 py-1 rounded-md text-xs font-bold border border-green-200 dark:border-green-500/20 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5"/> 샌드박스 편입 승인</span>
                                                            <span className="bg-primary text-primary-foreground px-3 py-1 rounded-md text-xs font-bold shadow-sm flex items-center gap-1 ring-2 ring-primary ring-offset-2 ring-offset-background animate-pulse">
                                                                <Rocket className="w-3.5 h-3.5" />
                                                                Active 자동 편입 완료
                                                            </span>
                                                        </div>
                                                    ) : activeResult.status === 'pending' ? (
                                                        <span className="bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-500 px-2.5 py-1 rounded-md text-xs font-bold border border-amber-200 dark:border-amber-500/20 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin"/> AI 배틀로얄 심사 중...</span>
                                                    ) : (
                                                        <span className="bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-500 px-2.5 py-1 rounded-md text-xs font-bold border border-red-200 dark:border-red-500/20 flex items-center gap-1"><XCircle className="w-3.5 h-3.5"/> 텐베거 요건 미달</span>
                                                    )}
                                                </h2>
                                            </div>
                                            <div className="text-right bg-muted/30 p-3 rounded-xl border">
                                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">TBP Score</div>
                                                <div className={cn("text-3xl font-black tracking-tighter leading-none", activeResult.status === 'passed' ? "text-primary" : "text-muted-foreground")}>
                                                    {activeResult.tbpScore}
                                                </div>
                                            </div>
                                        </div>

                                        {/* 타임라인 노드 (Harness Logs) */}
                                        <div className="relative pl-4 border-l-2 border-muted space-y-6 ml-2">
                                            {activeResult.harnessLogs?.map((log: any, idx: number) => {
                                                const isLast = idx === activeResult.harnessLogs.length - 1;
                                                return (
                                                <div key={idx} className="relative">
                                                    <div className={cn(
                                                        "absolute -left-[23px] top-1 rounded-full border-4 border-background w-3.5 h-3.5",
                                                        log.type === 'success' ? "bg-green-500" :
                                                        log.type === 'error' ? "bg-red-500" :
                                                        log.type === 'warning' ? "bg-amber-500" : "bg-primary"
                                                    )} />
                                                    <div className="flex flex-col gap-1 pl-4">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-bold font-mono">{log.time}</span>
                                                            <span className="text-xs font-bold text-primary">{log.step}</span>
                                                        </div>
                                                        <div className={cn(
                                                            "text-sm font-medium mt-0.5 leading-relaxed p-3 rounded-lg border",
                                                            log.type === 'error' ? "bg-red-50/50 dark:bg-red-500/5 text-red-600 dark:text-red-400 border-red-100 dark:border-red-500/20" :
                                                            log.type === 'success' ? "bg-green-50/50 dark:bg-green-500/5 text-green-600 dark:text-green-400 border-green-100 dark:border-green-500/20" :
                                                            log.type === 'warning' ? "bg-amber-50/50 dark:bg-amber-500/5 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-500/20" :
                                                            "bg-muted/30 text-foreground border-transparent"
                                                        )}>
                                                            {log.msg}
                                                        </div>
                                                    </div>
                                                </div>
                                            )})}
                                            {isScanning && (
                                                <div className="relative">
                                                    <div className="absolute -left-[25px] top-1 bg-primary/20 rounded-full border-4 border-background w-4 h-4 flex items-center justify-center">
                                                        <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                                                    </div>
                                                    <div className="pl-4">
                                                        <div className="text-sm font-medium text-muted-foreground animate-pulse mt-0.5">판단 근거를 추론하고 있습니다...</div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* 제공된 팩트 데이터 (Distilled Facts) */}
                                        <div className="mt-8">
                                            <div className="flex items-center gap-2 mb-3 px-1">
                                                <Database className="w-4 h-4 text-purple-500" />
                                                <h3 className="text-sm font-bold">제미나이에 제공된 팩트 데이터 (Distilled AI)</h3>
                                            </div>
                                            <div className="bg-purple-50 dark:bg-purple-500/5 border border-purple-100 dark:border-purple-500/20 rounded-xl p-5 shadow-sm prose prose-sm prose-purple dark:prose-invert max-w-none">
                                                {activeResult.inputData ? (
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeResult.inputData}</ReactMarkdown>
                                                ) : (
                                                    <span className="text-muted-foreground">제공된 데이터가 없습니다.</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* 최종 판단 리포트 */}
                                        <div className="mt-8">
                                            <div className="flex items-center gap-2 mb-3 px-1">
                                                <BookOpen className="w-4 h-4 text-primary" />
                                                <h3 className="text-sm font-bold">AI 내러티브 총평 (최종 판별 결과)</h3>
                                            </div>
                                            <div className="bg-card border rounded-xl p-5 shadow-sm prose prose-sm dark:prose-invert max-w-none">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeResult.rawResult}</ReactMarkdown>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {viewMode === 'active' && (
                <div className="flex-1 flex gap-6 min-h-0">
                    {/* 좌측 메인 대시보드 (Active Tracking) */}
                    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto pr-4 scrollbar-hide">

                        {/* 데일리 리뷰 컨트롤 바 */}
                        <div className="flex items-center justify-between mb-3 px-1">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Active Tracking 명부</span>
                                <span className="text-xs bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-md">{activeStocks.length}종목</span>
                            </div>
                            <button
                                onClick={handleRunDailyTracker}
                                disabled={isRunningTracker || activeStocks.length === 0}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold text-xs transition-colors"
                            >
                                {isRunningTracker ? (
                                    <><span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></span> 데일리 리뷰 실행 중...</>
                                ) : (
                                    <><span>🧠</span> AI 데일리 리뷰 실행</>
                                )}
                            </button>
                        </div>

                        {/* 트래커 진행 로그 패널 */}
                        {trackerLogs.length > 0 && (
                            <div className="mb-4 bg-muted/30 border rounded-xl p-3 space-y-1 max-h-48 overflow-y-auto">
                                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">🧠 데일리 리뷰 진행 로그</div>
                                {trackerLogs.map((log, i) => (
                                    <div key={i} className={`flex items-start gap-2 text-xs font-mono ${
                                        log.type === 'success' ? 'text-green-500' :
                                        log.type === 'warning' ? 'text-amber-500' :
                                        log.type === 'error' ? 'text-red-500' : 'text-muted-foreground'
                                    }`}>
                                        <span className="shrink-0 text-muted-foreground/50">{log.time}</span>
                                        <span>{log.msg}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Candidate List (단독 확장) */}
                        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                            <div className="overflow-y-auto w-full">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold text-left">종목명 / 메가트렌드</th>
                                            <th className="px-4 py-3 font-semibold text-right">편입 정보</th>
                                            <th className="px-4 py-3 font-semibold text-right">현재가 / 수익률</th>
                                            <th className="px-4 py-3 font-semibold text-center">가설 상태</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {activeStocks.length === 0 ? (
                                            <tr><td colSpan={4} className="py-10 text-center text-muted-foreground">Active Tracking 중인 종목이 없습니다. 신규 발굴(Scanner)에서 편입해주세요.</td></tr>
                                        ) : activeStocks.map((stock) => (
                                            <tr 
                                                key={stock.id} 
                                                onClick={() => setSelectedStockId(stock.id)}
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
                                                            stock.trackType === 'A' ? "bg-blue-500/20 text-blue-400" : 
                                                            stock.trackType === 'B' ? "bg-orange-500/20 text-orange-400" : "bg-purple-500/20 text-purple-400"
                                                        )}>{stock.trackBadge}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-[11px] font-medium mt-1.5">
                                                        <span className="text-muted-foreground truncate max-w-[200px]">{stock.trend}</span>
                                                    </div>
                                                </td>

                                                {/* 편입 정보 (Added Date / Base Price) */}
                                                <td className="px-4 py-4 text-right">
                                                    <div className="text-sm font-bold">{(stock.entryPrice || 0).toLocaleString()}원</div>
                                                    <div className="text-xs text-muted-foreground mt-1 font-mono">{stock.entryDate}</div>
                                                </td>

                                                {/* 현재가 & 수익률 */}
                                                <td className="px-4 py-4 text-right">
                                                    <div className="text-sm font-bold">{(stock.currentPrice || 0).toLocaleString()}원</div>
                                                    <div className={cn(
                                                        "text-xs font-bold mt-1",
                                                        stock.returnRate > 0 ? "text-red-500" : stock.returnRate < 0 ? "text-blue-500" : "text-muted-foreground"
                                                    )}>
                                                        {stock.returnRate > 0 ? '+' : ''}{stock.returnRate}%
                                                    </div>
                                                </td>

                                                {/* 상태 (가설 순항/훼손 등) */}
                                                <td className="px-4 py-4">
                                                    <div className="flex justify-center">
                                                        <span className={cn("text-xs font-bold px-2.5 py-1 rounded-md border whitespace-nowrap", 
                                                            stock.statusColor.includes('green') ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" :
                                                            stock.statusColor.includes('amber') || stock.statusColor.includes('orange') ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" :
                                                            stock.statusColor.includes('blue') ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" :
                                                            "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                                                        )}>
                                                            {stock.status}
                                                        </span>
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
                    {selectedStock ? (
                        <div className="w-[480px] shrink-0 flex flex-col border-l h-full overflow-hidden">
                        <div className={cn("p-5 px-6 text-primary-foreground relative shrink-0 transition-colors duration-500", selectedStock.isInvalidated ? "bg-red-600 dark:bg-red-700" : "bg-primary")}>
                            <div className="absolute right-[-20px] top-[-20px] opacity-10">
                                {selectedStock.isInvalidated ? <XCircle size={100} /> : <Lock size={100} />}
                            </div>
                            <div className="relative z-10 flex items-start justify-between">
                                <div>
                                    <h2 className="text-3xl font-bold">{selectedStock.name}</h2>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="bg-primary-foreground/20 px-2 py-1 rounded text-xs font-mono">{selectedStock.code}</span>
                                        <span className={cn("px-2 py-1 rounded text-xs font-bold", selectedStock.isInvalidated ? "text-red-200" : "text-green-300")}>
                                            {selectedStock.isInvalidated ? "폐기됨" : "Target: 300% 상승"}
                                        </span>
                                    </div>
                                </div>
                                <button 
                                    onClick={handleDeleteActiveTracking}
                                    className="p-1.5 hover:bg-black/20 rounded-md transition-colors text-white/70 hover:text-white"
                                    title="이 종목 모니터링 폐기"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>

                        <div className="p-6 flex-1 overflow-y-auto space-y-6 scrollbar-hide">
                            {/* 1. Synthesis 피치 시트 */}
                            <div className="space-y-4">
                                <h3 className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                                    <Telescope size={14} className="text-primary" />
                                    Final Judgment (AI 심사 요약)
                                </h3>
                                <div className="bg-primary/5 border border-primary/20 p-3 rounded-xl mb-4">
                                    <p className="text-sm font-bold leading-relaxed">{selectedStock.originalThesis}</p>
                                </div>
                                
                                <div className="w-full h-px bg-border/50 my-6" />

                                {/* 2. 최신 AI 데일리 판결 로그 */}
                                <div className="mb-6">
                                    <h3 className="flex items-center gap-2 text-[11px] font-bold text-amber-600 dark:text-amber-500 uppercase tracking-widest mb-3">
                                        <Activity size={14} /> 최신 데일리 리뷰 (AI 심사평)
                                    </h3>
                                    <div className="bg-amber-500/5 border border-amber-500/10 p-4 rounded-xl space-y-2">
                                        <div className="flex items-center justify-between border-b border-amber-500/10 pb-2 mb-2">
                                            <span className="text-[10px] font-bold text-amber-700/70 dark:text-amber-500/70">
                                                {selectedStock?.dailyReviewedAt ? `${selectedStock.dailyReviewedAt.substring(5, 16).replace('T', ' ')} 업데이트` : '업데이트 대기중'}
                                            </span>
                                            {selectedStock?.dailyVerdict === 'drop' ? (
                                                <span className="text-[10px] font-bold text-red-600 dark:text-red-500">🔴 가설 폐기 (DROP)</span>
                                            ) : selectedStock?.dailyVerdict === 'warning' ? (
                                                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-500">🟡 리스크 관망 (WARNING)</span>
                                            ) : selectedStock?.dailyVerdict === 'hold' ? (
                                                <span className="text-[10px] font-bold text-green-600 dark:text-green-500">🟢 가설 순항 (HOLD)</span>
                                            ) : (
                                                <span className="text-[10px] font-bold text-muted-foreground">-</span>
                                            )}
                                        </div>
                                        <div className="text-[13px] leading-relaxed font-bold text-foreground/90 break-all whitespace-pre-wrap">
                                            {selectedStock?.dailyNarrative || '아직 오늘자 데일리 복기(AI 리뷰)가 실행되지 않았습니다.'}
                                        </div>
                                    </div>
                                </div>

                                {/* 3. 체크리스트 - Milestone & Invalidation */}
                                <div className="space-y-4">
                                    <div>
                                        <h3 className="flex items-center justify-between text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
                                            <div className="flex items-center gap-2"><CheckCircle2 size={14} className="text-blue-500" /> 핵심 마일스톤</div>
                                        </h3>
                                        <div className="space-y-3">
                                            {selectedStock.milestones?.map((m: any, i: number) => (
                                                <div key={i} className="flex items-start gap-2.5 p-1.5 -ml-1.5 rounded-lg transition-colors">
                                                    <div className={cn("shrink-0 mt-0.5", m.checked ? "text-blue-500" : "text-foreground/40")}>
                                                        <CheckCircle2 size={14} />
                                                    </div>
                                                    <p className={cn("text-[13.5px] tracking-tight leading-relaxed transition-all", m.checked ? "font-bold text-foreground line-through decoration-blue-500/50 decoration-2 opacity-50" : "text-foreground font-semibold")}>{m.desc || m}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="pt-2">
                                        <h3 className="flex items-center gap-2 text-[10px] font-bold text-red-500 mb-2 uppercase tracking-widest">
                                            <XCircle size={12} /> 손절 / 가설 훼손 조건
                                        </h3>
                                        <div className="flex items-start gap-2.5 p-1.5 -ml-1.5 rounded-lg transition-colors">
                                            <div className={cn("shrink-0 mt-0.5", selectedStock.isInvalidated ? "text-red-500" : "text-foreground/40")}>
                                                <XCircle size={14} />
                                            </div>
                                            <p className={cn("text-[13.5px] tracking-tight leading-relaxed transition-all", selectedStock.isInvalidated ? "font-bold text-red-500" : "text-foreground font-semibold")}>
                                                {selectedStock.invalidationCondition}
                                            </p>
                                        </div>
                                        
                                        {selectedStock.isInvalidated && (
                                            <div className="mt-4 border border-red-500/30 bg-red-500/5 text-red-500 font-bold flex items-center justify-center gap-2 py-2 rounded text-[11px] tracking-widest uppercase animate-in fade-in zoom-in duration-300">
                                                <AlertCircle size={14} /> 가설 파기 : 포트폴리오 편출 요망
                                            </div>
                                        )}
                                        {(!selectedStock.isInvalidated && selectedStock.milestones?.every((m:any) => m.checked)) && (
                                            <div className="mt-4 border border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400 font-bold flex items-center justify-center gap-2 py-2 rounded text-[11px] tracking-widest uppercase animate-in fade-in zoom-in duration-300">
                                                🏆 텐베거 마일스톤 전면 달성
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="w-full h-px bg-border/50" />

                            {/* 3. Bull / Bear Views */}
                            <div className="flex flex-col gap-6">
                                <div className="space-y-2 bg-green-500/5 border border-green-500/10 p-4 rounded-xl">
                                    <div className="text-[10px] font-bold text-green-600 dark:text-green-500 flex items-center gap-1 uppercase tracking-widest"><TrendingUp size={12}/> Bull's View</div>
                                    <div className="text-[13px] leading-relaxed text-foreground/90 font-medium break-all prose prose-sm dark:prose-invert max-w-none prose-p:m-0 prose-p:mb-2 last:prose-p:mb-0 prose-ul:m-0 prose-li:m-0">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedStock.bullCase}</ReactMarkdown>
                                    </div>
                                </div>
                                <div className="space-y-2 bg-red-500/5 border border-red-500/10 p-4 rounded-xl">
                                    <div className="text-[10px] font-bold text-red-600 dark:text-red-500 flex items-center gap-1 uppercase tracking-widest"><TrendingDown size={12}/> Bear's Warning</div>
                                    <div className="text-[13px] leading-relaxed text-foreground/90 font-medium break-all prose prose-sm dark:prose-invert max-w-none prose-p:m-0 prose-p:mb-2 last:prose-p:mb-0 prose-ul:m-0 prose-li:m-0">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedStock.bearCase}</ReactMarkdown>
                                    </div>
                                </div>
                            </div>

                            <div className="w-full h-px bg-border/50" />

                            {/* 5. Daily AI Review Log (Archive) */}
                            <div>
                                <h3 className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4">
                                    <Activity size={14} className="text-muted-foreground" />
                                    전체 데일리 리뷰 로그
                                </h3>
                                <div className="space-y-5">
                                    <div className="space-y-2 opacity-60 hover:opacity-100 transition-opacity">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-mono text-muted-foreground">어제 장마감 판결</span>
                                            <span className="text-[10px] font-bold text-muted-foreground">리스크 관망</span>
                                        </div>
                                        <p className="text-[13px] leading-relaxed font-medium text-foreground/80">
                                            특이 수급 이탈 없음. 가설 진행 상황 특이사항 없음.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        </div>
                    ) : (
                        <div className="w-[480px] shrink-0 flex flex-col border-l h-full overflow-hidden bg-muted/10 items-center justify-center p-8 text-center text-muted-foreground">
                            <Telescope strokeWidth={1} size={80} className="mb-6 opacity-20" />
                            <h3 className="font-bold text-lg mb-2 opacity-80">선택된 종목이 없습니다</h3>
                            <p className="text-sm opacity-60 leading-relaxed">
                                좌측 리스트에서 트래킹 중인 종목을 선택하거나<br/>신규 발굴 탭에서 새로운 종목을 편입해주세요.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {viewMode === 'archive' && (
                <div className="flex-1 flex min-h-0 bg-card border rounded-2xl overflow-hidden shadow-sm">
                    {/* 좌측 패널 (목록) */}
                    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto pr-4 scrollbar-hide py-4 pl-4">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <History className="text-primary" /> 관리 이력 및 복기 (Hall of Fame & Graveyard)
                                </h2>
                                <p className="text-sm text-muted-foreground mt-1">
                                    과거 텐베거 후보군들의 발굴, 보유, 편출 내역 및 사후 분석 로그입니다.
                                </p>
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col min-h-0 overflow-hidden mt-2">
                            <div className="overflow-y-auto w-full pr-2">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold text-left">종목명 / 태그</th>
                                            <th className="px-4 py-3 font-semibold text-right">편입 정보</th>
                                            <th className="px-4 py-3 font-semibold text-right">매도 정보</th>
                                            <th className="px-4 py-3 font-semibold text-center">최종 수익률</th>
                                            <th className="px-4 py-3 font-semibold text-center">마감 사유</th>
                                            <th className="px-4 py-3 font-semibold text-center w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {archiveStocks.length === 0 ? (
                                            <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">보관된 히스토리가 없습니다.</td></tr>
                                        ) : archiveStocks.map((arc) => (
                                            <tr 
                                                key={arc.id} 
                                                onClick={() => setSelectedArchiveId(arc.id)}
                                                className={cn(
                                                    "border-b last:border-b-0 cursor-pointer transition-colors group",
                                                    selectedArchive?.id === arc.id ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30 border-l-2 border-l-transparent"
                                                )}
                                            >
                                                <td className="px-4 py-4 text-left">
                                                    <div className="font-bold text-base flex items-center gap-2">
                                                        {arc.stock_name} 
                                                        <span className="text-xs text-muted-foreground font-normal">{arc.stock_code}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-[11px] font-medium mt-1.5">
                                                        <span className="text-muted-foreground truncate max-w-[200px]">{arc.tag}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                    <div className="text-sm font-bold opacity-80">{arc.entry_price ? arc.entry_price.toLocaleString() : 0}원</div>
                                                    <div className="text-xs text-muted-foreground font-mono mt-1">{arc.buy_date}</div>
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                    <div className="text-sm font-bold relative inline-block">
                                                        {arc.sell_price ? arc.sell_price.toLocaleString() : 0}원
                                                    </div>
                                                    <div className="text-xs text-muted-foreground font-mono mt-1">{arc.sell_date ? arc.sell_date.split(' ')[0] : '-'}</div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center justify-center flex-col gap-1">
                                                        <span className={cn("text-lg font-bold font-mono tracking-tighter", arc.return_rate > 0 ? "text-red-500" : arc.return_rate < 0 ? "text-blue-500" : "text-muted-foreground")}>
                                                            {arc.return_rate > 0 ? '+' : ''}{Number(arc.return_rate).toFixed(1)}%
                                                        </span>
                                                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-sm", arc.success ? "bg-red-500/10 text-red-600" : "bg-blue-500/10 text-blue-600")}>
                                                            {arc.success ? "수익 마감" : "손실 마감"}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 text-center">
                                                    <span className="text-[11px] font-bold text-muted-foreground px-2.5 py-1 bg-muted/50 border rounded-md whitespace-nowrap">
                                                        {arc.final_narrative?.includes('수동 폐기') ? '사용자 수동 삭제' : '가설 훼손 (DROP)'}
                                                    </span>
                                                </td>
                                                {/* 개별 삭제 버튼 */}
                                                <td className="px-2 py-4 text-center">
                                                    <button
                                                        onClick={(e) => handleDeleteArchive(arc, e)}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
                                                        title="이 항목 히스토리에서 삭제"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* 우측 사이드 패널: 복기 상세 뷰 */}
                    {selectedArchive ? (
                        <div className="w-[480px] shrink-0 flex flex-col border-l h-full overflow-hidden bg-muted/5">
                            <div className={cn("p-5 px-6 text-primary-foreground relative shrink-0 transition-colors duration-500", selectedArchive.success ? "bg-green-600 dark:bg-green-700" : "bg-muted-foreground")}>
                                <div className="absolute right-[-20px] top-[-20px] opacity-10">
                                    <Archive size={100} />
                                </div>
                                <div className="relative z-10 flex items-start justify-between">
                                    <div>
                                        <h2 className="text-3xl font-bold">{selectedArchive.stock_name}</h2>
                                        <div className="flex items-center gap-2 mt-2">
                                            <span className="bg-primary-foreground/20 px-2 py-1 rounded text-xs font-mono">{selectedArchive.stock_code}</span>
                                            <span className={cn("px-2 py-1 rounded text-xs font-bold", selectedArchive.success ? "text-red-100 bg-red-500/20" : "text-blue-100 bg-blue-500/20")}>
                                                최종 수익률 {selectedArchive.return_rate > 0 ? '+' : ''}{Number(selectedArchive.return_rate).toFixed(1)}%
                                            </span>
                                            <span className="px-2 py-1 rounded text-xs font-bold bg-black/20 text-white/90">
                                                {selectedArchive.final_narrative?.includes('수동 폐기') ? '사용자 직접 삭제' : 'AI 가설 훼손 (DROP)'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-hide">
                                <div className="space-y-8">
                                    {/* 1. Final Judgment */}
                                    <div>
                                        <h3 className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
                                            <BookOpen size={14} className="text-primary" /> 최초 투자 가설 (Original Thesis)
                                        </h3>
                                        <div className="bg-muted/50 rounded-xl p-4 border border-border/50 text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                                            {selectedArchive.original_thesis}
                                        </div>
                                    </div>

                                    <div className="w-full h-px bg-border/50" />

                                    {/* 2. 사후 분석 */}
                                    <div>
                                        <h3 className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
                                            <Activity size={14} className={selectedArchive.success ? "text-green-500" : "text-red-500"} /> 최종 사후 분석 명세서
                                        </h3>
                                        <div className={cn("p-4 rounded-xl border border-dashed space-y-2", selectedArchive.success ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20")}>
                                            <div className="text-[13px] leading-relaxed font-bold text-foreground/90 whitespace-pre-wrap">
                                                {selectedArchive.final_narrative || '사후 분석 기록이 없습니다.'}
                                            </div>
                                        </div>
                                    </div>

                                    {/* 3. Bull / Bear Cases */}
                                    <div className="grid grid-cols-1 gap-4">
                                        <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-4">
                                            <h4 className="flex items-center gap-2 text-xs font-bold text-blue-600 mb-2">
                                                <TrendingUp size={14} /> Bull's View (최초 검토시)
                                            </h4>
                                            <div className="prose prose-sm dark:prose-invert prose-p:leading-snug prose-li:my-0 text-[12px] text-foreground/80 opacity-80 break-words whitespace-normal space-y-1">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedArchive.bull_case || 'N/A'}</ReactMarkdown>
                                            </div>
                                        </div>

                                        <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4">
                                            <h4 className="flex items-center gap-2 text-xs font-bold text-red-500 mb-2">
                                                <TrendingDown size={14} /> Bear's Warning (최초 검토시)
                                            </h4>
                                            <div className="prose prose-sm dark:prose-invert prose-p:leading-snug prose-li:my-0 text-[12px] text-foreground/80 opacity-80 break-words whitespace-normal space-y-1">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedArchive.bear_case || 'N/A'}</ReactMarkdown>
                                            </div>
                                        </div>
                                    </div>

                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="w-[480px] shrink-0 border-l flex flex-col items-center justify-center text-muted-foreground bg-muted/5">
                            <History size={48} className="opacity-20 mb-4" />
                            <p>좌측에서 복기(Archive)된 종목을 선택하세요.</p>
                        </div>
                    )}
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
                        
                        <div className="px-5 py-4 border-t bg-muted/10 flex justify-end">
                            <button onClick={handleSaveConditionSettings} className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold rounded-xl transition-colors shadow-sm active:scale-95">
                                적용 완료
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* AI Settings Modal */}
            {showSettings && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-card w-[520px] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-border/50">
                        <div className="p-6 border-b flex items-center justify-between bg-muted/30">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <Settings className="text-primary" size={24} /> 
                                Moonshot AI 크론 설정
                            </h2>
                            <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-muted hover:text-foreground rounded-full transition-colors text-muted-foreground">
                                <XCircle size={24} />
                            </button>
                        </div>
                        
                        <div className="p-6 space-y-6 flex-1">
                            {/* 설정 아이템 1 */}
                            <div className="space-y-3">
                                <label className="text-sm font-bold flex items-center justify-between">
                                    <span className="flex items-center gap-2">
                                        <Telescope size={16} className="text-blue-500" />
                                        신규 발굴 (Scanner AI) 실행 시간
                                    </span>
                                </label>
                                <div className="flex bg-muted/50 p-4 rounded-xl border border-border/50 gap-4 items-center">
                                    <input 
                                        type="time" 
                                        value={moonshotSettings.scannerCronTime} 
                                        onChange={(e) => setMoonshotSettings(prev => ({...prev, scannerCronTime: e.target.value}))}
                                        className="bg-background border px-4 py-2 rounded-lg text-lg font-semibold min-w-[150px] shrink-0 outline-none focus:ring-2 focus:ring-primary/50"
                                    />
                                    <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                                        스캐너 검색 결과를 바탕으로 새로운 텐베거 후보를 자동으로 평가하고 액티브 명부에 편입합니다.
                                    </p>
                                </div>
                            </div>

                            {/* 설정 아이템 2 */}
                            <div className="space-y-3">
                                <label className="text-sm font-bold flex items-center justify-between">
                                    <span className="flex items-center gap-2">
                                        <Activity size={16} className="text-green-500" />
                                        액티브 트래킹 리뷰 (Tracker AI) 실행 시간
                                    </span>
                                </label>
                                <div className="flex bg-muted/50 p-4 rounded-xl border border-border/50 gap-4 items-center">
                                    <input 
                                        type="time" 
                                        value={moonshotSettings.trackerCronTime} 
                                        onChange={(e) => setMoonshotSettings(prev => ({...prev, trackerCronTime: e.target.value}))}
                                        className="bg-background border px-4 py-2 rounded-lg text-lg font-semibold min-w-[150px] shrink-0 outline-none focus:ring-2 focus:ring-primary/50"
                                    />
                                    <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                                        기존 명부 종목들의 가설 유지 여부를 재평가하고, 정원 초과 시 방출(가설훼손)을 결정합니다.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 pt-2">
                                <input 
                                    type="checkbox" 
                                    id="ms_auto_enabled"
                                    checked={moonshotSettings.enabled}
                                    onChange={(e) => setMoonshotSettings(prev => ({...prev, enabled: e.target.checked}))}
                                    className="w-4 h-4 cursor-pointer"
                                />
                                <label htmlFor="ms_auto_enabled" className="text-sm font-bold cursor-pointer">
                                    Moonshot AI 자동화 스케줄 활성화
                                </label>
                            </div>
                        </div>

                        <div className="p-4 bg-muted/50 border-t flex items-center justify-end gap-3">
                            <button 
                                onClick={() => setShowSettings(false)}
                                className="px-4 py-2 hover:bg-muted font-bold text-sm rounded-lg transition-colors text-muted-foreground border bg-background shadow-sm"
                            >
                                취소
                            </button>
                            <button 
                                onClick={handleSaveSettings}
                                className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-lg transition-colors shadow-sm"
                            >
                                저장 및 적용
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
