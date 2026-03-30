import { AiService } from '../AiService'
import { AiExecutionQueue } from '../AiExecutionQueue'
import { V2PipelineManager } from '../v2_pipeline/V2PipelineManager'

interface ChatMessage {
    role: 'user' | 'model';
    text: string;
}

export class CoPilotAgent {
    private static instance: CoPilotAgent;
    private ai: AiService;
    private history: ChatMessage[] = [];

    private constructor() {
        this.ai = AiService.getInstance();
        this.history = [];
    }

    public static getInstance(): CoPilotAgent {
        if (!CoPilotAgent.instance) {
            CoPilotAgent.instance = new CoPilotAgent();
        }
        return CoPilotAgent.instance;
    }

    private async getSystemContext(): Promise<string> {
        const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        let ctx = `[System Current Time: ${now} KST]\n\n`;

        try {
            // Dynamic import to prevent circular dependency
            const { MarketConditionAgent } = await import('./MarketConditionAgent');
            const latest = MarketConditionAgent.getInstance().getLatestPrediction();
            if (latest) {
                ctx += `[Passive Context 1: 최근 KOSPI 방향성 예측 (작성시간: ${latest.date} ${latest.cycle === 'A' ? '08:50' : '15:10'} KST)]\n`;
                ctx += `- 예측 방향: ${latest.predict} (Confidence: ${latest.confidence}%)\n`;
                ctx += `- 핵심 근거: ${latest.rationale.substring(0, 300)}...\n\n`;
            } else {
                ctx += `[Passive Context 1: 최근 시황 예측 데이터 없음]\n\n`;
            }
        } catch (error) {
            console.error('[CoPilotAgent] Context loading error:', error);
            ctx += `[Passive Context 1: 데이터 로드 실패]\n\n`;
        }

        ctx += `--- 도구 호출(Function Calling) 강제 가이드라인 ---\n`;
        ctx += `1. 사령관(사용자)이 현재 시점의 새로운 데이터나 종목 정보를 요구할 때 아래 도구 중 하나만 출력하고 즉시 멈추십시오.\n`;
        ctx += `\n`;
        ctx += `★ 도구 선택 결정 트리 (순서대로 확인하라) ★\n`;
        ctx += `  [Step 1] 질문에 "뉴스, 소식, 이슈, 기사, 헤드라인, 속보, 탑뉴스, 분위기, 흐름, 장세" 단어가 있는가?\n`;
        ctx += `           → YES: 무조건 [CALL_TOOL: NEWS_HUB] 사용. PL-Macro·PL-LocalFlow·PL-FinanceInfo 절대 금지.\n`;
        ctx += `  [Step 2] 질문에 "달러, 환율, 나스닥, VIX, 금리, 유가, 선물" 단어가 있는가?\n`;
        ctx += `           → YES: [CALL_TOOL: PL-Macro] 사용.\n`;
        ctx += `  [Step 3] 질문에 "수급, 외국인, 기관, 개인, 순매수, 순매도" 단어가 있는가?\n`;
        ctx += `           → YES: [CALL_TOOL: PL-LocalFlow] 사용.\n`;
        ctx += `  [Step 4] 질문에 "상한가, 급등, 급락, 오늘 뭐가 올라, 상승 종목" 단어가 있는가?\n`;
        ctx += `           → YES: [CALL_TOOL: PL-RisingStock] 사용.\n`;
        ctx += `  [Step 5] 특정 종목명이 명시되고 회사 실적·사업 내용을 묻는가? ("적자야?", "PER 얼마야?", "뭐 만들어?")\n`;
        ctx += `           → YES: [CALL_TOOL: PL-FinanceInfo, "종목명"] 사용.\n`;
        ctx += `  [Step 6] 특정 종목·테마의 오늘 이유/원인/실시간 검색이 필요한가? ("왜 올랐어?", "메쥬 특징주")\n`;
        ctx += `           → YES: [CALL_TOOL: PL-NaverSearch, "핵심검색어"] 사용. 검색어는 2단어 이내.\n`;
        ctx += `  [Step 7] 복잡한 거시 분석·시나리오·심층 리포트인가?\n`;
        ctx += `           → YES: [CALL_TOOL: ESCALATE_GEMINI] 사용.\n`;
        ctx += `  [Step 8] 위 어디에도 해당 없으면 도구 없이 직접 대답하라.\n`;
        ctx += `\n`;
        ctx += `━━ 도구별 상세 설명 ━━\n`;
        ctx += `[CALL_TOOL: NEWS_HUB]      뉴스·기사·이슈·헤드라인 전용. 캐시에서 즉시 반환. (뉴스 질문에 Macro/LocalFlow 금지)\n`;
        ctx += `[CALL_TOOL: PL-Macro]      숫자 지표 전용: 환율·나스닥선물·VIX·금리·유가. (뉴스 질문에 사용 절대 금지)\n`;
        ctx += `[CALL_TOOL: PL-LocalFlow]  수급 전용: 외국인·기관 순매수·자금 동향.\n`;
        ctx += `[CALL_TOOL: PL-RisingStock] 상한가·급등주·오늘 주도 테마.\n`;
        ctx += `[CALL_TOOL: PL-NaverFlow]  네이버 실시간 검색 상위 종목·개인 관심 테마.\n`;
        ctx += `[CALL_TOOL: PL-Research]   증권사 분석 리포트.\n`;
        ctx += `[CALL_TOOL: PL-FinanceInfo, "종목명"] 기업 실적·재무·BM·배당·PER (회사 기본 정보 질문).\n`;
        ctx += `[CALL_TOOL: PL-NaverSearch, "검색어"] 특정 종목·테마 실시간 검색 (검색어 2단어 이내 필수).\n`;
        ctx += `[CALL_TOOL: ESCALATE_GEMINI] 고난도 복합 분석·심층 리포트 요청 시.\n`;
        ctx += `\n`;
        ctx += `2. 도구 코드를 출력하면 백그라운드 시스템이 데이터를 수집 후 재질문합니다. 그 전까지 대답을 완전히 멈추십시오.\n`;
        ctx += `3. 혼합 질문엔 Step 1부터 순서대로 판단해 먼저 해당하는 도구 1개만 선택하세요.\n`;
        ctx += `4. 일상적·간단한 질문은 도구 없이 직접 대답하세요.\n`;
        ctx += `-------------------------------------------------\n\n`;

        return ctx;
    }

