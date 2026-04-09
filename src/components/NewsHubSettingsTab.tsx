import { useState, useEffect, useCallback } from 'react'
import {
    Newspaper, Plus, Trash2, Save, Play, RefreshCw, AlertTriangle,
    CheckCircle2, Clock, Calendar, Tag, Database, Wifi, WifiOff,
    ChevronDown, ChevronUp, ToggleLeft, ToggleRight, Info
} from 'lucide-react'
import { Button } from './ui/Button'
import { Switch } from './ui/Switch'
import { Input } from './ui/Input'

// ─── Types ───────────────────────────────────────────────────────────────────
interface KeywordSlot {
    keyword: string
    enabled: boolean
    maxResults: number
    source: 'open_api'
}

interface ScheduleSlot {
    time: string
    enabled: boolean
    label: string
}

interface NewsHubSettings {
    enabled: boolean
    operatingDays: string[]
    scheduleSlots: ScheduleSlot[]
    keywords: KeywordSlot[]
    useJsonApi: boolean
    jsonApiCategories: string[]
    ttlMinutes: number
    retentionDays: number
    aiCronTimes: string[]
}

interface CacheStatus {
    isValid: boolean
    collectedAt: string | null
    ttlMinutes: number
    articleCount: number
    bucket: string | null
    ageMinutes: number | null
}

const DEFAULT_SETTINGS: NewsHubSettings = {
    enabled: true,
    operatingDays: ['1', '2', '3', '4', '5'],
    scheduleSlots: [
        { time: '08:00', enabled: true, label: '장전 (ITA·MCA 준비)' },
        { time: '09:05', enabled: true, label: '개장 직후' },
        { time: '10:00', enabled: true, label: '오전 중반' },
        { time: '11:00', enabled: true, label: '오전 후반' },
        { time: '12:00', enabled: false, label: '점심 (비활성)' },
        { time: '13:05', enabled: true, label: '오후 개장 직후' },
        { time: '14:00', enabled: true, label: '오후 마감 전' },
    ],
    keywords: [
        { keyword: '코스피 코스닥 시황', enabled: true, maxResults: 10, source: 'open_api' },
        { keyword: '뉴욕증시 마감',       enabled: true, maxResults: 10, source: 'open_api' },
        { keyword: '미국 금리 환율',      enabled: true, maxResults: 10, source: 'open_api' },
        { keyword: '반도체 AI 주식',      enabled: true, maxResults: 10, source: 'open_api' },
        { keyword: '외국인 기관 매수',    enabled: true, maxResults: 10, source: 'open_api' },
    ],
    useJsonApi: true,
    jsonApiCategories: ['MAJOR', 'GLOBAL', 'STOCK_ANALYSIS', 'GLOBAL_MARKET'],
    ttlMinutes: 55,
    retentionDays: 30,
    // ── AI 크론 참조 시각: 실제 SchedulerService 등록 기준 (뉴스허브 슬롯 충돌 감지용)
    // 업데이트 시 SchedulerService.ts와 동기화 필수
    aiCronTimes: [
        '08:30', // 이슈관리 AI (IssueManagementAgent)
        '08:50', // 시황 AI Cycle A - 장전 예측 (MarketConditionAgent)
        '09:10', // 장중 스웜 ① (IntradaySwarmAgent - Local AI)
        '09:25', // 장중 스웜 ②
        '09:26', // NaverFlow 수집 + 테마 AI (ThemeIntelligenceAgent)
        '09:30', // 시황 AI Cycle P - 개장 검증 (MarketConditionAgent)
        '09:35', // 📈 수급 AI (MomentumAnalystAgent) ← 신규
        '09:40', // 장중 스웜 ③ (IntradaySwarmAgent - Local AI)
        '09:41', // 📄 리포트 AI (FundamentalAnalystAgent), 테마 AI (ThemeIntelligenceAgent)
        '09:45', // 🧑‍💼 포트폴리오 매니저 (PortfolioManagerAgent)
        '09:55', // 장중 스웜 ④
        '10:10', // 장중 스웜 ⑤
        '10:25', // 장중 스웜 ⑥
        '10:40', // 장중 스웜 ⑦
        '10:55', // 장중 스웜 ⑧
        '11:10', // 장중 스웜 ⑨
        '15:00', // 장마감 전 피드백 (MarketReviewAgent)
        '15:10', // 시황 AI Cycle B - 마감 예측 (MarketConditionAgent)
        '15:35', // PerformanceTracker (수익률·장중 평가)
        '15:35', // NaverFlow 마감 수집
        '15:40', // 일간 회고 AI (MarketReviewAgent)
        '15:45', // ⚖️ 포트폴리오 장마감 채점 (PortfolioJudgeScheduler) ← 신규
    ],
}

