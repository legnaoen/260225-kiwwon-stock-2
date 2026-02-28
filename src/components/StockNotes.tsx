import React, { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Plus, Edit2, Trash2, X } from 'lucide-react'
import { useNoteStore, Note } from '../store/useNoteStore'

interface StockNotesProps {
    stockCode: string
}

export function StockNotes({ stockCode }: StockNotesProps) {
    const { notes, addNote, updateNote, deleteNote } = useNoteStore()
    const [isEditorOpen, setIsEditorOpen] = useState(false)
    const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create')
    const [editNoteId, setEditNoteId] = useState<string | null>(null)
    const [content, setContent] = useState('')

    const numericStockCode = stockCode?.replace(/[^0-9]/g, '') || ''

    const stockNotes = useMemo(() => {
        if (!numericStockCode) return []
        // Newest first
        return notes
            .filter(n => n.stockCode === numericStockCode)
            .sort((a, b) => b.createdAt - a.createdAt)
    }, [notes, numericStockCode])

    const openCreateModal = () => {
        setEditorMode('create')
        setEditNoteId(null)
        setContent('')
        setIsEditorOpen(true)
    }

    const openEditModal = (note: Note) => {
        setEditorMode('edit')
        setEditNoteId(note.id)
        setContent(note.content)
        setIsEditorOpen(true)
    }

    const handleSave = () => {
        if (!content.trim()) return
        if (editorMode === 'create') {
            addNote(numericStockCode, content)
        } else if (editorMode === 'edit' && editNoteId) {
            updateNote(editNoteId, content)
        }
        setIsEditorOpen(false)
        setContent('')
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

            {stockNotes.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/70 text-[13px] min-h-[150px] mt-8 bg-background border border-border/50 rounded-xl border-dashed">
                    <p>작성된 노트가 없습니다. 새 노트를 추가해보세요.</p>
                </div>
            ) : (
                <div className="flex flex-col pt-1">
                    {stockNotes.map(note => (
                        <div key={note.id} className="group relative flex flex-col py-3 border-b border-border/50 last:border-0 hover:bg-black/5 transition-colors">
                            <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-headings:text-foreground prose-p:leading-snug text-[13px] prose-a:text-blue-500 text-foreground mb-1.5">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {note.content}
                                </ReactMarkdown>
                            </div>

                            <div className="flex items-center justify-between h-5">
                                <span className="text-[11px] text-muted-foreground font-mono leading-none">{formatNoteDate(note.createdAt)}</span>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => openEditModal(note)} className="text-muted-foreground hover:text-primary p-0.5 rounded hover:bg-primary/10 transition-colors">
                                        <Edit2 size={13} />
                                    </button>
                                    <button onClick={() => {
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
