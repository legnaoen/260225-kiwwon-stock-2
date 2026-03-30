import { useState, useEffect } from 'react'
import { LayoutDashboard, ListOrdered, History, Settings, Bot, Calendar, Wallet, Brain, TrendingUp, BookOpen, Network, Globe, LineChart, Server, Sparkles, Activity } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export const menuItems = [
    { id: 'dashboard', name: '대시보드', icon: LayoutDashboard },
    { id: 'pipeline-monitor', name: '데이터 관제', icon: Server },
    { id: 'maiis-command', name: '종합 관제', icon: Network },
    { id: 'pm-tracker', name: 'PM 트래커', icon: LineChart },
    { id: 'macro-dashboard', name: '글로벌 매크로', icon: Globe },
    { id: 'holdings', name: '보유종목', icon: Wallet },
    /* [V1 Legacy] 추후 재활용을 위해 UI 라우팅만 중단 (컴포넌트는 보존)
    { id: 'watchlist', name: '관심종목', icon: ListOrdered },
    */
    { id: 'market-agent', name: '시황 AI', icon: Sparkles },
    { id: 'issue-agent', name: '이슈 AI', icon: Brain },
    { id: 'theme-tracker', name: '테마 AI', icon: Activity },
    { id: 'rising-stocks', name: '급등주', icon: TrendingUp },
    { id: 'narrative-insight', name: '내러티브', icon: Brain },
    /* [V1 Legacy]
    { id: 'schedule', name: '일정', icon: Calendar },
    { id: 'auto-trade', name: '자동매매', icon: Bot },
    { id: 'ai-trade', name: 'AI Trade', icon: Brain },
    */
    { id: 'settings', name: '설정', icon: Settings },
]

interface SidebarProps {
    activeTab: string
    onTabChange: (id: string) => void
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
    const [status, setStatus] = useState({ connected: false, realConnected: false, mockConnected: false })

    useEffect(() => {
        const checkStatus = async () => {
            const currentStatus = await window.electronAPI.getConnectionStatus()
            setStatus(currentStatus)
        }

        checkStatus()
        const interval = setInterval(checkStatus, 5000)
        return () => clearInterval(interval)
    }, [])

    return (
        <aside className="w-[84px] shrink-0 flex flex-col items-center border-r bg-muted/30">
            <nav className="flex-1 w-full flex flex-col items-center space-y-2 py-4">
                {menuItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => onTabChange(item.id)}
                        className={cn(
                            "flex flex-col items-center justify-center gap-1.5 w-[68px] h-[68px] rounded-xl transition-all duration-200 group text-[11px] font-medium",
                            activeTab === item.id
                                ? "bg-card text-primary shadow-sm border border-border"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
                        )}
                    >
                        <item.icon size={22} className={cn(
                            "transition-transform group-hover:scale-110",
                            activeTab === item.id ? "text-primary" : "text-muted-foreground"
                        )} />
                        {item.name}
                    </button>
                ))}
            </nav>
        </aside>
    )
}