    private getSystemInstruction(mode: 'auto'|'short'|'detail'): string {
        let base = "너는 Kiwoom-Trader-V2 시스템의 시니컬하고 냉철한 전략 보좌관인 안티그래비티 Co-Pilot 이다. 팩트에 기반해 조언하되 매우 전문가적인 톤을 유지해라. 존댓말을 써라.";
        if (mode === 'short') {
            return base + " [최우선 절대 명령: 무조건 3~4문장 이내로 아주 짧고 간결하게 핵심만 대답하라(티키타카). 길게 보고서를 쓰면 시스템 페이탈 에러가 발생한다. 구어체를 활용해 액션 위주로 던져라.]";
        } else if (mode === 'detail') {
            return base + " [최우선 명령: 어떠한 질문이든 (1.현상 2.근거 3.액션플랜)의 3단 구조를 갖춘 마크다운 리포트로 심층 분석하여 친절히 보고하라.]";
        }
        // auto 모드: 답변 길이 제한으로 히스토리 오염 방지 (Harness Context 무결성)
        return base + " [명령: 질문의 깊이에 맞게 답변 수준을 조절하되, 도구 없이 직접 답할 때는 최대 5줄 이내로 요약하라. 목록은 최대 5개 항목까지만 허용한다. 사령관이 '자세히', '분석해줘' 등 심층 요청 시에만 그 이상 서술해도 좋다.]";
    }

    // ─── [Harness Layer] 도구 선택 검증 및 자동 교정 ─────────────────────
    // 로컬 LLM의 잘못된 도구 선택을 키워드 규칙으로 오버라이드 (Reflection)
    private resolveToolId(rawToolId: string, userMessage: string): { toolId: string; overridden: boolean } {
        const msg = userMessage.toLowerCase();

        // Rule 1: 뉴스/이슈 키워드 → 무조건 NEWS_HUB
        const newsPattern = /뉴스|소식|이슈|기사|헤드라인|속보|탑뉴스|top\s*\.?뉴스|주요\s*뉴스|오늘\s*뉴스|분위기|장세|흐름이 어때|흐름은/;
        const wrongForNews = ['PL-MACRO', 'PL-LOCALFLOW', 'PL-RISINGSTOCK', 'PL-FINANCEINFO', 'PL-NAVERSEARCH', 'PL-NAVERFLOW'];
        if (newsPattern.test(msg) && wrongForNews.includes(rawToolId)) {
            console.warn(`[Harness Override] 뉴스 키워드 감지: ${rawToolId} → NEWS_HUB`);
            return { toolId: 'NEWS_HUB', overridden: true };
        }

        // Rule 2: 수급/외국인 키워드 → PL-LocalFlow
        const flowPattern = /수급|외국인|기관|개인|순매수|순매도|자금|투자자/;
        const wrongForFlow = ['PL-MACRO', 'PL-NAVERSEARCH', 'NEWS_HUB'];
        if (flowPattern.test(msg) && wrongForFlow.includes(rawToolId)) {
            console.warn(`[Harness Override] 수급 키워드 감지: ${rawToolId} → PL-LocalFlow`);
            return { toolId: 'PL-LocalFlow', overridden: true };
        }

        // Rule 3: 급등/상한가 키워드 → PL-RisingStock
        const risingPattern = /급등|상한가|상승 종목|오늘 뭐가 올라|강세 종목|뭐가 올라/;
        if (risingPattern.test(msg) && rawToolId !== 'PL-RISINGSTOCK') {
            console.warn(`[Harness Override] 급등 키워드 감지: ${rawToolId} → PL-RisingStock`);
            return { toolId: 'PL-RisingStock', overridden: true };
        }

        return { toolId: rawToolId, overridden: false };
    }

