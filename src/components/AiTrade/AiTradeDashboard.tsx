import React, { useState } from 'react'
import LiveTradeTab from './LiveTradeTab'
import StrategyReviewTab from './StrategyReviewTab'
import HistoryTab from './HistoryTab'
import { Activity, Brain, LineChart } from 'lucide-react'

export default function AiTradeDashboard() {
    const [activeTab, setActiveTab] = useState<'live' | 'strategy' | 'history'>('live')

    return (
        <div className="flex flex-col h-full bg-background pt-6 px-6 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 shrink-0 border-b border-border">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Brain className="text-primary" />
                        AI Trade Dashboard
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">AI 자동매매(데이트레이딩) 가상 샌드박스 및 리더보드</p>
                </div>

                {/* Sub-Tabs Navigation */}
                <div className="flex gap-1 bg-muted/50 p-1 rounded-xl">
                    <button
                        onClick={() => setActiveTab('live')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'live' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Activity size={16} />
                        Live Trade
                    </button>
                    <button
                        onClick={() => setActiveTab('strategy')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'strategy' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Brain size={16} />
                        Strategy & Evolution
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'history' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <LineChart size={16} />
                        History & PnL
                    </button>
                </div>
            </div>

            {/* Tab Content Area (No Card Padding/Borders) */}
            <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
                {activeTab === 'live' && <LiveTradeTab />}
                {activeTab === 'strategy' && <StrategyReviewTab />}
                {activeTab === 'history' && <HistoryTab />}
            </div>
        </div>
    )
}
