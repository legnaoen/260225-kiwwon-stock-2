import { LocalAiService } from '../LocalAiService';
import { AiService } from '../AiService';
import { NaverSearchCollector } from '../v2_pipeline/collectors/NaverSearchCollector';
import { SmartMoneyCollector } from '../v2_pipeline/collectors/SmartMoneyCollector';
import { FundamentalCollector } from '../v2_pipeline/collectors/FundamentalCollector';
import { FinanceInfoCollector } from '../v2_pipeline/collectors/FinanceInfoCollector';
import { BrowserWindow } from 'electron';

export interface MoonshotEvaluationResult {
    code: string;
    name: string;
    status: 'passed' | 'failed';
    narrative: string;
    tbpScore: number;
    megaTrend?: string;
    bullCase?: string;
    bearCase?: string;
    milestones?: string[];
    invalidationCondition?: string;
    inputData: string;
    prompt: string;
    rawResult: string;
    harnessLogs: any[];
    tag: string;
}

export class MoonshotValidationAgent {
    private static instance: MoonshotValidationAgent;
    private localAiService = LocalAiService.getInstance();
    private aiService = AiService.getInstance();
    
    private naverCollector = new NaverSearchCollector();
    private smartMoneyCollector = new SmartMoneyCollector();
    private fundamentalCollector = new FundamentalCollector();
    private financeInfoCollector = new FinanceInfoCollector();

    private constructor() {}

    public static getInstance(): MoonshotValidationAgent {
        if (!MoonshotValidationAgent.instance) {
            MoonshotValidationAgent.instance = new MoonshotValidationAgent();
        }
        return MoonshotValidationAgent.instance;
    }

    private extractCoreFinance(markdown: string): string {
        if (!markdown) return "";
        const lines = markdown.split('\n');
        // 반드시 포함해야 하는 핵심 재무 항목 (나머지 EPS, PER, PBR 등은 노이즈로 간주하고 버림)
        const keywords = ['주요재무정보', '202', '매출액', '영업이익', '영업이익률', '부채비율', '유보율'];
        const result: string[] = [];
        
        for (const line of lines) {
            if (line.includes('|')) {
                // 마크다운 테이블 구분선(|---|) 보존
                if (line.includes('---')) {
                    result.push(line);
                    continue;
                }
                // 핵심 키워드가 포함된 행만 핀셋 추출
                if (keywords.some(k => line.includes(k))) {
                    result.push(line);
                }
            }
        }
        return result.length > 0 ? result.join('\n') : "";
    }

