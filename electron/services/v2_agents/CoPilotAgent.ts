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
        ctx += `1. 사령관(사용자)이 현재 시점의 새로운 데이터나 종목 정보를 요구하거나 고도의 추론을 요구할 때 즉시 아래 특수 명령 중 하나만을 명확히 출력하고 당신은 대답을 정지하십시오.\n`;
        ctx += `   - [CALL_TOOL: ESCALATE_GEMINI] : 사령관의 질문 난이도가 너무 높거나(거시 경제 딥 브리핑, 방대한 데이터 통합 분석, 복잡한 시나리오 추론), 고품질 마크다운 리포트를 요구한다고 판단될 때 무조건 호출하라. 당신(로컬)을 대신하여 클라우드망의 대형 AI가 심층 분석을 전담하게 된다.\n`;
        ctx += `   - [CALL_TOOL: PL-Macro] : 나스닥선물, 환율, VIX, 글로벌 경제 지표 조회\n`;
        ctx += `   - [CALL_TOOL: PL-LocalFlow] : 코스피/코스닥 외국인, 기관 자금 동향 등 수급 조회\n`;
        ctx += `   - [CALL_TOOL: PL-RisingStock] : 당일 상한가, 급등주, 시장 주도 테마 조회 ("오늘 뭐가 올라?", "급등주 뭐야?")\n`;
        ctx += `   - [CALL_TOOL: PL-NaverFlow] : 실시간 검색 상위 종목, 개인투자자 관심 테마 조회\n`;
        ctx += `   - [CALL_TOOL: PL-NewsFlow] : 실시간 경제 및 주식 장중 속보/뉴스 흐름 조회\n`;
        ctx += `   - [CALL_TOOL: PL-Research] : 최신 증권사 분석 리포트 요약본 조회\n`;
        ctx += `   - [CALL_TOOL: PL-NewsKeyword] : 최신 뉴스 핵심 키워드 클라우드 조회\n`;
        ctx += `   - [CALL_TOOL: PL-FinanceInfo, "종목명"] : 특정 기업의 실적(매출/영업이익), 사업개요(BM), 배당, PER/PBR 적정주가 등 팩트 펀더멘털을 물을 때 무조건 호출 (예: [CALL_TOOL: PL-FinanceInfo, "삼성전자"])\n`;
        ctx += `   - [CALL_TOOL: PL-NaverSearch, "핵심검색어"] : 특정 종목/테마 딥다이브가 필요할 때 스스로 키워드를 도출해 맞춤 웹 검색 (예: [CALL_TOOL: PL-NaverSearch, "메쥬 특징주"])\n`;
        ctx += `   [경고] 목적을 명확히 분리하세요. "회사 사업 내용이 뭐야?", "적자 기업이야?" 등은 PL-FinanceInfo를 쓰고, "왜 오늘 올랐지?" 등 단기 호재나 뉴스 파악은 PL-NaverSearch를 쓰십시오.\n`;
        ctx += `   [경고] PL-NaverSearch 사용 시 검색어는 반드시 '메쥬 특징주', '제지 테마' 처럼 핵심 명사 1~2개로만 매우 짧게 구성하십시오. '메쥬 기업 개요 사업 내용' 처럼 문장형이나 3단어 이상의 검색어를 쓰면 아무 뉴스도 검색되지 않는 시스템 페이탈 에러가 발생합니다.\n`;
        ctx += `2. 도구 코드를 출력하면, 백그라운드 시스템이 즉시 해당 데이터를 수집하여 공급합니다.\n`;
        ctx += `3. 혼합된 질문(예: "오늘 상승 종목이랑 뉴스 어때?")엔 가장 핵심이 되는 도구 1개만 선택하세요.\n`;
        ctx += `4. 단순 팩트나 당신(작은 엔진)이 충분히 논리적으로 답할 수 있는 일상적인 질문이라면 도구를 전혀 호출하지 말고 그냥 대답하십시오.\n`;
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
        return base + " [명령: 사령관의 질문 길이나 의도를 파악해 상황에 맟게 알아서 답변 깊이를 유동적으로 조절하라.]";
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
                const plId = toolMatch[1].toUpperCase();
                const customKeyword = toolMatch[2]; // undefined일 수 있음
                
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
                        const v2 = V2PipelineManager.getInstance();
                        const plIdOriginal = toolMatch[1]; // PL-Macro 등 원래 대소문자 유지된 값 사용 필요
                        const plResult = await v2.runPipeline(plIdOriginal as any, { forceFetch: true, keyword: customKeyword });
                        toolMarkdown = plResult.aggregatedMarkdown;
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
