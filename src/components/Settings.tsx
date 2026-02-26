import { useState, useEffect } from 'react'
import { Save, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react'

export default function Settings() {
    const [keys, setKeys] = useState({ appkey: '', secretkey: '' })
    const [isSaving, setIsSaving] = useState(false)
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
    const [message, setMessage] = useState('')

    useEffect(() => {
        const loadKeys = async () => {
            const savedKeys = await window.electronAPI.getApiKeys()
            if (savedKeys) {
                setKeys(savedKeys)
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

    return (
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
        </div>
    )
}