    public async runValidation(
        stocks: { code: string; name: string; tag: string, price?: number }[],
        win?: BrowserWindow,
        ignoreCooldown: boolean = false
    ): Promise<MoonshotEvaluationResult[]> {
        const results: MoonshotEvaluationResult[] = [];
        const { DatabaseService } = await import('../DatabaseService');
        const db = DatabaseService.getInstance().getDb();
        const now = DatabaseService.getInstance().getKstTimestamp();
        const nowDate = new Date(now);

        // 1. Fetch currently active tracking stocks to skip
        const activeRecords = db.prepare('SELECT stock_code FROM moonshot_active_tracking').all();
        const activeSet = new Set(activeRecords.map((r: any) => r.stock_code));

        // 2. Fetch evaluation history for cooldown logic
        const evalHistory = db.prepare('SELECT stock_code, tag, created_at FROM moonshot_eval_history ORDER BY created_at DESC').all();
        const cooldownMap = new Map<string, number>(); // latest eval time per code+tag
        
        for (const record of evalHistory) {
            const key = `${record.stock_code}_${record.tag}`;
            if (!cooldownMap.has(key)) {
                cooldownMap.set(key, new Date(record.created_at).getTime());
            }
        }

        const filteredStocks = [];
        for (const stock of stocks) {
            if (!ignoreCooldown) {
                // Check active skip:
                if (activeSet.has(stock.code) || activeSet.has(stock.code.replace(/^A/, ''))) {
                    console.log(`[MoonshotAgent] Skipping ${stock.name} (${stock.code}): Already in Active Tracking.`);
                    continue;
                }

                // Check cooldown skip:
                const tagChar = stock.tag.replace(/[^ABC]/g, '');
                const cooldownDays = tagChar === 'A' ? 3 : tagChar === 'B' ? 7 : tagChar === 'C' ? 7 : 0;
                const lastEvalTime = cooldownMap.get(`${stock.code}_${stock.tag}`);
                
                if (lastEvalTime && cooldownDays > 0) {
                    const daysSince = (nowDate.getTime() - lastEvalTime) / (1000 * 60 * 60 * 24);
                    if (daysSince < cooldownDays) {
                        console.log(`[MoonshotAgent] Skipping ${stock.name} (${stock.code}): On cooldown (${daysSince.toFixed(1)} / ${cooldownDays} days for Track ${tagChar})`);
                        continue;
                    }
                }
            } else {
                console.log(`[MoonshotAgent] Force evaluate ${stock.name} (${stock.code}) - Cooldown and Active checks bypassed.`);
            }

            filteredStocks.push(stock);
        }

        if (filteredStocks.length === 0) {
            console.log(`[MoonshotAgent] No stocks left to validate after applying Anti-Duplicate & Cooldown filters.`);
            return [];
        }

        let batchHarnessLogs: { [code: string]: any[] } = {};
        let batchDistilledFacts: { [code: string]: string } = {};
        let batchPhase1Outputs: { [code: string]: { bullCase: string, bearCase: string } } = {};

        // ===============================================
        // [PHASE 1] 진짜 인텔리전트 하네스 - 종목별 독립 실행
        //   [A] 수급/펀더멘털 수집 (1회)
        //   [B] 적응형 검색 루프 (AI 주도, 최대 3번)
        //   [C] Bull Case 분석 Call
        //   [D] Bear Case 반박 Call
        //   [E] Synthesis 최종 피치 Call → 제미나이에게 전달
        // ===============================================
        for (const stock of filteredStocks) {
            const logs: any[] = [];
            const addLog = (step: string, msg: string, type: 'info' | 'warning' | 'success' | 'error') => {
                const log = { time: new Date().toLocaleTimeString('en-US', { hour12: false }), step, msg, type };
                logs.push(log);
                if (win && !win.isDestroyed()) {
                    win.webContents.send('moonshot:progress-log', { code: stock.code, log });
                }
            };
            batchHarnessLogs[stock.code] = logs;

            try {
                if (win && !win.isDestroyed()) {
                    win.webContents.send('moonshot:eval-start', stock.code);
                }

                // ─── [A] 카테고리별 분석 렌즈 설정 ───
                let localScenarioLens = "";
                if (stock.tag.includes('A')) {
                    localScenarioLens = "수년간의 주가 횡보/박스권 속에서 기관/외국인 순매수가 지속 우상향하는 '수급 디커플링(매집)' 징후 + 단순 실적이 아닌 '미래 CAPEX 급증' 또는 '구조적 사업 턴어라운드'를 통한 패러다임 시프트 증거";
                } else if (stock.tag.includes('B')) {
                    localScenarioLens = "바닥권 거래대금 폭발이 개인 단타가 아닌 스마트머니(기관/외인) 초기 스윕(Sweep)인지, 그리고 이 성장 스토리가 일회성 테마가 아닌 더 거대한 전방산업(AI·반도체·바이오)으로 구조적으로 확산될 씨앗이 있는지, 같은 테마 종목 중 기술적 독점력/희소성을 가진 진짜 대장주인지";
                } else if (stock.tag.includes('C')) {
                    localScenarioLens = "이미 바닥 대비 100~200% 오른 확정 주도주가 '2파동·3파동 개화기'인지, 아니면 신용잔고 급증(빚투 과열)과 스마트머니 대규모 엑시트(설거지)가 시작된 피크아웃인지";
                } else {
                    localScenarioLens = "시대적 메가트렌드와 압도적 독점력을 바탕으로 시총이 수배 레벨업될 수 있는 패러다임 시프트 증거";
                }

                // ─── [A] 수급 / 펀더멘털 수집 ───
                addLog('STEP 1', `[${stock.tag}] '${stock.name}' 수급·기본정보 수집 시작...`, 'info');
                let smDataPreview = "수급 데이터 없음";
                let funData: any = null;
                let financeMarkdown = "";
                try {
                    const smData = await this.smartMoneyCollector.collect({ keyword: stock.code });
                    if (smData?.flowData?.length > 0) {
                        smDataPreview = smData.flowData.slice(0, 5)
                            .map((f: any) => `${f.dt}: 외인${f.forgn_nt_buy_qty||0} 기관${f.orgn_nt_buy_qty||0}`)
                            .join(' | ');
                    }
                    // 모든 트랙에서 신용비율(credit_ratio) 확인용
                    funData = await this.fundamentalCollector.collect({ keyword: stock.code });

                    // A안, B안일 경우에만 상세 재무 마크다운 확보 (DART 대체)
                    if (stock.tag.includes('A') || stock.tag.includes('B')) {
                        addLog('STEP 1', `[${stock.tag}] 상세 재무 마크다운 (Naver Finance) 수집 및 핵심 지표 압축 중...`, 'info');
                        const financeInfo = await this.financeInfoCollector.collect({ keyword: stock.code });
                        // 12,000토큰짜리 원본을 버리고 300토큰짜리 핵심 4개년/분기 체력표로 압축 (Context Window Limit 방어)
                        financeMarkdown = this.extractCoreFinance(financeInfo?.markdown || "");
                    }
                } catch (e: any) {
                    addLog('STEP 1', `수급/기본정보 조회 에러: ${e.message}`, 'error');
                }

                // ─── [B] 3개 고정 키워드 순차 검색 ───
                // AI 중간 판단 없이, 카테고리별로 미리 설계된 3개 키워드를 전부 실행.
                // 결과를 모두 쌓은 후 Bull/Bear 분석으로 넘김.
                let rawNewsBuffer = "";

                // 카테고리별 검색 전략 (뉴스 기사 제목에 나올 법한 실전 키워드)
                let searchQueries: string[];
                if (stock.tag.includes('A')) {
                    // A안: 기본 뉴스 + 수급/매집 관련 + 실적/턴어라운드 관련
                    searchQueries = [
                        stock.name,
                        `${stock.name} 기관 매수`,
                        `${stock.name} 실적 흑자`
                    ];
                } else if (stock.tag.includes('B')) {
                    // B안: 기본 뉴스 + 거래량/모멘텀 + 사업/계약 관련
                    searchQueries = [
                        stock.name,
                        `${stock.name} 상한가 거래량`,
                        `${stock.name} 계약 수주`
                    ];
                } else if (stock.tag.includes('C')) {
                    // C안: 기본 뉴스 + 신고가/추세 + 수급 이탈 징후
                    searchQueries = [
                        stock.name,
                        `${stock.name} 신고가 외국인`,
                        `${stock.name} 신용잔고`
                    ];
                } else {
                    searchQueries = [
                        stock.name,
                        `${stock.name} 실적`,
                        `${stock.name} 성장`
                    ];
                }

                addLog('STEP 1', `데이터 사냥꾼: 3각도 뉴스 탐색 시작 (기본/수급/핵심지표)`, 'info');
                for (let i = 0; i < searchQueries.length; i++) {
                    const query = searchQueries[i];
                    try {
                        const newsData = await this.naverCollector.collect({ keyword: query });
                        const articleCount = newsData?.articles?.length || 0;
                        const headlines = newsData?.articles?.map((a: any) => `- ${a.title}`).join('\n') || '뉴스 없음';
                        rawNewsBuffer += `\n[탐색 ${i + 1}/3 | 관점: "${query}"]\n${headlines}\n`;
                        addLog('STEP 1', `탐색 ${i + 1}/3: "${query}" → ${articleCount}건`, articleCount > 0 ? 'info' : 'warning');
                    } catch (e: any) {
                        rawNewsBuffer += `\n[탐색 ${i + 1}/3 | "${query}"] → 수집 실패\n`;
                        addLog('STEP 1', `탐색 ${i + 1}/3: "${query}" 실패`, 'error');
                    }
                    if (i < searchQueries.length - 1) {
                        await new Promise(r => setTimeout(r, 300)); // Naver API 레이트리밋 방어
                    }
                }
                addLog('STEP 1', `3각도 탐색 완료. Bull/Bear 분석 진입.`, 'success');

                // ─── [C] Bull Case: 텐베거 근거 작성 ───
                addLog('STEP 2', `Bull 분석가: ${stock.name}의 3~10배 상승 근거 작성 중...`, 'info');
                const bullPrompt = `너는 "${stock.name}"에 강하게 투자를 주장하는 Bull(낙관론) 애널리스트야.
아래 수집된 모든 데이터를 보고, [${stock.tag}] 전략 관점에서 이 종목이 왜 3~10배 갈 수 있는지 가장 강력한 근거를 3줄 이내로 써라.
억지스러운 주장은 안 된다. 데이터에 실제로 근거가 있는 내용만.

[수집 데이터]
수급: ${smDataPreview}
신용비율: ${funData?.credit_ratio !== undefined ? funData.credit_ratio + '%' : '알수없음'}
${financeMarkdown ? `[상세 재무/기업개요 (Naver Finance)]\n${financeMarkdown}` : ''}
뉴스 요약:
${rawNewsBuffer}

[분석 렌즈]
${localScenarioLens}

Bull Case (3줄 이내):`;

                const bullCase = await this.localAiService.askLocalAi(bullPrompt, "Write a concise bull case in 1-3 bullet points.");
                addLog('STEP 2', `Bull 완성: "${bullCase.slice(0, 80)}..."`, 'success');

                // ─── [D] Bear Case: Bull 주장 반박 ───
                addLog('STEP 2', `Bear 분석가: Bull 주장 반박 및 약점 탐색 중...`, 'warning');
                const bearPrompt = `너는 반대 의견을 가진 Bear(비관론) 애널리스트야. 방금 Bull 애널리스트가 "${stock.name}"에 대해 이렇게 주장했다:

[Bull 주장]
${bullCase}

이 주장의 약점을 날카롭게 반박해라. 아래 관점에서 구체적인 반론을 3줄 이내로 써라:
- 이 뉴스가 단순 IR 홍보이거나 실체가 없을 가능성은?
- 수급이 개인 단타였을 가능성, 또는 이미 스마트머니가 빠지고 있는 신호는?
- 이 성장 시나리오가 실현 안 될 최악의 리스크는?

[참고 데이터]
신용비율: ${funData?.credit_ratio !== undefined ? funData.credit_ratio + '%' : '알수없음'}
뉴스에서 위험 신호:
${rawNewsBuffer}

Bear Case (3줄 이내):`;

                const bearCase = await this.localAiService.askLocalAi(bearPrompt, "Write a concise bear case challenging the bull argument in 1-3 bullet points.");
                addLog('STEP 2', `Bear 완성: "${bearCase.slice(0, 80)}..."`, 'warning');

                // ─── [E] Synthesis: 최종 피치 시트 작성 ───
                addLog('STEP 2', `종합 분석가: Bull/Bear 충돌 지점 종합 → 제미나이 심판역에 피치 시트 작성 중...`, 'info');
                const synthesisPrompt = `너는 객관적인 시니어 애널리스트야. Bull과 Bear 두 분석가의 논쟁을 들었다.

[종목] ${stock.name} (${stock.code}) | 전략 트랙: ${stock.tag}

[Bull 주장]
${bullCase}

[Bear 반박]
${bearCase}

[수급/기초 지표]
수급: ${smDataPreview}
신용비율: ${funData?.credit_ratio !== undefined ? funData.credit_ratio + '%' : '알수없음'}
${financeMarkdown ? `[상세 재무/기업개요]\n${financeMarkdown}` : ''}

위 두 시각을 종합해서, 월스트리트 최종 심판역(제미나이)에게 제출할 객관적 피치 시트를 작성해라.
억지 긍정도, 억지 부정도 하지 마라. Bull의 주장 중 살아남은 근거와 Bear의 주장 중 진짜 리스크를 모두 담아야 한다.
양식:
- **핵심 성장 근거:** (Bull에서 살아남은 것)
- **핵심 리스크:** (Bear에서 진짜로 우려되는 것)  
- **수급/지표 팩트:** (숫자 기반)
- **종합 의견:** (균형잡힌 1줄 결론)`;

                const finalPitch = await this.localAiService.askLocalAi(synthesisPrompt, "Write a balanced investment pitch sheet.");
                addLog('STEP 2', `최종 피치 시트 완성. 제미나이 배틀로얄 대기열 입장.`, 'success');

                batchDistilledFacts[stock.code] = finalPitch;
                batchPhase1Outputs[stock.code] = { bullCase, bearCase };

            } catch (error: any) {
                console.error(`[MoonshotAgent] Harness Error for ${stock.code}:`, error);
                addLog('STEP 2', `하네스 실패: ${error.message}`, 'error');
                batchDistilledFacts[stock.code] = `수집 실패: ${error.message}`;
            }
        }

        // ===============================================

        // [PHASE 2] 제미나이 배틀로얄 - 카테고리별 독립 심사
        //   A안 종목끼리 → 제미나이 A안 렌즈로 1번
        //   B안 종목끼리 → 제미나이 B안 렌즈로 1번
        //   C안 종목끼리 → 제미나이 C안 렌즈로 1번
        // ===============================================
        if (stocks.length > 0) {
            // stocks를 태그(A안/B안/C안)별로 그룹핑
            const categoryGroups: { [tag: string]: typeof stocks } = {};
            for (const stock of stocks) {
                const tag = stock.tag || '미분류';
                if (!categoryGroups[tag]) categoryGroups[tag] = [];
                categoryGroups[tag].push(stock);
            }

            for (const [categoryTag, categoryStocks] of Object.entries(categoryGroups)) {
                console.log(`[MoonshotAgent] Phase 2 배틀로얄 시작: [${categoryTag}] ${categoryStocks.length}개 종목 대상 제미나이 심사`);
                
                // 이 카테고리의 종목들에 STEP3 로그 전송
                for (const stock of categoryStocks) {
                    const log = {
                        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                        step: 'STEP 3',
                        msg: `최종 판사 (Gemini): [${categoryTag}] 배틀로얄 돌입. 동일 카테고리 ${categoryStocks.length}개 종목 상대평가 중...`,
                        type: 'info' as const
                    };
                    batchHarnessLogs[stock.code].push(log);
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('moonshot:progress-log', { code: stock.code, log });
                    }
                }

                // 카테고리별 전용 심사 기준 생성
                let trackCriteria = '';
                if (categoryTag.includes('A')) {
                    trackCriteria = `[Track A (턴어라운드/바닥 매집형) 전용 심사 기준]
- 단순한 양호한 실적이 아닌, '미래 CAPEX 턴어라운드' 유무가 핵심.
- 주가는 횡보(박스권)인데, 기관/외국인 수급만 우상향하는 '수급 디커플링(매집)' 징후가 있는가?
- 이 두 조건이 모두 결여된 종목은 탈락.`;
                } else if (categoryTag.includes('B')) {
                    trackCriteria = `[Track B (모멘텀 초기 돌파형) 전용 심사 기준]
- 단순 정치/재건/일회성 테마주 여부를 가장 엄격히 필터링.
- 거래대금 폭발이 개인 단타 수급인가, 외인/기관의 '초기 스윕(Sweep)'인가를 엄격 검증.
- 성장 스토리가 구조적으로 더 거대한 전방산업으로 확산 확장될 씨앗이 있는가? 없으면 탈락.
- 같은 테마 종목 중 기술적 희소성/독점력을 가진 진짜 대장주인가?`;
                } else if (categoryTag.includes('C')) {
                    trackCriteria = `[Track C (대세 주도주 중간 탑승형) 전용 심사 기준]
- "이미 많이 오른 주식인데 들어가도 안전한가?"에 초점. 맹목적 추격을 절대 권장하지 말 것.
- 신용잔고율 급증(빚투 과열), 각종 경제 채널 도배 등 '광기 지표' 포착 시 즉시 탈락.
- 스마트머니(기관/외인)의 엑시트 조짐(순매도 전환)이 보이면 펀더멘털 무관 가차없이 탈락.
- 오직 "스토리가 2파동·3파동으로 팽창 중이고, 스마트머니가 아직 잡고 있을 때"만 통과.`;
                } else {
                    trackCriteria = `[공통 심사 기준]\n- 메가트렌드 부합 여부, 독점력, 스마트머니 매집 연속성을 종합 평가.`;
                }

                const factsText = categoryStocks.map(s =>
                    `----- [기호: ${s.code}] 종목명: ${s.name} -----\n${batchDistilledFacts[s.code] || '수집 실패'}`
                ).join('\n\n');

                const judgePrompt = `당신은 월스트리트 출신의 딥 밸류 퀀트 애널리스트이자 'Project Moonshot' 최고 판단 심판역(Judge)입니다.
지금부터 당신에게 [${categoryTag}] 카테고리에 속한 총 ${categoryStocks.length}개 종목들의 [텐베거 시나리오 피치]를 제공합니다.

이 종목들은 모두 "${categoryTag}" 조건검색식을 통과한 동일 전략 후보군입니다.
아래 ${categoryTag} 전용 심사 기준을 통해 서로 엄격히 **상대 평가(배틀로얄)**하여 진짜 대장 1~2개만 가려내십시오.
나머지는 가차없이 탈락(isPass: false)시키십시오. 전원이 기준 미달이면 전원 탈락도 가능합니다.

${trackCriteria}

[공통 척도]
척도 1. 가시적 촉매 - 시대적 메가트렌드 부합 여부
척도 2. 기술적/독점적 희소성 - 진짜 대장인지
척도 3. 스마트머니(외인/기관) 매집 연속성 및 과열/피크아웃 징후

[${categoryTag} 후보군 세일즈 피치]
${factsText}

위 ${categoryStocks.length}개 종목 전체에 대해 누락 없이 아래의 순수 JSON 배열로만 응답하세요. (마크다운 코드블록 절대 불가)
[
  {
    "code": "종목코드(6자리)",
    "isPass": true 또는 false,
    "tbpScore": 0~100 (상대평가 랭킹 반영),
    "shortNarrative": "[타 종목 대비 우위/열위 포함 핵심 1줄]",
    "megaTrend": "[산업 트렌드를 관통하는 단어 2~3개, 예: AI 반도체 / 전력 인프라]",
    "milestones": [
        "[최우선 달성해야할 핵심 성과 1]",
        "[지속 성장을 뒷받침할 핵심 지표 2]"
    ],
    "invalidationCondition": "[아이디어 폐기 조건 - 이런 뉴스나 지표가 나오면 즉시 매도]"
  }
]`;

                try {
                    const { AiExecutionQueue } = await import('../AiExecutionQueue');
                    const aiResponseChunk = await AiExecutionQueue.getInstance().enqueue({
                        agentId: 'MOONSHOT_VALIDATION',
                        agentName: '텐배거 스캐너 (검증)',
                        triggerType: 'MANUAL',
                        targetType: 'gemini',
                        prompt: judgePrompt,
                        systemInstruction: "You must return a valid JSON array only."
                    });
                    let aiResultArray: any[] = [];

                    try {
                        const cleanJson = aiResponseChunk.replace(/```json/g, '').replace(/```/g, '').trim();
                        aiResultArray = JSON.parse(cleanJson);
                        if (!Array.isArray(aiResultArray)) {
                            if (aiResultArray.results) aiResultArray = aiResultArray.results;
                            else aiResultArray = [aiResultArray];
                        }
                    } catch (e) {
                        console.error(`[MoonshotAgent] [${categoryTag}] AI Parse Error:`, e, 'Raw:', aiResponseChunk);
                    }

                    for (const stock of categoryStocks) {
                        let aiResult = aiResultArray?.find((r: any) => 
                            r.code === stock.code || r.code === stock.code.replace(/^A/, '')
                        );

                        if (!aiResult) {
                            aiResult = {
                                isPass: false, tbpScore: 20,
                                shortNarrative: '텐베거 요건 미달 (상대평가 탈락)',
                                keyCatalyst: '분석 가치 미달', milestoneToTrack: '-', invalidationCondition: '-'
                            };
                        }

                        const logType = aiResult.isPass ? 'success' : 'warning';
                        const logMsg = aiResult.isPass
                            ? `🏆 [${categoryTag}] 배틀로얄 승리! 스코어 ${aiResult.tbpScore}점. 샌드박스 편입 강한 긍정.`
                            : `❌ [${categoryTag}] 배틀로얄 탈락. 타 종목 대비 폭발성 부족 (스코어 ${aiResult.tbpScore}점).`;

                        const log = {
                            time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                            step: 'RESULT', msg: logMsg, type: logType as 'warning' | 'success'
                        };
                        batchHarnessLogs[stock.code].push(log);
                        if (win && !win.isDestroyed()) {
                            win.webContents.send('moonshot:progress-log', { code: stock.code, log });
                        }

                        const rawReport = `[${aiResult.isPass ? '배틀로얄 승리 - 편입 통과' : '집단 상대평가 탈락'} | ${categoryTag} 기준]

💡 **메가트렌드 (Mega Trend)**
${aiResult.megaTrend || '-'}

🚀 **강세 근거 (Bull Case)**
${aiResult.bullCase || '-'}

⚠️ **약세 리스크 (Bear Case)**
${aiResult.bearCase || '-'}

🔭 **향후 추적 마일스톤 (Milestones)**
${Array.isArray(aiResult.milestones) ? aiResult.milestones.map((m: string) => `- ${m}`).join('\n') : '-'}

💥 **아이디어 폐기 및 손절 조건 (Invalidation)**
${aiResult.invalidationCondition || '-'}

💡 **최종 심판문 요약**
${aiResult.shortNarrative || '-'}`;

                        const status = aiResult.isPass ? 'passed' : 'failed';
                        const score = aiResult.tbpScore || 0;

                        const finalEval: MoonshotEvaluationResult = {
                            code: stock.code,
                            name: stock.name,
                            tag: categoryTag,
                            status: status,
                            narrative: aiResult.shortNarrative || '판단 보류',
                            tbpScore: score,
                            megaTrend: aiResult.megaTrend,
                            bullCase: batchPhase1Outputs[stock.code]?.bullCase || '',
                            bearCase: batchPhase1Outputs[stock.code]?.bearCase || '',
                            milestones: aiResult.milestones,
                            invalidationCondition: aiResult.invalidationCondition,
                            inputData: batchDistilledFacts[stock.code] || '',
                            prompt: judgePrompt,
                            rawResult: JSON.stringify(aiResult, null, 2),
                            harnessLogs: batchHarnessLogs[stock.code]
                        };

                        results.push(finalEval);

                        // ===== Cooldown History Write =====
                        try {
                            db.prepare(`INSERT INTO moonshot_eval_history (stock_code, stock_name, tag, status, tbp_score, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
                                finalEval.code, finalEval.name, finalEval.tag, finalEval.status, finalEval.tbpScore, now
                            );
                        } catch (err) {
                            console.error('[MoonshotAgent] Eval history insert error:', err);
                        }

                        // ===== Auto-Enroll Active Tracking =====
                        if (finalEval.status === 'passed') {
                            try {
                                const { kiwoomService } = await import('../kiwoomService');
                                let entryPrice = 0;
                                try {
                                    const priceStr = await kiwoomService.getCurrentPrice(finalEval.code.replace(/^A/, ''));
                                    if (priceStr) entryPrice = Math.abs(parseInt(priceStr, 10));
                                    else if (stock.price) entryPrice = stock.price;
                                } catch (e) {
                                    console.warn(`[MoonshotAgent] Failed realtime price for auto-enroll ${finalEval.code}, fallbacking to scanner price`);
                                    if (stock.price) entryPrice = stock.price;
                                }

                                db.prepare(`
                                    INSERT OR REPLACE INTO moonshot_active_tracking 
                                    (stock_code, stock_name, tag, tbp_score, mega_trend, bull_case, bear_case, milestones_json, invalidation_condition, entry_price, current_price, entry_date, created_at, updated_at, narrative)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                `).run(
                                    finalEval.code, finalEval.name, finalEval.tag, finalEval.tbpScore, 
                                    finalEval.megaTrend || '', finalEval.bullCase || '', finalEval.bearCase || '', 
                                    JSON.stringify(finalEval.milestones || []), finalEval.invalidationCondition || '', 
                                    entryPrice, entryPrice, now.split('T')[0].replace(/-/g, '.'), now, now, finalEval.narrative || ''
                                );
                                console.log(`🚀 [MoonshotAgent] AUTO-ENROLLED: ${finalEval.name} (${finalEval.code}) at ${entryPrice} KRW`);
                            } catch (err) {
                                console.error('[MoonshotAgent] Auto-enroll insertion error:', err);
                            }
                        }

                        if (win && !win.isDestroyed()) {
                            win.webContents.send('moonshot:eval-complete', { code: stock.code, result: finalEval });
                        }
                        await new Promise(r => setTimeout(r, 200));
                    }

                } catch (error: any) {
                    console.error(`[MoonshotAgent] [${categoryTag}] Batch Evaluator Error:`, error);
                    for (const stock of categoryStocks) {
                        const failObj: MoonshotEvaluationResult = {
                            code: stock.code, name: stock.name, tag: stock.tag,
                            status: 'failed', narrative: '배틀로얄 시스템 장애', tbpScore: 0,
                            inputData: batchDistilledFacts[stock.code], prompt: '',
                            rawResult: `[시스템 에러]\n${error.message}`,
                            harnessLogs: batchHarnessLogs[stock.code]
                        };
                        results.push(failObj);
                        if (win && !win.isDestroyed()) {
                            win.webContents.send('moonshot:eval-complete', { code: stock.code, result: failObj });
                        }
                    }
                }
            }
        }

        return results;
    }
}

