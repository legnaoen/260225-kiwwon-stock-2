import { useState, useEffect } from 'react'
import { LayoutDashboard, ListOrdered, History, Settings, Bot, Calendar, Wallet, Brain } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export const menuItems = [
    { id: 'dashboard', name: '대시보드', icon: LayoutDashboard },
    { id: 'holdings', name: '보유종목', icon: Wallet },
    { id: 'watchlist', name: '관심종목', icon: ListOrdered },
    { id: 'schedule', name: '일정', icon: Calendar },
    { id: 'auto-trade', name: '자동매매', icon: Bot },
    { id: 'ai-trade', name: 'AI Trade', icon: Brain },
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
        <aside className="w-[84px] shrink-0 flex flex-col items-center border-r border-border bg-muted/10">
            <nav className="flex-1 py-4 w-full flex flex-col items-center space-y-2">
                {menuItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => onTabChange(item.id)}
                        className={cn(
                            "flex flex-col items-center justify-center gap-1.5 w-[68px] h-[68px] rounded-2xl transition-all duration-200 group text-[11px] font-bold",
                            activeTab === item.id
                                ? "bg-primary/10 text-primary border border-primary/20 shadow-sm"
                                : "hover:bg-muted/50 text-muted-foreground hover:text-foreground border border-transparent"
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
