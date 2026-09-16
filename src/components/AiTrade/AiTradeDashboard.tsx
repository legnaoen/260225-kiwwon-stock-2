import React, { useState } from 'react'
import LiveTradeTab from './LiveTradeTab'
import StrategyReviewTab from './StrategyReviewTab'
import HistoryTab from './HistoryTab'
import { Activity, Brain, LineChart, AlertTriangle } from 'lucide-react'

export default function AiTradeDashboard() {
    const [activeTab, setActiveTab] = useState<'live' | 'strategy' | 'history'>('history')

    return (
        <div className="flex flex-col h-full bg-background pt-6 px-6 overflow-hidden">
            {/* Deprecation Warning Banner */}
            <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 mb-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
                    <AlertTriangle size={18} />
                    <span>[시스템 공지] 종목 AI 자동매매 엔진이 공식 폐기되었습니다. (과거 거래 이력 및 차트 조회 전용)</span>
                </div>
                <span className="text-xs text-muted-foreground">백테스트 손익비 미달 및 상투 진입 리스크로 인한 영구 비활성화</span>
            </div>

            {/* Header */}
            <div className="flex items-center justify-between pb-4 shrink-0 border-b border-border">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Brain className="text-muted-foreground" />
                        AI Trade Dashboard <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">폐기됨 (Deprecated)</span>
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">AI 자동매매 엔진 폐기 완료 — 과거 기록 및 리더보드 아카이브</p>
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
