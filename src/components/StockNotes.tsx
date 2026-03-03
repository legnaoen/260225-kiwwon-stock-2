import React, { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Plus, Edit2, Trash2, X } from 'lucide-react'
import { useNoteStore, Note } from '../store/useNoteStore'
import { formatTargetDate } from '../utils'

interface StockNotesProps {
    stockCode: string
    stockName?: string
}

export function StockNotes({ stockCode, stockName }: StockNotesProps) {
    const { notes, addNote, updateNote, deleteNote } = useNoteStore()
    const [isEditorOpen, setIsEditorOpen] = useState(false)
    const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create')
    const [editNoteId, setEditNoteId] = useState<string | null>(null)
    const [content, setContent] = useState('')
    const [targetDate, setTargetDate] = useState('')
    const [reminderType, setReminderType] = useState('없음')
    const [selectedNote, setSelectedNote] = useState<Note | null>(null)

    const numericStockCode = stockCode?.replace(/[^a-zA-Z0-9]/g, '') || ''

    const stockNotes = useMemo(() => {
        if (!numericStockCode) return []
        // Newest first
        return notes
            .filter(n => n.stockCode === numericStockCode)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    }, [notes, numericStockCode])

    const openCreateModal = () => {
        setEditorMode('create')
        setEditNoteId(null)
        setContent('')
        setTargetDate('')
        setReminderType('없음')
        setIsEditorOpen(true)
    }

    const openEditModal = (note: Note) => {
        setEditorMode('edit')
        setEditNoteId(note.id)
        setContent(note.content)
        setTargetDate(note.targetDate || '')
        setReminderType(note.reminderType || '없음')
        setIsEditorOpen(true)
    }

    const handleSave = () => {
        if (!content.trim()) return
        if (editorMode === 'create') {
            addNote(numericStockCode, stockName || '', content, targetDate, reminderType)
        } else if (editorMode === 'edit' && editNoteId) {
            updateNote(editNoteId, content, targetDate, reminderType)
        }
        setIsEditorOpen(false)
        setContent('')
        setTargetDate('')
        setReminderType('없음')
    }

    const formatNoteDate = (ts: number) => {
        const now = Date.now();
        const diffInSeconds = Math.floor((now - ts) / 1000);
        const diffInMinutes = Math.floor(diffInSeconds / 60);
        const diffInHours = Math.floor(diffInMinutes / 60);
        const diffInDays = Math.floor(diffInHours / 24);

        if (diffInDays >= 7) {
            return new Intl.DateTimeFormat('ko-KR', {
                year: 'numeric', month: '2-digit', day: '2-digit'
            }).format(new Date(ts));
        }

        if (diffInDays > 0) return `${diffInDays}d`;
        if (diffInHours > 0) return `${diffInHours}h`;
        if (diffInMinutes > 0) return `${diffInMinutes}m`;
        return '방금 전';
    }

    // Modal background click preventer
    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            setIsEditorOpen(false)
        }
    }

    if (!numericStockCode) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/70 text-[13px] min-h-[150px]">
                <p>종목을 선택해주세요.</p>
            </div>
        )
    }

    return (
        <div className="w-full flex flex-col relative">
            <div className="absolute -top-[50px] right-0 z-20">
                <button
                    onClick={openCreateModal}
                    className="flex items-center justify-center p-1.5 rounded hover:bg-black/5 text-muted-foreground hover:text-primary transition-colors"
                    title="노트 추가"
                >
                    <Plus size={18} strokeWidth={2.5} />
                </button>
            </div>

            <div className="flex items-center gap-2 mb-3">
                <button
                    onClick={() => {
                        const code = numericStockCode.replace(/^A/, '');
                        window.electronAPI.openExternal(`https://stock.naver.com/domestic/stock/${code}/`);
                    }}
                    className="px-2.5 py-0.5 rounded bg-[#03C75A]/10 text-[#03C75A] hover:bg-[#03C75A]/20 transition-colors text-[11px] font-bold border border-[#03C75A]/20 flex items-center gap-1"
                >
                    <span className="w-1.5 h-1.5 rounded-full bg-[#03C75A]" />
                    NAVER
                </button>
                <button
                    onClick={() => {
                        const code = numericStockCode.replace(/^A/, '');
                        window.electronAPI.openExternal(`https://www.tossinvest.com/stocks/A${code}/`);
                    }}
                    className="px-2.5 py-0.5 rounded bg-[#3182F6]/10 text-[#3182F6] hover:bg-[#3182F6]/20 transition-colors text-[11px] font-bold border border-[#3182F6]/20 flex items-center gap-1"
                >
                    <span className="w-1.5 h-1.5 rounded-full bg-[#3182F6]" />
                    TOSS
                </button>
            </div>

            {stockNotes.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/70 text-[13px] min-h-[150px] mt-8 bg-background border border-border/50 rounded-xl border-dashed">
                    <p>작성된 노트가 없습니다. 새 노트를 추가해보세요.</p>
                </div>
            ) : (
                <div className="flex flex-col pt-1">
                    {stockNotes.map(note => (
                        <div key={note.id} onClick={() => setSelectedNote(note)} className="group relative flex flex-col py-3 border-b border-border/50 last:border-0 hover:bg-black/5 cursor-pointer transition-colors px-2 -mx-2 rounded-lg">
                            <div className="text-[13px] text-foreground mb-1.5 break-all line-clamp-3 overflow-hidden leading-tight">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        h1: ({ children }) => <strong className="font-bold">{children} </strong>,
                                        h2: ({ children }) => <strong className="font-bold">{children} </strong>,
                                        h3: ({ children }) => <strong className="font-bold">{children} </strong>,
                                        h4: ({ children }) => <strong className="font-bold">{children} </strong>,
                                        h5: ({ children }) => <strong className="font-bold">{children} </strong>,
                                        h6: ({ children }) => <strong className="font-bold">{children} </strong>,
                                        p: ({ children }) => <div className="mb-1 whitespace-pre-wrap">{children}</div>,
                                        ul: ({ children }) => <ul className="pl-3 mb-1 list-disc list-inside">{children}</ul>,
                                        ol: ({ children }) => <ol className="pl-3 mb-1 list-decimal list-inside">{children}</ol>,
                                        li: ({ children }) => <li>{children}</li>,
                                        blockquote: ({ children }) => <div className="pl-2 border-l-2 border-border mb-1 opacity-80">{children}</div>,
                                        strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                                        em: ({ children }) => <span>{children}</span>,
                                        code: ({ children }) => <span>{children}</span>,
                                        a: ({ children }) => <span>{children}</span>,
                                        hr: () => <></>,
                                    }}
                                >
                                    {note.content}
                                </ReactMarkdown>
                            </div>

                            <div className="flex items-center justify-between h-5 mt-1.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-muted-foreground font-mono leading-none">{formatNoteDate(note.createdAt || 0)}</span>
                                    {note.targetDate && (
                                        <span className="text-[11px] font-bold text-blue-500 leading-none">
                                            {formatTargetDate(note.targetDate)}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={(e) => { e.stopPropagation(); openEditModal(note); }} className="text-muted-foreground hover:text-primary p-0.5 rounded hover:bg-primary/10 transition-colors">
                                        <Edit2 size={13} />
                                    </button>
                                    <button onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('이 노트를 정말 삭제하시겠습니까?')) deleteNote(note.id)
                                    }} className="text-muted-foreground hover:text-destructive p-0.5 rounded hover:bg-destructive/10 transition-colors">
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {selectedNote && !isEditorOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={() => setSelectedNote(null)}
                >
                    <div className="bg-background w-full max-w-[800px] max-h-[85vh] rounded-xl shadow-2xl border border-border flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
                            <h3 className="font-bold text-[15px] flex items-center gap-2">
                                📝 {stockName || numericStockCode} ({numericStockCode})
                            </h3>
                            <button onClick={() => setSelectedNote(null)} className="text-muted-foreground hover:text-foreground p-1 transition-colors"><X size={18} /></button>
                        </div>

                        <div className="p-5 flex flex-col gap-4 flex-1 overflow-y-auto min-h-0">
                            <div>
                                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <span className="bg-muted px-2 py-1 rounded-md border border-border">작성일: {new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(selectedNote.createdAt || 0))}</span>
                                    {selectedNote.targetDate && (
                                        <span className="bg-primary/10 text-primary px-2 py-1 rounded-md border border-primary/20">📅 {selectedNote.targetDate}</span>
                                    )}
                                    {selectedNote.reminderType && selectedNote.reminderType !== '없음' && (
                                        <span className="bg-secondary/20 text-secondary-foreground px-2 py-1 rounded-md border border-border">🔔 알림: {selectedNote.reminderType}</span>
                                    )}
                                </div>
                            </div>

                            <hr className="border-border/50" />

                            <div className="text-[14px] text-foreground">
                                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed break-all prose-p:my-1 prose-headings:my-3">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {selectedNote.content}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        </div>
                        <div className="px-5 py-4 border-t border-border bg-muted/30 flex items-center justify-end gap-3 shrink-0">
                            <button onClick={() => {
                                const n = selectedNote;
                                setSelectedNote(null);
                                openEditModal(n);
                            }} className="px-6 py-2 text-[13px] font-bold bg-muted hover:bg-muted/80 text-foreground border border-border/50 rounded-md transition-colors">수정</button>
                            <button onClick={() => {
                                if (confirm('이 노트를 정말 삭제하시겠습니까?')) {
                                    deleteNote(selectedNote.id);
                                    setSelectedNote(null);
                                }
                            }} className="px-6 py-2 text-[13px] font-bold bg-muted hover:bg-destructive/10 text-destructive border border-border/50 rounded-md transition-colors">삭제</button>
                        </div>
                    </div>
                </div>
            )}

            {isEditorOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={handleBackdropClick}
                >
                    <div className="bg-background w-full max-w-3xl rounded-xl shadow-2xl border border-border flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 h-[600px] max-h-[90vh]">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30 shrink-0">
                            <h3 className="font-bold text-[15px]">{editorMode === 'create' ? '새 노트 추가하기' : '작성된 노트 수정하기'}</h3>
                            <button onClick={() => setIsEditorOpen(false)} className="text-muted-foreground hover:text-foreground p-1 transition-colors"><X size={18} /></button>
                        </div>

                        <div className="px-5 py-3 flex items-center gap-4 bg-muted/10 border-b border-border">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-muted-foreground">목표 날짜</span>
                                <input
                                    type="date"
                                    value={targetDate}
                                    onChange={(e) => setTargetDate(e.target.value)}
                                    className="bg-background border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-muted-foreground">일정 알림(텔레그램)</span>
                                <select
                                    value={reminderType}
                                    onChange={(e) => setReminderType(e.target.value)}
                                    className="bg-background border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    <option value="없음">알림 없음</option>
                                    <option value="당일">당일 알림</option>
                                    <option value="1일 전">1일 전</option>
                                    <option value="3일 전">3일 전</option>
                                    <option value="1주일 전">1주일 전</option>
                                </select>
                            </div>
                        </div>

                        <div className="p-5 flex-1 flex flex-col gap-2 relative h-full min-h-0 bg-background">
                            <textarea
                                className="w-full h-full flex-1 p-4 rounded-lg border border-border bg-muted/10 focus:outline-none focus:ring-2 focus:ring-primary/50 text-[14px] font-mono resize-none leading-relaxed"
                                placeholder={"# 마크다운 문법을 사용하여 노트를 멋지게 작성해보세요!\n\n- 글머리 기호\n- **굵은 글씨**\n- `코드 블록` 등"}
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                            />
                            <div className="absolute top-7 right-8 text-[11px] font-bold text-muted-foreground pointer-events-none opacity-50 bg-background/80 backdrop-blur px-2 py-1 rounded shadow-sm border border-border/50 flex flex-col gap-1 items-end">
                                <span>Markdown 지원</span>
                            </div>
                        </div>
                        <div className="px-5 py-4 border-t border-border bg-muted/30 flex items-center justify-end gap-3 shrink-0">
                            <button onClick={() => setIsEditorOpen(false)} className="px-5 py-2 text-sm font-bold hover:bg-muted/80 rounded-md transition-colors text-muted-foreground">취소</button>
                            <button onClick={handleSave} disabled={!content.trim()} className="px-6 py-2 bg-primary text-primary-foreground text-[13px] font-bold rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50">
                                {editorMode === 'create' ? '작성 완료' : '수정 완료'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
