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
    const [activeTab, setActiveTab] = useState<'YOUTUBE' | 'NEWS' | 'MACRO' | 'RISING' | 'MASTER'>('YOUTUBE');
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
            } else if (activeTab === 'RISING') {
                // daily_rising_stocks는 YYYY-MM-DD 포맷을 사용하므로 replace 없이 원래 포맷 전달
                const res = await window.electronAPI.getRisingStocksSummary(targetDate);
                if (res.success) {
                    alert('당일 주도주 요약 데이터를 가져왔습니다!');
                    const dummyRecord: InsightRecord = {
                        id: 9998,
                        date: targetDate,
                        domain_type: 'RISING',
                        raw_input_text: "Target DB:\ndaily_rising_stocks (SQLite)\n[수집경로] 키움증권 조건검색 종목\n※ [급등/테마주 15종목] 및 [우량/수급주 10종목]을 이원화 수집하여 백엔드에서 테마별로 그룹핑",
                        used_prompt: "DB 어댑터 변환 (초과 트래픽 억제 / AI 개입 없음)",
                        generated_json: JSON.stringify(res.data, null, 2),
                        created_at: new Date().toISOString()
                    };
                    setRecords(prev => [dummyRecord, ...prev.filter(r => r.domain_type !== 'RISING')]);
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

    const handleRunMaster = async (timing: '0845' | '0930' | '1530') => {
        setIsLoading(true);
        try {
            const parsedDate = targetDate.replace(/-/g, '');
            const res = await window.electronAPI.generateMasterState(timing, parsedDate);
            if (res.success) {
                alert(`Master AI [${timing}] 분석 완료!`);
                const dummyRecord: InsightRecord = {
                    id: 10000 + parseInt(timing),
                    date: targetDate,
                    domain_type: 'MASTER',
                    raw_input_text: `Timing: ${timing}\n[Phase3] 4대 도메인 융합 및 시맨틱 매핑(50대 테마) 완료`,
                    used_prompt: `World State Generator Framework`,
                    generated_json: JSON.stringify(res.data, null, 2),
                    created_at: new Date().toISOString()
                };
                setRecords(prev => [dummyRecord, ...prev.filter(r => r.domain_type !== 'MASTER' || r.id !== dummyRecord.id)]);
                setSelectedRecord(dummyRecord);
            } else {
                alert(`오류 발생: ${res.error}`);
            }
        } catch (error: any) {
            alert(`API 호출 오류: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRunAggregation = async () => {
        setIsLoading(true);
        try {
            const res = await window.electronAPI.runRankingAggregation(targetDate);
            if (res.success) {
                alert(`${targetDate} 랭킹 취합 성공! 테스터 목록에 결과가 추가되었습니다.`);
                
                // 취합된 결과를 화면에 보여주기 위해 가짜 레코드를 생성합니다.
                const aggRecord: InsightRecord = {
                    id: 20000 + Date.now(),
                    date: targetDate,
                    domain_type: 'MASTER', // 편의상 MASTER 탭에 보이게 조치
                    raw_input_text: `Data Aggregation Pipeline for ${targetDate}\n- 테마 합산\n- 키워드 추출\n- 보유목록 수익률 업데이트`,
                    used_prompt: `Mechanical Aggregator Engine`,
                    generated_json: JSON.stringify(res.data || res, null, 2),
                    created_at: new Date().toISOString()
                };
                setRecords(prev => [aggRecord, ...prev]);
                setSelectedRecord(aggRecord);
                setActiveTab('MASTER'); // MASTER 탭으로 즉시 이동하여 보여줌
            } else {
                alert(`오류 발생: ${res.error}`);
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
                            <button 
                                onClick={() => setActiveTab('RISING')}
                                className={`w-full flex items-center gap-2 px-3 py-3 rounded-md text-sm font-bold text-left transition-colors mt-2 ${activeTab === 'RISING' ? 'bg-purple-500/10 text-purple-500' : 'hover:bg-muted text-foreground'}`}
                            >
                                <Database size={18} /> 당일 주도주 요약 가져오기
                            </button>
                            <button 
                                onClick={handleRunAggregation}
                                disabled={isLoading}
                                className={`w-full flex items-center justify-center gap-2 px-3 py-3 rounded-md text-sm font-bold text-center mt-4 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:opacity-50 shadow-sm`}
                            >
                                <Database size={16} /> Data Aggregation (08:00)
                            </button>
                            <button 
                                onClick={() => setActiveTab('MASTER')}
                                className={`w-full flex items-center justify-between px-3 py-3 rounded-md text-sm font-bold text-left transition-colors mt-2 border ${activeTab === 'MASTER' ? 'bg-amber-500/20 border-amber-500/50 text-amber-500' : 'bg-amber-500/5 border-amber-500/20 text-amber-500/70 hover:bg-amber-500/10'}`}
                            >
                                <span className="flex items-center gap-2"><BrainCircuit size={18} /> Master AI (최상위)</span>
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
                        <div className="p-4 border-t border-border flex flex-col gap-2">
                            {activeTab === 'MASTER' ? (
                                <>
                                    <button onClick={() => handleRunMaster('0845')} disabled={isLoading} className="w-full bg-slate-700 hover:bg-slate-600 border border-slate-500 rounded-md text-white font-bold py-2 text-sm transition-colors disabled:opacity-50 flex justify-center items-center gap-2"><Play size={16}/> 08:45 장전 대전제</button>
                                    <button onClick={() => handleRunMaster('0930')} disabled={isLoading} className="w-full bg-blue-700 hover:bg-blue-600 border border-blue-500 rounded-md text-white font-bold py-2 text-sm transition-colors disabled:opacity-50 flex justify-center items-center gap-2"><Play size={16}/> 09:30 알파 픽 뷰</button>
                                    <button onClick={() => handleRunMaster('1530')} disabled={isLoading} className="w-full bg-amber-700 hover:bg-amber-600 border border-amber-500 rounded-md text-white font-bold py-2 text-sm transition-colors disabled:opacity-50 flex justify-center items-center gap-2"><Play size={16}/> 15:30 오답 노트</button>
                                </>
                            ) : (
                                <button 
                                    onClick={handleRunAgent}
                                    disabled={isLoading}
                                    className="w-full flex justify-center items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 rounded-lg shadow disabled:opacity-50"
                                >
                                    {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Play size={18} />}
                                    {(activeTab === 'MACRO' || activeTab === 'RISING') ? 'API/DB 수집 실행' : `${activeTab} AI 실행`}
                                </button>
                            )}
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
