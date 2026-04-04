import { useState, useEffect } from 'react'
import { RefreshCw, Copy, MessageSquare, X } from 'lucide-react'
import { Button } from './ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/Dialog' // Assuming shadcn UI or similar is available. If not I will build a simple modal.

export default function TelegramLogsTab() {
    const [logs, setLogs] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedLog, setSelectedLog] = useState<any | null>(null)

    const fetchLogs = async () => {
        setLoading(true)
        try {
            const result = await (window as any).electronAPI.getTelegramLogs()
            if (result.success) {
                setLogs(result.data)
            }
        } catch (e) {
            console.error('Failed to fetch telegram logs', e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchLogs()
    }, [])

    const handleCopy = (text: string, e: React.MouseEvent) => {
        e.stopPropagation()
        navigator.clipboard.writeText(text)
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight mb-2">텔레그램 발송 로그</h2>
                    <p className="text-muted-foreground text-sm">최근 3일간 시스템 및 AI가 텔레그램으로 발송한 메시지 이력을 확인합니다.</p>
                </div>
                <Button variant="outline" onClick={fetchLogs} disabled={loading} className="gap-2">
                    <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                    새로고침
                </Button>
            </div>

            <div className="border border-border/50 rounded-xl overflow-hidden bg-card shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-muted/50 border-b border-border/50">
                            <tr>
                                <th className="px-4 py-3 font-medium text-foreground w-[180px]">발송 시간</th>
                                <th className="px-4 py-3 font-medium text-foreground w-[150px]">출처 (Sender)</th>
                                <th className="px-4 py-3 font-medium text-foreground">메시지 요약</th>
                                <th className="px-4 py-3 font-medium text-foreground w-[80px]">동작</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {logs.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                                        기록된 텔레그램 발송 로그가 없습니다.
                                    </td>
                                </tr>
                            ) : (
                                logs.map((log) => (
                                    <tr 
                                        key={log.id} 
                                        onClick={() => setSelectedLog(log)}
                                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                                    >
                                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                            {log.created_at.replace('T', ' ')}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-500/10 text-sky-600 text-xs font-semibold border border-sky-500/20">
                                                <MessageSquare size={12} />
                                                {log.sender_type || "일반 메시지"}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-foreground/80 max-w-md truncate">
                                            {log.message}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex justify-center">
                                                <Button 
                                                    variant="ghost" 
                                                    size="icon" 
                                                    onClick={(e) => handleCopy(log.message, e)}
                                                    title="전문 복사"
                                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                >
                                                    <Copy size={14} />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal for full text view */}
            {selectedLog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setSelectedLog(null)}>
                    <div className="bg-background rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-border/50" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-5 border-b border-border/50">
                            <div>
                                <h3 className="font-bold text-lg flex items-center gap-2">
                                    <MessageSquare size={18} className="text-sky-500" />
                                    메시지 상세 내용
                                </h3>
                                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                                    <span>출처: {selectedLog.sender_type}</span>
                                    <span>시간: {selectedLog.created_at.replace('T', ' ')}</span>
                                </div>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => setSelectedLog(null)} className="rounded-full">
                                <X size={20} />
                            </Button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 text-sm">
                            <pre className="whitespace-pre-wrap font-sans bg-muted/30 p-4 rounded-lg border border-border/30 text-foreground/90 overflow-x-hidden w-full break-words">
                                {selectedLog.message}
                            </pre>
                        </div>
                        <div className="p-4 border-t border-border/50 bg-muted/10 flex justify-end">
                            <Button 
                                variant="default" 
                                onClick={(e) => { handleCopy(selectedLog.message, e); setSelectedLog(null); }}
                                className="gap-2"
                            >
                                <Copy size={16} /> 전문 복사 
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
