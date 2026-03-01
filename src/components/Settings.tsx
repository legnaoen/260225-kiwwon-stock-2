import { useState, useEffect } from 'react'
import { Save, ShieldCheck, AlertCircle, RefreshCw, Send, MessageCircle } from 'lucide-react'

export default function Settings() {
    const [keys, setKeys] = useState({ appkey: '', secretkey: '' })
    const [isSaving, setIsSaving] = useState(false)
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
    const [message, setMessage] = useState('')

    const [telegramKeys, setTelegramKeys] = useState({ botToken: '', chatId: '' })
    const [isSavingTg, setIsSavingTg] = useState(false)
    const [statusTg, setStatusTg] = useState<'idle' | 'success' | 'error'>('idle')
    const [messageTg, setMessageTg] = useState('')
    const [isTestingTg, setIsTestingTg] = useState(false)

    useEffect(() => {
        const loadKeys = async () => {
            const savedKeys = await window.electronAPI.getApiKeys()
            if (savedKeys) {
                setKeys(savedKeys)
            }

            const savedTgKeys = await window.electronAPI.getTelegramSettings()
            if (savedTgKeys) {
                setTelegramKeys(savedTgKeys)
            }
        }
        loadKeys()
    }, [])

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
                chatId: telegramKeys.chatId.trim()
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

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">설정</h1>
                    <p className="text-sm text-muted-foreground">API 연결 및 앱 설정을 관리합니다.</p>
                </div>

                <div className="bg-card border rounded-2xl p-6 shadow-sm space-y-6">
                    <div className="flex items-center gap-2 pb-4 border-b border-border">
                        <ShieldCheck className="text-primary" size={20} />
                        <h2 className="text-lg font-semibold">키움증권 API 키 설정</h2>
                    </div>

                    <form onSubmit={handleSave} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">App Key</label>
                            <input
                                type="password"
                                value={keys.appkey}
                                onChange={(e) => setKeys({ ...keys, appkey: e.target.value })}
                                placeholder="발급받은 App Key를 입력하세요"
                                className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Secret Key</label>
                            <input
                                type="password"
                                value={keys.secretkey}
                                onChange={(e) => setKeys({ ...keys, secretkey: e.target.value })}
                                placeholder="발급받은 Secret Key를 입력하세요"
                                className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
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
                                    <span className="text-xs text-green-500 font-medium flex items-center gap-1">
                                        <ShieldCheck size={14} /> {message}
                                    </span>
                                )}
                                {status === 'error' && (
                                    <span className="text-xs text-destructive font-medium flex items-center gap-1 max-w-[300px]">
                                        <AlertCircle size={14} className="shrink-0" /> {message}
                                    </span>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={isSaving}
                                className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-bold hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-primary/20"
                            >
                                {isSaving ? <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={18} />}
                                저장하기
                            </button>
                        </div>
                    </form>

                    <div className="bg-muted/50 rounded-xl p-4 flex gap-4 items-start border border-border">
                        <AlertCircle className="text-muted-foreground mt-0.5" size={16} />
                        <div className="space-y-1">
                            <p className="text-xs font-semibold">키움증권 REST API 안내</p>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                입력하신 Key는 사용자 PC의 로컬 스토리지(`electron-store`)에만 안전하게 암호화되어 저장됩니다.
                                외부 서버로 전송되지 않으며, 토큰 발급을 위해서만 사용됩니다.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Telegram Settings Block */}
                <div className="bg-card border rounded-2xl p-6 shadow-sm space-y-6">
                    <div className="flex items-center gap-2 pb-4 border-b border-border">
                        <Send className="text-blue-500" size={20} />
                        <h2 className="text-lg font-semibold">텔레그램 연동 설정</h2>
                    </div>

                    <form onSubmit={handleSaveTelegram} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Bot Token</label>
                            <input
                                type="password"
                                value={telegramKeys.botToken}
                                onChange={(e) => setTelegramKeys({ ...telegramKeys, botToken: e.target.value })}
                                placeholder="BotFather에서 발급받은 봇 토큰 (예: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11)"
                                className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Chat ID</label>
                            <input
                                type="password"
                                value={telegramKeys.chatId}
                                onChange={(e) => setTelegramKeys({ ...telegramKeys, chatId: e.target.value })}
                                placeholder="메시지를 받을 사용자/그룹 Chat ID"
                                className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                            />
                        </div>

                        <div className="pt-4 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {isSavingTg && (
                                    <span className="text-xs text-muted-foreground animate-pulse flex items-center gap-2">
                                        <RefreshCw size={14} className="animate-spin" /> {messageTg}
                                    </span>
                                )}
                                {statusTg === 'success' && (
                                    <span className="text-xs text-green-500 font-medium flex items-center gap-1">
                                        <MessageCircle size={14} /> {messageTg}
                                    </span>
                                )}
                                {statusTg === 'error' && (
                                    <span className="text-xs text-destructive font-medium flex items-center gap-1 max-w-[300px]">
                                        <AlertCircle size={14} className="shrink-0" /> {messageTg}
                                    </span>
                                )}
                            </div>

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleTestMessage}
                                    disabled={isTestingTg}
                                    className="flex items-center gap-2 bg-muted text-foreground px-4 py-2.5 rounded-xl font-medium hover:bg-muted/80 disabled:opacity-50 transition-all border border-border"
                                >
                                    {isTestingTg ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} className="text-blue-500" />}
                                    테스트 발송
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSavingTg}
                                    className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg shadow-blue-500/20"
                                >
                                    {isSavingTg ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
                                    텔레그램 저장
                                </button>
                            </div>
                        </div>
                    </form>

                    <div className="bg-muted/50 rounded-xl p-4 flex gap-4 items-start border border-border">
                        <MessageCircle className="text-muted-foreground mt-0.5" size={16} />
                        <div className="space-y-1">
                            <p className="text-xs font-semibold">텔레그램 봇 안내</p>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                텔레그램에서 <strong>@BotFather</strong>를 통해 봇을 생성하고 Token을 발급받으세요. Chat ID는 <strong>@userinfobot</strong>을 통해 확인할 수 있습니다. 봇을 채널이나 그룹에 초대할 경우, 해당 그룹의 Chat ID (보통 '-'로 시작)를 입력하세요.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
