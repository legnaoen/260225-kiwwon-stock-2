import { useState, useEffect } from 'react'
import { Save, ShieldCheck, AlertCircle, RefreshCw, Send, MessageCircle, Bell, Clock, Database, Globe, BrainCircuit, Info, Activity, MonitorSmartphone, Bot, Newspaper } from 'lucide-react'
import { Input } from './ui/Input'
import { Button } from './ui/Button'
import { Switch } from './ui/Switch'
import { useScheduleStore } from '../store/useScheduleStore'
import { useUiStore, FontSizeTier } from '../store/useUiStore'
import ApiDiagnosticsTab from './ApiDiagnosticsTab'
import AiOrchestratorTab from './AiOrchestratorTab'
import NewsHubSettingsTab from './NewsHubSettingsTab'
import TelegramLogsTab from './TelegramLogsTab'

export default function Settings() {
    const [keys, setKeys] = useState({ appkey: '', secretkey: '' })
    const [isSaving, setIsSaving] = useState(false)
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
    const [message, setMessage] = useState('')

    interface TelegramSettings {
        botToken: string;
        chatId: string;
        chartTheme: string;
        chatType: string;
        dailyTopRisingNotify: boolean;
        dailyTopRisingTime1: string;
        dailyTopRisingTime2: string;
        weeklyTopRisingNotify: boolean;
        weeklyTopRisingTime: string;
        monthlyTopRisingNotify: boolean;
        monthlyTopRisingTime: string;
    }

    const [telegramKeys, setTelegramKeys] = useState<TelegramSettings>({
        botToken: '',
        chatId: '',
        chartTheme: 'dark',
        chatType: '',
        dailyTopRisingNotify: false,
        dailyTopRisingTime1: '09:30',
        dailyTopRisingTime2: '14:30',
        weeklyTopRisingNotify: false,
        weeklyTopRisingTime: '10:00',
        monthlyTopRisingNotify: false,
        monthlyTopRisingTime: '12:00'
    })
    const [aiSettings, setAiSettings] = useState({
        geminiKey: '',
        modelName: 'gemini-1.5-flash',
        deepModelName: 'gemini-3.1-pro-preview',
        deepModelAgents: [] as string[],
        lightweightCloudAgents: [] as string[],
        lightweightCloudModel: 'gemini-1.5-flash',
        virtualInitialBalance: 1000000,
        buyStartTime: '09:10',
        buyEndTime: '15:00',
        phase1PassLimit: 10,
        portfolioLimits: {
            buy:       { THEME: 3, MOMENTUM: 3, PULLBACK: 2, REPORT: 2 },
            watchlist: { THEME: 3, MOMENTUM: 3, PULLBACK: 2, REPORT: 2 }
        }
    })
    const [isSavingTg, setIsSavingTg] = useState(false)
    const [statusTg, setStatusTg] = useState<'idle' | 'success' | 'error'>('idle')
    const [messageTg, setMessageTg] = useState('')
    const [isTestingTg, setIsTestingTg] = useState(false)
    const [isTestingTopRising, setIsTestingTopRising] = useState(false)
    const [isTestingPeriodRising, setIsTestingPeriodRising] = useState(false)

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

    const [isSavingAi, setIsSavingAi] = useState(false)
    const [statusAi, setStatusAi] = useState<'idle' | 'success' | 'error'>('idle')
    const [messageAi, setMessageAi] = useState('')
    const [isTestingAi, setIsTestingAi] = useState(false)

    const [activeTab, setActiveTab] = useState<'accounts' | 'strategy' | 'system' | 'diagnostics' | 'telegram' | 'ai-orchestrator' | 'news-hub'>('ai-orchestrator')
    
    // UI Global State
    const { fontSizeTier, setFontSizeTier } = useUiStore()

    const [isTestingYahoo, setIsTestingYahoo] = useState(false)
    const [statusYahoo, setStatusYahoo] = useState<'idle' | 'success' | 'error'>('idle')
    const [messageYahoo, setMessageYahoo] = useState('')

    const [naverKeys, setNaverKeys] = useState({ clientId: '', clientSecret: '' })
    const [isSavingNaver, setIsSavingNaver] = useState(false)
    const [statusNaver, setStatusNaver] = useState<'idle' | 'success' | 'error'>('idle')
    const [messageNaver, setMessageNaver] = useState('')
    const [isTestingNaver, setIsTestingNaver] = useState(false)



    useEffect(() => {
        const loadKeys = async () => {
            const savedKeys = await window.electronAPI.getApiKeys()
            if (savedKeys) {
                setKeys(savedKeys)
            }

            const savedTgKeys = await window.electronAPI.getTelegramSettings()
            if (savedTgKeys) {
                const tgData = savedTgKeys as any;
                setTelegramKeys({
                    botToken: tgData.botToken || '',
                    chatId: tgData.chatId || '',
                    chartTheme: tgData.chartTheme || 'dark',
                    chatType: tgData.chatType || '',
                    dailyTopRisingNotify: tgData.dailyTopRisingNotify || false,
                    dailyTopRisingTime1: tgData.dailyTopRisingTime1 || '09:30',
                    dailyTopRisingTime2: tgData.dailyTopRisingTime2 || '14:30',
                    weeklyTopRisingNotify: tgData.weeklyTopRisingNotify || false,
                    weeklyTopRisingTime: tgData.weeklyTopRisingTime || '10:00',
                    monthlyTopRisingNotify: tgData.monthlyTopRisingNotify || false,
                    monthlyTopRisingTime: tgData.monthlyTopRisingTime || '12:00'
                })
            }

            const savedScheduleSettings = await window.electronAPI.getScheduleSettings()
            if (savedScheduleSettings) {
                setScheduleSettings({
                    notificationTime: savedScheduleSettings.notificationTime || '08:30',
                    globalDailyNotify: savedScheduleSettings.globalDailyNotify || false,
                    sendMissedOnStartup: savedScheduleSettings.sendMissedOnStartup ?? true
                })
            }

            // DART 설정 로드
            try {
                const savedDartKey = await window.electronAPI.getDartApiKey()
                setDartKey(savedDartKey)

                const savedDartSettings = await window.electronAPI.getDartSettings()
                if (savedDartSettings?.options) {
                    setDartOptions(savedDartSettings.options)
                }
            } catch (err) {
                console.warn('[Settings] DART 설정 로드 실패 (기능 비활성화됨):', err)
            }

            const savedAiSettings = await window.electronAPI.getAiSettings()
            if (savedAiSettings) {
                setAiSettings({
                    geminiKey: savedAiSettings.geminiKey || '',
                    modelName: savedAiSettings.modelName || 'gemini-1.5-flash',
                    deepModelName: savedAiSettings.deepModelName || 'gemini-3.1-pro-preview',
                    deepModelAgents: savedAiSettings.deepModelAgents || [],
                    lightweightCloudAgents: savedAiSettings.lightweightCloudAgents || [],
                    lightweightCloudModel: savedAiSettings.lightweightCloudModel || 'gemini-1.5-flash',
                    virtualInitialBalance: savedAiSettings.virtualInitialBalance ?? 1000000,
                    buyStartTime: savedAiSettings.buyStartTime || '09:10',
                    buyEndTime: savedAiSettings.buyEndTime || '15:00',
                    phase1PassLimit: savedAiSettings.phase1PassLimit ?? 10,
                    portfolioLimits: savedAiSettings.portfolioLimits
                        ? (() => {
                            // 구버전 키(SWING/VALUE) 감지 → 새 기준으로 자동 마이그레이션
                            const pl = savedAiSettings.portfolioLimits;
                            if (pl.buy && ('SWING' in pl.buy || 'VALUE' in pl.buy)) {
                                return {
                                    buy:       { THEME: 3, MOMENTUM: 3, PULLBACK: 2, REPORT: 2 },
                                    watchlist: { THEME: 3, MOMENTUM: 3, PULLBACK: 2, REPORT: 2 }
                                };
                            }
                            return pl;
                        })()
                        : { buy: { THEME: 3, MOMENTUM: 3, PULLBACK: 2, REPORT: 2 }, watchlist: { THEME: 3, MOMENTUM: 3, PULLBACK: 2, REPORT: 2 } }
                })
            }

            const savedNaverKeys = await (window.electronAPI as any).getNaverApiKeys()
            if (savedNaverKeys) {
                setNaverKeys(savedNaverKeys)
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
                chartTheme: telegramKeys.chartTheme || 'dark',
                chatType: telegramKeys.chatType || '',
                dailyTopRisingNotify: telegramKeys.dailyTopRisingNotify,
                dailyTopRisingTime1: telegramKeys.dailyTopRisingTime1,
                dailyTopRisingTime2: telegramKeys.dailyTopRisingTime2,
                weeklyTopRisingNotify: telegramKeys.weeklyTopRisingNotify,
                weeklyTopRisingTime: telegramKeys.weeklyTopRisingTime,
                monthlyTopRisingNotify: telegramKeys.monthlyTopRisingNotify,
                monthlyTopRisingTime: telegramKeys.monthlyTopRisingTime
            }
            const result = await (window.electronAPI as any).saveTelegramSettings(trimmedKeys)

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

    const handleSaveAi = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSavingAi(true)
        setStatusAi('idle')
        setMessageAi('AI 설정 저장 중...')
        try {
            await window.electronAPI.saveAiSettings(aiSettings)
            setStatusAi('success')
            setMessageAi('AI 설정이 저장되었습니다.')
            setTimeout(() => setStatusAi('idle'), 3000)
        } catch (error: any) {
            setStatusAi('error')
            setMessageAi('저장 오류')
        } finally {
            setIsSavingAi(false)
        }
    }

    const handleTestAi = async () => {
        if (!aiSettings.geminiKey) {
            setStatusAi('error')
            setMessageAi('API 키를 먼저 입력해주세요.')
            return
        }
        setIsTestingAi(true)
        setStatusAi('idle')
        setMessageAi('Gemini 기본 및 심층 모델 연결 테스트 중...')
        try {
            const result = await window.electronAPI.testAiConnection({
                geminiKey: aiSettings.geminiKey,
                modelName: aiSettings.modelName,
                deepModelName: aiSettings.deepModelName
            })
            if (result.success) {
                setStatusAi('success')
                setMessageAi(result.response)
            } else {
                setStatusAi('error')
                setMessageAi(`연결 실패: ${result.error}`)
            }
        } catch (error: any) {
            setStatusAi('error')
            setMessageAi(`테스트 오류: ${error.message}`)
        } finally {
            setIsTestingAi(false)
        }
    }

    const handleSaveNaver = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSavingNaver(true)
        setStatusNaver('idle')
        setMessageNaver('네이버 API 키 저장 중...')
        try {
            const result = await (window.electronAPI as any).saveNaverApiKeys(naverKeys)
            if (result.success) {
                setStatusNaver('success')
                setMessageNaver('네이버 설정이 저장되었습니다.')
                setTimeout(() => setStatusNaver('idle'), 3000)
            }
        } catch (error: any) {
            setStatusNaver('error')
            setMessageNaver('저장 오류')
        } finally {
            setIsSavingNaver(false)
        }
    }

    const handleTestNaver = async () => {
        setIsTestingNaver(true)
        setStatusNaver('idle')
        setMessageNaver('네이버 API 연결 테스트 중...')
        try {
            const result = await (window.electronAPI as any).testNaverApi(naverKeys)
            if (result.success) {
                setStatusNaver('success')
                setMessageNaver(`연결 성공! 최신 뉴스: ${result.title}`)
            } else {
                setStatusNaver('error')
                setMessageNaver(`연결 실패: ${result.error}`)
            }
        } catch (error: any) {
            setStatusNaver('error')
            setMessageNaver(`테스트 오류: ${error.message}`)
        } finally {
            setIsTestingNaver(false)
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

    const handleTestTopRising = async () => {
        setIsTestingTopRising(true)
        setStatusTg('idle')
        setMessageTg('급등주 TOP 10 테스트 발송 중...')
        try {
            const result = await (window.electronAPI as any).testTelegramTopRising()
            if (result.success) {
                setStatusTg('success')
                setMessageTg('급등주 TOP 10 메시지가 발송되었습니다.')
            } else {
                setStatusTg('error')
                setMessageTg(result.error || '발송 실패 (연결 혹은 API 확인)')
            }
        } catch (error: any) {
            setStatusTg('error')
            setMessageTg('발송 중 오류가 발생했습니다.')
        } finally {
            setIsTestingTopRising(false)
            setTimeout(() => setStatusTg('idle'), 4000)
        }
    }

    const handleTestPeriodRising = async (label: string, days: number) => {
        setIsTestingPeriodRising(true)
        setStatusTg('idle')
        setMessageTg(`${label} TOP 10 테스트 발송 중...`)
        try {
            const result = await (window.electronAPI as any).testTelegramPeriodRising({ label, days })
            if (result.success) {
                setStatusTg('success')
                setMessageTg(`${label} TOP 10 메시지가 발송되었습니다.`)
            } else {
                setStatusTg('error')
                setMessageTg(result.error || '발송 실패')
            }
        } catch (error: any) {
            setStatusTg('error')
            setMessageTg('발송 중 오류가 발생했습니다.')
        } finally {
            setIsTestingPeriodRising(false)
            setTimeout(() => setStatusTg('idle'), 4000)
        }
    }

    const menuItems = [
        { id: 'ai-orchestrator', label: 'AI 관제', icon: Bot, color: 'text-violet-500' },
        { id: 'news-hub', label: '뉴스 허브 설정', icon: Newspaper, color: 'text-sky-500' },
        { id: 'system', label: '시스템 및 UI 설정', icon: MonitorSmartphone, color: 'text-zinc-500' },
        { id: 'accounts', label: '계정 및 인프라', icon: ShieldCheck, color: 'text-blue-500' },
        { id: 'telegram', label: '텔레그램 통합 설정', icon: MessageCircle, color: 'text-sky-500' },
        { id: 'strategy', label: '자동매매 및 전략', icon: BrainCircuit, color: 'text-indigo-500' },
        { id: 'diagnostics', label: '원천 데이터 진단', icon: Info, color: 'text-rose-500' },
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
                        <Button
                            key={item.id}
                            variant={activeTab === item.id ? 'secondary' : 'ghost'}
                            onClick={() => setActiveTab(item.id)}
                            className={`w-full justify-start gap-3 h-11 ${activeTab === item.id ? 'font-bold' : 'text-muted-foreground'}`}
                        >
                            <item.icon size={18} className={`${activeTab === item.id ? item.color : 'text-muted-foreground/60'} transition-colors`} />
                            {item.label}
                        </Button>
                    ))}
                </nav>
            </aside>

            {/* Content Area */}
            <main className={`flex-1 overflow-y-auto bg-background/50 backdrop-blur-3xl ${activeTab === 'diagnostics' || activeTab === 'ai-orchestrator' ? 'h-full p-0 relative' : 'p-12'}`}>
                {activeTab === 'diagnostics' ? (
                    <ApiDiagnosticsTab />
                ) : activeTab === 'ai-orchestrator' ? (
                    <AiOrchestratorTab />
                ) : activeTab === 'news-hub' ? (
                    <div className="max-w-3xl mx-auto animate-in slide-in-from-right-4 fade-in duration-500 delay-75 py-10">
                        <NewsHubSettingsTab />
                    </div>
                ) : (
                    <div className="max-w-3xl mx-auto space-y-10 animate-in slide-in-from-right-4 fade-in duration-500 delay-75">

                        {activeTab === 'accounts' && (
                            <div className="space-y-12">
                                {/* Kiwoom Section */}
                                <div className="space-y-8">
                                <div className="space-y-1">
                                    <h2 className="text-3xl font-bold tracking-tight">키움증권 API</h2>
                                    <p className="text-muted-foreground">키움증권 REST API 연동 정보를 설정합니다.</p>
                                </div>

                                <div className="border border-border/30 rounded-xl p-8 bg-background space-y-8">
                                    <form onSubmit={handleSave} className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-sm font-semibold ml-1">App Key</label>
                                            <Input
                                                type="password"
                                                value={keys.appkey}
                                                onChange={(e) => setKeys({ ...keys, appkey: e.target.value })}
                                                placeholder="발급받은 App Key를 입력하세요"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-sm font-semibold ml-1">Secret Key</label>
                                            <Input
                                                type="password"
                                                value={keys.secretkey}
                                                onChange={(e) => setKeys({ ...keys, secretkey: e.target.value })}
                                                placeholder="발급받은 Secret Key를 입력하세요"
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

                                            <Button
                                                type="submit"
                                                disabled={isSaving}
                                            >
                                                {isSaving ? <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" /> : <Save size={18} className="mr-2" />}
                                                저장하기
                                            </Button>
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
                        </div>
                    )}

                        {activeTab === 'telegram' && (
                            <div className="space-y-8">
                                <div className="space-y-1">
                                    <h2 className="text-3xl font-bold tracking-tight">텔레그램 연동</h2>
                                    <p className="text-muted-foreground">알림 및 차트 전송을 위한 텔레그램 설정을 구성합니다.</p>
                                </div>

                                <div className="border border-border/30 rounded-xl p-8 bg-background space-y-8">
                                    <form onSubmit={handleSaveTelegram} className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-sm font-semibold ml-1">Bot Token</label>
                                            <Input
                                                type="password"
                                                value={telegramKeys.botToken}
                                                onChange={(e) => setTelegramKeys({ ...telegramKeys, botToken: e.target.value })}
                                                placeholder="BotFather에서 발급받은 봇 토큰"
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
                                                <Input
                                                    type="text"
                                                    value={telegramKeys.chatId}
                                                    onChange={(e) => setTelegramKeys({ ...telegramKeys, chatId: e.target.value })}
                                                    placeholder="사용자 ID 혹은 그룹 ID"
                                                    className="pr-14"
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

                                        <div className="space-y-6 pt-4 border-t border-border/40">
                                            <div className="flex items-center justify-between">
                                                <div className="space-y-1">
                                                    <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
                                                        <Activity size={16} className="text-blue-500" /> 당일 급등주 TOP 10 알림
                                                    </h3>
                                                    <p className="text-[11px] text-muted-foreground">지정된 시간에 당일 상승률 상위 종목을 요약하여 전송합니다.</p>
                                                </div>
                                                <Switch
                                                    checked={telegramKeys.dailyTopRisingNotify}
                                                    onChange={(checked) => setTelegramKeys({ ...telegramKeys, dailyTopRisingNotify: checked })}
                                                />
                                            </div>

                                            {telegramKeys.dailyTopRisingNotify && (
                                                <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-300">
                                                    <div className="space-y-2">
                                                        <label className="text-xs font-semibold ml-1 text-muted-foreground uppercase flex items-center gap-1">
                                                            <Clock size={12} /> 알림 시간 1
                                                        </label>
                                                        <Input
                                                            type="time"
                                                            value={telegramKeys.dailyTopRisingTime1}
                                                            onChange={(e) => setTelegramKeys({ ...telegramKeys, dailyTopRisingTime1: e.target.value })}
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-xs font-semibold ml-1 text-muted-foreground uppercase flex items-center gap-1">
                                                            <Clock size={12} /> 알림 시간 2
                                                        </label>
                                                        <Input
                                                            type="time"
                                                            value={telegramKeys.dailyTopRisingTime2}
                                                            onChange={(e) => setTelegramKeys({ ...telegramKeys, dailyTopRisingTime2: e.target.value })}
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            {telegramKeys.dailyTopRisingNotify && (
                                                <div className="flex justify-start">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={handleTestTopRising}
                                                        disabled={isTestingTopRising}
                                                        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
                                                    >
                                                        {isTestingTopRising ? <RefreshCw size={14} className="animate-spin mr-2" /> : <Send size={14} className="mr-2" />}
                                                        당일 급등주 TOP 10 즉시 테스트
                                                    </Button>
                                                </div>
                                            )}

                                            {/* 주간 및 월간 알림 삭제 블록 */}
                                            <div className="pt-4 border-t border-border/40 space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="space-y-1">
                                                        <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
                                                            <Activity size={16} className="text-indigo-500" /> 주간 수익률 TOP 10 알림
                                                        </h3>
                                                        <p className="text-[11px] text-muted-foreground">매일 지정된 시간에 최근 1주일간 수익률 상위 종목을 전송합니다.</p>
                                                    </div>
                                                    <Switch
                                                        checked={telegramKeys.weeklyTopRisingNotify}
                                                        onChange={(checked) => setTelegramKeys({ ...telegramKeys, weeklyTopRisingNotify: checked })}
                                                    />
                                                </div>
                                                {telegramKeys.weeklyTopRisingNotify && (
                                                    <div className="space-y-4">
                                                        <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-300">
                                                            <div className="space-y-2">
                                                                <label className="text-xs font-semibold ml-1 text-muted-foreground uppercase flex items-center gap-1">
                                                                    <Clock size={12} /> 알림 시간
                                                                </label>
                                                                <Input
                                                                    type="time"
                                                                    value={telegramKeys.weeklyTopRisingTime}
                                                                    onChange={(e) => setTelegramKeys({ ...telegramKeys, weeklyTopRisingTime: e.target.value })}
                                                                />
                                                            </div>
                                                            <div className="flex items-end">
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => handleTestPeriodRising('주간(1주일)', 5)}
                                                                    disabled={isTestingPeriodRising}
                                                                    className="w-full text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 border-indigo-200"
                                                                >
                                                                    {isTestingPeriodRising ? <RefreshCw size={14} className="animate-spin mr-2" /> : <Send size={14} className="mr-2" />}
                                                                    주간 TOP 10 테스트
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="pt-4 border-t border-border/40 space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="space-y-1">
                                                        <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
                                                            <Activity size={16} className="text-purple-500" /> 월간 수익률 TOP 10 알림
                                                        </h3>
                                                        <p className="text-[11px] text-muted-foreground">매일 지정된 시간에 최근 1개월간 수익률 상위 종목을 전송합니다.</p>
                                                    </div>
                                                    <Switch
                                                        checked={telegramKeys.monthlyTopRisingNotify}
                                                        onChange={(checked) => setTelegramKeys({ ...telegramKeys, monthlyTopRisingNotify: checked })}
                                                    />
                                                </div>
                                                {telegramKeys.monthlyTopRisingNotify && (
                                                    <div className="space-y-4">
                                                        <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-300">
                                                            <div className="space-y-2">
                                                                <label className="text-xs font-semibold ml-1 text-muted-foreground uppercase flex items-center gap-1">
                                                                    <Clock size={12} /> 알림 시간
                                                                </label>
                                                                <Input
                                                                    type="time"
                                                                    value={telegramKeys.monthlyTopRisingTime}
                                                                    onChange={(e) => setTelegramKeys({ ...telegramKeys, monthlyTopRisingTime: e.target.value })}
                                                                />
                                                            </div>
                                                            <div className="flex items-end">
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => handleTestPeriodRising('월간(1개월)', 20)}
                                                                    disabled={isTestingPeriodRising}
                                                                    className="w-full text-purple-600 hover:text-purple-700 hover:bg-purple-50 border-purple-200"
                                                                >
                                                                    {isTestingPeriodRising ? <RefreshCw size={14} className="animate-spin mr-2" /> : <Send size={14} className="mr-2" />}
                                                                    월간 TOP 10 테스트
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
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
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={handleTestMessage}
                                                    disabled={isTestingTg}
                                                    className="px-6 h-12 shadow-sm"
                                                >
                                                    {isTestingTg ? <RefreshCw size={18} className="animate-spin mr-2" /> : <Send size={18} className="text-blue-500 mr-2" />}
                                                    테스트 발송
                                                </Button>
                                                <Button
                                                    type="submit"
                                                    disabled={isSavingTg}
                                                    className="px-8 h-12 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                                                >
                                                    {isSavingTg ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" /> : <Save size={18} className="mr-2" />}
                                                    저장하기
                                                </Button>
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

                        {activeTab === 'telegram' && (
                            <div className="pt-12 border-t border-border/40">
                                <div className="space-y-8">
                                <div className="space-y-1">
                                    <h2 className="text-3xl font-bold tracking-tight">일정 알림</h2>
                                    <p className="text-muted-foreground">매일 지정된 시간에 텔레그램으로 주요 정보를 받아봅니다.</p>
                                </div>

                                <div className="border border-border/30 rounded-xl p-8 bg-background space-y-8">
                                    <form onSubmit={handleSaveSchedule} className="space-y-8">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            <div className="space-y-3">
                                                <label className="text-sm font-semibold ml-1 flex items-center gap-2">
                                                    <Clock size={16} /> 알림 발송 시간
                                                </label>
                                                <Input
                                                    type="time"
                                                    value={scheduleSettings.notificationTime}
                                                    onChange={(e) => setScheduleSettings({ ...scheduleSettings, notificationTime: e.target.value })}
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

                                            <Button
                                                type="submit"
                                                disabled={isSavingSchedule}
                                                className="px-8 bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                                            >
                                                {isSavingSchedule ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" /> : <Save size={18} className="mr-2" />}
                                                설정 저장하기
                                            </Button>
                                        </div>
                                    </form>
                                </div>
                                </div>
                                <div className="pt-12 border-t border-border/40">
                                    <TelegramLogsTab />
                                </div>
                            </div>
                        )}

                        {activeTab === 'accounts' && (
                            <div className="pt-12 border-t border-border/40">
                                <div className="space-y-8">
                                <div className="space-y-1">
                                    <h2 className="text-3xl font-bold tracking-tight">DART 공시</h2>
                                    <p className="text-muted-foreground">Open DART 연동 및 기업 고유번호 매핑을 관리합니다.</p>
                                </div>

                                <div className="border border-border/30 rounded-xl p-8 bg-background space-y-8">
                                    <form onSubmit={handleSaveDart} className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-sm font-semibold ml-1">Certified Key (DART API Key)</label>
                                            <Input
                                                type="password"
                                                value={dartKey}
                                                onChange={(e) => setDartKey(e.target.value)}
                                                placeholder="Open DART API 키를 입력하세요"
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
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={handleSyncCorpCodes}
                                                    disabled={isSyncingDart || !dartKey}
                                                    className="px-6 shadow-sm"
                                                >
                                                    {isSyncingDart ? <RefreshCw size={18} className="animate-spin mr-2" /> : <RefreshCw size={18} className="text-green-500 mr-2" />}
                                                    코드 동기화
                                                </Button>
                                                <Button
                                                    type="submit"
                                                    disabled={isSavingDart}
                                                    className="px-8 bg-green-600 text-white hover:bg-green-700 shadow-sm"
                                                >
                                                    {isSavingDart ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" /> : <Save size={18} className="mr-2" />}
                                                    저장하기
                                                </Button>
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
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                size="sm"
                                                onClick={handleSyncDisclosures}
                                                disabled={isSyncingDisclosures || !dartKey}
                                                className="text-primary bg-primary/10 hover:bg-primary/20 border-primary/20"
                                            >
                                                <RefreshCw size={14} className={isSyncingDisclosures ? 'animate-spin mr-2' : 'mr-2'} />
                                                공시 일정 동기화
                                            </Button>
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
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={handleSyncBatchFinancials}
                                                    disabled={isSyncingFinancials || !dartKey}
                                                    className="text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/20"
                                                >
                                                    <Database size={14} className={isSyncingFinancials ? 'animate-spin mr-2' : 'mr-2'} />
                                                    10년 재무정보 일괄 업데이트
                                                </Button>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                                                * 관심종목에 등록된 모든 종목의 최근 10개년 사업보고서 데이터를 수집합니다.<br />
                                                * DART API 호출 간격을 고려하여 종목당 약 10~15초가 소요됩니다.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                </div>
                            </div>
                        )}
                        {activeTab === 'strategy' && (
                            <div className="space-y-8">
                                <div className="space-y-1">
                                    <h2 className="text-3xl font-bold tracking-tight">AI 인공지능 설정</h2>
                                    <p className="text-muted-foreground">자동매매 전략 복기 및 종목 분석을 위한 AI 모델을 설정합니다.</p>
                                </div>

                                <div className="border border-border/30 rounded-xl p-8 bg-background">
                                    <form onSubmit={handleSaveAi} className="space-y-8">
                                        <div className="space-y-6">
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-sm font-bold flex items-center gap-2">
                                                        Google Gemini API Key
                                                        <a
                                                            href="https://aistudio.google.com/app/apikey"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-[10px] text-primary hover:underline font-normal"
                                                        >
                                                            (키 발급받기)
                                                        </a>
                                                    </label>
                                                </div>
                                                <Input
                                                    type="password"
                                                    value={aiSettings.geminiKey}
                                                    onChange={(e) => setAiSettings({ ...aiSettings, geminiKey: e.target.value })}
                                                    placeholder="AI Studio에서 발급받은 API 키를 입력하세요"
                                                />
                                            </div>

                                            <div className="space-y-6">
                                                <div className="space-y-3">
                                                    <label className="text-sm font-bold text-muted-foreground">기본 AI 모델 (Fallback)</label>
                                                    <select
                                                        value={aiSettings.modelName}
                                                        onChange={(e) => setAiSettings({ ...aiSettings, modelName: e.target.value })}
                                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors font-medium"
                                                    >
                                                        <optgroup label="Gemini 3 최신 라인업 (Preview)">
                                                            <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (고급 지능 및 에이전트 특화)</option>
                                                            <option value="gemini-3-flash-preview">Gemini 3 Flash (프런티어급 성능 가성비)</option>
                                                            <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite (경량형 초고속)</option>
                                                        </optgroup>
                                                        <optgroup label="Gemini 2.5 안정화 버전 (GA)">
                                                            <option value="gemini-2.5-pro">Gemini 2.5 Pro (안정적 추천)</option>
                                                            <option value="gemini-2.5-flash">Gemini 2.5 Flash (표준 속도)</option>
                                                            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (경량형 가성비)</option>
                                                        </optgroup>
                                                    </select>
                                                    <p className="text-[11px] text-muted-foreground">선택되지 않은 모든 AI 크론잡이 이 모델을 사용합니다.</p>
                                                </div>

                                                <div className="space-y-3">
                                                    <label className="text-sm font-bold text-primary">심층 AI 모델 (High Intelligence)</label>
                                                    <select
                                                        value={aiSettings.deepModelName}
                                                        onChange={(e) => setAiSettings({ ...aiSettings, deepModelName: e.target.value })}
                                                        className="flex h-10 w-full rounded-md border border-primary/50 bg-primary/5 px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition-colors font-medium"
                                                    >
                                                        <optgroup label="Gemini 3 최신 라인업 (Preview)">
                                                            <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (고급 지능 및 에이전트 특화)</option>
                                                            <option value="gemini-3-flash-preview">Gemini 3 Flash (프런티어급 성능 가성비)</option>
                                                            <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite (경량형 초고속)</option>
                                                        </optgroup>
                                                        <optgroup label="Gemini 2.5 안정화 버전 (GA)">
                                                            <option value="gemini-2.5-pro">Gemini 2.5 Pro (안정적 추천)</option>
                                                            <option value="gemini-2.5-flash">Gemini 2.5 Flash (표준 속도)</option>
                                                            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (경량형 가성비)</option>
                                                        </optgroup>
                                                    </select>
                                                    <p className="text-[11px] text-muted-foreground">아래에서 체크된 주요 에이전트만 이 모델을 사용합니다.</p>
                                                </div>
                                            </div>

                                            <div className="space-y-4 pt-4 border-t border-border/30">
                                                <label className="text-sm font-bold">심층 AI 모델 적용 대상 (Whitelist)</label>
                                                <div className="space-y-3">
                                                    {[
                                                        {
                                                            name: "📈 시황 AI",
                                                            agents: [
                                                                { id: 'MCA', label: '시장 상황 판단' },
                                                                { id: 'MRA', label: '시장 회고 작성' }
                                                            ]
                                                        },
                                                        {
                                                            name: "🔥 주도주 AI",
                                                            agents: [
                                                                { id: 'TRACK_A', label: 'Track A (진성 대장)' },
                                                                { id: 'TRACK_B,TRACK_C', label: 'Track B/C (알파 역상관)' },
                                                                { id: 'TRACK_D,TRACK_E', label: 'Track D/E (당일 급등)' },
                                                                { id: 'PORTFOLIO_JUDGE', label: '종합 심사 AI' }
                                                            ]
                                                        },
                                                        {
                                                            name: "🧬 테마 AI",
                                                            agents: [
                                                                { id: 'THEME', label: '테마 AI' }
                                                            ]
                                                        },
                                                        {
                                                            name: "🚀 텐배거 AI",
                                                            agents: [
                                                                { id: 'MOONSHOT_VALIDATION', label: '텐배거 스캐너 (1차 심사)' },
                                                                { id: 'MOONSHOT_TRACKER', label: '액티브 트래킹 (일일 리뷰)' }
                                                            ]
                                                        },
                                                        {
                                                            name: "💼 종목 AI (포트폴리오)",
                                                            agents: [
                                                                { id: 'PORTFOLIO_MANAGER', label: 'PM2 리밸런싱' },
                                                                { id: 'PM3_SWAP_REVIEW', label: 'PM3 교체 스왑 심사' }
                                                            ]
                                                        },
                                                        {
                                                            name: "💬 기타 도구",
                                                            agents: [
                                                                { id: 'COPILOT', label: 'AI 코파일럿' }
                                                            ]
                                                        }
                                                    ].map((category, idx) => (
                                                        <div key={idx} className="bg-secondary/20 p-4 rounded-xl border border-border/50">
                                                            <div className="text-xs font-bold text-muted-foreground mb-3">{category.name}</div>
                                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                                {category.agents.map(agent => (
                                                                    <label key={agent.id} className="flex items-center space-x-2 cursor-pointer p-2 hover:bg-background/50 rounded-lg transition-colors">
                                                                        <input
                                                                            type="checkbox"
                                                                            className="rounded border-gray-300 text-primary focus:ring-primary w-4 h-4 flex-shrink-0"
                                                                            checked={agent.id.split(',').every(id => aiSettings.deepModelAgents.includes(id))}
                                                                            onChange={(e) => {
                                                                                const checked = e.target.checked;
                                                                                const ids = agent.id.split(',');
                                                                                setAiSettings(prev => {
                                                                                    let newAgents = [...prev.deepModelAgents];
                                                                                    if (checked) {
                                                                                        ids.forEach(i => { if (!newAgents.includes(i)) newAgents.push(i) });
                                                                                    } else {
                                                                                        newAgents = newAgents.filter(i => !ids.includes(i));
                                                                                    }
                                                                                    return { ...prev, deepModelAgents: newAgents };
                                                                                });
                                                                            }}
                                                                        />
                                                                        <span className="text-xs font-medium text-foreground">{agent.label}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="space-y-4 pt-4 border-t border-border/30">
                                                <div className="space-y-1">
                                                    <label className="text-sm font-bold text-teal-600 flex items-center gap-2">
                                                        <MonitorSmartphone size={16} /> 클라우드 전환 대상 로컬 크론 (Whitelist)
                                                    </label>
                                                    <p className="text-[11px] text-muted-foreground">원래 로컬 AI(LM Studio)로 동작하는 크론 작업 중, <strong>Gemini 클라우드로 우회하여 초고속 병렬 처리</strong>를 적용할 작업을 선택합니다. 미선택 시 기본 로컬 AI로 동작합니다.</p>
                                                </div>
                                                
                                                <div className="flex items-center gap-3 bg-teal-500/10 p-3 rounded-lg border border-teal-500/20">
                                                    <label className="text-xs font-bold text-teal-800 shrink-0">적용할 클라우드 모델 :</label>
                                                    <select
                                                        value={(aiSettings as any).lightweightCloudModel || 'gemini-1.5-flash'}
                                                        onChange={(e) => setAiSettings({ ...aiSettings, lightweightCloudModel: e.target.value })}
                                                        className="flex h-8 w-full max-w-[280px] rounded-md border border-teal-500/30 bg-background px-3 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors font-medium"
                                                    >
                                                        <optgroup label="Gemini 3 최신 라인업 (Preview)">
                                                            <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (고급 지능 및 에이전트 특화)</option>
                                                            <option value="gemini-3-flash-preview">Gemini 3 Flash (프런티어급 성능 가성비)</option>
                                                            <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite (경량형 초고속)</option>
                                                        </optgroup>
                                                        <optgroup label="Gemini 2.5 안정화 버전 (GA)">
                                                            <option value="gemini-2.5-pro">Gemini 2.5 Pro (안정적 추천)</option>
                                                            <option value="gemini-2.5-flash">Gemini 2.5 Flash (표준 속도)</option>
                                                            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (경량형 가성비)</option>
                                                        </optgroup>
                                                    </select>
                                                </div>

                                                <div className="space-y-3">
                                                    {[
                                                        {
                                                            name: "📈 시황 AI",
                                                            agents: [
                                                                { id: 'ANALYST_CHART,ANALYST_NEWS', label: '시황 판단 보조 (차트/뉴스)' },
                                                                { id: 'MRA_DAILY_FEEDBACK,MRA_DAILY_RETRO', label: '시장 회고 보조 (피드백)' }
                                                            ]
                                                        },
                                                        {
                                                            name: "🔥 주도주 AI",
                                                            agents: [
                                                                { id: 'TRACK_A_GEMMA_RESEARCH', label: 'Track A 심층 리서치 (병렬 권장)' },
                                                                { id: 'TRACK_B_GEMMA_RESEARCH,TRACK_C_GEMMA_RESEARCH,TRACK_D_GEMMA_RESEARCH,TRACK_E_GEMMA_RESEARCH', label: 'Track B~E 심층 리서치 (병렬 권장)' }
                                                            ]
                                                        },
                                                        {
                                                            name: "🤖 관제 센터 (AI 스웜)",
                                                            agents: [
                                                                { id: 'SWARM_MONITOR,INTRADAY_MONITOR', label: '장중 스웜 패널 (다중 투표)' }
                                                            ]
                                                        },
                                                        {
                                                            name: "📰 뉴스 허브",
                                                            agents: [
                                                                { id: 'ITA', label: '이슈 트래커 (뉴스/공시 전처리)' }
                                                            ]
                                                        },
                                                        {
                                                            name: "💬 기타 도구",
                                                            agents: [
                                                                { id: 'COPILOT', label: 'AI 코파일럿 (로컬 백업)' }
                                                            ]
                                                        }
                                                    ].map((category, idx) => (
                                                        <div key={idx} className="bg-teal-500/5 p-4 rounded-xl border border-teal-500/20">
                                                            <div className="text-xs font-bold text-teal-700/70 mb-3">{category.name}</div>
                                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                                {category.agents.map(agent => (
                                                                    <label key={agent.id} className="flex items-center space-x-2 cursor-pointer p-2 hover:bg-white/50 rounded-lg transition-colors">
                                                                        <input
                                                                            type="checkbox"
                                                                            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-4 h-4 flex-shrink-0"
                                                                            checked={agent.id.split(',').every(id => (aiSettings as any).lightweightCloudAgents?.includes(id))}
                                                                            onChange={(e) => {
                                                                                const checked = e.target.checked;
                                                                                const ids = agent.id.split(',');
                                                                                setAiSettings(prev => {
                                                                                    let newAgents = [...(prev as any).lightweightCloudAgents || []];
                                                                                    if (checked) {
                                                                                        ids.forEach(i => { if (!newAgents.includes(i)) newAgents.push(i) });
                                                                                    } else {
                                                                                        newAgents = newAgents.filter(i => !ids.includes(i));
                                                                                    }
                                                                                    return { ...prev, lightweightCloudAgents: newAgents };
                                                                                });
                                                                            }}
                                                                        />
                                                                        <span className="text-xs font-medium text-foreground">{agent.label}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>

                                                <div className="bg-muted/30 rounded-xl p-4 flex gap-3 items-start border border-border/40 mt-2">
                                                    <Info className="text-teal-600 mt-0.5 shrink-0" size={16} />
                                                    <div className="space-y-1">
                                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                                            체크된 항목은 로컬 LM Studio 대신 <strong>기본 AI 모델(Gemini Flash 등)</strong>을 사용하여 API로 처리됩니다. 특히 종목 리서치 체크 시 <strong>병렬(Promise.all) 처리</strong>가 활성화되어 실행 속도가 수십 배 개선됩니다.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>



                                        </div>

                                        <div className="flex gap-4">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={handleTestAi}
                                                disabled={isTestingAi || isSavingAi}
                                                className="flex-1 h-12 text-base text-indigo-500 shadow-sm"
                                            >
                                                {isTestingAi ? <RefreshCw size={18} className="animate-spin mr-2" /> : <Send size={18} className="mr-2" />}
                                                연결 테스트
                                            </Button>
                                            <Button
                                                type="submit"
                                                disabled={isSavingAi || isTestingAi}
                                                className="flex-[2] h-12 text-base bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                                            >
                                                {isSavingAi ? <RefreshCw size={20} className="animate-spin mr-2" /> : <Save size={20} className="mr-2" />}
                                                AI 설정 저장하기
                                            </Button>
                                        </div>

                                        {messageAi && (
                                            <div className={`p-4 rounded-xl border text-xs flex items-start gap-2 animate-in fade-in slide-in-from-top-1 ${statusAi === 'success' ? 'bg-green-500/5 border-green-500/20 text-green-600' : 'bg-destructive/5 border-destructive/20 text-destructive'}`}>
                                                {statusAi === 'success' ? <ShieldCheck size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                                                <div className="whitespace-pre-line">{messageAi}</div>
                                            </div>
                                        )}
                                        <div className="p-6 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl space-y-3">
                                            <h4 className="text-sm font-bold text-indigo-600 flex items-center gap-2">
                                                <Info size={14} />
                                                AI 활용 가이드
                                            </h4>
                                            <ul className="text-xs text-muted-foreground space-y-2 list-disc list-inside leading-relaxed">
                                                <li>입력하신 API 키는 사용자 PC의 로컬 저장소에만 안전하게 보관됩니다.</li>
                                                <li>장 마감 후 진행되는 <strong>'AI 전략 복기'</strong>에서 활약하게 됩니다.</li>
                                                <li>Gemini 1.5/2.0 Flash 모델은 대부분의 무료 티어에서도 충분한 속도를 제공합니다.</li>
                                            </ul>
                                        </div>
                                    </form>
                            </div>
                        </div>
                    )}

                    {activeTab === 'system' && (
                        <div className="pt-12 border-t border-border/40 animate-in fade-in slide-in-from-bottom-2">
                            <div className="space-y-8">
                            <div className="space-y-1">
                                <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                                    <MonitorSmartphone className="text-zinc-500" size={32} />
                                    시스템 및 UI 테마
                                </h1>
                                <p className="text-muted-foreground">화면 표시 배율(글꼴 크기) 등 앱 전역 환경설정을 관리합니다.</p>
                            </div>

                            <div className="border border-border/30 rounded-xl p-8 bg-background space-y-8">
                                <div className="space-y-6">
                                    <h2 className="text-xl font-bold">화면 표시 배율 (UI Zoom)</h2>
                                    <p className="text-sm text-muted-foreground -mt-3">
                                        VSCode나 트레이딩 뷰어처럼 좁고 밀도 높은 화면 구성을 원하신다면 다소 작은 폰트를 선택하세요.<br/>
                                        이 설정은 즉시 시각적으로 적용되며 브라우저 로컬 저장소에 영구 보존됩니다.
                                    </p>
                                    
                                    <div className="grid grid-cols-4 gap-4 mt-6">
                                        {(['small', 'medium', 'large', 'xlarge'] as FontSizeTier[]).map((tier) => (
                                            <button
                                                key={tier}
                                                onClick={() => setFontSizeTier(tier)}
                                                className={`flex flex-col items-center gap-4 py-8 px-4 rounded-xl border-2 transition-all duration-200 ${
                                                    fontSizeTier === tier 
                                                        ? 'border-primary bg-primary/5 shadow-sm' 
                                                        : 'border-border/50 bg-background hover:border-primary/30 hover:bg-muted/10'
                                                }`}
                                            >
                                                <div className="flex items-center justify-center h-16 w-16 bg-muted/30 rounded-full">
                                                    <span className={`font-bold ${tier === 'small' ? 'text-xs' : tier === 'medium' ? 'text-base' : tier === 'large' ? 'text-xl' : 'text-3xl'}`}>
                                                        Aa
                                                    </span>
                                                </div>
                                                <div className="text-center">
                                                    <div className="font-bold capitalize">{tier}</div>
                                                    <div className="text-xs text-muted-foreground mt-1">
                                                        {tier === 'small' && '고밀도 14px'}
                                                        {tier === 'medium' && '기본 16px'}
                                                        {tier === 'large' && '크게 18px'}
                                                        {tier === 'xlarge' && '매우 크게 20px'}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            </div>
                        </div>
                    )}

                        {activeTab === 'accounts' && (
                            <div className="pt-12 border-t border-border/40">
                                <div className="space-y-8">
                                <div className="space-y-1">
                                    <h2 className="text-3xl font-bold tracking-tight">외부 API 연동</h2>
                                    <p className="text-muted-foreground">매크로 및 차트 분석을 위한 글로벌 데이터 소스를 관리합니다.</p>
                                </div>

                                <div className="border border-border/30 rounded-xl p-8 bg-background space-y-8">
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between p-6 bg-muted/20 border border-border/40 rounded-2xl group hover:border-purple-500/30 transition-all">
                                            <div className="flex items-center gap-4">
                                                <div className="p-3 bg-purple-500/10 rounded-xl">
                                                    <Globe className="text-purple-500" size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold">Yahoo Finance</h3>
                                                    <p className="text-xs text-muted-foreground">10년 주가 데이터 및 글로벌 지수 (별도 인증 불필요)</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                {statusYahoo === 'success' && (
                                                    <span className="text-[11px] font-bold text-green-500 bg-green-500/10 px-3 py-1 rounded-full border border-green-500/20">
                                                        연결됨
                                                    </span>
                                                )}
                                                {statusYahoo === 'error' && (
                                                    <span className="text-[11px] font-bold text-destructive bg-destructive/10 px-3 py-1 rounded-full border border-destructive/20">
                                                        연결 오류
                                                    </span>
                                                )}
                                                <Button
                                                    onClick={async () => {
                                                        setIsTestingYahoo(true)
                                                        setStatusYahoo('idle')
                                                        try {
                                                            const result = await window.electronAPI.testYahooFinance()
                                                            if (result.success) {
                                                                setStatusYahoo('success')
                                                                setMessageYahoo(`연결 성공: 삼성전자 10년치 데이터(${result.count}건) 수신 완료`)
                                                            } else {
                                                                setStatusYahoo('error')
                                                                setMessageYahoo(result.error || '연결 실패')
                                                            }
                                                        } catch (e) {
                                                            setStatusYahoo('error')
                                                            setMessageYahoo('연결 중 오류 발생')
                                                        } finally {
                                                            setIsTestingYahoo(false)
                                                        }
                                                    }}
                                                    disabled={isTestingYahoo}
                                                    className="bg-purple-600 hover:bg-purple-700 text-white shadow-sm px-5"
                                                    size="sm"
                                                >
                                                    {isTestingYahoo ? <RefreshCw size={16} className="animate-spin mr-2" /> : <RefreshCw size={16} className="mr-2" />}
                                                    연결 테스트
                                                </Button>
                                            </div>
                                        </div>

                                        {messageYahoo && (
                                            <div className={`p-4 rounded-xl border text-xs flex items-center gap-2 ${statusYahoo === 'success' ? 'bg-green-500/5 border-green-500/20 text-green-600' : 'bg-destructive/5 border-destructive/20 text-destructive'}`}>
                                                {statusYahoo === 'success' ? <ShieldCheck size={14} /> : <AlertCircle size={14} />}
                                                {messageYahoo}
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="p-5 border border-border/40 rounded-2xl bg-muted/10">
                                                <p className="text-xs font-bold mb-2">수집 데이터</p>
                                                <ul className="text-[11px] text-muted-foreground space-y-1.5 list-disc list-inside">
                                                    <li>KOSPI/KOSDAQ 종목 10년 월봉</li>
                                                    <li>S&P 500, 나스닥 등 주요 지수</li>
                                                    <li>USD/KRW 환율 및 미국채 금리</li>
                                                </ul>
                                            </div>
                                            <div className="p-5 border border-border/40 rounded-2xl bg-muted/10">
                                                <p className="text-xs font-bold mb-2">활용 계획</p>
                                                <ul className="text-[11px] text-muted-foreground space-y-1.5 list-disc list-inside">
                                                    <li>역사적 P/E, P/B 밴드 분석</li>
                                                    <li>글로벌 시황 기반 AI 리포팅</li>
                                                    <li>매크로 지표 변동 알림 (예정)</li>
                                                </ul>
                                            </div>
                                        </div>

                                        <div className="pt-8 border-t border-border/40">
                                            <div className="flex items-center gap-4 mb-6">
                                                <div className="p-3 bg-green-500/10 rounded-xl">
                                                    <Globe className="text-green-500" size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold">Naver Open API</h3>
                                                    <p className="text-xs text-muted-foreground">급등주 분석을 위한 최신 뉴스 수집 및 키워드 검색</p>
                                                </div>
                                            </div>

                                            <form onSubmit={handleSaveNaver} className="space-y-4">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="space-y-2">
                                                        <label className="text-xs font-bold ml-1">Client ID</label>
                                                        <Input
                                                            type="text"
                                                            value={naverKeys.clientId}
                                                            onChange={(e) => setNaverKeys({ ...naverKeys, clientId: e.target.value })}
                                                            placeholder="네이버 개발자 센터에서 발급받은 ID"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-xs font-bold ml-1">Client Secret</label>
                                                        <Input
                                                            type="password"
                                                            value={naverKeys.clientSecret}
                                                            onChange={(e) => setNaverKeys({ ...naverKeys, clientSecret: e.target.value })}
                                                            placeholder="네이버 개발자 센터에서 발급받은 Secret"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between pt-2">
                                                    <div className="flex items-center gap-2">
                                                        {isTestingNaver && (
                                                            <span className="text-xs text-muted-foreground animate-pulse flex items-center gap-2">
                                                                <RefreshCw size={14} className="animate-spin" /> {messageNaver}
                                                            </span>
                                                        )}
                                                        {statusNaver === 'success' && (
                                                            <span className="text-xs text-green-500 font-medium flex items-center gap-1 bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/20">
                                                                <ShieldCheck size={14} /> {messageNaver}
                                                            </span>
                                                        )}
                                                        {statusNaver === 'error' && (
                                                            <span className="text-xs text-destructive font-medium flex items-center gap-1 bg-destructive/10 px-3 py-1.5 rounded-full border border-destructive/20 max-w-[400px]">
                                                                <AlertCircle size={14} className="shrink-0" /> {messageNaver}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-3">
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={handleTestNaver}
                                                            disabled={isTestingNaver}
                                                            className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                                                        >
                                                            {isTestingNaver ? <RefreshCw size={14} className="animate-spin mr-2" /> : <Send size={14} className="mr-2" />}
                                                            연결 테스트
                                                        </Button>
                                                        <Button
                                                            type="submit"
                                                            size="sm"
                                                            disabled={isSavingNaver}
                                                            className="bg-green-600 hover:bg-green-700 text-white shadow-sm px-6 text-xs font-bold"
                                                        >
                                                            {isSavingNaver ? <RefreshCw size={14} className="animate-spin mr-2" /> : <Save size={14} className="mr-2" />}
                                                            네이버 키 저장
                                                        </Button>
                                                    </div>
                                                </div>
                                            </form>

                                            <div className="mt-4 bg-muted/20 rounded-xl p-4 flex gap-3 items-start border border-border/40">
                                                <Info className="text-muted-foreground/60 mt-0.5" size={16} />
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-bold">API 신청 안내</p>
                                                    <p className="text-[9px] text-muted-foreground leading-relaxed">
                                                        네이버 개발자 센터(<a href="https://developers.naver.com/" target="_blank" className="text-blue-500 hover:underline">developers.naver.com</a>)에서 '뉴스' 검색 API 권한을 포함한 애플리케이션을 등록하여 키를 발급받을 수 있습니다.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>


                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    </div>
                )}
            </main>
        </div>
    )
}
