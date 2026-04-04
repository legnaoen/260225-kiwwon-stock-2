import React, { useState, useEffect } from 'react'
import { AlertCircle, ArrowDownRight, ArrowUpRight, BarChart3, Brain, ChevronLeft, ChevronRight, Clock, FileText, Filter, Flame, Globe2, Link2, Newspaper, Target, TrendingDown, TrendingUp, Minus, X, MoreHorizontal, Bot, Trash2 } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area, Cell } from 'recharts'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

// ── Helpers ──
const getSeverityColor = (sev: string) => {
  if (sev.startsWith('A') || sev.startsWith('B')) return 'text-rose-500';
  if (sev.startsWith('C')) return 'text-amber-500';
  return 'text-slate-500';
}

const getSeverityBadgeClasses = (sev: string) => {
  if (sev.startsWith('A') || sev.startsWith('B')) return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
  if (sev.startsWith('C')) return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
}

const formatDaysFrom = (dateStr: string) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diffTime = Math.max(0, now.getTime() - d.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const paddedDays = String(diffDays).padStart(2, '0');
  return `${paddedDays}d from ${yy}-${mm}-${dd}`;
}

// ── Dummy Data ──
const DUMMY_ISSUES = [
  { 
    id: '2603-01', name: '중동 지정학적 확전 우려', severity: 'BB', status: 'ESCALATING', sectors: ['정유/방산(수혜)', '항공/해운(타격)'], date: '2026-03-24',
    impactDirection: '하락',
    summary: '이란-이스라엘 충돌 격화로 에너지 수급 불안 및 안전자산 선호 심리가 확산 중입니다.',
    goodSectors: [{ name: '정유/방산', reason: '유가 급등 및 지정학적 리스크 프리미엄 부각' }],
    badSectors: [{ name: '항공/해운', reason: '유류비 증가에 따른 단기적 이익률 악화 우려' }]
  },
  { 
    id: '2602-01', name: '미 연준 금리 인하 지연', severity: 'C', status: 'FADING', sectors: ['금융(수혜)', '바이오/성장주(타격)'], date: '2026-02-15',
    impactDirection: '하락',
    summary: '강력한 고용 지표로 인해 연내 금리 인하 기대감이 후퇴하며 국채 금리가 상승 중입니다.',
    goodSectors: [{ name: '금융', reason: '순이자마진(NIM) 방어 및 수익성 개선 가능성' }],
    badSectors: [{ name: '바이오/성장주', reason: '할인율 상승으로 인한 밸류에이션 하락' }]
  },
  { 
    id: '2601-01', name: '글로벌 AI 반도체 랠리', severity: 'AA', status: 'ESCALATING', sectors: ['반도체/전력기기(수혜)'], date: '2026-01-10',
    impactDirection: '상승',
    summary: '마이크론 등 주요 벤더 실적 서프라이즈로 AI 캡펙스(CAPEX) 장기 호황이 증명되었습니다.',
    goodSectors: [{ name: '반도체/전력기기', reason: 'HBM 수요 폭발 및 AI 데이터센터 수주 확대' }],
    badSectors: []
  },
  { 
    id: '2601-02', name: '국내 밸류업 프로그램', severity: 'D', status: 'RESOLVED', sectors: ['지주사/은행(수혜)'], date: '2026-01-20',
    impactDirection: '중립',
    summary: '정부의 기업 밸류업 가이드라인 발표 후, 옥석 가리기와 자사주 소각 등 주주환원에 집중하고 있습니다.',
    goodSectors: [{ name: '지주사/은행', reason: '저PBR 해소 목적의 적극적 배당 및 자사주 매입' }],
    badSectors: []
  },
];

const DUMMY_KEYWORDS = [
  { name: '이스라엘', count: 120 }, { name: '금리인하', count: 85 }, { name: '파월', count: 78 },
  { name: '유가', count: 65 }, { name: '실적', count: 52 }, { name: 'HBM', count: 45 },
  { name: '휴전', count: 30 }, { name: 'CPI', count: 25 },
];

// ── Helper Components ──
function StatusBadge({ status, size = 'default' }: { status: string, size?: 'default' | 'sm' }) {
  const isSm = size === 'sm';
  const cmn = "inline-flex items-center rounded font-bold tracking-wider";
  
  if (status === 'ESCALATING') return <span className={cn(cmn, "bg-rose-500/10 text-rose-500", isSm ? "px-1.5 py-0 text-[8px] border border-rose-500/20" : "gap-1 px-2 py-0.5 border border-rose-500/30 text-[10px]")}>{!isSm && <TrendingUp className="w-3 h-3" />} ESCALATING</span>
  if (status === 'FADING') return <span className={cn(cmn, "bg-amber-500/10 text-amber-500", isSm ? "px-1.5 py-0 text-[8px] border border-amber-500/20" : "gap-1 px-2 py-0.5 border border-amber-500/30 text-[10px]")}>{!isSm && <ArrowDownRight className="w-3 h-3" />} FADING</span>
  return <span className={cn(cmn, "bg-slate-500/10 text-slate-400", isSm ? "px-1.5 py-0 text-[8px] border border-slate-500/20" : "gap-1 px-2 py-0.5 border border-slate-500/30 text-[10px]")}>{!isSm && <X className="w-3 h-3" />} RESOLVED</span>
}

