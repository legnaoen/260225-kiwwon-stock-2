import React, { useState } from 'react'
import { useScheduleStore, ScheduleEvent } from '../../store/useScheduleStore'
import { useNoteStore } from '../../store/useNoteStore'
import { Plus, ChevronLeft, ChevronRight, X, ExternalLink } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getLocalDateStr } from '../../utils'

export default function CalendarView() {
    const { events: scheduleEvents, updateEvent, deleteEvent, addEvent } = useScheduleStore()
    const { notes, updateNote, deleteNote } = useNoteStore()
    const [currentDate, setCurrentDate] = useState(new Date())
    const [selectedEvent, setSelectedEvent] = useState<any>(null)
    const [selectedDateForEvents, setSelectedDateForEvents] = useState<{ date: string, events: any[] } | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const [editForm, setEditForm] = useState<any>({})

    // Add Mode states
    const [showAddModal, setShowAddModal] = useState(false)
    const [addForm, setAddForm] = useState({
        title: '',
        description: '',
        date: getLocalDateStr(),
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
        isMemo: true,
        isMarketEvent: false,
        originalId: ''
    }))

    const events = [...scheduleEvents, ...memoEvents]

    // Simple grid generation
    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()
    const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay()

    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()

    const daysInMonth = getDaysInMonth(year, month)
    const firstDay = getFirstDayOfMonth(year, month)

    const days = []
    for (let i = 0; i < firstDay; i++) days.push(null)
    for (let i = 1; i <= daysInMonth; i++) days.push(i)

    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))
    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))

    const startEdit = (evt: any) => {
        setIsEditing(true)
        setEditForm({
            title: evt.title,
            description: evt.description,
            date: evt.date,
            reminderType: evt.reminderType
        })
    }

    const saveEdit = () => {
        if (selectedEvent.isMemo) {
            const rawId = selectedEvent.id.replace('memo-', '')
            updateNote(rawId, editForm.description, editForm.date, editForm.reminderType, selectedEvent.isNotified)
        } else {
            updateEvent(selectedEvent.id, {
                title: editForm.title,
                description: editForm.description,
                date: editForm.date,
                reminderType: editForm.reminderType
            })
        }
        setIsEditing(false)
        setSelectedEvent({ ...selectedEvent, ...editForm })
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
        setShowAddModal(false);
        setAddForm({
            title: '',
            description: '',
            date: getLocalDateStr(),
            reminderType: '없음',
            code: ''
        });
    }

    const deleteCurrentEvent = () => {
        if (window.confirm("정말 삭제하시겠습니까?")) {
            if (selectedEvent.isMemo) {
                const rawId = selectedEvent.id.replace('memo-', '')
                deleteNote(rawId)
            } else {
                deleteEvent(selectedEvent.id)
            }
            setSelectedEvent(null)
            if (selectedDateForEvents) {
                setSelectedDateForEvents(prev => prev ? { ...prev, events: prev.events.filter(e => e.id !== selectedEvent.id) } : null)
            }
        }
    }

    return (
        <div className="w-full h-full flex flex-col p-4 relative">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                    <button onClick={prevMonth} className="p-2 hover:bg-muted rounded-xl"><ChevronLeft size={20} /></button>
                    <h2 className="text-xl font-bold">{year}년 {month + 1}월</h2>
                    <button onClick={nextMonth} className="p-2 hover:bg-muted rounded-xl"><ChevronRight size={20} /></button>
                </div>
                <button
                    onClick={() => {
                        setAddForm({ ...addForm, date: getLocalDateStr() });
                        setShowAddModal(true);
                    }}
                    className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl font-bold hover:bg-primary/90 transition-colors shadow-sm"
                >
                    <Plus size={18} />
                    일정 추가
                </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center font-bold text-sm text-muted-foreground mb-2">
                <div className="text-destructive">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div className="text-blue-500">토</div>
            </div>

            <div className="grid grid-cols-7 gap-1 flex-1 min-h-0">
                {days.map((day, idx) => {
                    if (!day) return <div key={`empty-${idx}`} className="bg-muted/5 rounded-xl border border-transparent"></div>

                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                    const dayEvents = events.filter(e => e.date === dateStr)
                    const isToday = getLocalDateStr() === dateStr

                    return (
                        <div
                            key={day}
                            className={`rounded-xl border flex flex-col min-h-0 p-1.5 transition-colors cursor-pointer hover:bg-muted/50 ${isToday ? 'border-primary/50 bg-primary/5' : 'border-border'}`}
                            onClick={() => {
                                if (dayEvents.length > 0) {
                                    setSelectedDateForEvents({ date: dateStr, events: dayEvents })
                                } else {
                                    setAddForm({ ...addForm, date: dateStr });
                                    setShowAddModal(true);
                                }
                            }}
                        >
                            <span className={`text-xs font-bold p-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>
                                {day}
                            </span>
                            <div className="mt-1 flex-1 overflow-hidden space-y-1 pr-1">
                                {dayEvents.slice(0, 3).map(evt => (
                                    <div
                                        key={evt.id}
                                        onClick={(e) => { e.stopPropagation(); setSelectedEvent(evt); }}
                                        className={`text-[10px] px-1.5 py-1 rounded-md mb-1 break-words whitespace-normal cursor-pointer hover:brightness-95 transition-all ${evt.isMarketEvent ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                                            : evt.isMemo ? 'bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20'
                                                : 'bg-green-500/10 text-green-600 dark:text-green-500 border border-green-500/20'
                                            }`}
                                    >
                                        <div className="font-bold mb-0.5 leading-tight truncate">{evt.isMarketEvent && '🏛 '}{evt.title}</div>
                                        {evt.isMemo && evt.description && (
                                            <div className="text-[9px] opacity-80 leading-snug line-clamp-1">
                                                {evt.description.replace(/[#*`>]/g, '')}
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {dayEvents.length > 3 && (
                                    <div className="text-[10px] text-muted-foreground text-center font-bold py-0.5 bg-muted/20 rounded-md">
                                        + {dayEvents.length - 3}개 더보기
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Add Event Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowAddModal(false)}>
                    <div className="bg-background w-full max-w-[500px] rounded-xl shadow-2xl border border-border flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
                            <h3 className="font-bold text-[16px] flex items-center gap-2">📅 새 일정 추가</h3>
                            <button onClick={() => setShowAddModal(false)} className="text-muted-foreground hover:text-foreground p-1 transition-colors"><X size={18} /></button>
                        </div>

                        <div className="p-5 flex flex-col gap-4">
                            <div>
                                <label className="text-xs font-bold text-muted-foreground mb-1 block">일정 제목 <span className="text-destructive">*</span></label>
                                <input
                                    type="text"
                                    placeholder="예: 실적 발표일, 매수 목표가 도달 체크"
                                    value={addForm.title}
                                    onChange={e => setAddForm({ ...addForm, title: e.target.value })}
                                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    autoFocus
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-muted-foreground mb-1 block">날짜</label>
                                    <input
                                        type="date"
                                        value={addForm.date}
                                        onChange={e => setAddForm({ ...addForm, date: e.target.value })}
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-muted-foreground mb-1 block">알림</label>
                                    <select
                                        value={addForm.reminderType}
                                        onChange={e => setAddForm({ ...addForm, reminderType: e.target.value as any })}
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    >
                                        <option value="없음">알림 없음</option>
                                        <option value="당일">당일 알림</option>
                                        <option value="1일 전">1일 전</option>
                                        <option value="3일 전">3일 전</option>
                                        <option value="1주일 전">1주일 전</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-muted-foreground mb-1 block">관련 종목 코드 (선택)</label>
                                <input
                                    type="text"
                                    placeholder="예: 005930"
                                    value={addForm.code}
                                    onChange={e => setAddForm({ ...addForm, code: e.target.value })}
                                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-muted-foreground mb-1 block">메모/상세 내용</label>
                                <textarea
                                    placeholder="일정과 관련된 상세 내용을 입력하세요."
                                    value={addForm.description}
                                    onChange={e => setAddForm({ ...addForm, description: e.target.value })}
                                    className="w-full h-32 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                                />
                            </div>
                        </div>

                        <div className="px-5 py-4 border-t border-border bg-muted/30 flex justify-end gap-2">
                            <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm font-bold text-muted-foreground hover:bg-muted/80 rounded-md transition-colors">취소</button>
                            <button onClick={handleAddEvent} className="px-6 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-md hover:bg-primary/90 transition-colors shadow-sm">일정 저장</button>
                        </div>
                    </div>
                </div>
            )}

            {selectedDateForEvents && !selectedEvent && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setSelectedDateForEvents(null)}>
                    <div className="bg-background w-full max-w-sm rounded-xl shadow-2xl border border-border flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
                            <h3 className="font-bold text-[15px]">{selectedDateForEvents.date} 일정</h3>
                            <button onClick={() => setSelectedDateForEvents(null)} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
                        </div>
                        <div className="p-4 flex flex-col gap-2 max-h-[300px] overflow-y-auto">
                            {selectedDateForEvents.events.map(evt => (
                                <div key={evt.id} onClick={() => { setSelectedEvent(evt); setIsEditing(false); }} className={`p-2 rounded-lg border cursor-pointer hover:bg-muted/50 ${evt.isMarketEvent ? 'border-blue-500/30' : evt.isMemo ? 'border-amber-500/30' : 'border-green-500/30'}`}>
                                    <div className={`font-bold text-sm mb-1 ${evt.isMarketEvent ? 'text-blue-500' : evt.isMemo ? 'text-amber-500' : 'text-green-500'}`}>{evt.title}</div>
                                    <div className="text-xs text-muted-foreground">알림: {evt.reminderType} {evt.code && !evt.isMemo && `| 종목: ${evt.code}`}</div>
                                </div>
                            ))}
                        </div>
                        <div className="p-3 border-t border-border bg-muted/10">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setAddForm({ ...addForm, date: selectedDateForEvents.date });
                                    setSelectedDateForEvents(null);
                                    setShowAddModal(true);
                                }}
                                className="w-full flex items-center justify-center gap-1 py-2 text-xs font-bold text-primary hover:bg-primary/5 rounded-lg transition-colors"
                            >
                                <Plus size={14} /> 이 날짜에 일정 추가
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {selectedEvent && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => { setSelectedEvent(null); setIsEditing(false); }}>
                    <div className="bg-background w-full max-w-[800px] max-h-[85vh] rounded-xl shadow-2xl border border-border flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
                            <h3 className="font-bold text-[15px] flex items-center gap-2">
                                {selectedEvent.isMarketEvent ? '🏛 DART 공시 / 시장 일정' : selectedEvent.isMemo ? `📝 ${selectedEvent.title}` : '📅 사용자 일정'}
                            </h3>
                            <button onClick={() => { setSelectedEvent(null); setIsEditing(false); }} className="text-muted-foreground hover:text-foreground p-1 transition-colors"><X size={18} /></button>
                        </div>

                        <div className="p-5 flex flex-col gap-4 flex-1 overflow-y-auto min-h-0">
                            {!isEditing ? (
                                <>
                                    <div>
                                        {!selectedEvent.isMemo && <h4 className="font-bold text-lg text-foreground mb-2">{selectedEvent.title}</h4>}
                                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                            <span className="bg-muted px-2 py-1 rounded-md border border-border">📅 {selectedEvent.date}</span>
                                            {selectedEvent.code && !selectedEvent.isMemo && <span className="bg-primary/10 text-primary px-2 py-1 rounded-md border border-primary/20">종목코드: {selectedEvent.code}</span>}
                                            {selectedEvent.reminderType && selectedEvent.reminderType !== '없음' && (
                                                <span className="bg-secondary/20 text-secondary-foreground px-2 py-1 rounded-md border border-border">🔔 알림: {selectedEvent.reminderType}</span>
                                            )}
                                            {selectedEvent.source === 'DART' && selectedEvent.originId && (
                                                <button
                                                    onClick={() => window.open(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${selectedEvent.originId}`, '_blank', 'width=1200,height=1000')}
                                                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-green-500/10 text-green-600 text-[11px] font-bold border border-green-500/20 hover:bg-green-500/20 transition-colors"
                                                >
                                                    <ExternalLink size={12} /> DART 원문보기
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <hr className="border-border/50" />

                                    {selectedEvent.description && (
                                        <div className="text-[14px] text-foreground">
                                            {selectedEvent.isMemo ? (
                                                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed break-all prose-p:my-1 prose-headings:my-3">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                        {selectedEvent.description}
                                                    </ReactMarkdown>
                                                </div>
                                            ) : (
                                                <p className="whitespace-pre-wrap leading-relaxed break-all">{selectedEvent.description}</p>
                                            )}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="space-y-4">
                                    {!selectedEvent.isMemo && (
                                        <div>
                                            <label className="text-xs font-bold text-muted-foreground mb-1 block">제목</label>
                                            <input type="text" value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                                        </div>
                                    )}
                                    <div className="flex gap-4">
                                        <div className="flex-1">
                                            <label className="text-xs font-bold text-muted-foreground mb-1 block">목표 일자</label>
                                            <input type="date" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-xs font-bold text-muted-foreground mb-1 block">알림</label>
                                            <select value={editForm.reminderType} onChange={e => setEditForm({ ...editForm, reminderType: e.target.value })} className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                                                <option value="없음">알림 없음</option>
                                                <option value="당일">당일 알림</option>
                                                <option value="1일 전">1일 전</option>
                                                <option value="3일 전">3일 전</option>
                                                <option value="1주일 전">1주일 전</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-muted-foreground mb-1 block">내용</label>
                                        <textarea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} className="w-full h-32 bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none font-mono" />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="px-5 py-4 border-t border-border bg-muted/30 flex justify-between items-center">
                            {!selectedEvent.isMarketEvent && !isEditing ? (
                                <div className="flex gap-2">
                                    <button onClick={() => startEdit(selectedEvent)} className="px-4 py-2 text-xs font-bold bg-muted text-muted-foreground hover:text-primary rounded-md transition-colors">수정</button>
                                    <button onClick={deleteCurrentEvent} className="px-4 py-2 text-xs font-bold bg-muted text-muted-foreground hover:text-destructive rounded-md transition-colors">삭제</button>
                                </div>
                            ) : <div />}

                            <div className="flex gap-2">
                                {isEditing ? (
                                    <>
                                        <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm font-bold text-muted-foreground hover:bg-muted/80 rounded-md transition-colors">취소</button>
                                        <button onClick={saveEdit} className="px-5 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-md hover:bg-primary/90 transition-colors">저장</button>
                                    </>
                                ) : (
                                    <button onClick={() => { setSelectedEvent(null); setIsEditing(false); }} className="px-5 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-md hover:bg-primary/90 transition-colors">닫기</button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
