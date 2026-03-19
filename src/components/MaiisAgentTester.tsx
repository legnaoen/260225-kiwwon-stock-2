import React, { useState, useEffect } from 'react';
import { X, Play, RefreshCw, Database, Youtube, Newspaper, BrainCircuit } from 'lucide-react';
// import { useToast } from './ui/use-toast'; // if available, or just use simple alert

interface InsightRecord {
    id: number;
    date: string;
    domain_type: string;
    raw_input_text: string;
    used_prompt: string;
    generated_json: string;
    created_at: string;
}

export function MaiisAgentTester({ onClose }: { onClose: () => void }) {
    const [activeTab, setActiveTab] = useState<'YOUTUBE' | 'NEWS' | 'MACRO'>('YOUTUBE');
    const [isLoading, setIsLoading] = useState(false);
    const [records, setRecords] = useState<InsightRecord[]>([]);
    const [selectedRecord, setSelectedRecord] = useState<InsightRecord | null>(null);
    const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0]);

    useEffect(() => {
        loadInsights();
    }, [targetDate]);

    const loadInsights = async () => {
        try {
            const data = await window.electronAPI.getDomainInsights(targetDate.replace(/-/g, ''));
            setRecords(data || []);
            if (data && data.length > 0) {
                // select the first one of the active tab if possible
                const filtered = data.filter((r: any) => r.domain_type === activeTab);
                if (filtered.length > 0) setSelectedRecord(filtered[0]);
                else setSelectedRecord(data[0]);
            } else {
                setSelectedRecord(null);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleRunAgent = async () => {
        setIsLoading(true);
        try {
            if (activeTab === 'MACRO') {
                const res = await window.electronAPI.getMacroSnapshot();
                if (res.success) {
                    alert('매크로 데이터 수집이 완료되었습니다!');
                    // For demo purposes, we can just artificially show it as a record or put it in state
                    const dummyRecord: InsightRecord = {
                        id: 9999,
                        date: targetDate,
                        domain_type: 'MACRO',
                        raw_input_text: "Target Symbols:\n^IXIC (NASDAQ)\nKRW=X (USDKRW)\n^TNX (YIELD 10Y)\nCL=F (CRUDE OIL)\n^VIX (VIX)\n^GSPC (S&P 500)",
                        used_prompt: "API 직접 호출 (AI 개입 없음)",
                        generated_json: JSON.stringify(res.data, null, 2),
                        created_at: new Date().toISOString()
                    };
                    setRecords(prev => [dummyRecord, ...prev.filter(r => r.domain_type !== 'MACRO')]);
                    setSelectedRecord(dummyRecord);
                } else {
                    alert(`오류 발생: ${res.error}`);
                }
            } else {
                const res = await window.electronAPI.analyzeDomain({ domain: activeTab, date: targetDate.replace(/-/g, '') });
                if (res.success) {
                    alert(`${activeTab} AI 분석이 완료되었습니다!`);
                    await loadInsights();
                } else {
                    alert(`오류 발생: ${res.error}`);
                }
            }
        } catch (error: any) {
            alert(`API 호출 오류: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const filteredRecords = records.filter(r => r.domain_type === activeTab);

    return (
        <div className="fixed inset-0 z-[100] flex bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-[90%] h-[90%] m-auto bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <header className="flex-none p-4 px-6 border-b border-border bg-card flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <BrainCircuit className="text-primary" size={24} />
                        <h2 className="text-lg font-bold">MAIIS Domain Agent Tester</h2>
                        <span className="text-sm text-muted-foreground ml-2">마스터 AI로 가기 전, 하위 에이전트의 응답 퀄리티를 육안 검증합니다.</span>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-md transition-colors text-foreground">
                        <X size={20} />
                    </button>
                </header>

                <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar */}
                    <div className="w-[280px] flex-none border-r border-border bg-muted/20 flex flex-col">
                        <div className="p-4 border-b border-border">
                            <label className="text-xs font-bold text-muted-foreground mb-1 block">대상 기준일 (YYYYMMDD)</label>
                            <input 
                                type="date" 
                                value={targetDate} 
                                onChange={(e) => setTargetDate(e.target.value)}
                                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                            />
                        </div>
                        <div className="p-2 flex-1 overflow-y-auto">
                            <button 
                                onClick={() => setActiveTab('YOUTUBE')}
                                className={`w-full flex items-center gap-2 px-3 py-3 rounded-md text-sm font-bold text-left transition-colors ${activeTab === 'YOUTUBE' ? 'bg-red-500/10 text-red-500' : 'hover:bg-muted text-foreground'}`}
                            >
                                <Youtube size={18} /> 유튜브 심리 분석 AI
                            </button>
                            <button 
                                onClick={() => setActiveTab('NEWS')}
                                className={`w-full flex items-center gap-2 px-3 py-3 rounded-md text-sm font-bold text-left transition-colors mt-2 ${activeTab === 'NEWS' ? 'bg-blue-500/10 text-blue-500' : 'hover:bg-muted text-foreground'}`}
                            >
                                <Newspaper size={18} /> 뉴스 매크로 팩트 AI
                            </button>
                            <button 
                                onClick={() => setActiveTab('MACRO')}
                                className={`w-full flex items-center gap-2 px-3 py-3 rounded-md text-sm font-bold text-left transition-colors mt-2 ${activeTab === 'MACRO' ? 'bg-green-500/10 text-green-500' : 'hover:bg-muted text-foreground'}`}
                            >
                                <Database size={18} /> 시장 지표 실데이터 가져오기
                            </button>

                            <div className="mt-8 px-2">
                                <h3 className="text-xs font-bold text-muted-foreground mb-3 flex items-center gap-1"><Database size={14}/> DB 기록 (Insight DB)</h3>
                                {filteredRecords.length === 0 ? (
                                    <div className="text-xs text-muted-foreground p-2 text-center bg-background rounded border border-border/50">데이터가 없습니다</div>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {filteredRecords.map(r => (
                                            <button 
                                                key={r.id} 
                                                onClick={() => setSelectedRecord(r)}
                                                className={`text-left text-xs p-2 rounded border ${selectedRecord?.id === r.id ? 'bg-primary/10 border-primary text-primary' : 'bg-background border-border text-muted-foreground hover:border-primary/50'}`}
                                            >
                                                {new Date(r.created_at).toLocaleTimeString('ko-KR')} 에 생성됨
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-t border-border">
                            <button 
                                onClick={handleRunAgent}
                                disabled={isLoading}
                                className="w-full flex justify-center items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 rounded-lg shadow disabled:opacity-50"
                            >
                                {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Play size={18} />}
                                {activeTab === 'MACRO' ? 'API 수집 실행' : `${activeTab} AI 실행`}
                            </button>
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="flex-1 flex flex-col bg-background overflow-hidden relative">
                        {isLoading && (
                            <div className="absolute inset-0 z-10 bg-background/50 backdrop-blur-sm flex items-center justify-center">
                                <div className="flex flex-col items-center gap-3">
                                    <RefreshCw className="animate-spin text-primary" size={32} />
                                    <span className="font-bold text-primary">에이전트가 생각하고 있습니다... (10~20초 소요)</span>
                                </div>
                            </div>
                        )}
                        {!selectedRecord ? (
                            <div className="flex-1 flex items-center justify-center text-muted-foreground font-medium">
                                좌측에서 기록을 선택하거나 AI를 실행해주세요.
                            </div>
                        ) : (
                            <div className="flex-1 flex overflow-hidden">
                                {/* Prompt & Input Area */}
                                <div className="w-1/2 flex flex-col border-r border-border h-full">
                                    <div className="p-3 border-b border-border bg-muted/20 font-bold text-sm text-foreground">
                                        주입된 컨텍스트 (Input & Prompt)
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                                        <div>
                                            <div className="text-xs font-bold text-primary mb-2">System Persona Prompt</div>
                                            <pre className="text-[11px] leading-relaxed bg-muted text-muted-foreground p-3 rounded border border-border whitespace-pre-wrap break-words">
                                                {selectedRecord.used_prompt}
                                            </pre>
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold text-amber-500 mb-2">Raw Data Input ({activeTab === 'MACRO' ? 'API 연동 타겟' : '크롤링 원본'})</div>
                                            <pre className="text-[11px] leading-relaxed bg-amber-500/5 text-foreground p-3 rounded border border-amber-500/20 whitespace-pre-wrap break-words">
                                                {selectedRecord.raw_input_text}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                                {/* JSON Output Area */}
                                <div className="w-1/2 flex flex-col h-full bg-zinc-950">
                                    <div className="p-3 border-b border-zinc-800 bg-zinc-900 font-bold text-sm text-zinc-100 flex justify-between items-center">
                                        <span>{activeTab === 'MACRO' ? '결과 Snapshot JSON' : '생성된 Unified Ontology JSON'}</span>
                                        <span className="text-[10px] font-mono text-zinc-400 font-normal px-2 py-1 rounded bg-zinc-800">
                                            {selectedRecord.created_at}
                                        </span>
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-4">
                                        <pre className="text-[13px] font-mono text-green-400 bg-transparent whitespace-pre-wrap break-words">
                                            {selectedRecord.generated_json}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