    private async buildMessages(sysInst: string): Promise<any[]> {
        const systemCtx = await this.getSystemContext();
        const messages: any[] = [
            { role: 'system', content: sysInst + '\n\n' + systemCtx }
        ];

        for (const msg of this.history) {
            messages.push({
                role: msg.role === 'model' ? 'assistant' : 'user',
                content: msg.text
            });
        }
        return messages;
    }

    private async buildFallbackPrompt(newMessage: string): Promise<string> {
        let fullPrompt = `당신은 안티그래비티 Co-Pilot (심층 분석 엔진) 입니다.\n\n`;
        fullPrompt += await this.getSystemContext();

        if (this.history.length > 0) {
            fullPrompt += "=== 지난 대화 기록 ===\n";
            for (const msg of this.history) {
                if (msg.text !== newMessage) {
                    fullPrompt += `${msg.role === 'user' ? '사용자' : 'AI'}: ${msg.text}\n\n`;
                }
            }
            fullPrompt += "================\n\n";
        }

        fullPrompt += `최상위 목표명령: ${newMessage}\n\n위 명령에 대해 최고 수준의 금융 분석 능력을 발휘하여 답변을 작성하라.`;
        return fullPrompt;
    }

    public async chat(message: string, mode: 'auto'|'short'|'detail', onUpdate: (text: string, isDone: boolean) => void): Promise<void> {
        try {
            // Record user message
            this.history.push({ role: 'user', text: message });
            
            const sysInst = this.getSystemInstruction(mode);
            const customMessages = await this.buildMessages(sysInst);
            // logging용 dummy prompt
            const currentPrompt = `(Chatting with ${this.history.length} messages)`;
            
            console.log(`[CoPilotAgent] 로컬 AI 판단 요청... (mode: ${mode})`);
            let responseText = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'COPILOT',
                agentName: '코파일럿',
                triggerType: 'CHAT',
                targetType: 'local',
                prompt: currentPrompt,
                systemInstruction: sysInst,
                customMessages: customMessages
            });

            // ==== [Intercept Dynamic Tool Calling & Escalation] ====
            const trimmed = responseText.trim();
            const toolMatch = trimmed.match(/\[CALL_TOOL:\s+([A-Z0-9_-]+)(?:,\s*["']([^"']+)["'])?\]/i);