const JSON_CATEGORY_LABELS: Record<string, string> = {
    MAJOR: '주요뉴스',
    GLOBAL: '해외뉴스',
    STOCK_ANALYSIS: '기업·종목분석',
    GLOBAL_MARKET: '해외증시',
}

const DAY_LABELS: Record<string, string> = {
    '1': '월', '2': '화', '3': '수', '4': '목', '5': '금',
}

// ─── 타임라인 경고 검출 ────────────────────────────────────────────────────────
function detectWarnings(settings: NewsHubSettings): string[] {
    const warnings: string[] = []
    const toMin = (t: string) => {
        const [h, m] = t.split(':').map(Number)
        return h * 60 + m
    }
    const aiMins = settings.aiCronTimes.map(toMin)
    for (const slot of settings.scheduleSlots) {
        if (!slot.enabled) continue
        const sm = toMin(slot.time)
        for (const am of aiMins) {
            if (sm > am - 5 && sm <= am) {
                const as = `${String(Math.floor(am / 60)).padStart(2, '0')}:${String(am % 60).padStart(2, '0')}`
                warnings.push(`[${slot.time}] "${slot.label}" 슬롯이 AI 실행 시각 [${as}]보다 5분 미만 앞에 있습니다.`)
            }
        }
    }
    return warnings
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function NewsHubSettingsTab() {
    const [settings, setSettings] = useState<NewsHubSettings>(DEFAULT_SETTINGS)
    const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null)
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
    const [saveMsg, setSaveMsg] = useState('')
    const [collecting, setCollecting] = useState(false)
    const [collectMsg, setCollectMsg] = useState('')
    const [warnings, setWarnings] = useState<string[]>([])
    const [newKeyword, setNewKeyword] = useState('')
    const [newSlotTime, setNewSlotTime] = useState('')
    const [newSlotLabel, setNewSlotLabel] = useState('')
    const [showAddSlot, setShowAddSlot] = useState(false)
    const [newAiCron, setNewAiCron] = useState('')

    const api = window.electronAPI as any

    // ── 초기 로드 ──────────────────────────────────────────────────────────────
    useEffect(() => {
        const load = async () => {
            const s = await api.getNewsHubSettings?.()
            if (s) setSettings(s)
            refreshCache()
        }
        load()
        const iv = setInterval(refreshCache, 30000)
        return () => clearInterval(iv)
    }, [])

    useEffect(() => {
        setWarnings(detectWarnings(settings))
    }, [settings])

    const refreshCache = async () => {
        const status = await api.getNewsHubCacheStatus?.()
        if (status) setCacheStatus(status)
    }

    // ── 저장 ───────────────────────────────────────────────────────────────────
    const handleSave = async () => {
        setSaveStatus('saving')
        setSaveMsg('저장 중...')
        try {
            const result = await api.saveNewsHubSettings?.(settings)
            if (result?.success) {
                setSaveStatus('success')
                const warnText = result.warnings?.length > 0
                    ? ` (경고 ${result.warnings.length}건)`
                    : ''
                setSaveMsg(`저장 완료 — 크론 재등록됨${warnText}`)
            } else {
                setSaveStatus('error')
                setSaveMsg(result?.error || '저장 실패')
            }
        } catch (e: any) {
            setSaveStatus('error')
            setSaveMsg(e.message)
        } finally {
            setTimeout(() => setSaveStatus('idle'), 4000)
        }
    }

    // ── 즉시 수집 ──────────────────────────────────────────────────────────────
    const handleCollectNow = async () => {
        setCollecting(true)
        setCollectMsg('뉴스 수집 중...')
        try {
            const result = await api.collectNewsHubNow?.()
            if (result?.success) {
                setCollectMsg(`✅ ${result.collected}건 수집 완료 (${result.duration_ms}ms)`)
                refreshCache()
            } else {
                setCollectMsg(`❌ 수집 실패: ${result?.error}`)
            }
        } catch (e: any) {
            setCollectMsg(`❌ 오류: ${e.message}`)
        } finally {
            setCollecting(false)
            setTimeout(() => setCollectMsg(''), 5000)
        }
    }

    // ── 슬롯 핸들러 ────────────────────────────────────────────────────────────
    const toggleSlot = (i: number) => {
        const updated = [...settings.scheduleSlots]
        updated[i] = { ...updated[i], enabled: !updated[i].enabled }
        setSettings({ ...settings, scheduleSlots: updated })
    }

    const updateSlotTime = (i: number, time: string) => {
        const updated = [...settings.scheduleSlots]
        updated[i] = { ...updated[i], time }
        setSettings({ ...settings, scheduleSlots: updated })
    }

    const updateSlotLabel = (i: number, label: string) => {
        const updated = [...settings.scheduleSlots]
        updated[i] = { ...updated[i], label }
        setSettings({ ...settings, scheduleSlots: updated })
    }

    const removeSlot = (i: number) => {
        setSettings({ ...settings, scheduleSlots: settings.scheduleSlots.filter((_, idx) => idx !== i) })
    }

    const addSlot = () => {
        if (!newSlotTime) return
        setSettings({
            ...settings,
            scheduleSlots: [
                ...settings.scheduleSlots,
                { time: newSlotTime, enabled: true, label: newSlotLabel || newSlotTime }
            ].sort((a, b) => a.time.localeCompare(b.time))
        })
        setNewSlotTime('')
        setNewSlotLabel('')
        setShowAddSlot(false)
    }

    // ── 키워드 핸들러 ──────────────────────────────────────────────────────────
    const toggleKeyword = (i: number) => {
        const updated = [...settings.keywords]
        updated[i] = { ...updated[i], enabled: !updated[i].enabled }
        setSettings({ ...settings, keywords: updated })
    }

    const updateKeywordResults = (i: number, v: number) => {
        const updated = [...settings.keywords]
        updated[i] = { ...updated[i], maxResults: v }
        setSettings({ ...settings, keywords: updated })
    }

    const removeKeyword = (i: number) => {
        setSettings({ ...settings, keywords: settings.keywords.filter((_, idx) => idx !== i) })
    }

    const addKeyword = () => {
        if (!newKeyword.trim()) return
        setSettings({
            ...settings,
            keywords: [...settings.keywords, { keyword: newKeyword.trim(), enabled: true, maxResults: 10, source: 'open_api' }]
        })
        setNewKeyword('')
    }

    // ── AI 크론 핸들러 ─────────────────────────────────────────────────────────
    const removeAiCron = (t: string) => {
        setSettings({ ...settings, aiCronTimes: settings.aiCronTimes.filter(x => x !== t) })
    }
    const addAiCron = () => {
        if (!newAiCron || settings.aiCronTimes.includes(newAiCron)) return
        setSettings({ ...settings, aiCronTimes: [...settings.aiCronTimes, newAiCron].sort() })
        setNewAiCron('')
    }

    // ── 렌더 ───────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-8 pb-12">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div className="space-y-1">
                    <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        <Newspaper size={28} className="text-sky-500" />
                        뉴스 허브 (Central News Hub)
                    </h2>
                    <p className="text-muted-foreground text-sm">
                        뉴스를 AI보다 먼저 일괄 수집하고 캐시합니다. 에이전트는 HTTP 없이 캐시에서 뉴스를 읽습니다.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="outline" onClick={handleCollectNow} disabled={collecting} className="gap-2">
                        {collecting
                            ? <RefreshCw size={14} className="animate-spin" />
                            : <Play size={14} />}
                        지금 수집
                    </Button>
                    <Button onClick={handleSave} disabled={saveStatus === 'saving'} className="gap-2">
                        {saveStatus === 'saving'
                            ? <RefreshCw size={14} className="animate-spin" />
                            : <Save size={14} />}
                        저장 및 적용
                    </Button>
                </div>
            </div>

            {/* Save Status */}
            {saveStatus !== 'idle' && (
                <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg border ${saveStatus === 'success'
                    ? 'bg-green-500/10 text-green-600 border-green-500/20'
                    : saveStatus === 'error'
                        ? 'bg-red-500/10 text-red-600 border-red-500/20'
                        : 'bg-muted text-muted-foreground border-border'
                    }`}>
                    {saveStatus === 'success' ? <CheckCircle2 size={14} /> : saveStatus === 'error' ? <AlertTriangle size={14} /> : <RefreshCw size={14} className="animate-spin" />}
                    {saveMsg}
                </div>
            )}

            {/* Collect Status */}
            {collectMsg && (
                <div className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border bg-sky-500/10 text-sky-600 border-sky-500/20">
                    <Newspaper size={14} />
                    {collectMsg}
                </div>
            )}

            {/* Warnings */}
            {warnings.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-amber-600 text-sm">
                        <AlertTriangle size={15} />
                        타임라인 경고 ({warnings.length}건)
                    </div>
                    {warnings.map((w, i) => (
                        <p key={i} className="text-xs text-amber-700 dark:text-amber-400 ml-5">• {w}</p>
                    ))}
                    <p className="text-[11px] text-muted-foreground ml-5">Hub 슬롯 시각을 AI 크론보다 최소 5분 앞에 설정하세요.</p>
                </div>
            )}

            {/* ── Cache Status ── */}
            <section className="border border-border/30 rounded-xl p-6 bg-background space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold flex items-center gap-2">
                        <Database size={16} className="text-sky-500" />
                        캐시 상태
                    </h3>
                    <button onClick={refreshCache} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                        <RefreshCw size={12} /> 새로고침
                    </button>
                </div>

                {cacheStatus ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {[
                            {
                                label: '캐시 상태',
                                value: cacheStatus.isValid ? '유효' : '만료 / 없음',
                                icon: cacheStatus.isValid ? <Wifi size={16} className="text-green-500" /> : <WifiOff size={16} className="text-red-500" />,
                                color: cacheStatus.isValid ? 'text-green-600' : 'text-red-500',
                            },
                            {
                                label: '기사 수',
                                value: `${cacheStatus.articleCount}건`,
                                icon: <Newspaper size={16} className="text-sky-500" />,
                                color: 'text-foreground',
                            },
                            {
                                label: '수집 버킷',
                                value: cacheStatus.bucket ?? '—',
                                icon: <Clock size={16} className="text-violet-500" />,
                                color: 'text-foreground',
                            },
                            {
                                label: '경과 시간',
                                value: cacheStatus.ageMinutes != null ? `${cacheStatus.ageMinutes}분 전` : '—',
                                icon: <RefreshCw size={16} className="text-orange-500" />,
                                color: cacheStatus.ageMinutes != null && cacheStatus.ageMinutes > cacheStatus.ttlMinutes ? 'text-red-500' : 'text-foreground',
                            },
                        ].map(s => (
                            <div key={s.label} className="bg-muted/30 rounded-lg p-3 space-y-1">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{s.icon}{s.label}</div>
                                <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">캐시 상태를 불러오는 중...</p>
                )}
            </section>

            {/* ── Master Switch ── */}
            <section className="border border-border/30 rounded-xl p-6 bg-background">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <h3 className="font-bold text-base">Hub 활성화</h3>
                        <p className="text-xs text-muted-foreground">비활성화 시 크론 등록 및 뉴스 수집이 중단됩니다.</p>
                    </div>
                    <Switch
                        checked={settings.enabled}
                        onChange={v => setSettings({ ...settings, enabled: v })}
                    />
                </div>
            </section>

            {/* ── Schedule Slots ── */}
            <section className="border border-border/30 rounded-xl p-6 bg-background space-y-5">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold flex items-center gap-2">
                        <Clock size={16} className="text-violet-500" />
                        수집 시간 슬롯
                    </h3>
                    <button
                        onClick={() => setShowAddSlot(!showAddSlot)}
                        className="text-xs text-sky-500 hover:text-sky-600 flex items-center gap-1 font-medium transition-colors"
                    >
                        <Plus size={13} /> 슬롯 추가
                    </button>
                </div>

                <p className="text-xs text-muted-foreground -mt-2">
                    활성화된 슬롯 시각에 크론이 실행됩니다. AI 크론보다 최소 5분 앞에 설정하세요.
                </p>

                <div className="space-y-2">
                    {settings.scheduleSlots.map((slot, i) => {
                        const isWarning = warnings.some(w => w.startsWith(`[${slot.time}]`))
                        return (
                            <div
                                key={i}
                                className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${slot.enabled
                                    ? isWarning
                                        ? 'border-amber-500/30 bg-amber-500/5'
                                        : 'border-border/40 bg-muted/20'
                                    : 'border-border/20 bg-muted/5 opacity-50'
                                    }`}
                            >
                                <Switch checked={slot.enabled} onChange={() => toggleSlot(i)} />
                                <input
                                    type="time"
                                    value={slot.time}
                                    onChange={e => updateSlotTime(i, e.target.value)}
                                    className="w-24 text-sm font-mono bg-transparent border border-border/30 rounded px-2 py-1 focus:outline-none focus:border-sky-500"
                                />
                                <input
                                    type="text"
                                    value={slot.label}
                                    onChange={e => updateSlotLabel(i, e.target.value)}
                                    className="flex-1 text-sm bg-transparent border border-border/30 rounded px-2 py-1 focus:outline-none focus:border-sky-500"
                                    placeholder="슬롯 설명"
                                />
                                {isWarning && (
                                    <AlertTriangle size={14} className="text-amber-500 shrink-0" title="타임라인 경고" />
                                )}
                                <button
                                    onClick={() => removeSlot(i)}
                                    className="text-muted-foreground hover:text-red-500 transition-colors p-1"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        )
                    })}
                </div>

                {showAddSlot && (
                    <div className="flex gap-2 mt-2 animate-in slide-in-from-top-2 duration-200">
                        <input
                            type="time"
                            value={newSlotTime}
                            onChange={e => setNewSlotTime(e.target.value)}
                            className="w-28 text-sm font-mono bg-muted border border-border/30 rounded px-2 py-2 focus:outline-none focus:border-sky-500"
                        />
                        <input
                            type="text"
                            value={newSlotLabel}
                            onChange={e => setNewSlotLabel(e.target.value)}
                            placeholder="설명 (예: 오후 특보)"
                            className="flex-1 text-sm bg-muted border border-border/30 rounded px-2 py-2 focus:outline-none focus:border-sky-500"
                        />
                        <Button size="sm" onClick={addSlot} disabled={!newSlotTime}>추가</Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowAddSlot(false)}>취소</Button>
                    </div>
                )}
            </section>

            {/* ── Operating Days ── */}
            <section className="border border-border/30 rounded-xl p-6 bg-background space-y-4">
                <h3 className="font-bold flex items-center gap-2">
                    <Calendar size={16} className="text-orange-500" />
                    운영 요일
                </h3>
                <div className="flex gap-3">
                    {Object.entries(DAY_LABELS).map(([val, label]) => {
                        const active = settings.operatingDays.includes(val)
                        return (
                            <button
                                key={val}
                                onClick={() => {
                                    const days = active
                                        ? settings.operatingDays.filter(d => d !== val)
                                        : [...settings.operatingDays, val].sort()
                                    setSettings({ ...settings, operatingDays: days })
                                }}
                                className={`w-11 h-11 rounded-xl text-sm font-bold border transition-all ${active
                                    ? 'bg-sky-500 text-white border-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.3)]'
                                    : 'bg-muted/30 text-muted-foreground border-border/30 hover:bg-muted/50'
                                    }`}
                            >
                                {label}
                            </button>
                        )
                    })}
                </div>
            </section>

            {/* ── Keywords ── */}
            <section className="border border-border/30 rounded-xl p-6 bg-background space-y-5">
                <h3 className="font-bold flex items-center gap-2">
                    <Tag size={16} className="text-green-500" />
                    검색 키워드 (네이버 Open API)
                </h3>
                <p className="text-xs text-muted-foreground -mt-2">
                    활성화된 키워드는 네이버 Open API로 검색됩니다. 최대 수집 건수를 개별 지정할 수 있습니다.
                </p>

                <div className="space-y-2">
                    {settings.keywords.map((kw, i) => (
                        <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${kw.enabled ? 'border-border/40 bg-muted/20' : 'border-border/20 bg-muted/5 opacity-50'}`}>
                            <Switch checked={kw.enabled} onChange={() => toggleKeyword(i)} />
                            <span className="flex-1 text-sm font-medium">{kw.keyword}</span>
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">최대</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={kw.maxResults}
                                    onChange={e => updateKeywordResults(i, parseInt(e.target.value) || 10)}
                                    className="w-14 text-sm text-center bg-muted border border-border/30 rounded px-2 py-1 focus:outline-none focus:border-green-500"
                                />
                                <span className="text-xs text-muted-foreground">건</span>
                            </div>
                            <button onClick={() => removeKeyword(i)} className="text-muted-foreground hover:text-red-500 transition-colors p-1">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>

                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newKeyword}
                        onChange={e => setNewKeyword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addKeyword()}
                        placeholder="추가할 키워드 입력 후 Enter"
                        className="flex-1 text-sm bg-muted border border-border/30 rounded px-3 py-2 focus:outline-none focus:border-green-500"
                    />
                    <Button size="sm" variant="outline" onClick={addKeyword} disabled={!newKeyword.trim()}>
                        <Plus size={14} className="mr-1" /> 추가
                    </Button>
                </div>
            </section>

            {/* ── JSON API Categories ── */}
            <section className="border border-border/30 rounded-xl p-6 bg-background space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold flex items-center gap-2">
                        <Newspaper size={16} className="text-blue-500" />
                        네이버 증권 JSON API
                    </h3>
                    <Switch
                        checked={settings.useJsonApi}
                        onChange={v => setSettings({ ...settings, useJsonApi: v })}
                    />
                </div>
                {settings.useJsonApi && (
                    <div className="grid grid-cols-2 gap-2 animate-in slide-in-from-top-2 duration-200">
                        {Object.entries(JSON_CATEGORY_LABELS).map(([val, label]) => {
                            const active = settings.jsonApiCategories.includes(val)
                            return (
                                <button
                                    key={val}
                                    onClick={() => {
                                        const cats = active
                                            ? settings.jsonApiCategories.filter(c => c !== val)
                                            : [...settings.jsonApiCategories, val]
                                        setSettings({ ...settings, jsonApiCategories: cats })
                                    }}
                                    className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all ${active
                                        ? 'bg-blue-500/10 border-blue-500/40 text-blue-600 dark:text-blue-400'
                                        : 'bg-muted/20 border-border/20 text-muted-foreground hover:bg-muted/40'
                                        }`}
                                >
                                    {active
                                        ? <CheckCircle2 size={14} className="text-blue-500" />
                                        : <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40" />}
                                    {label}
                                </button>
                            )
                        })}
                    </div>
                )}
            </section>

            {/* ── Cache & Retention ── */}
            <section className="border border-border/30 rounded-xl p-6 bg-background space-y-5">
                <h3 className="font-bold flex items-center gap-2">
                    <Database size={16} className="text-indigo-500" />
                    캐시 및 데이터 보존
                </h3>
                <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
                            <Clock size={11} /> 캐시 TTL (분)
                        </label>
                        <input
                            type="number"
                            min={10}
                            max={120}
                            value={settings.ttlMinutes}
                            onChange={e => setSettings({ ...settings, ttlMinutes: parseInt(e.target.value) || 55 })}
                            className="w-full text-sm bg-muted border border-border/30 rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
                        />
                        <p className="text-xs text-muted-foreground">캐시 유효 기간. 초과 시 에이전트는 이전 버킷을 fallback으로 사용합니다.</p>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
                            <Database size={11} /> DB 보존 기간 (일)
                        </label>
                        <input
                            type="number"
                            min={7}
                            max={365}
                            value={settings.retentionDays}
                            onChange={e => setSettings({ ...settings, retentionDays: parseInt(e.target.value) || 30 })}
                            className="w-full text-sm bg-muted border border-border/30 rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
                        />
                        <p className="text-xs text-muted-foreground">이 기간이 지난 뉴스는 다음 배치 수집 시 자동 삭제됩니다.</p>
                    </div>
                </div>
            </section>

            {/* ── AI Cron Times (Reference) ── */}
            <section className="border border-border/30 rounded-xl p-6 bg-background space-y-4">
                <div className="flex items-start gap-2">
                    <Info size={15} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div className="space-y-1">
                        <h3 className="font-bold text-sm">AI 크론 참조 시각 (타임라인 검증용)</h3>
                        <p className="text-xs text-muted-foreground">Hub 슬롯이 이 시각보다 5분 미만 앞에 있으면 경고가 표시됩니다. AI 스케줄을 변경했다면 여기도 업데이트하세요.</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {settings.aiCronTimes.map(t => (
                        <span key={t} className="flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-lg text-sm font-mono border border-border/30">
                            {t}
                            <button onClick={() => removeAiCron(t)} className="text-muted-foreground hover:text-red-500 transition-colors ml-0.5">
                                <Trash2 size={11} />
                            </button>
                        </span>
                    ))}
                    <div className="flex gap-2 items-center">
                        <input
                            type="time"
                            value={newAiCron}
                            onChange={e => setNewAiCron(e.target.value)}
                            className="w-24 text-sm font-mono bg-muted border border-border/30 rounded px-2 py-1.5 focus:outline-none focus:border-sky-500"
                        />
                        <button
                            onClick={addAiCron}
                            disabled={!newAiCron}
                            className="text-xs text-sky-500 hover:text-sky-600 disabled:opacity-30 font-medium transition-colors flex items-center gap-1"
                        >
                            <Plus size={12} /> 추가
                        </button>
                    </div>
                </div>
            </section>
        </div>
    )
}
