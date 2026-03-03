import { useState, useEffect } from 'react'
import { Save, ShieldCheck, AlertCircle, RefreshCw, Send, MessageCircle, Bell, Clock, Database } from 'lucide-react'
import { useScheduleStore } from '../store/useScheduleStore'

export default function Settings() {
    const [keys, setKeys] = useState({ appkey: '', secretkey: '' })
    const [isSaving, setIsSaving] = useState(false)
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
    const [message, setMessage] = useState('')

    const [telegramKeys, setTelegramKeys] = useState({ botToken: '', chatId: '', chartTheme: 'dark', chatType: '' })
    const [isSavingTg, setIsSavingTg] = useState(false)
    const [statusTg, setStatusTg] = useState<'idle' | 'success' | 'error'>('idle')
    const [messageTg, setMessageTg] = useState('')
    const [isTestingTg, setIsTestingTg] = useState(false)

    const [scheduleSettings, setScheduleSettings] = useState({
        notificationTime: '08:30',
        globalDailyNotify: false,
        sendMissedOnStartup: true
    })
    const [isSavingSchedule, setIsSavingSchedule] = useState(false)
    const [statusSchedule, setStatusSchedule] = useState<'idle' | 'success' | 'error'>('idle')
    const [messageSchedule, setMessageSchedule] = useState('')

    const [dartKey, setDartKey] = useState('')
    const [isSavingDart, setIsSavingDart] = useState(false)
    const [isSyncingDart, setIsSyncingDart] = useState(false)
    const [isSyncingDisclosures, setIsSyncingDisclosures] = useState(false)
    const [dartOptions, setDartOptions] = useState({
        regular: true,      // 정기공시 (실적발표 등)
        major: true,        // 주요사항보고 (배당, 증자 등)
        exchange: true,     // 거래소공시 (잠정실적 등)
        issue: false        // 발행공시
    })
    const [statusDart, setStatusDart] = useState<'idle' | 'success' | 'error'>('idle')
    const [messageDart, setMessageDart] = useState('')
    const [statusDisclosures, setStatusDisclosures] = useState<'idle' | 'success' | 'error'>('idle')
    const [messageDisclosures, setMessageDisclosures] = useState('')

    const [isSyncingFinancials, setIsSyncingFinancials] = useState(false)
    const [statusFinancials, setStatusFinancials] = useState<'idle' | 'success' | 'error'>('idle')
    const [messageFinancials, setMessageFinancials] = useState('')

    const [activeTab, setActiveTab] = useState<'kiwoom' | 'telegram' | 'schedule' | 'dart'>('kiwoom')

    useEffect(() => {
        const loadKeys = async () => {
            const savedKeys = await window.electronAPI.getApiKeys()
            if (savedKeys) {
                setKeys(savedKeys)
            }

            const savedTgKeys = await window.electronAPI.getTelegramSettings()
            if (savedTgKeys) {
                setTelegramKeys({
                    botToken: savedTgKeys.botToken || '',
                    chatId: savedTgKeys.chatId || '',
                    chartTheme: savedTgKeys.chartTheme || 'dark',
                    chatType: savedTgKeys.chatType || ''
                })
            }

            const savedScheduleSettings = await window.electronAPI.getScheduleSettings()
            if (savedScheduleSettings) {
                setScheduleSettings(savedScheduleSettings)
            }

            // DART 설정 로드
            const savedDartKey = await window.electronAPI.getDartApiKey()
            setDartKey(savedDartKey)

            const savedDartSettings = await window.electronAPI.getDartSettings()
            if (savedDartSettings?.options) {
                setDartOptions(savedDartSettings.options)
            }
        }
        loadKeys()
    }, [])

    const handleSaveDart = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSavingDart(true)
        setStatusDart('idle')
        setMessageDart('DART API 키 저장 중...')
        try {
            await window.electronAPI.saveDartApiKey(dartKey.trim())
            const result = await window.electronAPI.saveDartSettings({
                options: dartOptions
            })
            if (result.success) {
                setStatusDart('success')
                setMessageDart('DART 설정이 저장되었습니다.')
                setTimeout(() => setStatusDart('idle'), 3000)
            }
        } catch (error: any) {
            setStatusDart('error')
            setMessageDart('저장 오류')
        } finally {
            setIsSavingDart(false)
        }
    }

    const handleSyncCorpCodes = async () => {
        setIsSyncingDart(true)
        setStatusDart('idle')
        setMessageDart('기업 고유번호 동기화 중 (DART 서버 호출)...')
        try {
            // DART API 키가 설정되어 있어야 함
            const currentKey = dartKey.trim();
            if (!currentKey) {
                setStatusDart('error');
                setMessageDart('DART API 키를 먼저 입력하고 저장해주세요.');
                return;
            }

            const result = await window.electronAPI.syncDartCorpCodes()
            if (result.success) {
                setStatusDart('success')
                setMessageDart('기업 고유번호 동기화가 완료되었습니다. (SQLite 저장 완료)')
            } else {
                setStatusDart('error')
                setMessageDart(result.error || '동기화 실패 (API 키 확인 필요)')
            }
        } catch (error: any) {
            setStatusDart('error')
            setMessageDart('동기화 중 오류가 발생했습니다.')
        } finally {
            setIsSyncingDart(false)
            setTimeout(() => setStatusDart('idle'), 5000)
        }
    }

    const handleSyncDisclosures = async () => {
        setIsSyncingDisclosures(true)
        setStatusDisclosures('idle')
        setMessageDisclosures('관심종목 공시 일정 동기화 중...')
        try {
            const result = await window.electronAPI.syncDartWatchlistSchedules()
            if (result.success) {
                setStatusDisclosures('success')
                setMessageDisclosures('공시 일정 동기화 완료!')
                // Refresh local store from DB
                useScheduleStore.getState().pullSchedules()
            } else {
                setStatusDisclosures('error')
                setMessageDisclosures(result.error || '동기화 실패')
            }
        } catch (err: any) {
            setStatusDisclosures('error')
            setMessageDisclosures(err.message)
        } finally {
            setIsSyncingDisclosures(false)
        }
    }

    const handleSyncBatchFinancials = async () => {
        setIsSyncingFinancials(true)
        setStatusFinancials('idle')
        setMessageFinancials('10년 재무 데이터 동기화 시작 중...')
        try {
            const symbols = await window.electronAPI.getWatchlistSymbols()
            if (symbols.length === 0) {
                setStatusFinancials('error')
                setMessageFinancials('관심종목이 없습니다.')
                return
            }
            const result = await window.electronAPI.syncBatchFinancials(symbols)
            if (result.success) {
                setStatusFinancials('success')
                setMessageFinancials('10년 재무 데이터 동기화 완료!')
            } else {
                setStatusFinancials('error')
                setMessageFinancials(result.error || '동기화 실패')
            }
        } catch (err: any) {
            setStatusFinancials('error')
            setMessageFinancials(err.message)
        } finally {
            setIsSyncingFinancials(false)
            setTimeout(() => setStatusFinancials('idle'), 5000)
        }
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()

        // 마스킹된 키(****)가 포함되어 있으면 저장을 건너뜁니다.
        if (keys.appkey.includes('*') || keys.secretkey.includes('*')) {
            setStatus('success')
            setMessage('기존 연결 정보가 유지되었습니다.')
            setTimeout(() => setStatus('idle'), 3000)
            return
        }

        setIsSaving(true)
        setStatus('idle')
        setMessage('키움증권 연결 확인 중...')

        try {
            const trimmedKeys = {
                appkey: keys.appkey.trim(),
                secretkey: keys.secretkey.trim()
            }
            const result = await window.electronAPI.saveApiKeys(trimmedKeys)

            if (result.success) {
                setKeys(trimmedKeys)
                setStatus('success')
                setMessage(result.message || '성공적으로 저장되었습니다.')
                setTimeout(() => setStatus('idle'), 3000)
            } else {
                setStatus('error')
                setMessage(result.error || '연결 실패')
            }
        } catch (error: any) {
            setStatus('error')
            setMessage('저장 중 오류가 발생했습니다.')
        } finally {
            setIsSaving(false)
        }
    }

    const handleSaveTelegram = async (e: React.FormEvent) => {
        e.preventDefault()

        if (telegramKeys.botToken.includes('*') || telegramKeys.chatId.includes('*')) {
            setStatusTg('success')
            setMessageTg('기존 텔레그램 연결 정보가 유지되었습니다.')
            setTimeout(() => setStatusTg('idle'), 3000)
            return
        }

        setIsSavingTg(true)
        setStatusTg('idle')
        setMessageTg('텔레그램 설정 저장 중...')

        try {
            const trimmedKeys = {
                botToken: telegramKeys.botToken.trim(),
                chatId: telegramKeys.chatId.trim(),
                chartTheme: telegramKeys.chartTheme || 'dark'
            }
            const result = await window.electronAPI.saveTelegramSettings(trimmedKeys)

            if (result.success) {
                setTelegramKeys(trimmedKeys)
                setStatusTg('success')
                setMessageTg('텔레그램 봇 설정이 저장되었습니다.')
                setTimeout(() => setStatusTg('idle'), 3000)
            } else {
                setStatusTg('error')
                setMessageTg('저장 실패')
            }
        } catch (error: any) {
            setStatusTg('error')
            setMessageTg('저장 중 오류가 발생했습니다.')
        } finally {
            setIsSavingTg(false)
        }
    }

    const handleSaveSchedule = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSavingSchedule(true)
        setStatusSchedule('idle')
        setMessageSchedule('일정 설정 저장 중...')

        try {
            const result = await window.electronAPI.saveScheduleSettings(scheduleSettings)
            if (result.success) {
                setStatusSchedule('success')
                setMessageSchedule('일정 알림 설정이 저장되었습니다.')
                setTimeout(() => setStatusSchedule('idle'), 3000)
            } else {
                setStatusSchedule('error')
                setMessageSchedule('저장 실패')
            }
        } catch (error: any) {
            setStatusSchedule('error')
            setMessageSchedule('저장 중 오류가 발생했습니다.')
        } finally {
            setIsSavingSchedule(false)
        }
    }

    const handleTestMessage = async () => {
        setIsTestingTg(true)
        setStatusTg('idle')
        setMessageTg('테스트 메시지 발송 중...')
        try {
            const result = await window.electronAPI.sendTelegramTestMessage()
            if (result.success) {
                setStatusTg('success')
                setMessageTg('테스트 메시지가 성공적으로 발송되었습니다.')
            } else {
                setStatusTg('error')
                setMessageTg(result.error || '메시지 발송 실패 (설정을 확인하세요)')
            }
        } catch (error: any) {
            setStatusTg('error')
            setMessageTg('메시지 발송 중 오류가 발생했습니다.')
        } finally {
            setIsTestingTg(false)
            setTimeout(() => setStatusTg('idle'), 4000)
        }
    }

    const menuItems = [
        { id: 'kiwoom', label: '키움증권 API', icon: ShieldCheck, color: 'text-primary' },
        { id: 'telegram', label: '텔레그램 연동', icon: Send, color: 'text-blue-500' },
        { id: 'schedule', label: '일정 알림', icon: Bell, color: 'text-amber-500' },
        { id: 'dart', label: 'DART 공시', icon: Database, color: 'text-green-600' },
    ] as const

    return (
        <div className="flex h-full bg-background animate-in fade-in duration-500">
            {/* Sidebar Menu */}
            <aside className="w-64 border-r border-border/50 bg-muted/20 flex flex-col py-8 px-4 gap-2">
                <div className="px-3 mb-6">
                    <h1 className="text-xl font-extrabold tracking-tight">설정</h1>
                    <p className="text-[11px] text-muted-foreground mt-1">앱 환경을 최적화하세요.</p>
                </div>

                <nav className="flex-1 space-y-1">
                    {menuItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${activeTab === item.id
                                ? 'bg-background shadow-sm border border-border text-foreground font-semibold'
                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                                }`}
                        >
                            <item.icon size={18} className={`${activeTab === item.id ? item.color : 'text-muted-foreground/50 group-hover:text-muted-foreground'} transition-colors`} />
                            <span className="text-sm">{item.label}</span>
                        </button>
                    ))}
                </nav>
            </aside>

            {/* Content Area */}
            <main className="flex-1 overflow-y-auto bg-background/50 backdrop-blur-3xl">
                <div className="max-w-3xl mx-auto p-12 space-y-10 animate-in slide-in-from-right-4 fade-in duration-500 delay-75">

                    {activeTab === 'kiwoom' && (
                        <div className="space-y-8">
                            <div className="space-y-1">
                                <h2 className="text-3xl font-bold tracking-tight">키움증권 API</h2>
                                <p className="text-muted-foreground">키움증권 REST API 연동 정보를 설정합니다.</p>
                            </div>

                            <div className="bg-card border border-border/60 rounded-3xl p-8 shadow-sm space-y-8">
                                <form onSubmit={handleSave} className="space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold ml-1">App Key</label>
                                        <input
                                            type="password"
                                            value={keys.appkey}
                                            onChange={(e) => setKeys({ ...keys, appkey: e.target.value })}
                                            placeholder="발급받은 App Key를 입력하세요"
                                            className="w-full bg-muted/30 border border-border rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold ml-1">Secret Key</label>
                                        <input
                                            type="password"
                                            value={keys.secretkey}
                                            onChange={(e) => setKeys({ ...keys, secretkey: e.target.value })}
                                            placeholder="발급받은 Secret Key를 입력하세요"
                                            className="w-full bg-muted/30 border border-border rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
                                        />
                                    </div>

                                    <div className="pt-4 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {isSaving && (
                                                <span className="text-xs text-muted-foreground animate-pulse flex items-center gap-2">
                                                    <RefreshCw size={14} className="animate-spin" /> {message}
                                                </span>
                                            )}
                                            {status === 'success' && (
                                                <span className="text-xs text-green-500 font-medium flex items-center gap-1 bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/20">
                                                    <ShieldCheck size={14} /> {message}
                                                </span>
                                            )}
                                            {status === 'error' && (
                                                <span className="text-xs text-destructive font-medium flex items-center gap-1 bg-destructive/10 px-3 py-1.5 rounded-full border border-destructive/20 max-w-[400px]">
                                                    <AlertCircle size={14} className="shrink-0" /> {message}
                                                </span>
                                            )}
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={isSaving}
                                            className="flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-2xl font-bold hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all shadow-xl shadow-primary/20"
                                        >
                                            {isSaving ? <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={18} />}
                                            저장하기
                                        </button>
                                    </div>
                                </form>

                                <div className="bg-muted/30 rounded-2xl p-6 flex gap-4 items-start border border-border/40">
                                    <AlertCircle className="text-muted-foreground/60 mt-0.5" size={18} />
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold">보안 안내</p>
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                            입력하신 Key는 사용자 PC의 로컬 스토리지에만 안전하게 저장되며, 외부 서버로 전송되지 않습니다.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'telegram' && (
                        <div className="space-y-8">
                            <div className="space-y-1">
                                <h2 className="text-3xl font-bold tracking-tight">텔레그램 연동</h2>
                                <p className="text-muted-foreground">알림 및 차트 전송을 위한 텔레그램 설정을 구성합니다.</p>
                            </div>

                            <div className="bg-card border border-border/60 rounded-3xl p-8 shadow-sm space-y-8">
                                <form onSubmit={handleSaveTelegram} className="space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold ml-1">Bot Token</label>
                                        <input
                                            type="password"
                                            value={telegramKeys.botToken}
                                            onChange={(e) => setTelegramKeys({ ...telegramKeys, botToken: e.target.value })}
                                            placeholder="BotFather에서 발급받은 봇 토큰"
                                            className="w-full bg-muted/30 border border-border rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-muted-foreground/50"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold ml-1 flex items-center justify-between">
                                            <span>Chat ID</span>
                                            {telegramKeys.chatId && (
                                                <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${telegramKeys.chatType === 'private' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
                                                    {telegramKeys.chatType === 'private' ? 'Private' : 'Group/Complex'}
                                                </span>
                                            )}
                                        </label>
                                        <div className="relative group">
                                            <input
                                                type="text"
                                                value={telegramKeys.chatId}
                                                onChange={(e) => setTelegramKeys({ ...telegramKeys, chatId: e.target.value })}
                                                placeholder="사용자 ID 혹은 그룹 ID"
                                                className="w-full bg-muted/30 border border-border rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all pr-14 placeholder:text-muted-foreground/50"
                                            />
                                            {telegramKeys.chatId && (
                                                <button
                                                    type="button"
                                                    onClick={() => setTelegramKeys({ ...telegramKeys, chatId: '', chatType: '' })}
                                                    className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                                                    title="초기화"
                                                >
                                                    <RefreshCw size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <label className="text-sm font-semibold ml-1">차트 배경 테마</label>
                                        <div className="flex gap-4">
                                            {['dark', 'light'].map((theme) => (
                                                <button
                                                    key={theme}
                                                    type="button"
                                                    onClick={async () => {
                                                        setTelegramKeys({ ...telegramKeys, chartTheme: theme })
                                                        await window.electronAPI.saveTelegramTheme(theme)
                                                    }}
                                                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-2xl border transition-all ${(telegramKeys.chartTheme === theme || (theme === 'dark' && !telegramKeys.chartTheme))
                                                        ? 'bg-blue-500/10 border-blue-500 text-blue-600 font-bold'
                                                        : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50'
                                                        }`}
                                                >
                                                    <div className={`w-2 h-2 rounded-full ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} border border-border`} />
                                                    <span className="text-sm capitalize">{theme === 'dark' ? '어두운 테마' : '밝은 테마'}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="pt-4 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {isSavingTg && (
                                                <span className="text-xs text-muted-foreground animate-pulse flex items-center gap-2">
                                                    <RefreshCw size={14} className="animate-spin" /> {messageTg}
                                                </span>
                                            )}
                                            {statusTg === 'success' && (
                                                <span className="text-xs text-green-500 font-medium flex items-center gap-1 bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/20">
                                                    <MessageCircle size={14} /> {messageTg}
                                                </span>
                                            )}
                                            {statusTg === 'error' && (
                                                <span className="text-xs text-destructive font-medium flex items-center gap-1 bg-destructive/10 px-3 py-1.5 rounded-full border border-destructive/20 max-w-[400px]">
                                                    <AlertCircle size={14} className="shrink-0" /> {messageTg}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex gap-3">
                                            <button
                                                type="button"
                                                onClick={handleTestMessage}
                                                disabled={isTestingTg}
                                                className="flex items-center gap-2 bg-muted/50 text-foreground px-6 py-3.5 rounded-2xl font-bold hover:bg-muted active:scale-[0.98] disabled:opacity-50 transition-all border border-border"
                                            >
                                                {isTestingTg ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} className="text-blue-500" />}
                                                테스트 발송
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={isSavingTg}
                                                className="flex items-center gap-2 bg-blue-600 text-white px-8 py-3.5 rounded-2xl font-bold hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all shadow-xl shadow-blue-600/20"
                                            >
                                                {isSavingTg ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
                                                저장하기
                                            </button>
                                        </div>
                                    </div>
                                </form>

                                <div className="bg-muted/30 rounded-2xl p-6 flex gap-4 items-start border border-border/40">
                                    <MessageCircle className="text-muted-foreground/60 mt-0.5" size={18} />
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold">도움말</p>
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                            봇 생성은 <strong>@BotFather</strong>에게, Chat ID 확인은 <strong>@userinfobot</strong>을 통해 가능합니다.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'schedule' && (
                        <div className="space-y-8">
                            <div className="space-y-1">
                                <h2 className="text-3xl font-bold tracking-tight">일정 알림</h2>
                                <p className="text-muted-foreground">매일 지정된 시간에 텔레그램으로 주요 정보를 받아봅니다.</p>
                            </div>

                            <div className="bg-card border border-border/60 rounded-3xl p-8 shadow-sm space-y-8">
                                <form onSubmit={handleSaveSchedule} className="space-y-8">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-3">
                                            <label className="text-sm font-semibold ml-1 flex items-center gap-2">
                                                <Clock size={16} /> 알림 발송 시간
                                            </label>
                                            <input
                                                type="time"
                                                value={scheduleSettings.notificationTime}
                                                onChange={(e) => setScheduleSettings({ ...scheduleSettings, notificationTime: e.target.value })}
                                                className="w-full bg-muted/30 border border-border rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all"
                                            />
                                        </div>

                                        <div className="space-y-4">
                                            <label className="text-sm font-semibold ml-1 flex items-center gap-2">
                                                <Bell size={16} /> 알림 옵션
                                            </label>
                                            <div className="space-y-3">
                                                {[
                                                    { id: 'globalDailyNotify', label: '모든 일정 당일 알람', desc: '개별 설정 무관 전송' },
                                                    { id: 'sendMissedOnStartup', label: '부팅 시 미전송 알람 전송', desc: '시작 시 과거 알람 즉시 처리' }
                                                ].map((opt) => (
                                                    <div
                                                        key={opt.id}
                                                        onClick={() => setScheduleSettings({ ...scheduleSettings, [opt.id]: !scheduleSettings[opt.id as keyof typeof scheduleSettings] })}
                                                        className={`flex items-center gap-3 p-4 rounded-2xl border transition-all cursor-pointer ${scheduleSettings[opt.id as keyof typeof scheduleSettings]
                                                            ? 'bg-amber-500/10 border-amber-500/30'
                                                            : 'bg-muted/30 border-border/40 hover:bg-muted/50'
                                                            }`}
                                                    >
                                                        <div className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${scheduleSettings[opt.id as keyof typeof scheduleSettings]
                                                            ? 'bg-amber-500 border-amber-500 text-white'
                                                            : 'bg-background border-border shadow-inner'
                                                            }`}>
                                                            {scheduleSettings[opt.id as keyof typeof scheduleSettings] && <Save size={12} />}
                                                        </div>
                                                        <div className="flex-1">
                                                            <p className="text-sm font-bold">{opt.label}</p>
                                                            <p className="text-[10px] text-muted-foreground">{opt.desc}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-2 flex items-center justify-between border-t border-border/40 mt-4 pt-8">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    setIsSavingSchedule(true)
                                                    setMessageSchedule('테스트 알림 발송 중...')
                                                    const res = await window.electronAPI.testScheduleSummary()
                                                    if (res.success) {
                                                        setStatusSchedule('success')
                                                        setMessageSchedule('테스트 알림 전송 완료')
                                                    } else {
                                                        setStatusSchedule('error')
                                                        setMessageSchedule('발송 실패')
                                                    }
                                                    setIsSavingSchedule(false)
                                                    setTimeout(() => setStatusSchedule('idle'), 3000)
                                                }}
                                                className="flex items-center gap-2 text-xs text-amber-600 hover:text-amber-700 font-bold px-4 py-2.5 rounded-xl border border-amber-200 hover:bg-amber-50 transition-colors"
                                            >
                                                <Send size={14} /> 즉시 테스트
                                            </button>
                                            {isSavingSchedule && (
                                                <span className="text-xs text-muted-foreground animate-pulse ml-2 flex items-center gap-2">
                                                    <RefreshCw size={14} className="animate-spin" /> {messageSchedule}
                                                </span>
                                            )}
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={isSavingSchedule}
                                            className="flex items-center gap-2 bg-amber-500 text-white px-8 py-3.5 rounded-2xl font-bold hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all shadow-xl shadow-amber-500/20"
                                        >
                                            {isSavingSchedule ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
                                            설정 저장하기
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}

                    {activeTab === 'dart' && (
                        <div className="space-y-8">
                            <div className="space-y-1">
                                <h2 className="text-3xl font-bold tracking-tight">DART 공시</h2>
                                <p className="text-muted-foreground">Open DART 연동 및 기업 고유번호 매핑을 관리합니다.</p>
                            </div>

                            <div className="bg-card border border-border/60 rounded-3xl p-8 shadow-sm space-y-8">
                                <form onSubmit={handleSaveDart} className="space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold ml-1">Certified Key (DART API Key)</label>
                                        <input
                                            type="password"
                                            value={dartKey}
                                            onChange={(e) => setDartKey(e.target.value)}
                                            placeholder="Open DART API 키를 입력하세요"
                                            className="w-full bg-muted/30 border border-border rounded-2xl px-5 py-3.5 focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all placeholder:text-muted-foreground/50"
                                        />
                                    </div>

                                    <div className="space-y-4">
                                        <label className="text-sm font-semibold ml-1 text-muted-foreground">수집할 공시 항목</label>
                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { id: 'regular', label: '정기공시', desc: '사업/분기보고서 (실적발표 등)' },
                                                { id: 'major', label: '주요사항보고', desc: '배당/증자/감자/납입 결정 등' },
                                                { id: 'exchange', label: '거래소공시', desc: '영업실적 잠정치/수주 등' },
                                                { id: 'issue', label: '발행공시', desc: '증권신고서/투자설명서' }
                                            ].map((opt) => (
                                                <div
                                                    key={opt.id}
                                                    onClick={() => setDartOptions({ ...dartOptions, [opt.id]: !dartOptions[opt.id as keyof typeof dartOptions] })}
                                                    className={`flex items-start gap-3 p-4 rounded-2xl border transition-all cursor-pointer ${dartOptions[opt.id as keyof typeof dartOptions]
                                                        ? 'bg-green-500/10 border-green-500/30'
                                                        : 'bg-muted/30 border-border/40 hover:bg-muted/50'
                                                        }`}
                                                >
                                                    <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center border transition-all ${dartOptions[opt.id as keyof typeof dartOptions]
                                                        ? 'bg-green-600 border-green-600 text-white'
                                                        : 'bg-background border-border shadow-inner'
                                                        }`}>
                                                        {dartOptions[opt.id as keyof typeof dartOptions] && <Save size={12} />}
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className="text-sm font-bold">{opt.label}</p>
                                                        <p className="text-[10px] text-muted-foreground leading-tight">{opt.desc}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="pt-4 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {(isSavingDart || isSyncingDart) && (
                                                <span className="text-xs text-muted-foreground animate-pulse flex items-center gap-2">
                                                    <RefreshCw size={14} className="animate-spin" /> {messageDart}
                                                </span>
                                            )}
                                            {statusDart === 'success' && (
                                                <span className="text-xs text-green-500 font-medium flex items-center gap-1 bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/20">
                                                    <ShieldCheck size={14} /> {messageDart}
                                                </span>
                                            )}
                                            {statusDart === 'error' && (
                                                <span className="text-xs text-destructive font-medium flex items-center gap-1 bg-destructive/10 px-3 py-1.5 rounded-full border border-destructive/20 max-w-[400px]">
                                                    <AlertCircle size={14} className="shrink-0" /> {messageDart}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex gap-3">
                                            <button
                                                type="button"
                                                onClick={handleSyncCorpCodes}
                                                disabled={isSyncingDart || !dartKey}
                                                className="flex items-center gap-2 bg-muted/50 text-foreground px-6 py-3.5 rounded-2xl font-bold hover:bg-muted active:scale-[0.98] disabled:opacity-50 transition-all border border-border"
                                            >
                                                {isSyncingDart ? <RefreshCw size={18} className="animate-spin" /> : <RefreshCw size={18} className="text-green-500" />}
                                                코드 동기화
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={isSavingDart}
                                                className="flex items-center gap-2 bg-green-600 text-white px-8 py-3.5 rounded-2xl font-bold hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all shadow-xl shadow-green-600/20"
                                            >
                                                {isSavingDart ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
                                                저장하기
                                            </button>
                                        </div>
                                    </div>
                                </form>

                                <div className="bg-muted/30 rounded-2xl p-6 flex flex-col gap-4 border border-border/40">
                                    <div className="flex gap-4 items-start">
                                        <Database className="text-muted-foreground/60 mt-0.5" size={18} />
                                        <div className="space-y-1">
                                            <p className="text-xs font-bold">동기화 안내</p>
                                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                                최초 1회 '코드 동기화'가 필요합니다. 이후 '공시 일정 동기화'를 통해 관심종목의 최신 일정을 가져올 수 있습니다. (앱 시작 시 자동 실행됨)
                                            </p>
                                        </div>
                                    </div>

                                    <div className="pt-2 border-t border-border/20 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {isSyncingDisclosures && (
                                                <span className="text-[11px] text-muted-foreground animate-pulse flex items-center gap-2">
                                                    <RefreshCw size={12} className="animate-spin" /> {messageDisclosures}
                                                </span>
                                            )}
                                            {statusDisclosures === 'success' && (
                                                <span className="text-[11px] text-green-500 font-medium bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                                                    {messageDisclosures}
                                                </span>
                                            )}
                                            {statusDisclosures === 'error' && (
                                                <span className="text-[11px] text-destructive font-medium bg-destructive/10 px-2 py-1 rounded-full border border-destructive/20">
                                                    {messageDisclosures}
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleSyncDisclosures}
                                            disabled={isSyncingDisclosures || !dartKey}
                                            className="flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-xl text-xs font-bold hover:bg-primary/20 disabled:opacity-50 transition-all border border-primary/20"
                                        >
                                            <RefreshCw size={14} className={isSyncingDisclosures ? 'animate-spin' : ''} />
                                            공시 일정 동기화
                                        </button>
                                    </div>

                                    <div className="pt-2 border-t border-border/20 flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {isSyncingFinancials && (
                                                    <span className="text-[11px] text-muted-foreground animate-pulse flex items-center gap-2">
                                                        <RefreshCw size={12} className="animate-spin" /> {messageFinancials}
                                                    </span>
                                                )}
                                                {statusFinancials === 'success' && (
                                                    <span className="text-[11px] text-green-500 font-medium bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                                                        {messageFinancials}
                                                    </span>
                                                )}
                                                {statusFinancials === 'error' && (
                                                    <span className="text-[11px] text-destructive font-medium bg-destructive/10 px-2 py-1 rounded-full border border-destructive/20">
                                                        {messageFinancials}
                                                    </span>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleSyncBatchFinancials}
                                                disabled={isSyncingFinancials || !dartKey}
                                                className="flex items-center gap-2 bg-blue-500/10 text-blue-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-500/20 disabled:opacity-50 transition-all border border-blue-500/20"
                                            >
                                                <Database size={14} className={isSyncingFinancials ? 'animate-spin' : ''} />
                                                10년 재무정보 일괄 업데이트
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                                            * 관심종목에 등록된 모든 종목의 최근 10개년 사업보고서 데이터를 수집합니다.<br />
                                            * DART API 호출 간격을 고려하여 종목당 약 10~15초가 소요됩니다.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </main>
        </div>
    )
}