            if (toolMatch) {
                const rawPlId = toolMatch[1].toUpperCase();
                const customKeyword = toolMatch[2]; // undefined일 수 있음

                // ─── [Harness Validation Layer] 도구 선택 검증 ───
                const { toolId: resolvedId, overridden } = this.resolveToolId(rawPlId, message);
                const plId = resolvedId;
                if (overridden) {
                    onUpdate(`🔀 [Harness 교정] ${rawPlId} → ${plId} (질문 의도 분석 기반 자동 교정)`, false);
                    // 짧은 지연 후 실제 데이터 로딩 메시지로 덮음
                    await new Promise(r => setTimeout(r, 800));
                }
                
                if (plId === 'ESCALATE_GEMINI') {
                    console.log(`[CoPilotAgent] Gemini Escalation 감지!`);
                    onUpdate(`📡 [동적 라우팅] 높은 복잡도가 감지되어 Cloud AI (Gemini) 로 분석을 이관합니다...`, false);
                    
                    this.history.push({ role: 'model', text: `(사령관의 질문이 깊은 분석을 요하므로, 로컬 추론을 중단하고 Gemini에게 이관했다.)` });
                    
                    const fallbackPrompt = await this.buildFallbackPrompt(message);
                    responseText = await AiExecutionQueue.getInstance().enqueue({
                        agentId: 'COPILOT',
                        agentName: '코파일럿 (Gemini Escalated)',
                        triggerType: 'CHAT',
                        targetType: 'gemini',
                        prompt: fallbackPrompt,
                        systemInstruction: sysInst + " [추가 명령: 당신은 로컬 AI가 분석하기 벅차서 이관한 난제를 넘겨받은 클라우드 AI(Gemini)다. 최고 수준의 금융 인사이트를 발휘하여 사령관을 만족시켜라.]",
                    });
                    
                    // 프론트엔드 인식을 위한 마커 추가
                    responseText = `**[\u2601\uFE0F Gemini 심층 분석]**\n\n` + responseText;

                } else {
                    let krName = plId;
                    switch(plId) {
                        case 'PL-MACRO': krName = '매크로 지표'; break;
                        case 'PL-LOCALFLOW': krName = '국내 자금 수급'; break;
                        case 'PL-RISINGSTOCK': krName = '급등주 및 주도테마'; break;
                        case 'PL-NAVERFLOW': krName = '네이버 실검/관심도'; break;
                        case 'NEWS_HUB': krName = '뉴스 허브 (캐시)'; break;
                        case 'PL-NEWSFLOW': krName = '실시간 속보/뉴스'; break;
                        case 'PL-RESEARCH': krName = '증권사 리포트'; break;
                        case 'PL-NEWSKEYWORD': krName = '뉴스 키워드'; break;
                        case 'PL-NAVERSEARCH': krName = `'${customKeyword || '키워드'}' 웹 검색`; break;
                        case 'PL-FINANCEINFO': krName = `'${customKeyword || '종목'}' 재무/개요 조회`; break;
                    }
                    
                    console.log(`[CoPilotAgent] Tool 호출 감지됨: ${plId} (keyword: ${customKeyword})`);
                    // Notify frontend
                    onUpdate(`📡 실시간 [${krName}] 파이프라인 가동... (약 2~5초 소요)`, false);
                    
                    let toolMarkdown = '';
                    try {
                        if (plId === 'NEWS_HUB') {
                            // NewsDataHub 캐시에서 즉시 읽기 (외부 API 호출 없음)
                            const { NewsDataHub } = await import('../NewsDataHub');
                            toolMarkdown = NewsDataHub.getInstance().getNewsAsMarkdown({ maxPerCategory: 10 });
                            if (toolMarkdown.includes('캐시 없음')) {
                                toolMarkdown = '> ⚠️ 뉴스 캐시가 준비되지 않았습니다. 잠시 후 다시 시도하거나 News Hub에서 수동 수집을 실행하세요.';
                            }
                        } else {
                            const v2 = V2PipelineManager.getInstance();
                            const plIdOriginal = toolMatch[1];
                            const plResult = await v2.runPipeline(plIdOriginal as any, { forceFetch: true, keyword: customKeyword });
                            toolMarkdown = plResult.aggregatedMarkdown;
                        }
                    } catch(e: any) {
                        toolMarkdown = `데이터 수집 실패: ${e.message}`;
                    }
                    
                    const toolResponse = `[최신 시스템 도구 실행 결과: ${plId}${customKeyword ? ` - ${customKeyword}` : ''}]\n${toolMarkdown}\n\n위 데이터를 바탕으로 내가 방금 한 질문("${message}")에 대해 완벽하게 대답해. 질문을 반복하지 말고 곧바로 핵심 분석을 시작해라.`;
                    
                    console.log(`[CoPilotAgent] Tool 데이터 입수 완료. 로컬 AI 재요청...`);
                    // 내역에 주입
                    this.history.push({ role: 'model', text: `(최신 데이터를 가져오기 위해 '${plId}' 도구를 호출했다)` });
                    this.history.push({ role: 'user', text: toolResponse });
                    
                    const followupMessages = await this.buildMessages(sysInst);
                    
                    responseText = await AiExecutionQueue.getInstance().enqueue({
                        agentId: 'COPILOT',
                        agentName: '코파일럿 (Tool 후속)',
                        triggerType: 'CHAT',
                        targetType: 'local',
                        prompt: currentPrompt,
                        systemInstruction: sysInst,
                        customMessages: followupMessages
                    });
                }
            }
            // ==================================

            // 최종 응답 History 기록
            this.history.push({ role: 'model', text: responseText });

            // UI 전송
            onUpdate(responseText, true);

        } catch (error: any) {
            console.error('[CoPilotAgent] Error:', error);
            // 에러 시 롤백
            this.history.pop();
            throw error;
        }
    }

    public clearHistory() {
        this.history = [];
    }
}
