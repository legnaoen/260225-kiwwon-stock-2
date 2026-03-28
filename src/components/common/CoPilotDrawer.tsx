import React, { useState, useRef, useEffect } from 'react';
import { Bot, User, Send, X, BrainCircuit, ChevronDown, Zap, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export default function CoPilotDrawer() {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [messages, setMessages] = useState<{role: 'user'|'agent'|'system', text: string}[]>([
        { role: 'agent', text: '안녕하세요! 데이터 기반 전략을 돕는 안티그래비티 Co-Pilot 입니다.\n\n오늘 시장의 주도 테마나 KOSPI 방향성에 대해 무엇이든 말씀해 주세요.\n\n* **팁**: 마크다운이 완벽하게 지원됩니다.' }
    ]);
    const [input, setInput] = useState('');
    const [mode, setMode] = useState<'auto'|'short'|'detail'>('auto');
    const [isModeOpen, setIsModeOpen] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen, isLoading]);

    useEffect(() => {
        const cleanup = window.electronAPI.onCoPilotReply(({ text, isDone }) => {
            if (isDone) {
                setMessages(prev => [...prev, { role: 'agent', text }]);
                setIsLoading(false);
            } else {
                setMessages(prev => [...prev, { role: 'system', text }]);
            }
        });
        return cleanup;
    }, []);

    const handleSend = () => {
        if (!input.trim() || isLoading) return;
        const msg = input;
        setMessages(prev => [...prev, { role: 'user', text: msg }]);
        setInput('');
        setIsLoading(true);
        
        window.electronAPI.sendCoPilotMessage(msg, mode);
    };

    return (
        <>
            {/* Floating Toggle Button */}
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "fixed bottom-10 right-6 z-[100] p-4 rounded-full shadow-lg transition-transform duration-300",
                    "bg-primary hover:bg-primary/90 text-primary-foreground border border-border",
                    isOpen ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100 hover:scale-105"
                )}
            >
                <BrainCircuit className="w-6 h-6" />
            </button>

            {/* Slide-out Drawer Panel */}
            <div className={cn(
                "fixed top-8 bottom-6 right-0 w-[450px] z-[100] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col shadow-2xl overflow-hidden",
                "bg-background border-l border-border",
                isOpen ? "translate-x-0" : "translate-x-full"
            )}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
                    <div className="flex items-center gap-3 text-primary">
                        <div className="p-1.5 bg-primary/10 rounded-md">
                            <BrainCircuit className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col">
                            <span className="font-bold text-sm tracking-tight text-foreground">Co-Pilot War Room</span>
                            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">L1/L2 AI Access Matrix</span>
                        </div>
                    </div>
                    <button onClick={() => setIsOpen(false)} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Chat History */}
                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                    {messages.map((m, i) => (
                        <div key={i} className={cn("flex flex-col gap-1.5", m.role === 'user' ? "items-end ml-auto max-w-[85%]" : "items-start w-full")}>
                            {m.role !== 'system' && (
                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-1">
                                    {m.role === 'user' ? (
                                        <><span className="font-bold uppercase">Commander</span><User className="w-3 h-3" /></>
                                    ) : (
                                        <><Bot className="w-4 h-4 text-primary" /><span className="font-bold text-primary uppercase">Co-Pilot</span></>
                                    )}
                                </div>
                            )}
                            
                            {m.role === 'system' ? (
                                <div className="p-2.5 w-full text-[12px] bg-muted/50 text-muted-foreground border border-muted italic rounded-md">
                                    {m.text}
                                </div>
                            ) : m.role === 'user' ? (
                                <div className="p-3.5 text-[13px] leading-relaxed whitespace-pre-wrap shadow-sm bg-primary text-primary-foreground rounded-2xl rounded-tr-sm">
                                    {m.text}
                                </div>
                            ) : (
                                <div className="w-full text-sm text-foreground/90 leading-relaxed max-w-none prose prose-sm dark:prose-invert">
                                    <ReactMarkdown 
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            strong: ({node, children, ...props}) => {
                                                // 문장 시작 부분(컬럼 6 이하)인지 판별하여 스타일을 다르게 적용
                                                const isStart = node?.position?.start?.column ? node.position.start.column <= 10 : false;
                                                // 콜론으로 끝나는 강조어구도 시작 문구(라벨)로 간주
                                                const hasColon = React.Children.toArray(children).join('').includes(':');
                                                
                                                if (isStart || hasColon) {
                                                    // 문장 처음에 나오는 볼드 문구: 배경색 없이 단순 볼드 처리
                                                    return <strong className="font-bold text-foreground" {...props}>{children}</strong>;
                                                } else {
                                                    // 문장 중간에 나오는 볼드 문구: 밝은 노란색 마커 칠한 효과
                                                    return (
                                                        <strong 
                                                            className="font-bold text-foreground relative inline-block px-1 mx-0.5" 
                                                            style={{ background: 'linear-gradient(180deg, transparent 55%, rgba(250, 204, 21, 0.4) 55%)' }}
                                                            {...props}
                                                        >
                                                            {children}
                                                        </strong>
                                                    );
                                                }
                                            },
                                            b: ({node, children, ...props}) => {
                                                const isStart = node?.position?.start?.column ? node.position.start.column <= 10 : false;
                                                const hasColon = React.Children.toArray(children).join('').includes(':');
                                                if (isStart || hasColon) {
                                                    return <b className="font-bold text-foreground" {...props}>{children}</b>;
                                                } else {
                                                    return <b className="font-bold text-foreground relative inline-block px-1 mx-0.5" style={{ background: 'linear-gradient(180deg, transparent 55%, rgba(250, 204, 21, 0.4) 55%)' }} {...props}>{children}</b>;
                                                }
                                            }
                                        }}
                                    >
                                        {m.text
                                            .replace(/\\\*/g, '*') // Gemini 이스케이프 제거
                                            .replace(/\*\*\s*([^*]+?)\s*\*\*/g, '**$1**') // 양쪽 공백 완벽 제거 버그 픽스
                                            .replace(/\*\*(.*?)\*\*([가-힣a-zA-Z0-9])/g, '**$1** $2') // 뒤에 조사가 붙은 경우 분리
                                            .replace(/([가-힣a-zA-Z0-9])\*\*(.*?)\*\*/g, '$1 **$2**') // 앞에 글자가 붙은 경우 분리
                                        }
                                    </ReactMarkdown>
                                </div>
                            )}
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex flex-col gap-1.5 items-start w-full">
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-1">
                                <Bot className="w-4 h-4 text-primary animate-pulse" />
                                <span className="font-bold text-primary uppercase animate-pulse">Co-Pilot Thinking...</span>
                            </div>
                            <div className="w-full text-sm text-muted-foreground italic pl-6">
                                시황 분석 및 답변 생성 중...
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 pt-3 border-t border-border bg-background relative">
                    {/* Toolbar (Mode & Quick Actions) */}
                    <div className="flex items-center justify-between mb-3 relative">
                        {/* Mode Selector */}
                        <div className="relative">
                            <button 
                                onClick={() => setIsModeOpen(!isModeOpen)}
                                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold tracking-wide rounded-md border border-border bg-muted/30 hover:bg-muted text-muted-foreground transition-colors"
                            >
                                {mode === 'auto' && <><BrainCircuit className="w-3 h-3 text-primary" /> AUTO Mode</>}
                                {mode === 'short' && <><Zap className="w-3 h-3 text-amber-500" /> TIKI-TAKA</>}
                                {mode === 'detail' && <><FileText className="w-3 h-3 text-blue-500" /> REPORT</>}
                                <ChevronDown className={cn("w-3 h-3 ml-1 opacity-70 transition-transform", isModeOpen && "rotate-180")} />
                            </button>

                            {isModeOpen && (
                                <div className="absolute bottom-full left-0 mb-2 w-52 bg-background border border-border rounded-lg shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] p-1.5 z-[110] flex flex-col gap-1">
                                    <button onClick={() => { setMode('auto'); setIsModeOpen(false); }} className={cn("flex flex-col items-start px-3 py-2 text-left rounded-md hover:bg-muted/70 transition-colors", mode === 'auto' && "bg-muted")}>
                                        <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                                            <BrainCircuit className="w-3.5 h-3.5 text-primary" /> AUTO (눈치 모드)
                                        </span>
                                        <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">질문 의도와 길이에 따라 스스로 답변 깊이를 유연하게 조절합니다.</span>
                                    </button>
                                    <button onClick={() => { setMode('short'); setIsModeOpen(false); }} className={cn("flex flex-col items-start px-3 py-2 text-left rounded-md hover:bg-muted/70 transition-colors", mode === 'short' && "bg-muted")}>
                                        <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                                            <Zap className="w-3.5 h-3.5 text-amber-500" /> TIKI-TAKA (티키타카)
                                        </span>
                                        <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">3줄 이내 단답형으로 핵심만 대답하여 빠른 대화를 돕습니다.</span>
                                    </button>
                                    <button onClick={() => { setMode('detail'); setIsModeOpen(false); }} className={cn("flex flex-col items-start px-3 py-2 text-left rounded-md hover:bg-muted/70 transition-colors", mode === 'detail' && "bg-muted")}>
                                        <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                                            <FileText className="w-3.5 h-3.5 text-blue-500" /> REPORT (심층 리포트)
                                        </span>
                                        <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">항상 '현상-원인-액션'의 3단 구조 심층 브리핑을 뿜어냅니다.</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Quick Actions (Mock UI) */}
                        <div className="flex items-center gap-2">
                            <button className="text-[10px] px-2 py-1 bg-muted/40 hover:bg-muted text-muted-foreground rounded-md border border-border transition-colors">
                                + 현재 시황 불러오기
                            </button>
                            <button className="text-[10px] px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 font-bold rounded-md border border-amber-500/20 transition-colors">
                                [🔒 시장 뷰 주입]
                            </button>
                        </div>
                    </div>

                    <div className="flex items-end gap-2">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            placeholder="명령이나 의견을 자유롭게 입력하세요..."
                            className="flex-1 bg-muted/20 border border-border rounded-md py-3 pl-4 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none"
                            rows={1}
                            style={{ minHeight: '44px', maxHeight: '160px' }}
                        />
                        <button 
                            onClick={handleSend}
                            disabled={!input.trim() || isLoading}
                            className="p-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-md transition-colors"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