export default function IssueManagementTab({ onNavigate, initialSelection }: { onNavigate?: (tabId: string, entityId?: string) => void; initialSelection?: string } = {}) {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'TIMELINE' | 'SOURCES'>('OVERVIEW');
  const [issues, setIssues] = useState<any[]>(DUMMY_ISSUES);
  const [selectedIssue, setSelectedIssue] = useState<any>(DUMMY_ISSUES[0]);
  const [issueTimeline, setIssueTimeline] = useState<any[]>([]);
  const [swarmSessions, setSwarmSessions] = useState<any[]>([]);
  const [isSwarming, setIsSwarming] = useState(false);
  const [currentSwarmIndex, setCurrentSwarmIndex] = useState(0);
  const [briefing, setBriefing] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Graph RAG: 이 이슈에 연결된 테마/섹터 edges
  const [linkedThemeEdges, setLinkedThemeEdges] = useState<any[]>([]);
  // 이슈 리스트 페이지네이션 (최초 10개, 더보기)
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // 시황 마스터 AI 예측 (Market Risk 아래 출력용)
  const [masterPrediction, setMasterPrediction] = useState<any>(null);

  useEffect(() => {
    async function loadBriefingAndMaster() {
      if (window.electronAPI?.getIssueBriefing) {
        try {
          const res = await window.electronAPI.getIssueBriefing();
          if (res.success && res.data) {
            setBriefing(res.data);
          }
        } catch (err) {
          console.error('[IssueManagementTab] Failed to load briefing', err);
        }
      }

      if ((window.electronAPI as any)?.getMarketConditionHistory) {
        try {
          const res = await (window.electronAPI as any).getMarketConditionHistory(1);
          if (res.success && res.data && res.data.length > 0) {
            setMasterPrediction(res.data[0]);
          }
        } catch (err) {
          console.error('[IssueManagementTab] Failed to load master prediction', err);
        }
      }
    }
    loadBriefingAndMaster();
  }, []);

  useEffect(() => {
    async function loadData() {
      if (!selectedIssue?.id) return;
      
      if (window.electronAPI?.getIssueTimeline) {
        try {
          const res = await window.electronAPI.getIssueTimeline(selectedIssue.id);
          if (res.success && res.data) setIssueTimeline(res.data);
          else setIssueTimeline([]);
        } catch (err) {
          console.error('[IssueManagementTab] Failed to load timeline', err);
          setIssueTimeline([]);
        }
      }

      if (window.electronAPI?.getIssueSwarm) {
        try {
          const res = await window.electronAPI.getIssueSwarm(selectedIssue.id);
          if (res.success && res.data) {
            setSwarmSessions(res.data);
            setCurrentSwarmIndex(0);
          }
          else setSwarmSessions([]);
        } catch (err) {
          console.error('[IssueManagementTab] Failed to load swarm', err);
          setSwarmSessions([]);
        }
      }
    }
    loadData();
  }, [selectedIssue]);

  // Graph RAG: 이슈 선택 시 연결된 테마/섹터 edges 로드
  useEffect(() => {
    if (!selectedIssue?.id) { setLinkedThemeEdges([]); return; }
    const fetchEdges = async () => {
      try {
        const api = window.electronAPI as any;
        if (api.getKnowledgeEdgesFrom) {
          const res = await api.getKnowledgeEdgesFrom('ISSUE', selectedIssue.id);
          if (res.success && res.data) setLinkedThemeEdges(res.data.filter((e: any) => e.target_type === 'THEME' || e.target_type === 'SECTOR'));
          else setLinkedThemeEdges([]);
        }
      } catch (e) { setLinkedThemeEdges([]); }
    };
    fetchEdges();
  }, [selectedIssue?.id]);

  const [vixHistory, setVixHistory] = useState<any[]>([]);
  const [krwHistory, setKrwHistory] = useState<any[]>([]);
  const [tnxHistory, setTnxHistory] = useState<any[]>([]);
  const [oilHistory, setOilHistory] = useState<any[]>([]);

  useEffect(() => {
    async function loadMacros() {
      if (window.electronAPI?.getYahooMacros) {
        try {
          // ^VIX, KRW=X, ^TNX, CL=F
          const res = await window.electronAPI.getYahooMacros(['^VIX', 'KRW=X', '^TNX', 'CL=F']);
          if (res.success && res.data) {
             const vData = res.data[0]?.quotes?.slice(-30) || [];
             const kData = res.data[1]?.quotes?.slice(-30) || [];
             const tData = res.data[2]?.quotes?.slice(-30) || [];
             const oData = res.data[3]?.quotes?.slice(-30) || [];
             setVixHistory(vData);
             setKrwHistory(kData);
             setTnxHistory(tData);
             setOilHistory(oData);
          }
        } catch (e) {
          console.error(e);
        }
      }
    }
    loadMacros();
  }, []);

  const loadIssues = async () => {
    if (window.electronAPI?.getActiveIssues) {
      try {
        const res = await window.electronAPI.getActiveIssues();
        if (res.success && res.data && res.data.length > 0) {
          const SEVERITY_WEIGHTS: Record<string, number> = {
            'S': 100, 'AAA': 90, 'AA': 80, 'A': 70, 
            'BBB': 60, 'BB': 50, 'B': 40, 
            'CCC': 30, 'CC': 20, 'C': 10, 'D': 0
          };
          const getWeight = (sev: string) => SEVERITY_WEIGHTS[sev?.toUpperCase()?.trim()] ?? 0;

          const formatted = res.data.map((d: any) => ({
            ...d,
            date: d.created_date,           // 최초 생성일 기준
            lastUpdated: d.updated_date,
            swarmSummary: d.swarmSummary,
          })).sort((a: any, b: any) => {
            const wA = getWeight(a.severity);
            const wB = getWeight(b.severity);
            if (wA !== wB) return wB - wA; // 1차 정렬: 파급력(Severity) 높은 순
            if (a.status === 'ESCALATING' && b.status !== 'ESCALATING') return -1; // 2차 정렬: ESCALATING 우선
            if (a.status !== 'ESCALATING' && b.status === 'ESCALATING') return 1;
            return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(); // 3차 정렬: 최근 갱신일 순
          });
          
          setIssues(formatted);
          setSelectedIssue((prev: any) => prev ? formatted.find((f:any)=>f.id===prev.id) || formatted[0] : formatted[0]);
        }
      } catch (err) {
        console.error('[IssueManagementTab] Failed to load issues', err);
      }
    }
  };

  useEffect(() => {
    loadIssues();
  }, []);

  // 딥 네비게이션: 이슈 목록 로드 후 initialSelection에 해당하는 이슈 자동 선택
  useEffect(() => {
    if (!initialSelection || issues.length === 0) return;
    // ID 또는 이름으로 검색
    const sel = initialSelection.toLowerCase();
    const found =
      issues.find((i: any) => i.id?.toLowerCase() === sel) ||
      issues.find((i: any) => i.name?.toLowerCase().includes(sel));
    if (found) {
      setSelectedIssue(found);
      setActiveTab('TIMELINE'); // 대시보드가 아니라 상세(TIMELINE) 탭으로 이동해야 함
      setTimeout(() => {
        const el = document.getElementById(`issue-item-${found.id}`);
        if(el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [initialSelection, issues]);

  const handleRunAnalysis = async () => {
    if(!window.electronAPI?.runIssueAnalysis) return;
    setIsAnalyzing(true);
    try {
      const res = await window.electronAPI.runIssueAnalysis();
      if(res.success) {
        // reload issues & briefing
        const issuesRes = await window.electronAPI.getActiveIssues();
        if (issuesRes.success && issuesRes.data) {
          const formatted = issuesRes.data.map((d: any) => ({
            ...d,
            date: d.created_date,           // 최초 생성일 기준
            lastUpdated: d.updated_date,
          }));
          setIssues(formatted);
          if (formatted.length > 0) setSelectedIssue(formatted[0]);
        }
        if (window.electronAPI.getIssueBriefing) {
          const briefingRes = await window.electronAPI.getIssueBriefing();
          if (briefingRes.success && briefingRes.data) setBriefing(briefingRes.data);
        }
        alert('이슈 에이전트 분석이 완료되었습니다.');
      } else {
        alert('분석 실패: ' + res.error);
      }
    } catch(e) {
      console.error(e);
      alert('오류 발생');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDeleteSwarmSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if(!window.confirm('이 평가 기록을 정말 삭제하시겠습니까?')) return;
    if(window.electronAPI?.deleteSwarmSession && selectedIssue) {
      await window.electronAPI.deleteSwarmSession(sessionId);
      const res = await window.electronAPI.getIssueSwarm(selectedIssue.id);
      if(res?.success) setSwarmSessions(res.data);
      loadIssues(); // 요약 업데이트용
    }
  }

  const renderMacroValue = (history: any[], symbol: string) => {
    if (!history || history.length < 2) return <span className="text-muted-foreground">-</span>;
    const current = history[history.length - 1].close;
    const prev = history[history.length - 2].close;
    const diff = current - prev;
    const diffPct = (diff / prev) * 100;
    const signPct = diffPct > 0 ? '+' : '';
    const signNum = diff > 0 ? '+' : '';
    let colorCls = diff > 0 ? "text-rose-400" : diff < 0 ? "text-emerald-500" : "text-muted-foreground";

    let text = '';
    if (symbol === 'KRW=X') {
      text = `${signNum}${diff.toFixed(1)}원 (${current.toLocaleString(undefined, {maximumFractionDigits:1})}원)`;
    } else if (symbol === '^VIX') {
      text = `${signPct}${diffPct.toFixed(2)}% (${current.toFixed(2)} pt)`;
    } else if (symbol === '^TNX') {
      text = `${signNum}${diff.toFixed(3)}%p (${current.toFixed(3)}%)`;
    } else if (symbol === 'CL=F') {
      text = `${signPct}${diffPct.toFixed(2)}% ($${current.toFixed(2)})`;
    }
    return <span className={cn("font-mono text-[11px] font-bold", colorCls)}>{text}</span>;
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden text-sm">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background z-10">
        <div className="flex items-center gap-2">
          <Brain className="text-indigo-400 w-4 h-4" />
          <span className="text-sm font-bold tracking-tight">장기/이슈 관리 AI</span>
          <span className="text-xs text-muted-foreground ml-1 hidden sm:inline-block">Macro & News Agent</span>
          <button 
            onClick={handleRunAnalysis} 
            disabled={isAnalyzing}
            className="ml-4 px-3 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500 text-[11px] font-bold rounded-md border border-indigo-500/20 shadow-sm transition-colors disabled:opacity-50"
          >
            {isAnalyzing ? '분석 중...' : '에이전트 수동 실행'}
          </button>
        </div>
        <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-md border border-border/40">
          {[
            { id: 'OVERVIEW', label: '🌐 대시보드' },
            { id: 'TIMELINE', label: '⏳ 타임라인' },
            { id: 'SOURCES', label: '📡 데이터 원천' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={cn(
                "px-4 py-1.5 text-xs font-bold rounded-sm transition-all duration-200",
                activeTab === t.id ? "bg-background text-foreground shadow-sm ring-1 ring-border/50" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content Area ── */}
      <div className="flex-1 p-4 min-h-0 overflow-hidden">
        
        {/* OVERVIEW TAB */}
        {activeTab === 'OVERVIEW' && (
          <div className="grid grid-cols-12 gap-4 h-full animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Left Column: AI Briefing & Macro */}
            <div className="col-span-5 flex flex-col gap-4 overflow-y-auto pb-8 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {/* AI Briefing Card */}
              <div className="bg-muted/10 border border-border/40 rounded-xl overflow-hidden flex flex-col shadow-sm shrink-0">
                <div className="px-4 py-2.5 border-b border-border/50 bg-indigo-500/5 flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-400 flex items-center gap-1.5"><Brain className="w-4 h-4" /> AI 장기 관점 브리핑</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{briefing?.created_at || '생성 대기 중'}</span>
                </div>
                <div className="p-4 flex-1">
                  <div className="flex flex-col gap-4 mb-5">
                    {/* 1. Market Risk & Macro Indicators */}
                    <div className="flex flex-wrap items-center gap-6 pb-4 border-b border-border/30">
                      <div className="flex-1 min-w-[200px]">
                        <div className="text-xs text-muted-foreground mb-1 font-bold">Market Risk Score</div>
                        <div className="flex items-end gap-2">
                          <span className="text-2xl font-bold text-rose-500 tracking-tighter">{briefing?.risk_score || 0}<span className="text-xs font-normal text-muted-foreground ml-1">/100</span></span>
                          <div className="flex-1 h-1.5 bg-muted/50 rounded-full mb-2 overflow-hidden">
                            <div className={cn("h-full", (briefing?.risk_score || 0) > 80 ? 'bg-rose-600' : 'bg-gradient-to-r from-amber-500 to-rose-500')} style={{ width: `${briefing?.risk_score || 0}%` }} />
                          </div>
                        </div>
                      </div>
                      
                      {/* 매크로 지표 (이슈 AI 산출) */}
                      <div className="flex gap-4 text-[11px] font-mono">
                        {briefing?.macro_krw && <div><span className="text-muted-foreground mr-1">KRW</span><span className={briefing.macro_krw.includes('+') ? 'text-rose-500' : 'text-blue-500'}>{briefing.macro_krw}</span></div>}
                        {briefing?.macro_tnx && <div><span className="text-muted-foreground mr-1">TNX</span><span className={briefing.macro_tnx.includes('+') ? 'text-rose-500' : 'text-blue-500'}>{briefing.macro_tnx}</span></div>}
                        {briefing?.macro_vix && <div><span className="text-muted-foreground mr-1">VIX</span><span className={briefing.macro_vix.includes('+') ? 'text-rose-500' : 'text-blue-500'}>{briefing.macro_vix}</span></div>}
                      </div>
                    </div>

                    {/* 2. 마스터 AI가 측정한 프레임별 전망 (T+1, T+5, T+20) */}
                    {masterPrediction && (
                      <div className="flex items-center gap-3 bg-indigo-50/50 dark:bg-indigo-950/20 p-2.5 rounded-lg border border-indigo-100 dark:border-indigo-900/30">
                        <span className="text-xs font-extrabold text-indigo-700 dark:text-indigo-400 shrink-0">👑 마스터 AI 뷰</span>
                        <div className="flex gap-2">
                          <span className={cn("text-[10px] px-2 py-0.5 rounded font-bold border", 
                            masterPrediction.predict === 'LONG' ? 'bg-rose-50 text-rose-600 border-rose-200' : masterPrediction.predict === 'SHORT' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-slate-50 text-slate-600 border-slate-200'
                          )}>전체: {masterPrediction.predict} ({masterPrediction.confidence}%)</span>
                          
                          {masterPrediction.t1_target_return !== undefined && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-black/40 border border-border/50 text-muted-foreground">T+1목표 <span className={masterPrediction.t1_target_return > 0 ? "text-rose-500 font-bold" : "text-blue-500 font-bold"}>{masterPrediction.t1_target_return}%</span></span>
                          )}
                          {masterPrediction.t5_predict && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-black/40 border border-border/50 text-muted-foreground">T+5 <span className={masterPrediction.t5_predict === 'LONG' ? "text-rose-500 font-bold" : masterPrediction.t5_predict === 'SHORT' ? "text-blue-500 font-bold" : "font-bold"}>{masterPrediction.t5_predict}</span></span>
                          )}
                          {masterPrediction.t20_predict && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-black/40 border border-border/50 text-muted-foreground">T+20 <span className={masterPrediction.t20_predict === 'LONG' ? "text-rose-500 font-bold" : masterPrediction.t20_predict === 'SHORT' ? "text-blue-500 font-bold" : "font-bold"}>{masterPrediction.t20_predict}</span></span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="prose prose-sm dark:prose-invert prose-p:leading-relaxed prose-p:text-muted-foreground pt-1">
                    <h4 className="flex items-center gap-1.5 text-foreground"><Target className="w-4 h-4 text-rose-400" /> 오늘 시장의 테제 (by 이슈 AI)</h4>
                    {briefing?.summary_markdown ? (
                      <div dangerouslySetInnerHTML={{ __html: briefing.summary_markdown }} />
                    ) : (
                      <p>아직 생성된 브리핑이 없습니다. 상단의 '에이전트 수동 실행'을 클릭하세요.</p>
                    )}
                  </div>


                </div>
              </div>

              {/* Macro Verifier Card */}
              <div className="bg-muted/10 border border-border/40 rounded-xl p-4 shadow-sm flex-1">
                <div className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 mb-3"><BarChart3 className="w-4 h-4" /> 팩트 체크 (Macro Verifier)</div>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between items-end mb-1">
                      <span className="text-xs font-bold flex items-center gap-1.5">VIX (공포지수) <span className="text-[9px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">최근 30영업일</span></span>
                      {renderMacroValue(vixHistory, '^VIX')}
                    </div>
                    <div className="h-20 w-full mb-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={vixHistory} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                           <defs>
                              <linearGradient id="vixGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <XAxis 
                               dataKey="date" 
                               tickFormatter={(v) => { const d = new Date(v); return `${d.getMonth()+1}/${d.getDate()}` }} 
                               axisLine={false} 
                               tickLine={false} 
                               tick={{fontSize: 9, fill: 'currentColor', opacity: 0.4}} 
                               dy={5}
                               minTickGap={15}
                            />
                            <YAxis type="number" domain={['dataMin', 'dataMax']} hide />
                            <Area type="monotone" dataKey="close" stroke="#f43f5e" fill="url(#vixGrad)" strokeWidth={1.5} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-end mb-1">
                      <span className="text-xs font-bold flex items-center gap-1.5">USD/KRW 환율 <span className="text-[9px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">최근 30영업일</span></span>
                      {renderMacroValue(krwHistory, 'KRW=X')}
                    </div>
                    <div className="h-20 w-full mb-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={krwHistory} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="krwGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2}/>
                                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <XAxis 
                               dataKey="date" 
                               tickFormatter={(v) => { const d = new Date(v); return `${d.getMonth()+1}/${d.getDate()}` }} 
                               axisLine={false} 
                               tickLine={false} 
                               tick={{fontSize: 9, fill: 'currentColor', opacity: 0.4}} 
                               dy={5}
                               minTickGap={15}
                            />
                            <YAxis type="number" domain={['auto', 'auto']} hide />
                            <Area type="monotone" dataKey="close" stroke="#8b5cf6" fill="url(#krwGrad)" strokeWidth={1.5} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  {/* 국채 금리 */}
                  <div>
                    <div className="flex justify-between items-end mb-1">
                      <span className="text-xs font-bold flex items-center gap-1.5">미 10년물 국채 <span className="text-[9px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">최근 30영업일</span></span>
                      {renderMacroValue(tnxHistory, '^TNX')}
                    </div>
                    <div className="h-20 w-full mb-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={tnxHistory} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="tnxGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2}/>
                                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <XAxis 
                               dataKey="date" 
                               tickFormatter={(v) => { const d = new Date(v); return `${d.getMonth()+1}/${d.getDate()}` }} 
                               axisLine={false} 
                               tickLine={false} 
                               tick={{fontSize: 9, fill: 'currentColor', opacity: 0.4}} 
                               dy={5}
                               minTickGap={15}
                            />
                            <YAxis type="number" domain={['auto', 'auto']} hide />
                            <Area type="monotone" dataKey="close" stroke="#f59e0b" fill="url(#tnxGrad)" strokeWidth={1.5} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  {/* 유가 */}
                  <div>
                    <div className="flex justify-between items-end mb-1">
                      <span className="text-xs font-bold flex items-center gap-1.5">WTI 원유 <span className="text-[9px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">최근 30영업일</span></span>
                      {renderMacroValue(oilHistory, 'CL=F')}
                    </div>
                    <div className="h-20 w-full mb-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={oilHistory} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="oilGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <XAxis 
                               dataKey="date" 
                               tickFormatter={(v) => { const d = new Date(v); return `${d.getMonth()+1}/${d.getDate()}` }} 
                               axisLine={false} 
                               tickLine={false} 
                               tick={{fontSize: 9, fill: 'currentColor', opacity: 0.4}} 
                               dy={5}
                               minTickGap={15}
                            />
                            <YAxis type="number" domain={['auto', 'auto']} hide />
                            <Area type="monotone" dataKey="close" stroke="#3b82f6" fill="url(#oilGrad)" strokeWidth={1.5} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Active Issues List */}
            <div className="col-span-7 bg-muted/10 border border-border/40 rounded-xl flex flex-col overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-border/50 bg-muted/20 flex justify-between items-center">
                <span className="text-xs font-bold text-foreground">Active Issue Ledger 진행 중인 이슈</span>
                <span className="text-[10px] font-mono bg-background px-2 py-0.5 rounded border border-border/50 text-muted-foreground">{issues.length} Total</span>
              </div>
              <div className="p-4 overflow-y-auto space-y-3 pb-8 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {issues.slice(0, visibleCount).map(issue => (
                  <div
                    key={issue.id}
                    id={`issue-item-${issue.id}`}
                    onClick={() => { setSelectedIssue(issue); setActiveTab('TIMELINE'); }}
                    className={cn(
                      "group p-4 bg-background border hover:border-indigo-500/40 rounded-lg cursor-pointer transition-all duration-200 shadow-sm hover:shadow-md flex flex-col gap-2.5",
                      selectedIssue?.id === issue.id
                        ? "border-indigo-500/50 ring-1 ring-indigo-500/20 bg-indigo-500/3"
                        : "border-border/40"
                    )}
                  >
                    {/* Header: Title & Master Feedback & Badge */}
                    <div className="flex flex-col w-full gap-1.5">
                      <div className="flex items-start justify-between w-full">
                        <div className="flex flex-col w-full gap-0.5 mt-0.5">
                          <span className="text-base font-bold text-foreground group-hover:text-indigo-600 dark:text-indigo-400 transition-colors w-full leading-tight">{issue.name}</span>
                          {issue.current_stance && (
                             <span className="text-[11px] text-muted-foreground/80 font-medium leading-snug mt-1 flex items-start gap-1">
                               <span className="shrink-0 text-indigo-400/70">↳</span>
                               {issue.current_stance}
                             </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          {issue.master_comment && (
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold border", issue.master_veto ? "bg-amber-500/10 text-amber-500 border-amber-500/30" : "bg-emerald-500/10 text-emerald-500 border-emerald-500/30")}>
                              {issue.master_veto ? '🛡️ VETO' : '🤝 CONFIRM'}
                            </span>
                          )}
                          <StatusBadge status={issue.status} size="sm" />
                        </div>
                      </div>
                      
                      {issue.master_comment && (
                         <div className="px-2 py-1.5 bg-muted/30 border border-border/50 rounded flex items-start gap-1.5 shadow-inner mt-1">
                            <Brain className={cn("w-3.5 h-3.5 shrink-0 mt-0.5", issue.master_veto ? "text-amber-500" : "text-emerald-500")} />
                            <span className="text-xs text-muted-foreground leading-snug font-medium italic">"{issue.master_comment}"</span>
                         </div>
                      )}
                    </div>

                    {/* Middle: Info Text */}
                    <div className="flex flex-wrap items-center gap-2 w-full mt-0.5">
                      {/* Severity */}
                      <span className={cn("text-xs font-extrabold", getSeverityColor(issue.severity))}>
                        {issue.severity}
                      </span>
                      <span className="text-border/60 mx-1">|</span>
                      {/* Direction */}
                      <span className={cn("flex items-center gap-0.5 text-xs font-bold", issue.impactDirection === '상승' ? "text-rose-500" : issue.impactDirection === '하락' ? "text-indigo-500" : "text-slate-500")}>
                        {issue.impactDirection === '상승' ? <TrendingUp className="w-3.5 h-3.5" /> : issue.impactDirection === '하락' ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                        {issue.impactDirection}
                      </span>
                      <span className="text-border/60 mx-1">|</span>
                      {/* Good Sectors */}
                      {issue.goodSectors.map((sec: any) => sec.name.split('/').map((n: string) => (
                        <span key={`good-${n}`} className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{n}</span>
                      )))}
                      {/* Bad Sectors */}
                      {issue.badSectors.map((sec: any) => sec.name.split('/').map((n: string) => (
                        <span key={`bad-${n}`} className="text-xs font-bold text-rose-500">{n}</span>
                      )))}
                    </div>

                    {/* Footer: Date Tracking & Swarm Summary */}
                    <div className="flex items-center justify-between w-full mt-1.5 pt-2 border-t border-border/20">
                      <div className="flex items-center text-xs text-slate-600 dark:text-slate-300 font-semibold">
                        {issue.swarmSummary ? (
                          <span>{issue.swarmSummary}</span>
                        ) : (
                          <span className="text-muted-foreground/60 font-medium">평가 요약 없음</span>
                        )}
                      </div>
                      <div className="flex flex-col items-end text-slate-500 dark:text-slate-400">
                        <div className="flex items-center">
                          <Clock className="w-3.5 h-3.5 mr-1.5" />
                          <span className="text-[10px] font-mono tracking-tight">{formatDaysFrom(issue.date)}</span>
                        </div>
                        {issue.lastUpdated && issue.lastUpdated !== issue.date && (
                          <span className="text-[9px] font-mono text-muted-foreground/50">갱신: {issue.lastUpdated?.substring(0,10)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* 더 보기 버튼 */}
                {visibleCount < issues.length && (
                  <button
                    onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                    className="w-full py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground border border-dashed border-border/50 hover:border-border rounded-lg transition-colors bg-muted/5 hover:bg-muted/20"
                  >
                    ↓ 더 보기 ({issues.length - visibleCount}개 남음)
                  </button>
                )}
                {visibleCount >= issues.length && issues.length > PAGE_SIZE && (
                  <button
                    onClick={() => setVisibleCount(PAGE_SIZE)}
                    className="w-full py-2 text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  >
                    ↑ 접기
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TIMELINE TAB */}
        {activeTab === 'TIMELINE' && (
          <div className="grid grid-cols-12 gap-0 h-full border border-border/40 rounded-xl bg-background overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
            {/* Left: Issue List */}
            <div className="col-span-4 border-r border-border/40 bg-muted/10 flex flex-col">
              <div className="p-3 border-b border-border/40 bg-muted/20 space-y-3">
                <button 
                  onClick={() => setActiveTab('OVERVIEW')}
                  className="w-full flex flex-col p-2.5 bg-background border border-border/50 hover:border-indigo-500/50 rounded-md shadow-sm group transition-all text-left"
                >
                  <div className="flex items-center justify-between w-full mb-1.5">
                    <div className="flex items-center gap-1.5 text-sm font-bold text-foreground group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      <Globe2 className="w-4 h-4" /> 오버뷰 대시보드 복귀
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" />
                  </div>
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs text-muted-foreground font-mono">Market Risk Score</span>
                    <span className="text-xs font-bold text-rose-500">68/100</span>
                  </div>
                  <div className="w-full h-1 bg-muted/40 rounded-full mt-1.5 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-500 to-rose-500 w-[68%]" />
                  </div>
                </button>
                <div className="relative">
                  <Filter className="w-4 h-4 absolute left-3 top-2 text-muted-foreground" />
                  <input type="text" placeholder="이슈 검색..." className="w-full bg-background border border-border/50 rounded-md py-1.5 pl-9 pr-3 text-xs focus:outline-none focus:border-indigo-500" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {issues.map(issue => (
                  <button key={issue.id} onClick={() => setSelectedIssue(issue)} className={cn("w-full text-left p-3 rounded-md transition-all flex flex-col gap-2.5", selectedIssue?.id === issue.id ? "bg-indigo-500/10 border border-indigo-500/30 shadow-sm" : "hover:bg-muted/50 border border-transparent")}>
                    {/* Header: Title & Badge */}
                    <div className="flex items-center gap-2 justify-between w-full">
                      <span className={cn("font-bold text-[13px] leading-tight truncate w-full", selectedIssue?.id === issue.id ? "text-indigo-600 dark:text-indigo-400 font-extrabold" : "text-foreground")}>{issue.name}</span>
                      <StatusBadge status={issue.status} size="sm" />
                    </div>
                    
                    {/* Middle: Info Text */}
                    <div className="flex flex-wrap items-center gap-2 w-full">
                      {/* Severity */}
                      <span className={cn("text-[11px] font-extrabold", getSeverityColor(issue.severity))}>
                        {issue.severity}
                      </span>
                      <span className="text-border/60 mx-0.5">|</span>
                      {/* Direction */}
                      <span className={cn("flex items-center gap-0.5 text-[11px] font-bold", issue.impactDirection === '상승' ? "text-rose-500" : issue.impactDirection === '하락' ? "text-indigo-500" : "text-slate-500")}>
                        {issue.impactDirection === '상승' ? <TrendingUp className="w-3 h-3" /> : issue.impactDirection === '하락' ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                        {issue.impactDirection}
                      </span>
                      <span className="text-border/60 mx-0.5">|</span>
                      {/* Good Sectors */}
                      {issue.goodSectors.map((sec: any) => sec.name.split('/').map((n: string) => (
                        <span key={`good-${n}`} className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">{n}</span>
                      )))}
                      {/* Bad Sectors */}
                      {issue.badSectors.map((sec: any) => sec.name.split('/').map((n: string) => (
                        <span key={`bad-${n}`} className="text-[11px] font-bold text-rose-500">{n}</span>
                      )))}
                    </div>

                    {/* Footer: Date Tracking & Swarm Summary */}
                    <div className="flex items-center justify-between w-full mt-0.5 pt-1.5 border-t border-border/10">
                      <div className="flex items-center text-[10.5px] text-slate-600 dark:text-slate-300 font-semibold truncate">
                        {issue.swarmSummary ? (
                          <div className="flex items-center w-full truncate space-x-1.5 max-w-[90%]">
                            <span>{issue.swarmSummary}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60 font-medium text-[10px]">평가 요약 없음</span>
                        )}
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <div className="flex items-center text-slate-500 dark:text-slate-400 font-medium">
                          <Clock className="w-3 h-3 mr-1" />
                          <span className="text-[10px] font-mono tracking-tight">{formatDaysFrom(issue.date)}</span>
                        </div>
                        {issue.lastUpdated && issue.lastUpdated !== issue.date && (
                          <span className="text-[9px] font-mono text-muted-foreground/50">갱신: {issue.lastUpdated?.substring(0,10)}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            
            {/* Right: Timeline Detail */}
            <div className="col-span-8 flex flex-col p-6 bg-background overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              <div className="flex items-start justify-between mb-5 pb-5 border-b border-border/40 shrink-0">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-bold flex items-center text-foreground">{selectedIssue?.name}</h2>
                    <div className="flex items-center gap-1.5 h-fit">
                      <div className={cn("flex items-center justify-center text-[12px] font-extrabold px-2.5 py-0.5 rounded shadow-sm border select-none", getSeverityBadgeClasses(selectedIssue?.severity || ''))}>
                        {selectedIssue?.severity}
                      </div>
                      <div className={cn("flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded shadow-sm border select-none", selectedIssue?.impactDirection === '상승' ? "bg-rose-500/10 text-rose-500 border-rose-500/20" : selectedIssue?.impactDirection === '하락' ? "bg-indigo-500/10 text-indigo-500 border-indigo-500/20" : "bg-slate-500/10 text-slate-500 border-slate-500/20")}>
                        {selectedIssue?.impactDirection === '상승' ? <TrendingUp className="w-3 h-3" /> : selectedIssue?.impactDirection === '하락' ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                        <span>{selectedIssue?.impactDirection}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground/80">
                    <div className="flex items-center">
                      <Clock className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                      <span className="text-xs font-mono font-medium tracking-tight">{formatDaysFrom(selectedIssue?.date || '')}</span>
                    </div>
                    {selectedIssue?.lastUpdated && selectedIssue.lastUpdated !== selectedIssue.date && (
                      <span className="text-[10px] font-mono text-muted-foreground/50 bg-muted/40 px-1.5 py-0.5 rounded">
                        최종갱신 {selectedIssue.lastUpdated?.substring(0, 10)}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2 h-fit">
                  <StatusBadge status={selectedIssue?.status || ''} size="default" />
                  <div className="relative group flex items-center">
                    <button className="p-1.5 hover:bg-muted/50 rounded-md text-muted-foreground transition-colors outline-none cursor-pointer">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                    {/* Dropdown styling via group-hover */}
                    <div className="absolute right-0 top-full mt-1 w-44 bg-background border border-border/60 rounded-md shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
                      <button 
                        onClick={async () => {
                          if (window.electronAPI?.resolveIssue && selectedIssue?.id) {
                            if(window.confirm(`'${selectedIssue.name}' 이슈를 강제 종료하시겠습니까?`)) {
                              await window.electronAPI.resolveIssue(selectedIssue.id);
                              // Refresh the list
                              const res = await window.electronAPI.getActiveIssues();
                              if (res.success && res.data) {
                                const formatted = res.data.map((d: any) => ({ ...d, date: d.updated_date || d.created_date }));
                                setIssues(formatted);
                                if (formatted.length > 0) setSelectedIssue(formatted[0]);
                                else { setSelectedIssue(null); setActiveTab('OVERVIEW'); }
                              }
                            }
                          }
                        }}
                        className="w-full text-left px-3 py-2 text-[11px] font-bold text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                      >
                        강제 종료 (Force Resolve)
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Summary Block */}
              <div className="mb-6 p-4 bg-muted/20 border border-border/50 rounded-xl shadow-sm">
                <p className="text-[14px] text-foreground/90 font-medium leading-relaxed">
                  "{selectedIssue?.summary}"
                </p>
              </div>

              {/* ── 통합 Knowledge Panel: 연관 섹터 + 연관 테마 ── */}
              {((selectedIssue?.goodSectors?.length > 0 || selectedIssue?.badSectors?.length > 0) || linkedThemeEdges.filter((e: any) => e.target_type === 'THEME').length > 0) && (() => {
                // 테마 AI가 매핑한 THEME 타입 edges만 분리
                const themeEdges = linkedThemeEdges.filter((e: any) => e.target_type === 'THEME' || (!e.target_type?.includes('SECTOR') && e.created_by === 'THEME_AI'));
                const themeBenefits = themeEdges.filter((e: any) => e.relation === 'BENEFITS' || e.relation === 'DRIVES');
                const themeHurts    = themeEdges.filter((e: any) => e.relation === 'HURTS');

                // ── 통합 카드 렌더러 (섹터/테마 동일 스타일) ──
                const renderMosaicCard = (
                  name: string,
                  description: string,   // sector.reason 또는 chain 인라인 텍스트
                  isBenefit: boolean,
                  onClick: () => void,
                ) => {
                  const bgCls    = isBenefit ? 'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10 hover:border-emerald-500/35' : 'bg-rose-500/5 border-rose-500/20 hover:bg-rose-500/10 hover:border-rose-500/35';
                  const badgeCls = isBenefit ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-500 border-rose-500/20';
                  const Icon     = isBenefit ? TrendingUp : TrendingDown;
                  return (
                    <button
                      onClick={onClick}
                      className={cn(
                        'group p-4 border rounded-xl flex flex-col gap-2 text-left transition-all shadow-sm',
                        'min-h-[120px] hover:shadow-md hover:scale-[1.01]',
                        bgCls
                      )}
                    >
                      <div className={cn('w-fit flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-bold', badgeCls)}>
                        <Icon className="w-3 h-3" />
                        <span>{name}</span>
                      </div>
                      {description && (
                        <p className="text-[12.5px] font-medium text-foreground/80 leading-snug mt-1">{description}</p>
                      )}
                    </button>
                  );
                };

                return (
                  <div className="mb-8 space-y-5">
                    {/* 섹터 서브섹션 */}
                    {(selectedIssue?.goodSectors?.length > 0 || selectedIssue?.badSectors?.length > 0) && (
                      <div>
                        <div className="flex items-center gap-2 mb-3 border-b border-border/40 pb-2">
                          <BarChart3 className="w-4 h-4 text-slate-400" />
                          <span className="text-sm font-bold text-foreground">연관 섹터</span>
                          <span className="text-[10px] text-muted-foreground ml-1">이슈 AI 직접 분석 · 클릭 시 테마 탭 이동</span>
                          <span className="ml-auto text-[10px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                            수혜 {selectedIssue?.goodSectors?.length || 0} · 피해 {selectedIssue?.badSectors?.length || 0}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          {selectedIssue?.goodSectors?.map((sec: any, idx: number) =>
                            sec.name.split('/').map((n: string, i: number) =>
                              <React.Fragment key={`good-${idx}-${i}`}>
                                {renderMosaicCard(n, sec.reason, true, () => onNavigate?.('theme-tracker', n))}
                              </React.Fragment>
                            )
                          )}
                          {selectedIssue?.badSectors?.map((sec: any, idx: number) =>
                            sec.name.split('/').map((n: string, i: number) =>
                              <React.Fragment key={`bad-${idx}-${i}`}>
                                {renderMosaicCard(n, sec.reason, false, () => onNavigate?.('theme-tracker', n))}
                              </React.Fragment>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {/* 테마 서브섹션 (테마AI 데이터, knowledge_edges) */}
                    {themeEdges.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3 border-b border-border/40 pb-2">
                          <Link2 className="w-4 h-4 text-violet-400" />
                          <span className="text-sm font-bold text-foreground">연관 테마</span>
                          <span className="text-[10px] text-muted-foreground ml-1">테마 AI 데이터 매핑 · 클릭 시 테마 탭 이동</span>
                          <span className="ml-auto text-[10px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                            수혜 {themeBenefits.length} · 피해 {themeHurts.length}

                          </span>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          {themeBenefits.map((edge: any, i: number) => {
                            const desc = edge.logical_path
                              ? edge.logical_path.split(/→|->/).map((s: string) => s.trim()).filter(Boolean).join(' → ')
                              : '';
                            return (
                              <React.Fragment key={`tb-${i}`}>
                                {renderMosaicCard(edge.target_id, desc, true, () => onNavigate?.('theme-tracker', edge.target_id))}
                              </React.Fragment>
                            );
                          })}
                          {themeHurts.map((edge: any, i: number) => {
                            const desc = edge.logical_path
                              ? edge.logical_path.split(/→|->/).map((s: string) => s.trim()).filter(Boolean).join(' → ')
                              : '';
                            return (
                              <React.Fragment key={`th-${i}`}>
                                {renderMosaicCard(edge.target_id, desc, false, () => onNavigate?.('theme-tracker', edge.target_id))}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Swarm AI Simulation Section */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3 border-b border-border/40 pb-2">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-indigo-400" />
                    <span className="text-sm font-bold text-foreground">독자 위원회 (군집 AI 다면 평가)</span>
                  </div>
                  <button 
                    onClick={async () => {
                      if(!window.electronAPI?.runIssueSwarm || !selectedIssue) return;
                      setIsSwarming(true);
                      try {
                        const res = await window.electronAPI.runIssueSwarm(selectedIssue.id, selectedIssue);
                        if(res.success && res.data) {
                          setSwarmSessions(prev => [res.data, ...prev]);
                          setCurrentSwarmIndex(0);
                        }
                      } finally {
                        setIsSwarming(false);
                      }
                    }}
                    disabled={isSwarming || selectedIssue?.status === 'RESOLVED'}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700 text-white rounded shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSwarming ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> 평가 중...</> : '🐟 군집 투표 시작'}
                  </button>
                </div>

                {swarmSessions.length > 0 ? (
                  <div className="space-y-4">
                    {(() => {
                      const session = swarmSessions[currentSwarmIndex];
                      if (!session) return null;
                      
                      const upVotes = session.votes?.filter((v:any) => v.voteResult === 'UP').length || 0;
                      const downVotes = session.votes?.filter((v:any) => v.voteResult === 'DOWN').length || 0;
                      const holdVotes = session.votes?.filter((v:any) => v.voteResult === 'HOLD').length || 0;
                      const isOldSession = upVotes === 0 && downVotes === 0 && holdVotes === 0;
                      let dirStr = '';
                      if (!isOldSession) {
                        if (upVotes > downVotes && upVotes >= holdVotes) dirStr = '상승(UP) 우세';
                        else if (downVotes > upVotes && downVotes >= holdVotes) dirStr = '하락(DOWN) 우세';
                        else dirStr = '중립(HOLD)';
                      }

                      return (
                      <div key={session.id} className="border border-border/50 rounded-xl bg-muted/5 overflow-hidden shadow-sm">
                        <div className="bg-muted/30 px-4 py-2 border-b border-border/50 flex justify-between items-center text-xs">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                              <button onClick={() => setCurrentSwarmIndex(prev => Math.min(prev + 1, swarmSessions.length - 1))} disabled={currentSwarmIndex === swarmSessions.length - 1} className="p-1 hover:bg-muted/80 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent">
                                <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
                              </button>
                              <span className="font-mono text-muted-foreground min-w-[70px] text-center">{session.sessionDate}</span>
                              <button onClick={() => setCurrentSwarmIndex(prev => Math.max(prev - 1, 0))} disabled={currentSwarmIndex === 0} className="p-1 hover:bg-muted/80 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent">
                                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                              </button>
                            </div>
                            <span className="text-[10px] text-muted-foreground/60 font-mono tracking-tight bg-background px-1.5 py-0.5 rounded border border-border/50 shadow-sm">{currentSwarmIndex + 1} / {swarmSessions.length}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="font-bold flex items-center gap-2">
                              {dirStr && <span>방향: <span className={cn(dirStr.includes('상승') ? 'text-rose-500' : dirStr.includes('하락') ? 'text-indigo-500' : 'text-slate-500')}>{dirStr}</span> <span className="text-border/60 mx-1">|</span></span>}
                              <span>파급력: <span className={getSeverityColor(session.targetSeverity)}>{session.targetSeverity}</span> → <span className={getSeverityColor(session.consensusSeverity)}>{session.consensusSeverity}</span></span>
                            </span>
                            <button onClick={(e) => handleDeleteSwarmSession(session.id, e)} className="text-muted-foreground hover:text-red-500 transition-colors p-1 rounded-sm hover:bg-red-500/10" title="기록 삭제">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-col w-full">
                          {session.votes?.map((vote: any, index: number) => (
                            <div key={vote.id || vote.personaId} className={cn("flex gap-3 px-4 py-4 group/comment hover:bg-muted/10 transition-colors", index > 0 && "border-t border-border/40")}>
                              <div className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-background border border-border/50 text-base shadow-sm">
                                {vote.personaId === 'BULL' ? '🐂' : vote.personaId === 'BEAR' ? '🐻' : vote.personaId === 'QUANT' ? '📊' : vote.personaId === 'DEALER' ? '🏦' : '🤖'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start mb-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-bold text-foreground/80">{vote.personaId}</span>
                                    <span className={cn("text-[10px] px-2 py-0.5 rounded flex items-center gap-1 font-bold border tracking-tight", 
                                      vote.voteResult === 'UP' || vote.voteResult === 'OVERESTIMATED' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                                      vote.voteResult === 'DOWN' || vote.voteResult === 'UNDERESTIMATED' ? 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' :
                                      vote.voteResult === 'AGREE' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                                      'bg-slate-500/10 text-slate-500 border-slate-500/20'
                                    )}>
                                      <span>{vote.voteResult === 'UP' ? '상승' : vote.voteResult === 'DOWN' ? '하락' : vote.voteResult === 'HOLD' ? '중립' : vote.voteResult}</span>
                                      <span className="opacity-50 text-[9px]">➡️</span> 
                                      <span className="font-extrabold">{vote.suggestedSeverity}</span>
                                    </span>
                                  </div>
                                  
                                  {vote.winRate !== undefined && vote.winRate !== null && (
                                    <div className="flex items-center gap-1.5">
                                      <span className={cn("text-[10px] font-mono", vote.winRate >= 60 ? "text-amber-500 font-bold" : "text-muted-foreground opacity-60")}>
                                          🎯 적중률 {vote.winRate}%
                                      </span>
                                      {vote.weight !== undefined && (
                                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted/50 text-foreground/70 border border-border/40">
                                              입김 {Number(vote.weight).toFixed(1)}x
                                          </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <div className="text-[13px] text-foreground/90 leading-relaxed mt-1.5 break-keep">
                                  {vote.argument}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-6 bg-muted/10 border border-border/40 border-dashed rounded-xl">
                    아직 진행된 군집 토론이 없습니다. 버튼을 눌러 평가를 시작하세요.
                  </div>
                )}
              </div>

              {/* Timeline Tree */}
              <div className="flex-1 pl-4 pr-2">
                <div className="relative border-l-2 border-indigo-500/20 space-y-8 pb-8">
                  {issueTimeline.length > 0 ? issueTimeline.map((item, idx) => (
                    <div key={item.id} className="relative pl-6">
                      <div className={cn("absolute w-3 h-3 rounded-full -left-[7px] top-1 ring-4 ring-background", idx === 0 ? "bg-indigo-500" : "bg-slate-500")} />
                      <div className="text-xs font-mono text-muted-foreground mb-1">
                        {item.snapshot_date} 
                        {item.severity && <span className={cn("ml-2 font-bold tracking-wider select-none", getSeverityColor(item.severity))}>[{item.severity}]</span>}
                      </div>
                      <div className="text-base font-bold text-foreground mb-2">{item.summary}</div>
                      {(item.ai_analysis || item.market_reaction) && (
                        <div className="text-sm text-foreground/90 bg-muted/20 p-3.5 rounded-md border border-border/50 leading-relaxed shadow-sm space-y-2">
                          {item.ai_analysis && <p>{item.ai_analysis}</p>}
                          {item.market_reaction && <p className="text-muted-foreground whitespace-pre-line text-[12.5px] border-t border-border/30 pt-2"><strong className="text-amber-500">Reaction:</strong> {item.market_reaction}</p>}
                        </div>
                      )}
                    </div>
                  )) : (
                    <div className="text-sm text-muted-foreground p-4">타임라인 기록이 없습니다.</div>
                  )}
                </div>

                {/* Human Input */}
                <div className="mt-8 border-t border-border/40 pt-4">
                  <div className="text-xs font-bold text-muted-foreground mb-2 flex items-center gap-1.5"><Brain className="w-4 h-4" /> PM 수동 개입 기록</div>
                  <textarea placeholder="AI가 인지하지 못한 추가 맥락이나 컨텍스트를 주입하세요..." className="w-full h-24 bg-muted/10 border border-border/50 rounded-lg p-3 text-sm focus:outline-none focus:border-indigo-500 resize-none" />
                  <div className="flex justify-end mt-2"><button className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-xs rounded shadow">기록 추가</button></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SOURCES TAB */}
        {activeTab === 'SOURCES' && (
          <div className="grid grid-cols-12 gap-4 h-full overflow-hidden animate-in fade-in slide-in-from-left-4 duration-300">
            {/* Left: Keywords */}
            <div className="col-span-4 bg-muted/10 border border-border/40 rounded-xl p-4 flex flex-col shadow-sm">
              <div className="flex items-center gap-2 mb-4 border-b border-border/40 pb-3">
                <Flame className="w-4 h-4 text-amber-500" />
                <span className="font-bold text-sm">실시간 급상승 키워드</span>
                <span className="text-[10px] bg-background px-1.5 rounded border border-border ml-auto">PL-NewsKeyword</span>
              </div>
              <div className="flex-1 w-full -ml-4 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={DUMMY_KEYWORDS} layout="vertical" margin={{ top: 0, right: 20, left: 30, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11, fontWeight: 'bold'}} width={60} />
                    <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px'}} />
                    <Bar dataKey="count" radius={[0,4,4,0]}>
                      {DUMMY_KEYWORDS.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index < 2 ? '#f43f5e' : index < 4 ? '#8b5cf6' : '#334155'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Right: News & Reports */}
            <div className="col-span-8 flex flex-col gap-4 overflow-y-auto pr-2">
              <div className="bg-muted/10 border border-border/40 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Newspaper className="w-4 h-4 text-indigo-400" />
                  <span className="font-bold text-sm">핵심 뉴스 스트림</span>
                  <span className="text-[10px] bg-background px-1.5 rounded border border-border ml-auto">PL-NewsFlow</span>
                </div>
                <div className="space-y-2">
                  {[1,2,3].map(i => (
                    <div key={i} className="group p-3 bg-background border border-border/40 rounded-lg hover:border-indigo-500/30 transition-colors">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-bold text-sm group-hover:text-indigo-400 transition-colors">미 연준, 연내 금리 인하 신중론 대두... 시장 충격 제한적</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap"><Link2 className="inline w-3 h-3 mr-1"/>연합인포맥스</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">파월 의장이 인플레이션 재점화 가능성을 언급하며 6월 인하 가능성을 일축했습니다...</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-muted/10 border border-border/40 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <FileText className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-sm">제도권 매크로 리포트</span>
                  <span className="text-[10px] bg-background px-1.5 rounded border border-border ml-auto">PL-Research</span>
                </div>
                <div className="space-y-2">
                  {[1,2].map(i => (
                    <div key={i} className="p-3 bg-background border border-border/40 rounded-lg border-l-2 border-l-emerald-500">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-bold text-sm">글로벌 자금 이동: 방산 및 필수소비재 비중 확대 권고</span>
                        <span className="text-[10px] font-bold px-1.5 bg-emerald-500/10 text-emerald-500 rounded">NH투자증권</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">지정학적 리스크 장기화 시 박스권 장세 돌입. 현재 반도체 쏠림 현상의 피로도가 높아 대체재 성격의 가치주 및 방산 섹터로 수급 분산 예상.</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
