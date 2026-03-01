import { useState, useEffect, useRef } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table'
import { Play, Square, RefreshCw, Settings2, Clock, ShieldCheck, ListOrdered } from 'lucide-react'
import { useAccountStore } from '../store/useAccountStore'

// types
interface Condition {
    seq: string
    name: string
}

export default function AutoTrade() {
    const [conditions, setConditions] = useState<Condition[]>([])
    const [selectedSeq, setSelectedSeq] = useState<string>('')
    const { accountList: accounts } = useAccountStore()
    const [selectedAccount, setSelectedAccount] = useState<string>('')
    const [isActive, setIsActive] = useState<boolean>(false)
    const [logs, setLogs] = useState<{ time: string, message: string, level: string }[]>([])

    // Settings State
    const [timeHours, setTimeHours] = useState('09')
    const [timeMinutes, setTimeMinutes] = useState('00')
    const [dailyBudget, setDailyBudget] = useState('7000000') // 일일 최대 한도
    const [buyLimit, setBuyLimit] = useState('1000000') // 1회 매수 한도
    const [buyPremium, setBuyPremium] = useState('3') // 매수 할증 퍼센트
    const [maxPriceLimit, setMaxPriceLimit] = useState('20') // 매수 상한 퍼센트
    const [throttleLimit, setThrottleLimit] = useState('3') // 초당 주문 건수
    const [condSellTimeHours, setCondSellTimeHours] = useState('15')
    const [condSellTimeMinutes, setCondSellTimeMinutes] = useState('10')
    const [condSellInterval, setCondSellInterval] = useState('3') // 분할 간격 (분)
    const [autoModify, setAutoModify] = useState(true)

    const isLoaded = useRef(false)

    const formatCurrency = (val: string) => {
        const num = parseInt(val.replace(/[^0-9]/g, ''), 10);
        return isNaN(num) ? '' : num.toLocaleString();
    };

    // Load Settings
    useEffect(() => {
        const loadSettings = async () => {
            const saved = await window.electronAPI.getAutoTradeSettings()
            if (saved) {
                if (saved.selectedAccount) setSelectedAccount(saved.selectedAccount)
                if (saved.selectedSeq) setSelectedSeq(saved.selectedSeq)
                if (saved.timeHours) setTimeHours(saved.timeHours)
                if (saved.timeMinutes) setTimeMinutes(saved.timeMinutes)
                if (saved.dailyBudget) setDailyBudget(saved.dailyBudget)
                if (saved.buyLimit) setBuyLimit(saved.buyLimit)
                if (saved.buyPremium) setBuyPremium(saved.buyPremium)
                if (saved.maxPriceLimit) setMaxPriceLimit(saved.maxPriceLimit)
                if (saved.throttleLimit) setThrottleLimit(saved.throttleLimit)
                if (saved.condSellTimeHours) setCondSellTimeHours(saved.condSellTimeHours)
                if (saved.condSellTimeMinutes) setCondSellTimeMinutes(saved.condSellTimeMinutes)
                if (saved.condSellInterval) setCondSellInterval(saved.condSellInterval)
                if (saved.autoModify !== undefined) setAutoModify(saved.autoModify)
            }

            // Get active status from backend
            const activeStatus = await window.electronAPI.getAutoTradeStatus()
            setIsActive(activeStatus)

            setTimeout(() => { isLoaded.current = true }, 500) // Delay to avoid saving initial render states
        }
        loadSettings()
    }, [])

    // Save Settings automatically
    useEffect(() => {
        if (!isLoaded.current) return

        window.electronAPI.saveAutoTradeSettings({
            selectedAccount,
            selectedSeq,
            timeHours,
            timeMinutes,
            dailyBudget,
            buyLimit,
            buyPremium,
            maxPriceLimit,
            throttleLimit,
            condSellTimeHours,
            condSellTimeMinutes,
            condSellInterval,
            autoModify
        })
    }, [selectedAccount, selectedSeq, timeHours, timeMinutes, dailyBudget, buyLimit, buyPremium, maxPriceLimit, throttleLimit, condSellTimeHours, condSellTimeMinutes, condSellInterval, autoModify])

    const toggleActive = async (newStatus: boolean) => {
        setIsActive(newStatus)
        await window.electronAPI.setAutoTradeStatus(newStatus)
    }

    useEffect(() => {
        // 컴포넌트 마운트 시 조건검색 WS 연결 및 목록 요청
        const initConditionSocket = async () => {
            await window.electronAPI.connectConditionWs()

            // 기존에 캐싱된게 있으면 가져오기
            const initialList = await window.electronAPI.getConditionList()
            if (initialList && initialList.length > 0) {
                setConditions(initialList.map((c: any) => ({ seq: c[0], name: c[1] })))
                if (!selectedSeq) setSelectedSeq(initialList[0][0])
            }
        }
        initConditionSocket()

        // 소켓을 타고 들어오는 새 조건검색식 목록 리스너
        const removeListener = window.electronAPI.onConditionList((list: any[]) => {
            setConditions(list.map((c: any) => ({ seq: c[0], name: c[1] })))
            if (list.length > 0 && !selectedSeq) {
                setSelectedSeq(list[0][0])
            }
        })

        return () => removeListener()
    }, [])

    // Synchronize selectedAccount from store if blank
    useEffect(() => {
        if (!selectedAccount && accounts && accounts.length > 0) {
            setSelectedAccount(accounts[0])
        }
    }, [accounts, selectedAccount])

    // Subscribe to logs
    useEffect(() => {
        const removeLogListener = window.electronAPI.onAutoTradeLog((logInfo: any) => {
            setLogs(prev => [logInfo, ...prev].slice(0, 50)) // 최근 50개 유지
        })
        return () => removeLogListener()
    }, [])

    const handleTestSearch = async () => {
        if (!selectedSeq) return
        await window.electronAPI.startConditionSearch(selectedSeq)
        alert('테스트로 조건검색을 1회 실행했습니다. 터미널 로그를 확인해주세요.')
    }

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
            {/* Header Area */}
            <div className="flex-none p-6 border-b border-border/50 bg-muted/10">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            자동매매 시스템
                            <span className="flex h-2 w-2 relative ml-1">
                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isActive ? 'bg-green-400' : 'bg-red-400'}`}></span>
                                <span className={`relative inline-flex rounded-full h-2 w-2 ${isActive ? 'bg-green-500' : 'bg-red-500'}`}></span>
                            </span>
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1">조건검색식 기반 스케줄링 및 호가 정정</p>
                    </div>

                    <div className="flex gap-3">
                        {isActive ? (
                            <button
                                onClick={() => toggleActive(false)}
                                className="flex items-center gap-2 px-6 py-2 bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 transition-colors rounded-xl font-bold"
                            >
                                <Square size={18} /> 정지
                            </button>
                        ) : (
                            <button
                                onClick={() => toggleActive(true)}
                                className="flex items-center gap-2 px-6 py-2 bg-green-500/10 text-green-500 border border-green-500/20 hover:bg-green-500/20 transition-colors rounded-xl font-bold"
                            >
                                <Play size={18} /> 가동 시작
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Split Layout */}
            <div className="flex-1 flex min-h-0">
                {/* Left Panel: Settings */}
                <div className="w-[300px] overflow-y-auto border-r border-border/50 flex flex-col">

                    {/* Account Selection */}
                    <div className="p-4 border-b border-border/50 space-y-3">
                        <h3 className="flex items-center gap-2 font-bold text-sm text-foreground">
                            <ListOrdered size={16} className="text-primary" /> 매매 계좌 설정
                        </h3>
                        <div className="space-y-1.5">
                            <select
                                className="w-full bg-muted/30 border border-border/50 rounded p-2 text-sm outline-none focus:border-primary/50 text-foreground"
                                value={selectedAccount}
                                onChange={(e) => setSelectedAccount(e.target.value)}
                            >
                                <option value="" disabled>계좌를 선택해주세요</option>
                                {accounts.map(acc => (
                                    <option key={acc} value={acc}>{acc}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Condition Search */}
                    <div className="p-4 border-b border-border/50 space-y-3">
                        <h3 className="flex items-center gap-2 font-bold text-sm text-foreground">
                            <ListOrdered size={16} className="text-primary" /> 조건검색식 설정
                        </h3>
                        <div className="space-y-1.5">
                            <select
                                className="w-full bg-muted/30 border border-border/50 rounded p-2 text-sm outline-none focus:border-primary/50 text-foreground"
                                value={selectedSeq}
                                onChange={(e) => setSelectedSeq(e.target.value)}
                            >
                                <option value="" disabled>수식을 선택해주세요</option>
                                {conditions.map(c => (
                                    <option key={c.seq} value={c.seq}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Schedule Settings */}
                    <div className="p-4 border-b border-border/50 space-y-3">
                        <h3 className="flex items-center gap-2 font-bold text-sm text-foreground">
                            <Clock size={16} className="text-primary" /> 매수 스케줄 (1일 1회)
                        </h3>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                className="flex-1 bg-muted/30 border border-border/50 rounded p-2 text-sm text-center outline-none focus:border-primary/50 text-foreground"
                                value={timeHours}
                                onChange={e => setTimeHours(e.target.value)}
                                onBlur={e => setTimeHours(String(Math.min(23, Math.max(0, parseInt(e.target.value || '0', 10)))).padStart(2, '0'))}
                                min="0" max="23"
                            />
                            <span className="font-bold text-muted-foreground">:</span>
                            <input
                                type="number"
                                className="flex-1 bg-muted/30 border border-border/50 rounded p-2 text-sm text-center outline-none focus:border-primary/50 text-foreground"
                                value={timeMinutes}
                                onChange={e => setTimeMinutes(e.target.value)}
                                onBlur={e => setTimeMinutes(String(Math.min(59, Math.max(0, parseInt(e.target.value || '0', 10)))).padStart(2, '0'))}
                                min="0" max="59"
                            />
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-tight">지정가 시간에 1회만 검색 후 매수 발송.</p>
                    </div>

                    {/* Risk Management */}
                    <div className="p-4 space-y-4">
                        <h3 className="flex items-center gap-2 font-bold text-sm text-foreground">
                            <ShieldCheck size={16} className="text-primary" /> 주문 및 안전 제어
                        </h3>
                        <div className="space-y-3">
                            <div className="space-y-1.5 pt-2 border-t border-border/50">
                                <label className="text-xs text-muted-foreground font-medium">일일 최대 총 예산 (원)</label>
                                <input
                                    type="text"
                                    className="w-full bg-muted/30 border border-border/50 rounded p-2 text-sm outline-none focus:border-primary/50 text-foreground"
                                    value={formatCurrency(dailyBudget)}
                                    onChange={e => setDailyBudget(e.target.value.replace(/[^0-9]/g, ''))}
                                />
                                <p className="text-[10px] text-muted-foreground leading-tight">초과시 N빵 분할 계산</p>
                            </div>
                            <div className="space-y-1.5 pt-2 border-t border-border/50">
                                <label className="text-xs text-muted-foreground font-medium">1종목당 최대 투입 (원)</label>
                                <input
                                    type="text"
                                    className="w-full bg-muted/30 border border-border/50 rounded p-2 text-sm outline-none focus:border-primary/50 text-foreground"
                                    value={formatCurrency(buyLimit)}
                                    onChange={e => setBuyLimit(e.target.value.replace(/[^0-9]/g, ''))}
                                />
                            </div>
                            <div className="flex gap-2 pt-2 border-t border-border/50">
                                <div className="space-y-1.5 flex-1">
                                    <label className="text-[10px] text-muted-foreground font-medium block">매수 할증 (%)</label>
                                    <input
                                        type="number"
                                        className="w-full bg-muted/30 border border-border/50 rounded p-2 text-sm outline-none focus:border-primary/50 text-foreground"
                                        value={buyPremium}
                                        onChange={e => setBuyPremium(e.target.value)}
                                    />
                                    <p className="text-[9px] text-muted-foreground text-center">현재가+X%</p>
                                </div>
                                <div className="space-y-1.5 flex-1">
                                    <label className="text-[10px] text-muted-foreground font-medium block">최대 상한 캡 (%)</label>
                                    <input
                                        type="number"
                                        className="w-full bg-muted/30 border border-border/50 rounded p-2 text-sm outline-none focus:border-primary/50 text-foreground"
                                        value={maxPriceLimit}
                                        onChange={e => setMaxPriceLimit(e.target.value)}
                                    />
                                    <p className="text-[9px] text-muted-foreground text-center">초과 방지</p>
                                </div>
                            </div>

                            <div className="space-y-1.5 pt-2 border-t border-border/50">
                                <label className="text-xs text-muted-foreground font-medium flex items-center gap-1 justify-between">
                                    초당 주문수 (Throttling)
                                </label>
                                <input
                                    type="number"
                                    className="w-full bg-muted/30 border border-border/50 rounded p-2 text-sm outline-none focus:border-primary/50 text-foreground"
                                    value={throttleLimit}
                                    onChange={e => setThrottleLimit(e.target.value)}
                                    min="1" max="10"
                                />
                            </div>

                            <div className="space-y-3 pt-4 border-t border-border/50 bg-muted/10 -mx-4 px-4 pb-4">
                                <h4 className="font-bold text-[13px] text-foreground flex items-center gap-1.5">
                                    조건부 지정가 3분할 정정 청산
                                </h4>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        className="w-14 bg-muted/30 border border-border/50 rounded py-1.5 px-2 text-xs text-center outline-none focus:border-primary/50 text-foreground"
                                        value={condSellTimeHours}
                                        onChange={e => setCondSellTimeHours(e.target.value)}
                                        onBlur={e => setCondSellTimeHours(String(Math.min(23, Math.max(0, parseInt(e.target.value || '0', 10)))).padStart(2, '0'))}
                                    />
                                    <span className="font-bold text-muted-foreground text-xs">:</span>
                                    <input
                                        type="number"
                                        className="w-14 bg-muted/30 border border-border/50 rounded py-1.5 px-2 text-xs text-center outline-none focus:border-primary/50 text-foreground"
                                        value={condSellTimeMinutes}
                                        onChange={e => setCondSellTimeMinutes(e.target.value)}
                                        onBlur={e => setCondSellTimeMinutes(String(Math.min(59, Math.max(0, parseInt(e.target.value || '0', 10)))).padStart(2, '0'))}
                                    />
                                    <span className="text-[10px] text-muted-foreground ml-1">부터 분할 시작</span>
                                </div>
                                <div className="space-y-1.5 pt-1">
                                    <label className="text-[11px] text-muted-foreground font-medium flex items-center gap-1 justify-between">
                                        분할 간격 (분)
                                    </label>
                                    <input
                                        type="number"
                                        className="w-full bg-muted/30 border border-border/50 rounded py-1.5 px-2 text-sm outline-none focus:border-primary/50 text-foreground"
                                        value={condSellInterval}
                                        onChange={e => setCondSellInterval(e.target.value)}
                                        min="1" max="60"
                                    />
                                </div>
                                <p className="text-[10px] text-muted-foreground leading-tight px-1">
                                    조건부지정가(05) 수량을 지정된 시간부터 입력한 간격에 맞춰 3회(33%, 50%, 전량)에 걸쳐 현재가 정정 매도합니다. 15시 20분에 시장가로 일괄 청산됩니다.
                                </p>
                            </div>

                            <label className="flex items-start gap-2 pt-2 border-t border-border/50 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 mt-0.5 rounded border-border text-primary focus:ring-primary bg-background"
                                    checked={autoModify}
                                    onChange={e => setAutoModify(e.target.checked)}
                                />
                                <div className="flex flex-col flex-1">
                                    <span className="text-[13px] font-bold text-foreground group-hover:text-primary transition-colors">1분 경과 매도주문 정정</span>
                                    <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">지정가 매도가 1분 경과시 현재가로 정정</span>
                                </div>
                            </label>
                        </div>
                    </div>

                </div>

                {/* Right Panel: Status Dashboard */}
                <div className="flex-1 flex flex-col overflow-hidden bg-background">

                    {/* Unexecuted Orders (미체결) */}
                    <div className="flex-1 flex flex-col min-h-[50%] border-b border-border/50">
                        <div className="p-3 shrink-0 flex items-center justify-between bg-muted/5">
                            <h3 className="text-xs font-bold flex items-center gap-2"><Settings2 size={14} className="text-muted-foreground" /> 실시간 미체결 내역 (매도정정 대기열)</h3>
                        </div>
                        <div className="flex-1 overflow-auto">
                            <Table className="border-0">
                                <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10 border-b border-border shadow-sm">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="py-2 h-8 text-xs">주문시간</TableHead>
                                        <TableHead className="py-2 h-8 text-xs">종목명</TableHead>
                                        <TableHead className="py-2 h-8 text-xs">구분</TableHead>
                                        <TableHead className="py-2 h-8 text-xs text-right">주문단가</TableHead>
                                        <TableHead className="py-2 h-8 text-xs text-right">미체결 잔량</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    <TableRow className="border-0 hover:bg-transparent">
                                        <TableCell colSpan={5} className="text-center h-40 text-muted-foreground text-xs">
                                            현재 당일 미체결 내역이 없습니다.
                                        </TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {/* Today's Execution History */}
                    <div className="flex-1 flex flex-col min-h-[50%]">
                        <div className="p-3 shrink-0 bg-muted/5">
                            <h3 className="text-xs font-bold flex items-center gap-2"><Clock size={14} className="text-muted-foreground" /> 당일 자동매매 로그 이력</h3>
                        </div>
                        <div className="flex-1 overflow-auto bg-black/5">
                            <Table className="border-0">
                                <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10 border-b border-border/50 hidden">
                                    <TableRow>
                                        <TableHead className="w-[100px]">시간</TableHead>
                                        <TableHead>이벤트 내용</TableHead>
                                        <TableHead className="w-[80px]">상태</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {logs.length === 0 ? (
                                        <TableRow className="border-border/30">
                                            <TableCell colSpan={3} className="text-center h-20 text-muted-foreground text-xs">
                                                아직 발생한 시스템 로그가 없습니다.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        logs.map((log, i) => (
                                            <TableRow key={i} className="border-border/30">
                                                <TableCell className="text-[10px] text-muted-foreground w-[80px] py-2">{log.time}</TableCell>
                                                <TableCell className="text-xs py-2 font-mono text-muted-foreground">
                                                    {log.message}
                                                </TableCell>
                                                <TableCell className="w-[60px] py-2">
                                                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${log.level === 'ERROR' ? 'bg-red-500/10 text-red-500' :
                                                        log.level === 'SUCCESS' ? 'bg-green-500/10 text-green-500' :
                                                            log.level === 'WARN' ? 'bg-yellow-500/10 text-yellow-500' :
                                                                'bg-blue-500/10 text-blue-500'
                                                        }`}>
                                                        {log.level}
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    )
}
