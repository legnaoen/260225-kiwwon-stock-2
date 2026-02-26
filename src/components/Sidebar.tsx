import { useState, useEffect } from 'react'
import { LayoutDashboard, ListOrdered, History, Settings } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export const menuItems = [
    { id: 'holdings', name: '보유종목', icon: LayoutDashboard },
    { id: 'watchlist', name: '관심종목', icon: ListOrdered },
    { id: 'orders', name: '주문내역', icon: History },
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

            <div className="py-6 w-full flex flex-col items-center mt-auto">
                <div title={status.connected ? '키움증권 연결됨 (실전)' : '연결 끊김'} className="p-2">
                    <div className={cn(
                        "w-2.5 h-2.5 rounded-full ring-4 shadow-sm",
                        status.connected ? "bg-rise ring-rise/20 animate-pulse" : "bg-muted-foreground ring-muted-foreground/20"
                    )} />
                </div>
            </div>
        </aside>
    )
}
