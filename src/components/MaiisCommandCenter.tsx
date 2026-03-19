import React, { useState } from 'react';
import { Terminal, X, ChevronUp, ChevronDown, Activity, Hash, Layers, Target, Clock, ArrowUpRight, TrendingUp, Database } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { MaiisAgentTester } from './MaiisAgentTester';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// Dummy SVG Chart Component for wireframe
const DummyChart = ({ color, trend }: { color: string, trend: 'up' | 'down' | 'flat' }) => {
    return (
        <svg className="w-full h-full" viewBox="0 0 100 40" preserveAspectRatio="none">
            {trend === 'up' && <path d="M0,35 Q20,30 40,25 T80,15 L100,5" fill="none" stroke={color} strokeWidth="2" />}
            {trend === 'down' && <path d="M0,5 Q20,10 40,20 T80,30 L100,35" fill="none" stroke={color} strokeWidth="2" />}
            {trend === 'flat' && <path d="M0,20 Q20,15 40,20 T80,25 L100,20" fill="none" stroke={color} strokeWidth="2" />}
            
            {/* Gradient under area */}
            <path d={trend === 'up' ? "M0,35 Q20,30 40,25 T80,15 L100,5 L100,40 L0,40 Z" : 
                     trend === 'down' ? "M0,5 Q20,10 40,20 T80,30 L100,35 L100,40 L0,40 Z" : 
                     "M0,20 Q20,15 40,20 T80,25 L100,20 L100,40 L0,40 Z"} 
                  fill={`url(#grad-${color})`} opacity="0.1" />
            <defs>
                <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="1" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
        </svg>
    )
}

