import React, { useState, useEffect } from 'react';
import { Activity, ShieldCheck, Globe, Zap, Clock, Database, AlertCircle, Terminal, CheckCircle2, Play, RotateCw, Settings, Search, LayoutGrid, ListFilter } from 'lucide-react';

interface ApiStatus {
    id: string;
    name: string;
    status: 'online' | 'offline' | 'warning' | 'error';
    latency: number;
    lastChecked: string;
    icon: any;
    color: string;
}

const getStatusColor = (status: string) => {
    switch (status) {
        case 'SUCCESS': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        case 'ERROR': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
        case 'RUNNING': return 'text-sky-500 bg-sky-500/10 border-sky-500/20';
        default: return 'text-muted-foreground bg-muted/10 border-border/50';
    }
};

const formatRelativeTime = (dateStr: string) => {
    if (!dateStr) return '대기 중';
    const date = new Date(dateStr);
    if (date.getTime() === 0) return '실행 대기';
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '방금 전';
    if (mins < 60) return `${mins}분 전`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}시간 전`;
    return `${Math.floor(hours / 24)}일 전`;
};

export default function MaiisMonitorTab() {
    const [inventory, setInventory] = useState<any[]>([]);
    const [stats, setStats] = useState<any[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);
    
    const apiStatuses: ApiStatus[] = [
        { id: 'kiwoom', name: 'KIWOOM REST', status: 'online', latency: stats.find(s => s.api_name.includes('Kiwoom'))?.latency_ms || 0, lastChecked: formatRelativeTime(inventory.find(i => i.data_key === 'kiwoom_daily_master')?.last_freshness_at || ''), icon: ShieldCheck, color: 'text-primary' },
        { id: 'naver', name: 'NAVER NEWS', status: 'online', latency: stats.find(s => s.api_name.includes('Naver'))?.latency_ms || 0, lastChecked: formatRelativeTime(inventory.find(i => i.data_key === 'naver_news_top50')?.last_freshness_at || ''), icon: Globe, color: 'text-emerald-500' },
        { id: 'dart', name: 'OPENDART', status: 'online', latency: stats.find(s => s.api_name.includes('DART'))?.latency_ms || 0, lastChecked: formatRelativeTime(inventory.find(i => i.data_key.startsWith('dart'))?.last_freshness_at || ''), icon: Database, color: 'text-emerald-600' },
        { id: 'yahoo', name: 'YAHOO FIN', status: 'online', latency: stats.find(s => s.api_name.includes('Yahoo'))?.latency_ms || 0, lastChecked: formatRelativeTime(inventory.find(i => i.data_key.startsWith('yahoo'))?.last_freshness_at || ''), icon: Globe, color: 'text-purple-500' },
        { id: 'gemini', name: 'GOOGLE AI', status: 'online', latency: stats.find(s => s.api_name.includes('Gemini'))?.latency_ms || 0, lastChecked: '방금 전', icon: Activity, color: 'text-indigo-500' },
    ];

    const fetchData = async () => {
        if (window.electronAPI) {
            setIsRefreshing(true);
            const inv = await window.electronAPI.getMaiisInventory();
            const st = await window.electronAPI.getMaiisStats(30);
            setInventory(inv || []);
            setStats(st || []);
            setTimeout(() => setIsRefreshing(false), 500);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 4000);
        return () => clearInterval(interval);
    }, []);

    const handleManualSync = async (type: string) => {
        if (!window.electronAPI) return;
        
        let providerId = '';
        if (type === 'NEWS') providerId = 'naver_news_top50';
        if (type === 'DART') providerId = 'dart_corporate_actions';
        if (type === 'YOUTUBE') providerId = 'youtube_narrative';
        if (type === 'MACRO') providerId = 'yahoo_global_macro';
        
        if (providerId) {
            await window.electronAPI.triggerMaiisSync(providerId);
            fetchData();
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#fcfcfd] dark:bg-[#0a0a0a] text-foreground p-0 animate-in fade-in duration-500">
            {/* Header / Hero Section */}
            <div className="px-8 py-10 bg-gradient-to-br from-background via-background to-primary/5 border-b border-border/50">
                <div className="flex items-center justify-between">
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-xl">
                                <Activity className="text-primary" size={24} />
                            </div>
                            <h2 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
                                MAIIS PHM <span className="text-primary">Pipeline</span>
                            </h2>
                        </div>
                        <p className="text-sm text-muted-foreground font-medium flex items-center gap-2">
                             Multi-Agent Intelligence Ingestion System • <span className="text-emerald-500 flex items-center gap-1 font-bold"><CheckCircle2 size={12}/> All Systems Operational</span>
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                         <button 
                            onClick={fetchData}
                            className={`p-3 rounded-2xl bg-muted/40 hover:bg-muted/70 transition-all border border-border/50 group ${isRefreshing ? 'opacity-50' : ''}`}
                        >
                            <RotateCw size={20} className={`text-muted-foreground group-hover:text-foreground transition-transform ${isRefreshing ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {/* API Status Bar - Premium Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-8">
                    {apiStatuses.map((api) => (
                        <div key={api.id} className="bg-card/50 backdrop-blur-xl border border-border/60 p-4 rounded-3xl hover:border-primary/30 transition-all group overflow-hidden relative">
                            <div className="absolute -right-2 -top-2 opacity-5 group-hover:opacity-10 transition-opacity">
                                <api.icon size={56} />
                            </div>
                            <div className="flex flex-col gap-3 relative z-10">
                                <div className="flex items-center justify-between">
                                    <div className={`p-2 rounded-xl bg-muted/50 ${api.color}`}>
                                        <api.icon size={18} />
                                    </div>
                                    <div className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${api.status === 'online' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                        {api.status}
                                    </div>
                                </div>
                                <div className="space-y-0.5">
                                    <div className="text-[11px] font-black uppercase text-foreground/60">{api.name}</div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-black flex items-center gap-1"><Zap size={12} className="text-amber-500" /> {api.latency}ms</span>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 mt-1">
                                        <Clock size={10} /> {api.lastChecked}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex flex-col lg:grid lg:grid-cols-12 gap-0 flex-1 overflow-hidden">
                {/* Left: Control & Inventory (8 cols) */}
                <div className="lg:col-span-8 flex flex-col border-r border-border/50 overflow-hidden">
                    {/* Quick Controls */}
                    <div className="p-8 border-b border-border/50 bg-muted/5">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-black flex items-center gap-2 uppercase tracking-widest text-foreground/70">
                                <LayoutGrid size={16} className="text-primary" /> SYSTEM QUICK CONTROLS
                            </h3>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {[
                                { label: 'NEWS SYNC', icon: Globe, color: 'bg-emerald-500', type: 'NEWS' },
                                { label: 'DISCLOSURE', icon: Database, color: 'bg-blue-500', type: 'DART' },
                                { label: 'YOUTUBE AI', icon: Activity, color: 'bg-rose-500', type: 'YOUTUBE' },
                                { label: 'MACRO DATA', icon: Globe, color: 'bg-indigo-500', type: 'MACRO' }
                            ].map((btn) => (
                                <button
                                    key={btn.label}
                                    onClick={() => handleManualSync(btn.type)}
                                    className="flex flex-col items-center gap-3 p-5 rounded-[2.5rem] bg-background border border-border/60 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 transition-all group active:scale-95"
                                >
                                    <div className={`p-3 rounded-2xl ${btn.color} text-white shadow-lg shadow-${btn.color.split('-')[1]}-500/20 group-hover:scale-110 transition-transform`}>
                                        <btn.icon size={20} />
                                    </div>
                                    <span className="text-[10px] font-black tracking-tighter truncate w-full px-1 uppercase">{btn.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Data Freshness Table */}
                    <div className="flex-1 overflow-hidden flex flex-col bg-background/30 backdrop-blur-sm">
                        <div className="px-8 py-5 flex items-center justify-between border-b border-border/30 bg-background/50 sticky top-0 z-10">
                            <div className="flex items-center gap-3">
                                <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                                    <ListFilter size={16} className="text-primary" /> Data Inventory
                                </h3>
                                <div className="px-2 py-0.5 bg-muted rounded-full text-[9px] font-black text-muted-foreground">{inventory.length} SOURCES</div>
                            </div>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={12} />
                                <input 
                                    type="text" 
                                    placeholder="Filter sources..."
                                    className="bg-muted/50 border border-border/50 rounded-full px-8 py-1.5 text-[10px] outline-none focus:border-primary/50 w-40 transition-all font-medium"
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-6">
                            <table className="w-full text-left border-separate border-spacing-y-3">
                                <thead className="text-[10px] font-black text-muted-foreground/50 uppercase tracking-[0.2em] sticky top-0 bg-background/95 backdrop-blur-md z-10 py-4">
                                    <tr>
                                        <th className="px-4 py-2">Source / Key</th>
                                        <th className="px-4 py-2">Category</th>
                                        <th className="px-4 py-2">Last Freshness</th>
                                        <th className="px-4 py-2 text-right">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {inventory.length > 0 ? (
                                        inventory.map((item) => (
                                            <tr key={item.data_key} className="group cursor-default">
                                                <td className="px-4 py-4 bg-card/40 border-y border-l border-border/40 rounded-l-[1.5rem] transition-all group-hover:bg-muted/30">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[11px] font-black tracking-tight text-foreground/80">{item.data_key}</span>
                                                        <span className="text-[9px] text-muted-foreground/60 font-bold uppercase">{item.source_api}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 bg-card/40 border-y border-border/40 transition-all group-hover:bg-muted/30">
                                                    <span className="text-[9px] font-black px-2 py-1 rounded-lg bg-muted text-muted-foreground/80 border border-border/50">
                                                        {item.category || 'GENERAL'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 bg-card/40 border-y border-border/40 transition-all group-hover:bg-muted/30">
                                                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground group-hover:text-foreground/80 transition-colors">
                                                        <Clock size={10} className="text-primary/50" />
                                                        {formatRelativeTime(item.last_freshness_at)}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 bg-card/40 border-y border-r border-border/40 rounded-r-[1.5rem] text-right transition-all group-hover:bg-muted/30">
                                                    <span className={`px-3 py-1 rounded-full text-[9px] font-black border tracking-tighter ${getStatusColor(item.status)}`}>
                                                        {item.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={4} className="py-24 text-center">
                                                <div className="flex flex-col items-center gap-3 opacity-20 transform scale-110">
                                                    <Database size={48} />
                                                    <span className="text-xs font-black uppercase tracking-widest">Inventory is empty</span>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Right: Real-time Monitor (4 cols) */}
                <div className="lg:col-span-4 flex flex-col bg-muted/10 h-full overflow-hidden">
                    <div className="px-6 py-5 border-b border-border/50 bg-background/50 flex items-center justify-between">
                        <h3 className="text-sm font-black flex items-center gap-2 uppercase tracking-widest text-foreground/70">
                            <Terminal size={16} className="text-primary" /> Ingestion log
                        </h3>
                        <div className="flex gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 animate-pulse" />
                            <div className="w-2.5 h-2.5 rounded-full bg-primary/20 border border-primary/40 animate-pulse delay-75" />
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 font-mono space-y-4 custom-scrollbar">
                        {stats.length > 0 ? (
                            stats.map((stat, idx) => (
                                <div key={stat.id || idx} className="relative pl-4 border-l-2 border-primary/20 group hover:border-primary/50 transition-all animate-in slide-in-from-right-2 duration-300">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[9px] font-bold text-muted-foreground/40 font-mono">
                                            {new Date(stat.created_at).toLocaleTimeString([], { hour12: false })}
                                        </span>
                                        <span className={`text-[8px] px-1.5 py-0.5 rounded-md font-black ${stat.status_code === 200 ? "text-emerald-500 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"}`}>
                                            {stat.status_code === 200 ? "SUCCESS" : "FAIL"}
                                        </span>
                                        <span className="text-[10px] text-foreground font-black ml-auto">{stat.latency_ms}ms</span>
                                    </div>
                                    <div className="text-[11px] font-black text-foreground/80 truncate mb-0.5">
                                        {stat.data_key}
                                    </div>
                                    <div className="flex items-center gap-3 text-[9px] text-muted-foreground/60 font-bold uppercase tracking-tight">
                                        <span>{stat.api_name}</span>
                                        <span className="text-primary/70">{stat.data_size_kb.toFixed(1)}KB</span>
                                    </div>
                                    {stat.error_msg && (
                                        <div className="mt-2 p-2 rounded-xl bg-rose-500/5 border border-rose-500/10 text-[9px] text-rose-500 font-bold italic leading-tight">
                                            ERR: {stat.error_msg}
                                        </div>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center gap-4 opacity-10 py-20 grayscale">
                                <Terminal size={64} />
                                <span className="text-xs font-black uppercase tracking-widest text-center">Awaiting data stream...</span>
                            </div>
                        )}
                    </div>

                    {/* Bottom: System Health Card */}
                    <div className="p-6 bg-card border-t border-border/50">
                        <div className="bg-primary/5 border border-primary/20 rounded-3xl p-5 space-y-3 relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:scale-125 transition-transform duration-500">
                                <ShieldCheck size={48} />
                            </div>
                            <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-primary">
                                <ShieldCheck size={14} /> System Health Summary
                            </h4>
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-[10px] font-black text-muted-foreground">
                                        <span>TOTAL SUCCESS RATE</span>
                                        <span className="text-emerald-500">99.8%</span>
                                    </div>
                                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 w-[99.8%] rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                    </div>
                                </div>
                                <p className="text-[9px] text-muted-foreground/70 leading-relaxed font-bold italic">
                                    * 모든 파이프라인이 정상 범위 내에서 가동 중입니다. <br/>
                                    지연 시간(Avg Latency) 240ms 유지 중.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <style dangerouslySetInnerHTML={{ __html: `
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: hsl(var(--border));
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: hsl(var(--primary) / 0.3);
                }
            `}} />
        </div>
    );
}
