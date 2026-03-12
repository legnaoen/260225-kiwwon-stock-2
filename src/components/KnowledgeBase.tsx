import React, { useState, useEffect } from 'react'
import { BookOpen, Clock, ChevronDown, ChevronRight, Edit3, Save, X, RotateCcw, Sparkles, FileText, AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '../utils'

interface SkillsFile {
    fileName: string
    displayName: string
    description: string
    exists: boolean
    content: string
    lastModified: string | null
    dbVersion: number
    dbLastUpdated: string | null
}

interface HistoryEntry {
    id: number
    version: number
    diff_summary: string
    change_type: string
    trigger_context: string | null
    changed_at: string
}

const CHANGE_TYPE_BADGE: Record<string, { label: string; color: string }> = {
    MANUAL:    { label: '수동 편집', color: 'bg-blue-500/15 text-blue-400' },
    AI_LESSON: { label: 'AI 교훈', color: 'bg-emerald-500/15 text-emerald-400' },
    AI_BATCH:  { label: 'AI 배치', color: 'bg-violet-500/15 text-violet-400' },
    SYSTEM:    { label: '시스템', color: 'bg-muted text-muted-foreground' }
}

export default function KnowledgeBase() {
    const [files, setFiles] = useState<SkillsFile[]>([])
    const [selectedFile, setSelectedFile] = useState<SkillsFile | null>(null)
    const [history, setHistory] = useState<HistoryEntry[]>([])
    const [historyOpen, setHistoryOpen] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [editContent, setEditContent] = useState('')
    const [diffSummary, setDiffSummary] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [status, setStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
    const [previewVersion, setPreviewVersion] = useState<{ version: number; content: string } | null>(null)

    useEffect(() => { loadFiles() }, [])

    const loadFiles = async () => {
        const res = await window.electronAPI?.skillsGetAll?.()
        if (res?.success) {
            setFiles(res.data ?? [])
            if (!selectedFile && (res.data?.length ?? 0) > 0) {
                selectFile(res.data![0])
            }
        }
    }

    const selectFile = async (file: SkillsFile) => {
        setSelectedFile(file)
        setIsEditing(false)
        setPreviewVersion(null)
        setHistoryOpen(false)
        const res = await window.electronAPI?.skillsGetHistory?.(file.fileName)
        if (res?.success) setHistory(res.data ?? [])
    }

    const handleSave = async () => {
        if (!selectedFile || !diffSummary.trim()) {
            setStatus({ type: 'err', msg: '변경 내용 요약을 입력해 주세요.' })
            return
        }
        setIsSaving(true)
        const res = await window.electronAPI?.skillsSave?.({
            fileName: selectedFile.fileName,
            content: editContent,
            diffSummary
        })
        setIsSaving(false)
        if (res?.success) {
            setStatus({ type: 'ok', msg: '저장 완료! DB에 이력이 기록되었습니다.' })
            setIsEditing(false)
            setDiffSummary('')
            await loadFiles()
            const updated = files.find(f => f.fileName === selectedFile.fileName)
            if (updated) selectFile({ ...updated, content: editContent })
        } else {
            setStatus({ type: 'err', msg: '저장 실패' })
        }
        setTimeout(() => setStatus(null), 3000)
    }

    const loadVersion = async (entry: HistoryEntry) => {
        const res = await window.electronAPI?.skillsGetVersion?.({
            fileName: selectedFile!.fileName,
            version: entry.version
        })
        if (res?.success) {
            setPreviewVersion({ version: entry.version, content: res.data })
        }
    }

    const restoreVersion = () => {
        if (!previewVersion) return
        setEditContent(previewVersion.content)
        setDiffSummary(`v${previewVersion.version} 버전으로 복원`)
        setIsEditing(true)
        setPreviewVersion(null)
    }

    return (
        <div className="flex h-full bg-background">
            {/* 왼쪽: 파일 목록 */}
            <div className="w-56 shrink-0 border-r border-border flex flex-col">
                <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-muted-foreground">
                        <BookOpen size={14} />
                        Knowledge Base
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
                        AI 분석에 활용되는 투자 원칙 및 지식을 관리합니다.
                    </p>
                </div>
                <div className="flex-1 p-2 space-y-1 overflow-y-auto">
                    {files.map(file => (
                        <button
                            key={file.fileName}
                            onClick={() => selectFile(file)}
                            className={cn(
                                'w-full text-left p-3 rounded-xl transition-all space-y-1 border',
                                selectedFile?.fileName === file.fileName
                                    ? 'bg-primary/5 border-primary/30 shadow-sm'
                                    : 'border-transparent hover:bg-muted/60'
                            )}
                        >
                            <div className="flex items-center gap-1.5">
                                <FileText size={12} className={file.exists ? 'text-primary' : 'text-muted-foreground'} />
                                <span className="text-xs font-bold truncate">{file.displayName}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className={cn(
                                    'text-[10px] font-mono',
                                    file.exists ? 'text-emerald-500' : 'text-amber-500'
                                )}>
                                    {file.exists ? `v${file.dbVersion}` : '미생성'}
                                </span>
                                {file.dbLastUpdated && (
                                    <span className="text-[9px] text-muted-foreground">
                                        {new Date(file.dbLastUpdated).toLocaleDateString('ko-KR')}
                                    </span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* 오른쪽: 파일 내용 */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {selectedFile ? (
                    <>
                        {/* 헤더 */}
                        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-muted/10">
                            <div>
                                <h3 className="text-sm font-bold">{selectedFile.displayName}</h3>
                                <p className="text-[10px] text-muted-foreground">{selectedFile.description}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* 이력 토글 */}
                                <button
                                    onClick={() => setHistoryOpen(p => !p)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                                >
                                    <Clock size={12} />
                                    변경 이력 ({history.length})
                                </button>

                                {isEditing ? (
                                    <>
                                        <button
                                            onClick={() => { setIsEditing(false); setPreviewVersion(null) }}
                                            className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg border border-border hover:bg-muted transition-colors"
                                        >
                                            <X size={12} /> 취소
                                        </button>
                                        <button
                                            onClick={handleSave}
                                            disabled={isSaving}
                                            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
                                        >
                                            <Save size={12} />
                                            {isSaving ? '저장 중...' : '저장 & 기록'}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        onClick={() => { setEditContent(selectedFile.content); setIsEditing(true) }}
                                        className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-background border border-border hover:bg-muted transition-colors"
                                    >
                                        <Edit3 size={12} /> 편집
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* 저장 요약 입력 (편집 중일 때) */}
                        {isEditing && (
                            <div className="px-6 py-2 border-b border-border bg-amber-500/5 flex items-center gap-3">
                                <Sparkles size={14} className="text-amber-500 shrink-0" />
                                <input
                                    type="text"
                                    value={diffSummary}
                                    onChange={e => setDiffSummary(e.target.value)}
                                    placeholder="변경 내용 요약을 입력하세요 (필수)"
                                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                                />
                            </div>
                        )}

                        {/* 상태 토스트 */}
                        {status && (
                            <div className={cn(
                                'mx-6 mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold',
                                status.type === 'ok'
                                    ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                                    : 'bg-destructive/10 text-destructive border border-destructive/20'
                            )}>
                                {status.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                                {status.msg}
                            </div>
                        )}

                        {/* 본문 영역 */}
                        <div className="flex-1 flex overflow-hidden">
                            {/* 본문 뷰어 / 에디터 */}
                            <div className={cn('flex-1 overflow-y-auto', historyOpen && 'border-r border-border')}>
                                {isEditing ? (
                                    <textarea
                                        value={editContent}
                                        onChange={e => setEditContent(e.target.value)}
                                        className="w-full h-full p-6 bg-transparent text-xs font-mono resize-none outline-none leading-relaxed"
                                        spellCheck={false}
                                    />
                                ) : previewVersion ? (
                                    <div className="p-6">
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="text-xs font-bold text-amber-500">
                                                v{previewVersion.version} 미리보기 (현재 버전 아님)
                                            </span>
                                            <button
                                                onClick={restoreVersion}
                                                className="flex items-center gap-1 px-3 py-1 text-[11px] font-bold rounded-lg bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
                                            >
                                                <RotateCcw size={12} /> 이 버전으로 복원
                                            </button>
                                        </div>
                                        <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono text-muted-foreground">
                                            {previewVersion.content}
                                        </pre>
                                    </div>
                                ) : (
                                    <div className="p-6">
                                        {selectedFile.exists ? (
                                            <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono">
                                                {selectedFile.content}
                                            </pre>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                                                <FileText size={32} className="mb-2 opacity-30" />
                                                <p className="text-sm font-bold">파일이 아직 생성되지 않았습니다.</p>
                                                <p className="text-xs mt-1">편집 버튼을 눌러 내용을 작성하고 저장하세요.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 변경 이력 패널 */}
                            {historyOpen && (
                                <div className="w-72 shrink-0 overflow-y-auto">
                                    <div className="p-3 border-b border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                        변경 이력
                                    </div>
                                    {history.length === 0 ? (
                                        <div className="p-4 text-xs text-muted-foreground text-center">이력이 없습니다.</div>
                                    ) : history.map(entry => (
                                        <button
                                            key={entry.id}
                                            onClick={() => loadVersion(entry)}
                                            className="w-full text-left p-3 border-b border-border/50 hover:bg-muted/40 transition-colors"
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-[11px] font-black text-primary">v{entry.version}</span>
                                                <span className={cn(
                                                    'text-[9px] px-1.5 py-0.5 rounded-full font-bold',
                                                    CHANGE_TYPE_BADGE[entry.change_type]?.color ?? 'bg-muted text-muted-foreground'
                                                )}>
                                                    {CHANGE_TYPE_BADGE[entry.change_type]?.label ?? entry.change_type}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2">
                                                {entry.diff_summary || '(요약 없음)'}
                                            </p>
                                            <p className="text-[9px] text-muted-foreground/60 mt-1 font-mono">
                                                {new Date(entry.changed_at).toLocaleString('ko-KR')}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        왼쪽에서 파일을 선택하세요.
                    </div>
                )}
            </div>
        </div>
    )
}