export default function MaiisCommandCenter() {
    const [isTerminalOpen, setIsTerminalOpen] = useState(false);
    const [isTesterOpen, setIsTesterOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'theme' | 'keyword'>('theme');

    // Dummy Data
    const marketReports = [
        { date: '3/19', mode: 'Risk On', score: '0.00', text: 'AI 반도체는 어쩌고 저쩌고 시장을 주도하고 있으며 주가 상승을 견인했습니다. 기관 매수세가 강하게 유입되며 전반적인 투심을 끌어올리고 있습니다.' },
        { date: '3/18', mode: 'Risk On', score: '0.00', text: 'AI 반도체는 어쩌고 저쩌고 시장을 주도하고 있으며 주가 상승을 견인했습니다. 기관 매수세가 강하게 유입되며 전반적인 투심을 끌어올리고 있습니다.' },
        { date: '3/17', mode: 'Risk Off', score: '-1.50', text: '단기 과열 우려로 차익 실현 매물이 쏟아졌습니다. 방어주 위주의 포트폴리오 재편이 필요합니다.' },
        { date: '3/16', mode: 'Neutral', score: '0.20', text: '방향성 탐색 구간입니다. 주요 매크로 이벤트 대기 중이며 개별 이슈 장세가 펼쳐지고 있습니다.' }
    ];

    const keywordRankings = [
        { rank: 1, change: 3, isUp: true, badge: '#반도체 및 AI 모멘텀', weight: 92, text: '엔비디아 GTC 이벤트와 AI 수요 피크아웃 우려 해소로 반도체 대형주가 지수 상승을 견인했습니다.' },
        { rank: 2, change: -1, isUp: false, badge: '#전고체 배터리', weight: 85, text: '삼성SDI의 전고체 배터리 양산 로드맵 발표 이후 관련 소부장 기업들로 수급이 확산 중.' },
        { rank: 3, change: 0, isUp: true, badge: '#밸류업 프로그램', weight: 78, text: '저PBR 관련주들의 배당 및 자사주 소각 기대감이 유지되며 지루한 박스권을 방어하고 있습니다.' },
        { rank: 4, change: 5, isUp: true, badge: '#비만치료제 K-바이오', weight: 65, text: '글로벌 비만치료제 열풍 속 국내 관련 임상 파이프라인 보유 기업들에 단기 투기성 자금 유입.' }
    ];

    const sectorRankings = [
        { rank: 1, change: 2, isUp: true, badge: 'IT 하드웨어 (반도체)', weight: 95, text: '엔비디아 GTC 이벤트와 AI 수요 피크아웃 우려 해소로 반도체 대형주가 지수 상승을 견인했습니다.' },
        { rank: 2, change: -1, isUp: false, badge: '금융 (은행/지주)', weight: 82, text: '주주환원율 제고 기대감에 외인 매수세 지속 중.' },
        { rank: 3, change: 1, isUp: true, badge: '건강관리 (바이오)', weight: 75, text: '금리 인하 기대감 선반영 및 각종 임상 데이터 발표 모멘텀.' },
        { rank: 4, change: -2, isUp: false, badge: '자동차 및 부품', weight: 60, text: '피크아웃 우려 대비 호실적 기대감에 하방 경직성 확보.' }
    ];

    const recommendedStocks = [
        { rank: 1, change: 3, isUp: true, name: '삼성전자', score: 98, profit: '00.00%', days: '24d', reason: '글로벌 AI 메모리 수요 증가 및 파운드리 실적 턴어라운드 기대.' },
        { rank: 2, change: -1, isUp: false, name: 'SK하이닉스', score: 95, profit: '12.45%', days: '15d', reason: 'HBM 시장 독점력 유지 및 차세대 메모리 단가 인상 수혜.' },
        { rank: 3, change: 2, isUp: true, name: '한미반도체', score: 92, profit: '45.10%', days: '40d', reason: 'TC본더 글로벌 독점적 지위. 엔비디아-SKH 생태계 핵심 체인.' },
        { rank: 4, change: 0, isUp: true, name: '현대차', score: 88, profit: '5.20%', days: '8d', reason: 'PBR 1배 미만 밸류에이션 매력 및 역대 최대 영업이익 지속 전망.' },
        { rank: 5, change: 5, isUp: true, name: '알테오젠', score: 85, profit: '110.3%', days: '60d', reason: '머크 피하주사형 제형 변경 독점 계약 체결 강력 모멘텀.' }
    ];

    return (
        <div className="flex flex-col h-full w-full bg-background overflow-hidden relative text-foreground">
            
            {/* Header (Top Row) */}
            <header className="flex-none p-4 px-6 border-b border-border bg-card/40 backdrop-blur-md flex justify-between items-center z-20">
                <div className="flex items-center gap-3">
                    <button className="px-4 py-2 bg-background border border-border rounded-lg text-sm font-semibold hover:bg-muted transition-colors shadow-sm">마스터 에이전트</button>
                    <button className="px-4 py-2 bg-background border border-border rounded-lg text-sm font-semibold hover:bg-muted transition-colors shadow-sm">매크로 에이전트</button>
                    <button className="px-4 py-2 bg-background border border-border rounded-lg text-sm font-semibold hover:bg-muted transition-colors shadow-sm">섹터 에이전트</button>
                    <button className="px-4 py-2 bg-background border border-border rounded-lg text-sm font-semibold hover:bg-muted transition-colors shadow-sm">퀀트 에이전트</button>
                    <button className="px-4 py-2 bg-background border border-border rounded-lg text-sm font-semibold hover:bg-muted transition-colors shadow-sm text-primary border-primary/30 bg-primary/5">분석가 에이전트</button>
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={() => setIsTesterOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary text-primary rounded-lg text-sm font-bold shadow-sm hover:bg-primary/20 transition-colors"
                    >
                        <Database size={16} /> 에이전트 품질 인스펙터
                    </button>
                    <button 
                        onClick={() => setIsTerminalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-700 text-zinc-100 rounded-lg text-sm font-bold shadow-sm hover:bg-zinc-800 transition-colors"
                    >
                        <Terminal size={16} /> 터미널 로그 보기 (팝업)
                    </button>
                </div>
            </header>

            {/* Main Grid Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 bg-muted/10">
                <div className="mx-auto flex flex-col gap-8 max-w-7xl">

                    {/* Middle Row: Charts & Summary Panels (3 Columns) */}
                    <div className="grid grid-cols-3 gap-6">
                        {/* 1. 마켓 센티먼트 */}
                        <div className="flex flex-col gap-2">
                            <h2 className="text-sm font-bold flex items-center gap-1.5 h-[26px]"><Activity size={16} className="text-primary"/> 마켓 센티먼트</h2>
                            <div className="bg-card border border-border rounded-xl p-5 h-[160px] shadow-sm flex flex-col justify-between group cursor-pointer hover:border-primary/50 transition-colors">
                                <div className="text-xs text-muted-foreground font-semibold">Risk-On 지수 트렌드</div>
                                <div className="flex-1 w-full mt-2 relative">
                                    <DummyChart color="#3b82f6" trend="up" />
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 backdrop-blur-[1px]">
                                        <span className="text-sm font-bold">Chart View</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 2. 테마 & 키워드 (Tabbed) */}
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-4 h-[26px]">
                                <button 
                                    onClick={() => setActiveTab('theme')} 
                                    className={cn("text-sm font-bold flex items-center gap-1.5 cursor-pointer pb-1 transition-colors border-b-2", activeTab === 'theme' ? "text-amber-500 border-amber-500" : "text-muted-foreground border-transparent hover:text-foreground")}
                                >
                                    <Layers size={16}/> 테마/섹터 유동성
                                </button>
                                <button 
                                    onClick={() => setActiveTab('keyword')} 
                                    className={cn("text-sm font-bold flex items-center gap-1.5 cursor-pointer pb-1 transition-colors border-b-2", activeTab === 'keyword' ? "text-pink-500 border-pink-500" : "text-muted-foreground border-transparent hover:text-foreground")}
                                >
                                    <Hash size={16}/> 키워드 집중도
                                </button>
                            </div>
                            
                            {activeTab === 'theme' ? (
                                <div key="theme" className="bg-card border border-border rounded-xl p-5 h-[160px] shadow-sm flex flex-col justify-between group cursor-pointer hover:border-amber-500/50 transition-colors animate-in fade-in zoom-in-95 duration-200">
                                    <div className="text-xs text-muted-foreground font-semibold">자금 유입 강도 추이</div>
                                    <div className="flex-1 w-full mt-2 relative">
                                        <DummyChart color="#f59e0b" trend="flat" />
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 backdrop-blur-[1px]">
                                            <span className="text-sm font-bold">Chart View</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div key="keyword" className="bg-card border border-border rounded-xl p-5 h-[160px] shadow-sm flex flex-col justify-between group cursor-pointer hover:border-pink-500/50 transition-colors animate-in fade-in zoom-in-95 duration-200">
                                    <div className="text-xs text-muted-foreground font-semibold">핵심 테마 등장 빈도</div>
                                    <div className="flex-1 w-full mt-2 relative">
                                        <DummyChart color="#ec4899" trend="up" />
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 backdrop-blur-[1px]">
                                            <span className="text-sm font-bold">Chart View</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 3. 추천종목 퍼포먼스 */}
                        <div className="flex flex-col gap-2">
                            <h2 className="text-sm font-bold flex items-center gap-1.5 h-[26px]"><Target size={16} className="text-green-500"/> 추천종목 요약</h2>
                            <div className="bg-card border border-border rounded-xl p-5 h-[160px] shadow-sm flex flex-col justify-center gap-3">
                                <div className="flex justify-between items-center text-sm border-b border-border/50 pb-2">
                                    <span className="text-muted-foreground font-medium">추적 기간</span>
                                    <span className="font-bold flex items-center gap-1"><Clock size={14}/> 최근 3개월</span>
                                </div>
                                <div className="flex justify-between items-center text-sm border-b border-border/50 pb-2">
                                    <span className="text-muted-foreground font-medium">총 AI 추천(누적)</span>
                                    <span className="font-bold">124 건</span>
                                </div>
                                <div className="flex justify-between items-center text-sm border-b border-border/50 pb-2">
                                    <span className="text-muted-foreground font-medium">히트 레이트 (승률)</span>
                                    <span className="font-bold text-primary">68.5%</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground font-medium">포트폴리오 수익률</span>
                                    <span className="font-extrabold text-red-500">+12.4%</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Row: Detailed Lists (3 Columns) */}
                    <div className="grid grid-cols-3 gap-12 mt-4">
                        
                        {/* 1. 시황리포트 */}
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-6 border-b-[3px] border-border pb-2">
                                <h2 className="text-lg font-extrabold flex items-center gap-2 text-foreground relative after:absolute after:bottom-[-11px] after:left-0 after:w-full after:h-[3px] after:bg-foreground">
                                    시황리포트 (Master)
                                </h2>
                            </div>
                            <div className="flex flex-col gap-6 pt-2">
                                {marketReports.map((item, i) => (
                                    <div key={i} className="flex flex-col gap-2 pb-5 border-b border-border/50 last:border-0 hover:bg-card/50 px-2 -mx-2 rounded-lg transition-colors group">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <span className="font-extrabold text-[15px] tabular-nums whitespace-nowrap">{item.date}</span>
                                                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider", 
                                                    item.mode === 'Risk On' ? "bg-green-500/20 text-green-600" : 
                                                    item.mode === 'Risk Off' ? "bg-red-500/20 text-red-600" : "bg-muted text-foreground"
                                                )}>
                                                    {item.mode}
                                                </span>
                                            </div>
                                            <span className="font-mono text-sm font-bold text-muted-foreground">{item.score}</span>
                                        </div>
                                        <p className="text-[13px] leading-relaxed text-foreground font-medium line-clamp-3 mt-1">
                                            {item.text}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 2. 테마 & 키워드 랭킹 (Tabbed) */}
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-6 border-b-[3px] border-border pb-2">
                                <h2 
                                    onClick={() => setActiveTab('theme')} 
                                    className={cn("text-lg font-extrabold cursor-pointer transition-colors flex items-center gap-2", activeTab === 'theme' ? "text-foreground relative after:absolute after:bottom-[-11px] after:left-0 after:w-full after:h-[3px] after:bg-foreground" : "text-muted-foreground hover:text-foreground")}
                                >
                                    섹터 랭킹
                                </h2>
                                <h2 
                                    onClick={() => setActiveTab('keyword')} 
                                    className={cn("text-lg font-extrabold cursor-pointer transition-colors flex items-center gap-2", activeTab === 'keyword' ? "text-foreground relative after:absolute after:bottom-[-11px] after:left-0 after:w-full after:h-[3px] after:bg-foreground" : "text-muted-foreground hover:text-foreground")}
                                >
                                    키워드 랭킹
                                </h2>
                            </div>
                            <div className="flex flex-col gap-6 pt-2">
                                {(activeTab === 'theme' ? sectorRankings : keywordRankings).map((item, i) => (
                                    <div key={i} className="flex flex-col gap-2 pb-5 border-b border-border/50 last:border-0 hover:bg-card/50 px-2 -mx-2 rounded-lg transition-colors animate-in fade-in duration-200">
                                        <div className="flex justify-between items-start pt-1">
                                            <div className="flex items-center gap-1 flex-1 min-w-0 pr-2">
                                                <span className="font-extrabold text-[15px] w-[14px] tabular-nums">{item.rank}</span>
                                                <div className="flex items-center w-[20px] justify-start">
                                                    {item.change !== 0 ? (
                                                        <span className={cn("text-[10px] font-bold flex items-center", item.isUp ? "text-red-500" : "text-blue-500")}>
                                                            {item.isUp ? <ChevronUp size={12} strokeWidth={4}/> : <ChevronDown size={12} strokeWidth={4}/>}
                                                            {Math.abs(item.change)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground font-bold text-lg leading-none mb-1">-</span>
                                                    )}
                                                </div>
                                                <span className="px-2 py-0.5 bg-muted rounded text-[11px] font-bold truncate shrink-0 max-w-[140px] border border-border shadow-sm">
                                                    {item.badge}
                                                </span>
                                            </div>
                                            <span className="font-mono text-[11px] font-bold text-muted-foreground tabular-nums shrink-0 pt-0.5 w-5 text-right bg-muted/30 p-1 rounded">
                                                {item.weight}
                                            </span>
                                        </div>
                                        <p className="text-[13px] leading-relaxed text-foreground font-medium line-clamp-2 mt-1">
                                            {item.text}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 3. 추천종목 (Analyst Picks) */}
                        <div className="flex flex-col gap-4">
                            <div className="flex justify-between items-end border-b-[3px] border-border pb-2 relative after:absolute after:bottom-[-3px] after:left-0 after:w-full after:h-[3px] after:bg-foreground">
                                <h2 className="text-lg font-extrabold flex items-center gap-2">추천종목</h2>
                                <div className="text-[10px] text-muted-foreground flex gap-3 font-semibold mb-0.5">
                                    <span className="hover:text-foreground cursor-pointer flex items-center gap-0.5">추천순위순 <ChevronDown size={12}/></span>
                                    <span>수익률</span>
                                    <span>경과일</span>
                                </div>
                            </div>
                            
                            <div className="flex flex-col gap-6 pt-2">
                                {recommendedStocks.map((item, i) => (
                                    <div key={i} className="flex flex-col gap-1.5 pb-5 border-b border-border/50 last:border-0 hover:bg-card/50 px-2 -mx-2 rounded-lg transition-colors">
                                        <div className="flex justify-between items-center w-full pt-1">
                                            <div className="flex items-center gap-1 min-w-0 pr-2">
                                                <span className="font-extrabold text-[15px] w-[14px] tabular-nums">{item.rank}</span>
                                                <div className="flex items-center w-[20px] justify-start">
                                                    {item.change !== 0 ? (
                                                        <span className={cn("text-[10px] font-bold flex items-center", item.isUp ? "text-red-500" : "text-blue-500")}>
                                                            {item.isUp ? <ChevronUp size={12} strokeWidth={4}/> : <ChevronDown size={12} strokeWidth={4}/>}
                                                            {Math.abs(item.change)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground font-bold text-lg leading-none mb-1">-</span>
                                                    )}
                                                </div>
                                                <span className="font-bold text-[14px] truncate">{item.name}</span>
                                                <span className="ml-1 px-2 h-[18px] flex items-center justify-center bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-extrabold text-[10px] rounded-full tabular-nums shrink-0">{item.score}</span>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <span className={cn("font-bold font-mono text-sm", item.profit.startsWith('-') ? "text-blue-500" : "text-red-500")}>
                                                    {item.profit}
                                                </span>
                                                <span className="font-mono text-xs font-bold text-muted-foreground w-6 text-right tabular-nums bg-muted/30 px-1 py-0.5 rounded">{item.days}</span>
                                            </div>
                                        </div>
                                        <p className="text-[13px] leading-relaxed text-foreground font-medium line-clamp-1 mt-1">
                                            {item.reason}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            {/* Terminal Log Modal/Popup */}
            {isTerminalOpen && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-8 animate-in fade-in duration-200">
                    <div className="bg-[#1e1e1e] w-full max-w-4xl h-[600px] shadow-2xl rounded-2xl border border-zinc-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="bg-zinc-900 border-b border-zinc-800 p-3 flex justify-between items-center shrink-0 shadow-sm">
                            <div className="flex gap-2 items-center">
                                <div className="flex gap-1.5 ml-1">
                                    <div className="w-3 h-3 rounded-full bg-red-500/80 border border-red-500"></div>
                                    <div className="w-3 h-3 rounded-full bg-amber-500/80 border border-amber-500"></div>
                                    <div className="w-3 h-3 rounded-full bg-green-500/80 border border-green-500"></div>
                                </div>
                                <span className="text-zinc-400 font-mono text-xs ml-4 font-semibold tracking-widest uppercase">MAIIS // Active Agent Swarm Console</span>
                            </div>
                            <button onClick={() => setIsTerminalOpen(false)} className="text-zinc-500 hover:text-white transition-colors bg-zinc-800 hover:bg-zinc-700 p-1 rounded-md">
                                <X size={16} strokeWidth={3}/>
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed text-zinc-300">
                            <div className="text-blue-400 opacity-80 mb-1">=== SWARM INITIALIZATION ===</div>
                            <div className="mb-1"><span className="text-emerald-400">[MarketScanner]</span> Scanning 2,500 tickers... <span className="text-zinc-500">Done (245ms)</span></div>
                            <div className="mb-1"><span className="text-amber-400">[NaverNews]</span> Extracting daily keywords...</div>
                            <div className="mb-1 text-zinc-500 pl-4">▸ Found 124 articles mentioning "금리 인하"</div>
                            <div className="mb-1 text-zinc-500 pl-4">▸ Found 85 articles mentioning "로보틱스"</div>
                            <div className="mb-4"><span className="text-fuchsia-400">[MasterAgent]</span> Synthesizing macro & news... <span className="text-rose-400 font-bold bg-rose-500/20 px-1 rounded ml-1">RISK-ON DECLARED</span></div>
                            
                            <div className="text-blue-400 opacity-80 mb-1">=== ANALYSIS PIPELINE ===</div>
                            <div className="mb-1"><span className="text-cyan-400">[SectorAgent]</span> Weighting IT Hardware: 95, Finance: 82.</div>
                            <div className="mb-1"><span className="text-purple-400">[AnalystAgent]</span> Running fundamental checks on Q1 candidate: "한미반도체"</div>
                            <div className="mb-1 text-zinc-500 pl-4">▸ PE: 45.2, PB: 6.1 (Premium applied)</div>
                            <div className="mb-1 text-zinc-500 pl-4">▸ Foreign Ownership: +2.1% WoW</div>
                            <div className="mb-1"><span className="text-emerald-400 bg-emerald-500/10 text-emerald-300 px-1 rounded ml-1 border border-emerald-500/20">[ACTION]</span> <span className="text-white font-bold">Buy Signal Generated for 042700.KS</span></div>
                            <div className="mt-6 text-zinc-600 animate-pulse">_ Awaiting next tick...</div>
                        </div>
                    </div>
                </div>
            )}
            
            {isTesterOpen && <MaiisAgentTester onClose={() => setIsTesterOpen(false)} />}
        </div>
    );
}
