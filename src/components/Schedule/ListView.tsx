import { Calendar, Trash2, Edit2, Plus, X } from 'lucide-react'

export default function ListView() {
    const { events: scheduleEvents, deleteEvent, updateEvent, addEvent } = useScheduleStore()
    const { notes, deleteNote, updateNote } = useNoteStore()
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const [isAdding, setIsAdding] = useState(false)
    const [editForm, setEditForm] = useState<any>({})
    const [addForm, setAddForm] = useState({
        title: '',
        description: '',
        date: new Date().toISOString().split('T')[0],
        reminderType: '없음' as any,
        code: ''
    })

    const memoEvents = notes.filter(n => n.targetDate).map(n => ({
        id: `memo-${n.id}`,
        title: `${n.stockName || n.stockCode} (${n.stockCode})`,
        description: n.content,
        date: n.targetDate as string,
        code: n.stockCode,
        reminderType: (n.reminderType as any) || '없음',
        isNotified: n.isNotified || false,
        isMarketEvent: false,
        isMemo: true,
        originalId: n.id
    }))

    const events = useMemo(() => {
        return [...scheduleEvents, ...memoEvents].sort((a, b) => a.date.localeCompare(b.date))
    }, [scheduleEvents, memoEvents])

    // Auto-select first event if none selected
    React.useEffect(() => {
        if (events.length > 0 && !selectedEventId && !isAdding) {
            setSelectedEventId(events[0].id)
        }
    }, [events, selectedEventId, isAdding])

    const selectedEvent = events.find(e => e.id === selectedEventId) || events[0]

    const handleStartEdit = () => {
        if (!selectedEvent) return
        setEditForm({
            title: selectedEvent.title,
            description: selectedEvent.description,
            date: selectedEvent.date,
            reminderType: selectedEvent.reminderType
        })
        setIsEditing(true)
    }

    const handleSaveEdit = () => {
        if (selectedEvent.isMemo) {
            updateNote(selectedEvent.originalId!, editForm.description, editForm.date, editForm.reminderType, selectedEvent.isNotified)
        } else {
            updateEvent(selectedEvent.id, {
                title: editForm.title,
                description: editForm.description,
                date: editForm.date,
                reminderType: editForm.reminderType
            })
        }
        setIsEditing(false)
    }

    const handleAddEvent = () => {
        if (!addForm.title.trim()) {
            alert("제목을 입력해주세요.");
            return;
        }
        addEvent({
            title: addForm.title,
            description: addForm.description,
            date: addForm.date,
            reminderType: addForm.reminderType,
            code: addForm.code
        });
        setIsAdding(false);
        setAddForm({
            title: '',
            description: '',
            date: new Date().toISOString().split('T')[0],
            reminderType: '없음',
            code: ''
        });
    }

    return (
        <div className="w-full h-full flex overflow-hidden bg-background">
            {/* Left List Pane */}
            <div className="w-[400px] flex flex-col border-r border-border shrink-0">
                <div className="p-4 border-b border-border bg-muted/5">
                    <button
                        onClick={() => {
                            setIsAdding(true);
                            setIsEditing(false);
                            setSelectedEventId(null);
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 transition-colors shadow-sm"
                    >
                        <Plus size={18} /> 새 일정 추가
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden pt-1">
                    {events.length === 0 ? (
                        <div className="text-center py-20 text-muted-foreground">
                            <p>일정이 없습니다.</p>
                        </div>
                    ) : (
                        <div className="flex flex-col">
                            {events.map((evt) => (
                                <div
                                    key={evt.id}
                                    onClick={() => { setSelectedEventId(evt.id); setIsEditing(false); setIsAdding(false); }}
                                    className={`py-4 px-5 border-b border-border transition-colors cursor-pointer relative group
                                        ${selectedEventId === evt.id ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                                >
                                    {selectedEventId === evt.id && (
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>
                                    )}
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center justify-between gap-2 overflow-hidden">
                                            <h3 className={`font-bold text-[14px] truncate leading-tight
                                                ${evt.isMarketEvent ? 'text-blue-500' : evt.isMemo ? 'text-amber-500' : 'text-green-500'}`}
                                            >
                                                {evt.title}
                                            </h3>
                                            <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap shrink-0">
                                                {evt.date}
                                            </span>
                                        </div>
                                        <div className="text-[12px] text-muted-foreground line-clamp-2 leading-snug break-all min-h-[2.5em]">
                                            {evt.description || "내용 없음"}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Right Detail Pane */}
            <div className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden relative">
                {isAdding ? (
                    <div className="flex-1 flex flex-col p-8 gap-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold">새 일정 추가</h2>
                            <button onClick={() => setIsAdding(false)} className="p-2 hover:bg-muted rounded-full text-muted-foreground"><X size={20} /></button>
                        </div>
                        <div className="space-y-4 max-w-2xl">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-muted-foreground">일정 제목</label>
                                <input
                                    type="text"
                                    placeholder="일정 제목을 입력하세요"
                                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                                    value={addForm.title}
                                    onChange={e => setAddForm({ ...addForm, title: e.target.value })}
                                    autoFocus
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-muted-foreground">날짜</label>
                                    <input
                                        type="date"
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                                        value={addForm.date}
                                        onChange={e => setAddForm({ ...addForm, date: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-muted-foreground">알림 설정</label>
                                    <select
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                                        value={addForm.reminderType}
                                        onChange={e => setAddForm({ ...addForm, reminderType: e.target.value })}
                                    >
                                        <option value="없음">알림 없음</option>
                                        <option value="당일">당일 알림</option>
                                        <option value="1일 전">1일 전</option>
                                        <option value="3일 전">3일 전</option>
                                        <option value="1주일 전">1주일 전</option>
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-muted-foreground">종목 코드 (선택)</label>
                                <input
                                    type="text"
                                    placeholder="예: 005930"
                                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                                    value={addForm.code}
                                    onChange={e => setAddForm({ ...addForm, code: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1.5 flex-1 flex flex-col min-h-0">
                                <label className="text-xs font-bold text-muted-foreground">상세 내용</label>
                                <textarea
                                    placeholder="상세 내용을 입력하세요"
                                    className="w-full flex-1 min-h-[250px] bg-background border border-border rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-primary outline-none resize-none leading-relaxed font-mono"
                                    value={addForm.description}
                                    onChange={e => setAddForm({ ...addForm, description: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="mt-auto flex justify-end gap-3 pt-4 border-t border-border">
                            <button onClick={() => setIsAdding(false)} className="px-5 py-2 text-sm font-bold bg-muted hover:bg-muted/80 rounded-md transition-colors">취소</button>
                            <button onClick={handleAddEvent} className="px-8 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors shadow-lg">일정 저장</button>
                        </div>
                    </div>
                ) : selectedEvent ? (
                    <div className="flex-1 flex flex-col min-h-0">
                        {isEditing ? (
                            /* Edit Mode */
                            <div className="flex-1 flex flex-col p-8 gap-6">
                                <h2 className="text-xl font-bold mb-2">일정 수정</h2>
                                <div className="space-y-4 max-w-2xl">
                                    {!selectedEvent.isMemo && (
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-bold text-muted-foreground">일정 제목</label>
                                            <input
                                                type="text"
                                                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                                                value={editForm.title}
                                                onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                                            />
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-bold text-muted-foreground">날짜</label>
                                            <input
                                                type="date"
                                                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                                                value={editForm.date}
                                                onChange={e => setEditForm({ ...editForm, date: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-bold text-muted-foreground">알림 설정</label>
                                            <select
                                                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                                                value={editForm.reminderType}
                                                onChange={e => setEditForm({ ...editForm, reminderType: e.target.value })}
                                            >
                                                <option value="없음">알림 없음</option>
                                                <option value="당일">당일 알림</option>
                                                <option value="1일 전">1일 전</option>
                                                <option value="3일 전">3일 전</option>
                                                <option value="1주일 전">1주일 전</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="space-y-1.5 flex-1 flex flex-col min-h-0">
                                        <label className="text-xs font-bold text-muted-foreground">상세 내용</label>
                                        <textarea
                                            className="w-full flex-1 min-h-[300px] bg-background border border-border rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-primary outline-none resize-none leading-relaxed font-mono"
                                            value={editForm.description}
                                            onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="mt-auto flex justify-end gap-3 pt-4 border-t border-border">
                                    <button onClick={() => setIsEditing(false)} className="px-5 py-2 text-sm font-bold bg-muted hover:bg-muted/80 rounded-md transition-colors">취소</button>
                                    <button onClick={handleSaveEdit} className="px-6 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">저장 완료</button>
                                </div>
                            </div>
                        ) : (
                            /* View Mode */
                            <>
                                <div className="px-6 py-5 border-b border-border bg-muted/5">
                                    <h2 className="text-xl font-bold text-foreground flex items-center gap-3">
                                        {selectedEvent.isMarketEvent ? '🏛' : selectedEvent.isMemo ? '📝' : '📅'} {selectedEvent.title}
                                    </h2>
                                    <div className="flex items-center gap-3 mt-3">
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted text-[11px] font-medium border border-border">
                                            <Calendar size={12} /> {selectedEvent.date}
                                        </span>
                                        {selectedEvent.code && (
                                            <span className="inline-flex px-2.5 py-1 rounded-md bg-primary/10 text-primary text-[11px] font-bold border border-primary/20">
                                                종목코드: {selectedEvent.code}
                                            </span>
                                        )}
                                        {selectedEvent.reminderType && selectedEvent.reminderType !== '없음' && (
                                            <span className="inline-flex px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-500 text-[11px] font-medium border border-amber-500/20">
                                                🔔 알림: {selectedEvent.reminderType}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex-1 p-8 overflow-y-auto">
                                    <div className="max-w-3xl">
                                        {selectedEvent.description ? (
                                            <div className="text-[15px] leading-relaxed text-foreground">
                                                {selectedEvent.isMemo ? (
                                                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed break-all prose-p:my-2 prose-headings:my-4 prose-strong:text-foreground">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                            {selectedEvent.description}
                                                        </ReactMarkdown>
                                                    </div>
                                                ) : (
                                                    <p className="whitespace-pre-wrap break-all">{selectedEvent.description}</p>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="text-muted-foreground/50 italic py-10">상세 내용이 없습니다.</div>
                                        )}
                                    </div>
                                </div>

                                <div className="px-6 py-4 border-t border-border bg-muted/5 flex justify-end gap-3 shrink-0">
                                    <button
                                        onClick={handleStartEdit}
                                        className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold bg-muted hover:bg-primary/10 text-primary border border-border rounded-md transition-colors"
                                    >
                                        <Edit2 size={14} /> 수정
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (confirm('이 일정을 삭제하시겠습니까?')) {
                                                if (selectedEvent.isMemo) {
                                                    deleteNote(selectedEvent.originalId!);
                                                } else {
                                                    deleteEvent(selectedEvent.id);
                                                }
                                                setSelectedEventId(null);
                                            }
                                        }}
                                        className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold bg-muted hover:bg-destructive/10 text-destructive border border-border rounded-md transition-colors"
                                    >
                                        <Trash2 size={14} /> 일정 삭제
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground opacity-30">
                        <Calendar size={64} strokeWidth={1} className="mb-4" />
                        <p className="text-lg">왼쪽 리스트에서 일정을 선택해주세요.</p>
                    </div>
                )}
            </div>
        </div>
    )
}
