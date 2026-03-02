import { useEffect, useRef } from 'react'
import { useScheduleStore } from '../store/useScheduleStore'
import { useNoteStore } from '../store/useNoteStore'

function isTimeMatch(alertTime: string) {
    const now = new Date()
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    return timeStr === alertTime
}

function calculateTargetDate(eventDateStr: string, reminderType: string): string | null {
    if (!reminderType || reminderType === '없음') return null

    const eventDate = new Date(eventDateStr)

    if (reminderType === '당일') {
        // no change
    } else if (reminderType === '1일 전') {
        eventDate.setDate(eventDate.getDate() - 1)
    } else if (reminderType === '3일 전') {
        eventDate.setDate(eventDate.getDate() - 3)
    } else if (reminderType === '1주일 전') {
        eventDate.setDate(eventDate.getDate() - 7)
    }

    return eventDate.toISOString().split('T')[0]
}

export function useScheduleNotifier(alertTime: string = '08:30') {
    const { events, updateEvent } = useScheduleStore()
    const { notes, updateNote } = useNoteStore()
    const lastCheckedTime = useRef<string | null>(null)

    useEffect(() => {
        // Run every 20 seconds to guarantee picking up the exact minute
        const intervalId = setInterval(() => {
            const now = new Date()
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
            const dateStr = now.toISOString().split('T')[0]

            // If we hit the alert minute and haven't processed it yet
            if (timeStr === alertTime && lastCheckedTime.current !== timeStr) {
                lastCheckedTime.current = timeStr

                // 1. Process standard schedule events
                events.forEach(evt => {
                    if (evt.isNotified || !evt.reminderType || evt.reminderType === '없음') return

                    const targetDateStr = calculateTargetDate(evt.date, evt.reminderType)
                    if (targetDateStr === dateStr) {
                        const dDayStr = evt.reminderType === '당일' ? '(D-Day)' : `(${evt.reminderType} 알림)`
                        const msg = `📅 [일정 알림] ${evt.title}\n일자: ${evt.date} ${dDayStr}\n${evt.code ? `관련 종목: ${evt.code}` : ''}\n${evt.description || ''}`

                        window.electronAPI?.sendTelegramMessage(msg).then((res: any) => {
                            if (res?.success) updateEvent(evt.id, { isNotified: true })
                        }).catch(console.error)
                    }
                })

                // 2. Process memo/note events 
                notes.forEach(note => {
                    if (!note.targetDate || !note.reminderType || note.reminderType === '없음' || note.isNotified) return

                    const targetDateStr = calculateTargetDate(note.targetDate, note.reminderType)
                    if (targetDateStr === dateStr) {
                        const dDayStr = note.reminderType === '당일' ? '(D-Day)' : `(${note.reminderType} 알림)`
                        const msg = `📝 [메모 알림] 종목코드: ${note.stockCode}\n목표 일자: ${note.targetDate} ${dDayStr}\n\n내용:\n${note.content.substring(0, 300)}`

                        window.electronAPI?.sendTelegramMessage(msg).then((res: any) => {
                            if (res?.success) updateNote(note.id, note.content, note.targetDate, note.reminderType, true)
                        }).catch(console.error)
                    }
                })

            }

            // reset lastCheckedTime if minute passes
            if (timeStr !== alertTime) {
                lastCheckedTime.current = null
            }

        }, 20000) // 20 sec interval

        return () => clearInterval(intervalId)
    }, [events, notes, alertTime])
}
