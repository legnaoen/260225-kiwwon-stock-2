import React, { useState, useEffect } from 'react'
import { LineChart, TrendingUp, TrendingDown, Activity, Target, Award, Brain, Loader2, Settings, Save, RotateCcw, Cpu, Clock, X, CalendarDays, ArrowRight } from 'lucide-react'
import { Switch } from './ui/Switch'
import { cn } from '../utils'
import { ResponsiveContainer, LineChart as RechartsLineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'

// ──────────────────────────────────────────────
// Strategy Profile Types
// ──────────────────────────────────────────────
interface StrategyProfile {
    strategy: string
    hardTakeProfit: number
    hardStopLoss: number
    trailingStopPct: number
    maxHoldDays: number
    forceCloseTime: string
    defaultTargetPct: number
    reviewFrequency: string
    minConviction: number
    extensionDays: number
    managementMode: 'HARD_RULE' | 'AI_DRIVEN'
}

const STRATEGY_META = {
    DAYTRADING: { label: '데이트레이딩', icon: '⚡', color: 'border-amber-500/30 bg-amber-500/5', desc: '당일 매매, 장마감 전 강제 청산' },
    SWING: { label: '스윙', icon: '🌊', color: 'border-blue-500/30 bg-blue-500/5', desc: '5~10일 단기 트레이딩' },
    POSITION: { label: '포지션', icon: '🎯', color: 'border-emerald-500/30 bg-emerald-500/5', desc: 'AI 주도 중기 투자' },
    LONGTERM: { label: '장기', icon: '🏦', color: 'border-violet-500/30 bg-violet-500/5', desc: 'AI 주도 장기 투자' },
}

function NumberInput({ value, onChange, suffix = '%', min = -100, max = 100, step = 1, ruleType = 'hard' }: {
    value: number, onChange: (v: number) => void, suffix?: string,
    min?: number, max?: number, step?: number, ruleType?: 'hard' | 'ai' | 'ref'
}) {
    const dotColor = ruleType === 'hard' ? 'bg-red-500' : ruleType === 'ai' ? 'bg-amber-500' : 'bg-zinc-400'
    return (
        <div className="flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-full shrink-0', dotColor)} />
            <input
                type="number" value={value} min={min} max={max} step={step}
                onChange={e => onChange(parseFloat(e.target.value) || 0)}
                className="w-20 px-2 py-1.5 text-sm font-mono bg-background border border-border rounded-lg text-right outline-none focus:border-violet-500 transition-colors"
            />
            <span className="text-xs text-muted-foreground font-semibold">{suffix}</span>
        </div>
    )
}

// ──────────────────────────────────────────────
// ... (나머지 생략된 기존 차트/모달 컴포넌트 코드유지를 위해 replace 범위를 최소화합니다)
// ──────────────────────────────────────────────
// Mini SVG Line Chart Component
// ──────────────────────────────────────────────
function DualLineChart({ data, width = 700, height = 220 }: {
    data: { date: string, pmReturn: number, kospiReturn: number }[]
    width?: number
    height?: number
}) {
    if (data.length < 2) {
        return (
            <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height }}>
                <Activity size={16} className="mr-2 opacity-40" />
                차트를 표시하려면 최소 2일의 데이터가 필요합니다.
            </div>
        )
    }

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs">
                    <p className="font-bold mb-2">{label}</p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex flex-col gap-1 mb-1">
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                {entry.name}
                            </span>
                            <span className={cn("font-bold text-sm", entry.value > 0 ? "text-red-500" : entry.value < 0 ? "text-blue-500" : "text-foreground")}>
                                {entry.value > 0 ? '+' : ''}{entry.value.toFixed(2)}%
                            </span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div style={{ width: '100%', height }}>
            <ResponsiveContainer width="100%" height="100%">
                <RechartsLineChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.08} />
                    <XAxis 
                        dataKey="date" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: 'currentColor', opacity: 0.5, fontSize: 10, fontWeight: 500 }}
                        dy={10}
                        minTickGap={30}
                    />
                    <YAxis 
                        axisLine={false} 
                        tickLine={false}
                        tick={{ fill: 'currentColor', opacity: 0.4, fontSize: 10, fontWeight: 500 }}
                        tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`}
                        dx={-10}
                        width={60}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'currentColor', strokeOpacity: 0.2, strokeWidth: 1, strokeDasharray: '4 4' }} />
                    <defs>
                        <linearGradient id="pmColor" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    <Line 
                        name="KOSPI"
                        type="monotone" 
                        dataKey="kospiReturn" 
                        stroke="#9ca3af" 
                        strokeWidth={1.5}
                        strokeDasharray="5 5"
                        dot={false}
                        activeDot={{ r: 4, fill: '#9ca3af', stroke: 'var(--background)', strokeWidth: 2 }}
                    />
                    <Line 
                        name="PM 포트폴리오"
                        type="monotone" 
                        dataKey="pmReturn" 
                        stroke="#8b5cf6" 
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5, fill: '#8b5cf6', stroke: 'var(--background)', strokeWidth: 2 }}
                    />
                </RechartsLineChart>
            </ResponsiveContainer>
        </div>
    )
}

// ──────────────────────────────────────────────
// KPI Card Component
// ──────────────────────────────────────────────
function KpiCard({ label, value, subValue, icon: Icon, color }: {
    label: string
    value: string
    subValue?: string
    icon: any
    color: string
}) {
    return (
        <div className="flex flex-col gap-1.5 p-4 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
            <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
                <Icon size={16} className={color} />
            </div>
            <span className={cn("text-2xl font-black tabular-nums", color)}>{value}</span>
            {subValue && (
                <span className="text-xs text-muted-foreground font-semibold">{subValue}</span>
            )}
        </div>
    )
}

// ──────────────────────────────────────────────
// Strategy Settings Modal
// ──────────────────────────────────────────────
function StrategySettingsModal({ profiles, reviewSchedule, onProfileChange, onScheduleChange, onSave, onReset, onClose, saving, saveMsg }: {
    profiles: Record<string, StrategyProfile>
    reviewSchedule: { intradayTime: string, closingTime: string, autoEnabled: boolean }
    onProfileChange: (strategy: string, field: string, value: any) => void
    onScheduleChange: (schedule: any) => void
    onSave: () => void
    onReset: () => void
    onClose: () => void
    saving: boolean
    saveMsg: string
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-[720px] max-h-[85vh] overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-violet-500/10">
                            <Settings size={18} className="text-violet-500" />
                        </div>
                        <div>
                            <h2 className="text-base font-black">전략 프로파일 설정</h2>
                            <p className="text-xs text-muted-foreground">익절·손절 규칙과 AI 역할을 조정합니다</p>
                        </div>
                        {saveMsg && <span className="text-xs text-emerald-500 font-bold ml-2">{saveMsg}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onReset}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-border hover:bg-muted transition-colors">
                            <RotateCcw size={12} /> 기본값
                        </button>
                        <button onClick={onSave} disabled={saving}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-colors">
                            <Save size={12} /> {saving ? '저장중...' : '저장'}
                        </button>
                        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors ml-1">
                            <X size={16} className="text-muted-foreground" />
                        </button>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    {/* Legend */}
                    <div className="flex gap-5 text-xs font-semibold">
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> 하드룰 (시스템 자동 실행)</span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> AI 기준 (AI 판단 임계값)</span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-zinc-400" /> 참고값 (AI 가이드라인)</span>
                    </div>

                    {/* Strategy Cards */}
                    <div className="grid grid-cols-2 gap-4">
                        {Object.keys(STRATEGY_META).map(key => {
                            const meta = STRATEGY_META[key as keyof typeof STRATEGY_META]
                            const p = profiles[key]
                            if (!p) return null
                            const isHardRule = p.managementMode === 'HARD_RULE'

                            return (
                                <div key={key} className={cn('rounded-xl border p-4 space-y-3', meta.color)}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg">{meta.icon}</span>
                                            <span className="text-sm font-extrabold">{meta.label}</span>
                                        </div>
                                        <span className={cn(
                                            'text-[10px] px-2.5 py-0.5 rounded-full font-bold',
                                            isHardRule ? 'bg-red-500/15 text-red-500' : 'bg-emerald-500/15 text-emerald-500'
                                        )}>
                                            {isHardRule ? '🔴 하드룰 주도' : '🟢 AI 주도'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">{meta.desc}</p>

                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                                        <div className="space-y-1">
                                            <label className="text-[11px] font-bold text-muted-foreground">손절선</label>
                                            <NumberInput value={p.hardStopLoss} onChange={v => onProfileChange(key, 'hardStopLoss', v)}
                                                min={-30} max={0} ruleType="hard" />
                                        </div>

                                        {isHardRule && (
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-bold text-muted-foreground">익절선</label>
                                                <NumberInput value={p.hardTakeProfit} onChange={v => onProfileChange(key, 'hardTakeProfit', v)}
                                                    min={0} max={50} ruleType="hard" />
                                            </div>
                                        )}

                                        {key === 'SWING' && (
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-bold text-muted-foreground">트레일링 스탑</label>
                                                <NumberInput value={p.trailingStopPct} onChange={v => onProfileChange(key, 'trailingStopPct', v)}
                                                    min={-20} max={0} ruleType="hard" />
                                            </div>
                                        )}

                                        {p.maxHoldDays > 0 && (
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-bold text-muted-foreground">보유 상한</label>
                                                <NumberInput value={p.maxHoldDays} onChange={v => onProfileChange(key, 'maxHoldDays', v)}
                                                    min={1} max={999} suffix="일" ruleType="hard" />
                                            </div>
                                        )}

                                        {key === 'DAYTRADING' && (
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-bold text-muted-foreground">강제 청산</label>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                                    <input type="time" value={p.forceCloseTime}
                                                        onChange={e => onProfileChange(key, 'forceCloseTime', e.target.value)}
                                                        className="px-2 py-1.5 text-sm font-mono bg-background border border-border rounded-lg outline-none focus:border-violet-500" />
                                                </div>
                                            </div>
                                        )}

                                        {key === 'SWING' && (
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-bold text-muted-foreground">연장 가능</label>
                                                <NumberInput value={p.extensionDays} onChange={v => onProfileChange(key, 'extensionDays', v)}
                                                    min={0} max={30} suffix="일" ruleType="ai" />
                                            </div>
                                        )}

                                        {!isHardRule && (
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-bold text-muted-foreground">기본 목표수익률</label>
                                                <NumberInput value={p.defaultTargetPct} onChange={v => onProfileChange(key, 'defaultTargetPct', v)}
                                                    min={1} max={100} ruleType="ref" />
                                            </div>
                                        )}

                                        {!isHardRule && (
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-bold text-muted-foreground">청산검토 conviction</label>
                                                <NumberInput value={p.minConviction} onChange={v => onProfileChange(key, 'minConviction', v)}
                                                    min={0} max={100} suffix="" ruleType="ai" />
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-start gap-1.5 pt-2 border-t border-border/50">
                                        <Cpu size={12} className="text-muted-foreground mt-0.5 shrink-0" />
                                        <span className="text-[11px] text-muted-foreground leading-snug">
                                            {isHardRule
                                                ? 'AI 역할: 예외 조기청산 권고, 전략 전환 제안'
                                                : `AI 역할: 목표가 조정, 보유/청산 전권 (리뷰: ${p.reviewFrequency === 'DAILY' ? '매일' : '주 1회'})`
                                            }
                                        </span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* PM Review Schedule */}
                    <div className="rounded-xl border border-border p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <Clock size={14} className="text-muted-foreground" />
                            <span className="text-sm font-bold">PM 리뷰 스케줄</span>
                        </div>
                        <div className="flex items-center gap-8">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground font-semibold">장중 리뷰</span>
                                <input type="time" value={reviewSchedule.intradayTime}
                                    onChange={e => onScheduleChange({ ...reviewSchedule, intradayTime: e.target.value })}
                                    className="px-2.5 py-1.5 text-sm font-mono bg-background border border-border rounded-lg" />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground font-semibold">장마감 리뷰</span>
                                <input type="time" value={reviewSchedule.closingTime}
                                    onChange={e => onScheduleChange({ ...reviewSchedule, closingTime: e.target.value })}
                                    className="px-2.5 py-1.5 text-sm font-mono bg-background border border-border rounded-lg" />
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    checked={reviewSchedule.autoEnabled}
                                    onChange={(checked) => onScheduleChange({ ...reviewSchedule, autoEnabled: checked })}
                                />
                                <span className="text-xs font-bold">자동 실행</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ──────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────
export default function PmTracker() {
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [activeListTab, setActiveListTab] = useState<'holding' | 'watching' | 'closed' | 'log'>('holding')
    const [logFilter, setLogFilter] = useState<'all' | 'trades'>('all')
    const [chartRange, setChartRange] = useState<'7' | '30' | '90' | 'all'>('30')
    const [profiles, setProfiles] = useState({} as Record<string, StrategyProfile>)
    const [reviewSchedule, setReviewSchedule] = useState({ intradayTime: '14:50', closingTime: '15:45', autoEnabled: false })
    const [saving, setSaving] = useState(false)
    const [saveMsg, setSaveMsg] = useState('')
    const [showSettings, setShowSettings] = useState(false)

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        setLoading(true)
        try {
            const [trackerRes, profileRes, scheduleRes] = await Promise.all([
                window.electronAPI.getPortfolioTracker(),
                window.electronAPI.getStrategyProfiles(),
                window.electronAPI.getReviewSchedule(),
            ])
            if (trackerRes.success && trackerRes.data) setData(trackerRes.data)
            if (profileRes.success && profileRes.data) setProfiles(profileRes.data)
            if (scheduleRes.success && scheduleRes.data) setReviewSchedule(scheduleRes.data)
        } catch (error) {
            console.error('[PmTracker] Load error:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleSaveProfiles = async () => {
        setSaving(true)
        try {
            await window.electronAPI.saveStrategyProfiles(profiles)
            await window.electronAPI.saveReviewSchedule(reviewSchedule)
            setSaveMsg('저장 완료')
            setTimeout(() => setSaveMsg(''), 2000)
        } catch (e) { setSaveMsg('저장 실패') }
        finally { setSaving(false) }
    }

    const handleResetProfiles = async () => {
        const res = await window.electronAPI.resetStrategyProfiles()
        if (res.success && res.data) {
            setProfiles(res.data)
            setSaveMsg('기본값 복원됨')
            setTimeout(() => setSaveMsg(''), 2000)
        }
    }

    const updateProfile = (strategy: string, field: string, value: any) => {
        setProfiles(prev => ({
            ...prev,
            [strategy]: { ...prev[strategy], [field]: value }
        }))
    }

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-violet-500" />
            </div>
        )
    }

    const stats = data?.stats || {}
    const active = data?.active || []
    const closed = data?.closed || []
    const dailyHistory = data?.dailyHistory || []

    const holdingItems = active.filter((item: any) => item.entry_shares > 0 || item.status === 'HOLDING');
    const watchingItems = active.filter((item: any) => !(item.entry_shares > 0 || item.status === 'HOLDING'));

    const chartData = (() => {
        const mapped = dailyHistory.map((d: any) => ({
            date: `${d.date.slice(4, 6)}/${d.date.slice(6, 8)}`,
            pmReturn: d.portfolio_return || 0,
            kospiReturn: d.kospi_return || 0,
        }))
        if (chartRange === 'all') return mapped
        const limit = parseInt(chartRange)
        return mapped.slice(-limit)
    })()

    const latestAlpha = dailyHistory.length > 0 ? dailyHistory[dailyHistory.length - 1].alpha || 0 : 0

    const getPhysicalState = (item: any) => {
        if (item.entry_shares > 0 || item.status === 'HOLDING') return { label: `📦 보유중`, cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' };
        if (item.entry_pending === 1) return { label: '⏳ 매수 대기', cls: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' };
        return { label: '👀 관심', cls: 'bg-muted text-muted-foreground border border-border/50' };
    };
    const getLogicalSignal = (item: any) => {
        const sig = (item.last_signal || '').toUpperCase();
        if (sig.includes('BUY')) return { label: '🤖 강력 매수', cls: 'text-red-500 bg-red-500/15' };
        if (sig.includes('SELL')) return { label: '🤖 청산 권고', cls: 'text-blue-500 bg-blue-500/15' };
        if (sig.includes('HOLD')) return { label: '🤖 유지 (HOLD)', cls: 'text-amber-500 bg-amber-500/15' };
        return { label: `🤖 ${sig || '관망'}`, cls: 'text-muted-foreground bg-muted' };
    };
    const strategyLabels: Record<string, string> = {
        'DAYTRADING': '당일',
        'SWING': '스윙',
        'POSITION': '포지션',
        'LONGTERM': '장기',
    }

    const activityLog = (() => {
        const events: any[] = [];
        const allItems = [...active, ...closed];

        allItems.forEach((item: any) => {
            if (item.created_at) {
                events.push({
                    id: `${item.stock_code}-watch-${item.created_at}`, type: 'WATCH',
                    date: item.created_at.split('T')[0].replace(/-/g, ''), 
                    timestamp: new Date(item.created_at).getTime(),
                    stock_name: item.stock_name, reason: item.last_signal_reason || '조건 검색 편입', strategy: item.strategy
                });
            }
            if (item.entry_date && item.entry_date.length === 8) {
                const y = item.entry_date.slice(0,4), m = item.entry_date.slice(4,6), d = item.entry_date.slice(6,8)
                events.push({
                    id: `${item.stock_code}-buy-${item.entry_date}`, type: 'BUY',
                    date: item.entry_date,
                    timestamp: new Date(`${y}-${m}-${d}T09:00:00`).getTime(),
                    stock_name: item.stock_name, reason: item.last_signal_reason || '조건 달성 (매수)', strategy: item.strategy
                });
            }
            if (item.status === 'CLOSED' && item.closed_date && item.closed_date.length === 8) {
                const y = item.closed_date.slice(0,4), m = item.closed_date.slice(4,6), d = item.closed_date.slice(6,8)
                events.push({
                    id: `${item.stock_code}-sell-${item.closed_date}`, type: 'SELL',
                    date: item.closed_date,
                    timestamp: new Date(`${y}-${m}-${d}T15:30:00`).getTime(),
                    stock_name: item.stock_name, reason: item.last_signal_reason || '청산 규칙 도달',
                    profit: item.closed_profit_rate, strategy: item.strategy
                });
            }
        });

        events.sort((a, b) => b.timestamp - a.timestamp);
        const groups: Record<string, any[]> = {};
        events.forEach(e => {
            if (!groups[e.date]) groups[e.date] = [];
            groups[e.date].push(e);
        });

        return Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(date => ({
            date, events: groups[date]
        }));
    })();

    const weeklyTurnover = (() => {
        const d = new Date(); d.setDate(d.getDate() - 7);
        const last7 = d.toISOString().split('T')[0].replace(/-/g, '');
        const wCount = [...active, ...closed].filter((c: any) => 
            (c.entry_date && c.entry_date >= last7) || 
            (c.closed_date && c.closed_date >= last7)
        ).length;
        return wCount;
    })();

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="px-6 pt-5 pb-3 border-b border-border flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-violet-500/10">
                        <LineChart size={20} className="text-violet-500" />
                    </div>
                    <div>
                        <h1 className="text-lg font-black">PM AI 포트폴리오 트래커</h1>
                        <p className="text-xs text-muted-foreground font-medium">
                            AI 투자 판단의 성적을 KOSPI 대비 추적합니다
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {latestAlpha !== 0 && (
                        <div className={cn(
                            "flex items-center gap-1.5 px-4 py-2 rounded-xl border font-bold text-sm",
                            latestAlpha > 0
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                                : "bg-red-500/10 border-red-500/20 text-red-500"
                        )}>
                            {latestAlpha > 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                            Alpha: {latestAlpha > 0 ? '+' : ''}{latestAlpha.toFixed(1)}%p
                        </div>
                    )}
                    <button
                        onClick={() => setShowSettings(true)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-bold hover:bg-muted transition-colors"
                    >
                        <Settings size={15} className="text-muted-foreground" />
                        전략 설정
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                {/* ── Chart Section ── */}
                <div className="rounded-xl border border-border p-4 bg-card/30">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-extrabold">누적 수익률 비교</h2>
                        <div className="flex gap-1">
                            {(['7', '30', '90', 'all'] as const).map(r => (
                                <button
                                    key={r}
                                    onClick={() => setChartRange(r)}
                                    className={cn(
                                        "px-2.5 py-1 text-xs font-bold rounded-md transition-colors",
                                        chartRange === r
                                            ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                                            : "text-muted-foreground hover:bg-muted"
                                    )}
                                >
                                    {r === 'all' ? '전체' : `${r}일`}
                                </button>
                            ))}
                        </div>
                    </div>
                    <DualLineChart data={chartData} />
                </div>

                {/* ── KPI Cards ── */}
                <div className="grid grid-cols-4 gap-3">
                    <KpiCard
                        label="총 수익률"
                        value={`${stats.totalReturn >= 0 ? '+' : ''}${(stats.totalReturn || 0).toFixed(1)}%`}
                        subValue={`NAV ₩${((stats.currentNAV || 10000000) / 10000).toFixed(0)}만`}
                        icon={TrendingUp}
                        color={stats.totalReturn >= 0 ? 'text-red-500' : 'text-blue-500'}
                    />
                    <KpiCard
                        label="승률"
                        value={`${(stats.winRate || 0).toFixed(1)}%`}
                        subValue={`${stats.wins || 0}승 ${stats.losses || 0}패`}
                        icon={Target}
                        color={(stats.winRate || 0) >= 60 ? 'text-emerald-500' : (stats.winRate || 0) < 40 ? 'text-red-500' : 'text-amber-500'}
                    />
                    <KpiCard
                        label="평균 보유일"
                        value={`${stats.avgHoldDays || 0}일`}
                        subValue={`최근 7일 교체: ${weeklyTurnover}건`}
                        icon={Activity}
                        color="text-muted-foreground"
                    />
                    <KpiCard
                        label="실보유 현황"
                        value={`${holdingItems.length}종목 체결`}
                        subValue={`+ ${watchingItems.length}종목 관심/대기 중`}
                        icon={Award}
                        color="text-violet-500"
                    />
                </div>

                {/* ── Active / Closed Tabs ── */}
                <div className="rounded-xl border border-border overflow-hidden">
                    <div className="flex border-b border-border bg-muted/20">
                        {(['holding', 'watching', 'closed', 'log'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveListTab(tab)}
                                className={cn(
                                    "flex-1 py-3 text-sm font-bold transition-colors border-b-2",
                                    activeListTab === tab
                                        ? "border-violet-500 text-foreground bg-background"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {tab === 'holding' ? `📦 보유 종목 (${holdingItems.length})` 
                                : tab === 'watching' ? `👀 AI 관심 종목 (${watchingItems.length})` 
                                : tab === 'closed' ? `📜 청산 이력 (${closed.length})` 
                                : `📝 AI 활동 로그`}
                            </button>
                        ))}
                    </div>

                    <div className="pb-8">
                        {activeListTab === 'log' ? (() => {
                            const filteredLog = logFilter === 'trades' 
                                ? activityLog.map(g => ({ ...g, events: g.events.filter((e: any) => e.type !== 'WATCH') })).filter(g => g.events.length > 0)
                                : activityLog;

                            return (
                            <div className="p-5 space-y-6">
                                <div className="flex justify-end mb-2">
                                    <div className="bg-muted/50 p-1 rounded-lg flex inline-flex">
                                        <button 
                                            onClick={() => setLogFilter('all')} 
                                            className={cn("px-3 py-1.5 text-xs font-bold rounded-md transition-colors", logFilter === 'all' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                                        >
                                            전체 보기
                                        </button>
                                        <button 
                                            onClick={() => setLogFilter('trades')} 
                                            className={cn("px-3 py-1.5 text-xs font-bold rounded-md transition-colors", logFilter === 'trades' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                                        >
                                            실체결만 보기
                                        </button>
                                    </div>
                                </div>
                                {filteredLog.map((group, i) => (
                                    <div key={i} className="relative pl-4 border-l-2 border-border/50 space-y-3">
                                        <div className="absolute -left-[9px] top-0 bg-background px-1">
                                            <CalendarDays size={14} className="text-muted-foreground" />
                                        </div>
                                        <h3 className="text-sm font-black -translate-y-1">{group.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1년 $2월 $3일')}</h3>
                                        <div className="space-y-2">
                                            {group.events.map((ev: any) => (
                                                <div key={ev.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/30">
                                                    <span className={cn(
                                                        "px-2 py-1 rounded text-[10px] font-black w-14 text-center shrink-0",
                                                        ev.type === 'BUY' ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                                                        ev.type === 'SELL' ? "bg-red-500/15 text-red-500" :
                                                        "bg-muted text-muted-foreground"
                                                    )}>
                                                        {ev.type === 'BUY' ? '🟢 편입' : ev.type === 'SELL' ? '🔴 청산' : '👀 관심'}
                                                    </span>
                                                    <span className="font-bold text-sm w-24 shrink-0 truncate">{ev.stock_name}</span>
                                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-500 shrink-0">{strategyLabels[ev.strategy] || ev.strategy}</span>
                                                    <ArrowRight size={14} className="text-muted-foreground/30 shrink-0" />
                                                    <span className="text-xs text-muted-foreground truncate flex-1">{ev.reason}</span>
                                                    {ev.profit !== undefined && (
                                                        <span className={cn(
                                                            "text-xs font-bold tabular-nums ml-2 shrink-0 w-16 text-right",
                                                            ev.profit > 0 ? "text-red-500" : ev.profit < 0 ? "text-blue-500" : "text-muted-foreground"
                                                        )}>
                                                            {ev.profit > 0 ? '+' : ''}{parseFloat(ev.profit).toFixed(1)}%
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                                {filteredLog.length === 0 && (
                                    <div className="py-16 text-center text-muted-foreground">
                                        <Activity size={28} className="mx-auto mb-3 opacity-30" />
                                        <p className="text-sm font-semibold">최근 동작 내역이 없습니다</p>
                                    </div>
                                )}
                            </div>
                            )
                        })() : activeListTab === 'holding' || activeListTab === 'watching' ? (() => {
                            const targetList = activeListTab === 'holding' ? holdingItems : watchingItems;
                            return targetList.length > 0 ? (
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/40">
                                        <tr className="text-xs text-muted-foreground uppercase">
                                            <th className="py-2.5 px-3 text-left w-8">#</th>
                                            <th className="py-2.5 px-3 text-left">종목명</th>
                                            <th className="py-2.5 px-3 text-center">conviction</th>
                                            <th className="py-2.5 px-3 text-center">상태</th>
                                            <th className="py-2.5 px-3 text-center">전략</th>
                                            <th className="py-2.5 px-3 text-left">매수 사유</th>
                                            <th className="py-2.5 px-3 text-center">갱신일</th>
                                            <th className="py-2.5 px-3 text-right">수익률</th>
                                            <th className="py-2.5 px-3 text-right">보유일</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(() => {
                                            const renderRow = (item: any, i: number) => {
                                                const profit = item.profit_rate || 0
                                                return (
                                                    <tr key={item.stock_code} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                                                        <td className="py-3 px-3 font-bold text-muted-foreground tabular-nums">{i + 1}</td>
                                                        <td className="py-3 px-3 font-bold">{item.stock_name}</td>
                                                        <td className="py-3 px-3 text-center">
                                                            <span className="px-2.5 py-0.5 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-400 font-extrabold text-xs">
                                                                {item.conviction_score}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-3">
                                                            <div className="flex justify-center items-center gap-1.5">
                                                                <span className={cn("text-[10.5px] font-black px-2 py-0.5 rounded-md whitespace-nowrap", getPhysicalState(item).cls)}>
                                                                    {getPhysicalState(item).label}
                                                                </span>
                                                                <span className={cn("text-[10.5px] font-black px-2 py-0.5 rounded-md whitespace-nowrap", getLogicalSignal(item).cls)}>
                                                                    {getLogicalSignal(item).label}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-3 text-center">
                                                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                                                                {strategyLabels[item.strategy] || item.strategy}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-3 text-muted-foreground max-w-[200px] truncate">{item.last_signal_reason || '-'}</td>
                                                        <td className="py-3 px-3 text-center">
                                                            {item.last_reviewed_at && (() => {
                                                                const diff = Date.now() - new Date(item.last_reviewed_at).getTime();
                                                                const mins = Math.floor(diff / 60000);
                                                                const isRecentReview = mins < 60;
                                                                const isNewlyCreated = item.created_at ? (Date.now() - new Date(item.created_at).getTime()) < 60000 * 60 : false;
                                                                const timeText = mins < 1 ? '방금' : mins < 60 ? `${mins}분 전` : mins < 1440
                                                                    ? new Date(item.last_reviewed_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
                                                                    : new Date(item.last_reviewed_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + ' ' + new Date(item.last_reviewed_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                                                                return (
                                                                    <div className="flex items-center justify-center gap-1">
                                                                        <span className={cn("text-[10px] font-medium whitespace-nowrap", isRecentReview ? "text-primary/80" : "text-muted-foreground/60")}>{timeText}</span>
                                                                        {isNewlyCreated && <span className="text-[8px] font-black px-1 rounded bg-primary/15 text-primary">NEW</span>}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </td>
                                                        <td className={cn("py-3 px-3 text-right font-bold tabular-nums", profit > 0 ? 'text-red-500' : profit < 0 ? 'text-blue-500' : 'text-muted-foreground')}>
                                                            {profit > 0 ? '+' : ''}{profit.toFixed(1)}%
                                                        </td>
                                                        <td className="py-3 px-3 text-right text-muted-foreground font-mono">{item.days_held || 0}</td>
                                                    </tr>
                                                )
                                            }

                                            return (
                                                <>
                                                    {targetList.map((item: any, i: number) => renderRow(item, i))}
                                                </>
                                            )
                                        })()}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="py-16 text-center text-muted-foreground">
                                    <Brain size={28} className="mx-auto mb-3 opacity-30" />
                                    <p className="text-sm font-semibold">{activeListTab === 'holding' ? '보유중인 종목이 없습니다' : '관심 종목이 없습니다'}</p>
                                    <p className="text-xs mt-1">종합 관제에서 PM AI를 실행하세요.</p>
                                </div>
                            )
                        })() : (
                            closed.length > 0 ? (
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/40">
                                        <tr className="text-xs text-muted-foreground uppercase">
                                            <th className="py-2.5 px-3 text-center w-8">결과</th>
                                            <th className="py-2.5 px-3 text-left">종목명</th>
                                            <th className="py-2.5 px-3 text-left">매수 사유</th>
                                            <th className="py-2.5 px-3 text-right">수익률</th>
                                            <th className="py-2.5 px-3 text-center">편입일</th>
                                            <th className="py-2.5 px-3 text-center">청산일</th>
                                            <th className="py-2.5 px-3 text-right">보유일</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {closed.map((item: any) => {
                                            const profit = item.closed_profit_rate || 0
                                            const isWin = profit > 0
                                            return (
                                                <tr key={`${item.stock_code}-${item.closed_date}`} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                                                    <td className="py-3 px-3 text-center text-base">{isWin ? '🟢' : '🔴'}</td>
                                                    <td className="py-3 px-3 font-bold">{item.stock_name}</td>
                                                    <td className="py-3 px-3 text-muted-foreground max-w-[200px] truncate">{item.last_signal_reason || '-'}</td>
                                                    <td className={cn("py-3 px-3 text-right font-bold tabular-nums", isWin ? 'text-red-500' : 'text-blue-500')}>
                                                        {isWin ? '+' : ''}{profit.toFixed(1)}%
                                                    </td>
                                                    <td className="py-3 px-3 text-center text-muted-foreground font-mono">
                                                        {item.entry_date ? `${item.entry_date.slice(4, 6)}/${item.entry_date.slice(6, 8)}` : '-'}
                                                    </td>
                                                    <td className="py-3 px-3 text-center text-muted-foreground font-mono">
                                                        {item.closed_date ? `${item.closed_date.slice(4, 6)}/${item.closed_date.slice(6, 8)}` : '-'}
                                                    </td>
                                                    <td className="py-3 px-3 text-right text-muted-foreground font-mono">{item.days_held || 0}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="py-16 text-center text-muted-foreground">
                                    <Activity size={28} className="mx-auto mb-3 opacity-30" />
                                    <p className="text-sm font-semibold">청산 이력이 없습니다</p>
                                    <p className="text-xs mt-1">PM AI가 종목을 청산하면 여기에 표시됩니다.</p>
                                </div>
                            )
                        )}
                    </div>
                </div>
            </div>

            {/* Strategy Settings Modal */}
            {showSettings && (
                <StrategySettingsModal
                    profiles={profiles}
                    reviewSchedule={reviewSchedule}
                    onProfileChange={updateProfile}
                    onScheduleChange={setReviewSchedule}
                    onSave={handleSaveProfiles}
                    onReset={handleResetProfiles}
                    onClose={() => setShowSettings(false)}
                    saving={saving}
                    saveMsg={saveMsg}
                />
            )}
        </div>
    )
}
