import React, { Component, ErrorInfo, ReactNode, useState, useEffect } from 'react'
import { Settings as SettingsIcon, AlertTriangle, Moon, Sun } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import TitleBar from './components/TitleBar'
import Sidebar, { menuItems } from './components/Sidebar'
import Holdings from './components/Holdings'
import Watchlist from './components/Watchlist'
import Settings from './components/Settings'
import AutoTrade from './components/AutoTrade'
import CapturePage from './components/CapturePage'

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
    constructor(props: { children: ReactNode }) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-foreground p-10 select-text">
                    <div className="bg-destructive/10 border border-destructive/20 p-8 rounded-2xl max-w-2xl w-full space-y-4">
                        <div className="flex items-center gap-3 text-destructive">
                            <AlertTriangle size={32} />
                            <h1 className="text-2xl font-bold">애플리케이션 오류 발생</h1>
                        </div>
                        <p className="text-muted-foreground">앱을 렌더링하는 중에 예상치 못한 오류가 발생했습니다.</p>
                        <div className="bg-black/50 p-4 rounded-xl overflow-auto font-mono text-sm border border-white/5">
                            {this.state.error?.toString()}
                        </div>
                        <button
                            onClick={() => window.location.reload()}
                            className="bg-primary text-primary-foreground px-6 py-2 rounded-xl font-bold"
                        >
                            앱 다시 시작
                        </button>
                    </div>
                </div>
            )
        }
        return this.props.children
    }
}

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export default function App() {
    return (
        <ErrorBoundary>
            <AppContent />
        </ErrorBoundary>
    )
}

function AppContent() {
    const [activeTab, setActiveTab] = useState('holdings')
    const [isDarkMode, setIsDarkMode] = useState(() => {
        // Use system theme by default
        return window.matchMedia('(prefers-color-scheme: dark)').matches
    })

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        const handleChange = (e: MediaQueryListEvent) => {
            setIsDarkMode(!e.matches)
        }
        mediaQuery.addEventListener('change', handleChange)
        return () => mediaQuery.removeEventListener('change', handleChange)
    }, [])

    const [captureMode, setCaptureMode] = useState<{ code: string, name: string, theme: string } | null>(null)

    useEffect(() => {
        // Simple hash-based router for offscreen capture mode
        const hash = window.location.hash
        if (hash.startsWith('#/capture/')) {
            const [pathPart, queryPart] = hash.split('?')
            const parts = pathPart.split('/')
            if (parts.length >= 3) {
                const code = parts[2]
                const name = decodeURIComponent(parts[3] || code)
                const theme = queryPart && queryPart.includes('theme=light') ? 'light' : 'dark'
                setCaptureMode({ code, name, theme })
            }
        }
    }, [])

    const [status, setStatus] = useState({ connected: false, mockConnected: false, realConnected: false })

    useEffect(() => {
        const checkStatus = async () => {
            const currentStatus = await window.electronAPI.getConnectionStatus()
            setStatus(currentStatus)
        }

        checkStatus()
        const interval = setInterval(checkStatus, 5000)
        return () => clearInterval(interval)
    }, [])

    // Market Hours Auto-Refresh (1 minute interval)
    useEffect(() => {
        const isMarketOpen = () => {
            // Get current time in KST (UTC+9)
            const now = new Date()
            const kstOffset = 9 * 60 // KST is UTC+9
            const kstTime = new Date(now.getTime() + (now.getTimezoneOffset() + kstOffset) * 60000)

            const day = kstTime.getDay() // 0: Sun, 1: Mon, ..., 6: Sat
            const hours = kstTime.getHours()
            const minutes = kstTime.getMinutes()
            const currentTime = hours * 100 + minutes

            // Market open: Mon-Fri, 09:00 - 15:30
            const isWeekday = day >= 1 && day <= 5
            const isDuringHours = currentTime >= 900 && currentTime <= 1530

            return isWeekday && isDuringHours
        }

        const autoRefresh = () => {
            if (isMarketOpen()) {
                console.log('Market is open. Triggering auto-refresh...')
                window.dispatchEvent(new CustomEvent('kiwoom:refresh-data'))
            }
        }

        const interval = setInterval(autoRefresh, 60000) // 1 minute
        return () => clearInterval(interval)
    }, [])

    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }, [isDarkMode])

    if (captureMode) {
        return <CapturePage code={captureMode.code} name={captureMode.name} theme={captureMode.theme} />
    }

    return (
        <div className="flex flex-col h-screen bg-background text-foreground transition-colors duration-300">
            <TitleBar
                isDarkMode={isDarkMode}
                onToggleTheme={() => setIsDarkMode(!isDarkMode)}
            />

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <Sidebar
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                />

                {/* Main Content */}
                <main className="flex-1 overflow-hidden bg-background flex flex-col">
                    <div className="w-full h-full flex flex-col min-h-0">
                        {activeTab === 'holdings' && <Holdings />}
                        {activeTab === 'watchlist' && <Watchlist />}
                        {activeTab === 'auto-trade' && <AutoTrade />}
                        {activeTab === 'settings' && <Settings />}

                        {(activeTab !== 'holdings' && activeTab !== 'watchlist' && activeTab !== 'settings' && activeTab !== 'auto-trade') && (
                            <div className="flex flex-col items-center justify-center py-20 opacity-50 space-y-4">
                                <div className="p-6 bg-muted rounded-full">
                                    <SettingsIcon size={48} className="text-muted-foreground animate-pulse" />
                                </div>
                                <h2 className="text-xl font-semibold">{menuItems.find(i => i.id === activeTab)?.name} 화면 준비 중</h2>
                                <p className="text-sm">현재 Phase 1 개발 진행 중입니다.</p>
                            </div>
                        )}
                    </div>
                </main>
            </div>

            {/* Status Bar */}
            <footer className="h-6 px-4 bg-muted/80 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5 font-medium">
                        <div className={cn(
                            "w-2 h-2 rounded-full",
                            status.connected ? "bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]" : "bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.5)]"
                        )} />
                        <span>{status.connected ? '키움 API 서비스 정상 (실전)' : 'API 서비스 연결오류 또는 대기중'}</span>
                    </div>
                </div>
                <div>
                    마지막 동기화: {new Date().toLocaleTimeString()}
                </div>
            </footer>
        </div>
    )
}
