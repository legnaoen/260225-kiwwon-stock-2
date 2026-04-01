import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { NewsDataHub } from '../NewsDataHub';
import { IssueLedgerDB } from './IssueLedgerDB';

export class ThemeIntelligenceAgent {
    private static instance: ThemeIntelligenceAgent;
    private db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): ThemeIntelligenceAgent {
        if (!ThemeIntelligenceAgent.instance) {
            ThemeIntelligenceAgent.instance = new ThemeIntelligenceAgent();
        }
        return ThemeIntelligenceAgent.instance;
    }

    /**
     * 메인 배치 프로세스: 특정 일자의 모멘텀 랭킹 상위 테마/섹터를 가져와 뉴스와 매핑하여 분석
     */
    public async runBatchAnalysis(targetDate?: string) {
        const dateStr = targetDate || this.db.getKstDate();
        console.log(`[ThemeIntelligence] 🤖 ${dateStr} 테마/섹터 일괄 분석 시작...`);

        try {
            // 1. 해당 일자의 순위 데이터 가져오기
            const rawDb = (this.db as any).db;
            const marketFlow = rawDb.prepare(`
                SELECT type, name, rank_num
                FROM naver_market_flow
                WHERE date = ? AND rank_num <= 10
                ORDER BY type, rank_num ASC
            `).all(dateStr) as any[];

            if (!marketFlow || marketFlow.length === 0) {
                console.warn(`[ThemeIntelligence] ${dateStr} 일자의 테마/섹터 랭킹 데이터가 없어 분석을 스킵합니다.`);
                return null;
            }

            const themeNames = marketFlow.filter(m => m.type === 'THEME').map(m => m.name);
            const sectorNames = marketFlow.filter(m => m.type === 'SECTOR').map(m => m.name);

            // 2. 컨텍스트용 이슈/뉴스 수집
            let newsContext = "[최근 트래커 이슈 장부]\n";
            try {
                const issues = IssueLedgerDB.getInstance().getActiveIssues();
                newsContext += issues.map(i => `- ${i.name}: ${i.summary}`).join('\n');
            } catch (e) {
                console.error('[ThemeIntelligence] 이슈 장부 로드 실패', e);
            }

            newsContext += "\n\n[당일 수집된 핵심 뉴스]\n";
            try {
                newsContext += NewsDataHub.getInstance().getNewsAsMarkdown({ maxPerCategory: 20 });
            } catch (e) {
                console.error('[ThemeIntelligence] 뉴스 데이터 허브 로드 실패', e);
            }

            // 2.5 [핵심 고도화] Top 5 테마, Top 3 섹터의 주도주 실시간 타겟 검색 (직접 크롤링 & DB 연동)
            const top5Themes = marketFlow.filter(m => m.type === 'THEME' && m.rank_num <= 5).map(m => m.name);
            const top3Sectors = marketFlow.filter(m => m.type === 'SECTOR' && m.rank_num <= 3).map(m => m.name);
            const targets = [...top5Themes, ...top3Sectors];
            
            let targetedNewsContext = "\n\n[🔥 최상위 주도 테마/섹터 심층 실시간 뉴스]\n";
            try {
                const { NaverSearchCollector } = await import('../v2_pipeline/collectors/NaverSearchCollector');
                const collector = new NaverSearchCollector();
                
                const stmtGetStocks = rawDb.prepare(`
                    SELECT stock_name FROM stock_theme_tags 
                    WHERE tag_name = ? 
                    ORDER BY change_rate DESC 
                    LIMIT 2
                `);

                const stmtInsertNews = rawDb.prepare(`
                    INSERT INTO naver_news_flow
                        (date, category, title, body_snippet, source, article_id, url, collected_at, time_bucket, article_hash, search_keyword)
                    VALUES
                        (@date, @category, @title, @body_snippet, @source, @article_id, @url, @collected_at, @time_bucket, @article_hash, @search_keyword)
                `);

                const insertNewsTx = rawDb.transaction((items: any[]) => {
                    for (const item of items) {
                        try { stmtInsertNews.run(item); } catch (e) { /* 중복이나 키에러 무시 */ }
                    }
                });

                const now = new Date();
                const timeBucket = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                
                let dbRowsToInsert: any[] = [];

                for (const targetName of targets) {
                    const stocks = stmtGetStocks.all(targetName) as any[];
                    if (!stocks || stocks.length === 0) continue;
                    
                    // 높은 정확도를 위해 1위 주도주 이름으로 단독 검색
                    const keyword = stocks[0].stock_name; 
                    
                    try {
                        const rawSearch = await collector.collect({ keyword: keyword });
                        const articles = rawSearch?.articles || [];
                        if (articles.length > 0) {
                            targetedNewsContext += `\n[${targetName} 주도주: ${keyword} 관련 최신 팩트]\n`;
                            
                            for (const a of articles.slice(0, 3)) { 
                                const title = (a.title || '').replace(/<[^>]+>/g, '');
                                const snippet = (a.description || '').replace(/<[^>]+>/g, '');
                                targetedNewsContext += `- ${title} (${snippet.substring(0, 70)}...)\n`;
                                
                                let source = 'NaverSearchAPI';
                                try { source = a.originallink ? new URL(a.originallink).hostname.replace('www.', '') : 'Naver'; } catch(e){}
                                
                                const hash = Math.abs((Math.imul(31, 0) + title.charCodeAt(0)) | 0).toString(16) + (a.pubDate || Date.now());

                                dbRowsToInsert.push({
                                    date: dateStr,
                                    category: 'THEME_TARGET',
                                    title: title,
                                    body_snippet: snippet,
                                    source: source,
                                    article_id: hash,
                                    url: a.originallink || a.link || '',
                                    collected_at: now.toISOString(),
                                    time_bucket: timeBucket,
                                    article_hash: hash,
                                    search_keyword: keyword
                                });
                            }
                        }
                    } catch (err: any) {
                        console.error(`[ThemeIntelligence] 타겟 뉴스 검색 실패 (${keyword}):`, err.message);
                    }
                    
                    // API Call Limit Delay
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

                if (dbRowsToInsert.length > 0) {
                    insertNewsTx(dbRowsToInsert);
                    console.log(`[ThemeIntelligence] 🎯 주도주 타겟 검색 완료: 뉴스 ${dbRowsToInsert.length}건 DB 저장 및 프롬프트 주입`);
                    newsContext += targetedNewsContext;
                }
            } catch (e) {
                console.error('[ThemeIntelligence] 주도주 실시간 타겟 뉴스 확보 중 에러:', e);
            }

            // 2.7. 시황 AI 최신 거시 투심 주입
            let marketConditionContext = "[현재 시장 거시 환경 (시황 AI 군집 투심)]\n";
            try {
                const latestPred = rawDb.prepare(`
                    SELECT time_slot, predict, confidence, swarm_sentiment, rationale
                    FROM intraday_predictions
                    WHERE date = ?
                    ORDER BY created_at DESC LIMIT 1
                `).get(dateStr) as any;
                
                if (latestPred) {
                    marketConditionContext += `- 최신 장중 군집 투심: ${latestPred.swarm_sentiment || latestPred.predict} (신뢰도 ${latestPred.confidence}%)\n`;
                    const rat = (latestPred.rationale || '').substring(0, 150).replace(/\n/g, ' ');
                    marketConditionContext += `- 시황 요약: ${rat}...\n`;
                } else {
                    marketConditionContext += "- 당일 시황 AI 판단 기록 없음.\n";
                }
            } catch (e: any) {
                console.error('[ThemeIntelligence] 시황 투심 확보 에러:', e.message);
            }

            // 2.8. 과거 7일간의 테마/섹터 랭킹 및 생애주기 분석 이력 주입
            let themeHistoryContext = "[최근 7일간의 주도 테마/섹터 이력 (생애주기 판별용)]\n";
            try {
                if (targets.length > 0) {
                    const placeholders = targets.map(() => '?').join(',');
                    
                    const historyFlow = rawDb.prepare(`
                        SELECT date, type, name, rank_num
                        FROM naver_market_flow
                        WHERE date < ? AND date >= date(?, '-7 days')
                          AND name IN (${placeholders})
                        ORDER BY date ASC, rank_num ASC
                    `).all(dateStr, dateStr, ...targets) as any[];

                    const historyIntel = rawDb.prepare(`
                        SELECT date, name, lifespan_type, reason
                        FROM theme_intelligence
                        WHERE date < ? AND date >= date(?, '-7 days')
                          AND name IN (${placeholders})
                        ORDER BY date DESC
                    `).all(dateStr, dateStr, ...targets) as any[];

                    for (const tName of targets) {
                        const myFlows = historyFlow.filter((f: any) => f.name === tName);
                        const myIntels = historyIntel.filter((f: any) => f.name === tName);
                        
                        if (myFlows.length > 0 || myIntels.length > 0) {
                            themeHistoryContext += `[${tName}]\n`;
                            if (myFlows.length > 0) {
                                const rankProgression = myFlows.map((f: any) => `${f.date}(${f.rank_num}위)`).join(' -> ');
                                themeHistoryContext += `- 랭킹 변화: ${rankProgression} -> [오늘]\n`;
                            }
                            if (myIntels.length > 0) {
                                const lastIntel = myIntels[0]; // 가장 최근 기록
                                themeHistoryContext += `- 직전 분석 (${lastIntel.date}): [${lastIntel.lifespan_type}] ${lastIntel.reason}\n`;
                            }
                        }
                    }
                }
            } catch (e: any) {
                console.error('[ThemeIntelligence] 과거 이력 확보 에러:', e.message);
            }

            // 3. Gemini Prompt 조립 (이슈 목록 주입 → 할루시네이션 방지)
            const activeIssues = IssueLedgerDB.getInstance().getActiveIssues();
            const issueListForPrompt = activeIssues.length > 0
                ? activeIssues.map((i: any) => `  - ID: "${i.id}" | 이름: "${i.name}" | 심각도: ${i.severity} | 상태: ${i.status}`).join('\n')
                : '  (현재 등록된 활성 거시 이슈 없음)';

            const systemInstruction = `당신은 대한민국 주식 시장의 메가트렌드와 테마의 생애주기(Lifecycle)를 분석하는 최상위 퀀트(Quant) 및 시황 전략가입니다. 단순히 뉴스만 보고 해석하지 않으며, 현재 코스피의 거시적 투심(롱/숏 장세)과 해당 테마의 과거 며칠간 랭킹 변화(발생→성장→눌림목→피크아웃→설거지) 이력을 복합적으로 추론합니다.`;
            
            const userPrompt = `
[오늘 상위 랭크된 주도 섹터 목록 (Top 10)]
${sectorNames.join(', ')}

[오늘 상위 랭크된 주도 테마 목록 (Top 10)]
${themeNames.join(', ')}

${marketConditionContext}

[시장 컨텍스트 (실시간 뉴스 및 이슈 요약)]
${newsContext}

${themeHistoryContext}

[🔒 현재 시스템에 등록된 활성 거시 이슈 목록 (아래 목록 외의 이슈 ID를 임의로 생성하지 마시오)]
${issueListForPrompt}

---
위 컨텍스트를 완벽하게 분석하여, 오늘 랭크된 총 ${marketFlow.length}개의 (섹터 + 테마) 항목 각각에 대해 상승한 핵심 호재 이유를 짧게 요약하고, 해당 모멘텀의 예상 수명 및 현재 생애주기(Lifecycle)를 판단하시오.

[분석 지침]
1. 거시 지수(KOSPI) 투심이 꺾였을 때 뜨는 테마는 단발성 해지 테마일 확률이 높습니다. 반면 상승장에서는 메가트렌드로 갈 확률이 높습니다.
2. 과거 이력에서 순위가 지속 상승 중이면 '성장', 순위 밖으로 나갔다 며칠 만에 재등장했다면 '눌림목', 이미 몇일 연속 1~2위를 석권하며 뉴스가 쏟아지면 '피크아웃/설거지' 등의 생애주기를 명시하십시오.

[중요 제약]
- linked_issue_id는 반드시 위 "활성 거시 이슈 목록"에 존재하는 ID만 사용해야 합니다. 
- 만약 상위 3위 이내의 대장 테마임에도 매핑되는 기존 이슈가 없다면, 이것은 시황 AI가 놓친 신규 메타입니다. 이 경우 빈 칸으로 두지 말고, "ISSUE-NEW-임의의영문명" 형식으로 ID를 새로 생성하여 적으십시오. (시스템이 이를 파싱해 신규 이슈로 자동 등록할 것입니다).
- 기존 하위 테마인데 매핑할 원인이 없다면 원래대로 null로 설정하십시오.

반드시 아래의 구조를 가진 순수 JSON 배열만 출력하시오. (Markdown 백틱 금지)

[
  {
    "type": "THEME 혹은 SECTOR",
    "name": "항목 이름",
    "reason": "상승/주도 요인에 대한 1~2문장 요약",
    "lifespan_type": "1일 반짝 테마 (설거지)" 혹은 "단기 테마 (눌림목/성장)" 혹은 "중기 트렌드" 등 수명과 생애주기를 명시,
    "lifespan_reasoning": "왜 이런 수명/생애주기로 판단했는지 (이력 및 거시 투심 근거 포함)",
    "linked_issue_id": "위 이슈 목록의 ID 중 하나 또는 신규 이슈 ID 또는 null",
    "linked_issue_path": "이슈→테마 연결 논리 경로 또는 null"
  }
]
`;

            // 4. Gemini 실행 큐 등재
            const rawResponse = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'THEME_INTELLIGENCE',
                agentName: '테마 수명 분석기',
                triggerType: 'MANUAL', // 일단 메뉴얼/테스트
                prompt: userPrompt,
                systemInstruction: systemInstruction,
            });

            // 5. JSON 파싱
            const jsonMatch = rawResponse.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (!jsonMatch) {
                throw new Error("JSON 배열 파싱에 실패했습니다. (응답 포맷 오류)");
            }

            const parsedArray = JSON.parse(jsonMatch[0]);

            // 6. DB에 기록 (Upsert)
            const mapDataForDb = parsedArray.map((item: any) => {
                let normalizedType = 'THEME';
                if (item.type) {
                    const t = item.type.toUpperCase();
                    if (t.includes('SECTOR') || t.includes('섹터')) {
                        normalizedType = 'SECTOR';
                    } else if (t.includes('THEME') || t.includes('테마')) {
                        normalizedType = 'THEME';
                    }
                }
                
                return {
                    date: dateStr,
                    type: normalizedType,
                    name: item.name,
                    reason: item.reason || '',
                    lifespan_type: item.lifespan_type || '판단 불가',
                    lifespan_reasoning: item.lifespan_reasoning || ''
                };
            });

            this.db.upsertThemeIntelligence(mapDataForDb);
            console.log(`[ThemeIntelligence] 🤖 성공적으로 ${mapDataForDb.length}개의 테마/섹터 분석이 완료되어 DB에 캐싱되었습니다.`);

            // 7 (추가). Knowledge Edge 기록: ISSUE → THEME/SECTOR 연결
            const ledgerDb = IssueLedgerDB.getInstance();
            const activeIssueIds = new Set(activeIssues.map(i => i.id));
            let edgeCount = 0;
            for (const item of parsedArray) {
                const linkedId: string | null = item.linked_issue_id;
                if (!linkedId) continue;

                let actualIssueId = linkedId;
                const normalizedType = item.type?.toUpperCase().includes('SECTOR') ? 'SECTOR' : 'THEME';

                // 이슈 목록에 없는 ID인데, ISSUE-NEW- 접두어가 있다면 신규 DRAFT 이슈 생성
                if (!activeIssueIds.has(linkedId)) {
                    if (linkedId.startsWith('ISSUE-NEW-')) {
                        actualIssueId = `ISSUE-${dateStr.replace(/-/g, '')}-THM-${Math.floor(Math.random() * 10000)}`;
                        try {
                            ledgerDb.upsertIssue({
                                id: actualIssueId,
                                name: `[테마AI 발굴] ${item.name} 상승 재료`,
                                summary: item.reason,
                                tags: ['THEME_AI_DISCOVERY', normalizedType, item.name],
                                date_created: this.db.getKstDate(),
                                date_updated: this.db.getKstDate(),
                                status: 'DRAFT', // 검증 전 DRAFT 상태
                                impact_level: 'LOW',
                                confidence: 50,
                                source_context: `테마 ${item.name}의 강력한 수급에 기반한 AI 역추산 이슈.\n연결 논리: ${item.linked_issue_path || '알 수 없음'}`,
                                system_recommendation: `예상 수명: ${item.lifespan_type}`,
                                related_stocks_json: JSON.stringify([])
                            });
                            activeIssueIds.add(actualIssueId);
                            console.log(`[ThemeIntelligence] 💡 신규 이슈(DRAFT)가 발굴되었습니다: ${actualIssueId}`);
                        } catch(e: any) { 
                            console.error('[ThemeIntelligence] 신규 이슈 자동 생성 실패:', e.message); 
                            continue; 
                        }
                    } else {
                        // 할루시네이션 차단 (이슈 장부에 없고 ISSUE-NEW-도 아닌 임시 ID)
                        continue; 
                    }
                }

                // 수명 기반 자동 만료일 설정
                let expiresAt: string | undefined;
                if (item.lifespan_type?.includes('단기')) {
                    const expires = new Date();
                    expires.setDate(expires.getDate() + 14);
                    expiresAt = expires.toISOString().slice(0, 10);
                }

                try {
                    ledgerDb.upsertEdge({
                        source_type: 'ISSUE',
                        source_id:   actualIssueId,
                        target_type: normalizedType,
                        target_id:   item.name,
                        relation:    'DRIVES',
                        confidence:  0.7,
                        logical_path: item.linked_issue_path || null,
                        created_by:  'THEME_AI',
                        expires_at:  expiresAt
                    });
                    edgeCount++;
                } catch (edgeErr: any) {
                    console.warn(`[ThemeIntelligence] Edge 기록 실패 (${actualIssueId}→${item.name}):`, edgeErr.message);
                }
            }
            if (edgeCount > 0) {
                console.log(`[ThemeIntelligence] 🔗 Knowledge Graph: ${edgeCount}개 ISSUE→THEME/SECTOR 엣지 기록 완료`);
            }

            // 7. 텔레그램 알림 전송 (Top 3 요약)
            try {
                const { TelegramService } = await import('../TelegramService');
                const tgSvc = TelegramService.getInstance();
                
                let tgMsg = `🤖 *[테마 AI 브리핑 완료]* (${dateStr})\n\n`;

                const themes = parsedArray.filter((i: any) => i.type.toUpperCase() === 'THEME');
                const sectors = parsedArray.filter((i: any) => i.type.toUpperCase() === 'SECTOR');

                if (themes.length > 0) {
                    tgMsg += `*[🔥 상위 주도 테마 TOP 3]*\n\n`;
                    tgMsg += themes.slice(0, 3).map((t: any, idx: number) => 
                        `${idx + 1}. *${t.name}* [${t.lifespan_type}]\n  - ${t.reason.replace(/[*_`]/g, '')}`
                    ).join('\n\n') + '\n\n\n';
                }

                if (sectors.length > 0) {
                    tgMsg += `*[📈 상위 주도 섹터 TOP 3]*\n\n`;
                    tgMsg += sectors.slice(0, 3).map((s: any, idx: number) => 
                        `${idx + 1}. *${s.name}* [${s.lifespan_type}]\n  - ${s.reason.replace(/[*_`]/g, '')}`
                    ).join('\n\n') + '\n';
                }

                tgSvc.sendMessage(tgMsg).catch(err => console.error('[ThemeIntelligence] 텔레그램 발송 실패', err));
            } catch (tgErr) {
                console.error('[ThemeIntelligence] 텔레그램 연동 실패', tgErr);
            }

            return mapDataForDb;

        } catch (error: any) {
            console.error(`[ThemeIntelligence] 💥 분석 중 오류 발생:`, error.message);
            throw error;
        }
    }

    /**
     * 사용자의 코파일럿 검증 개입 파이프라인
     */
    public async verifyIntelligence(params: { date: string, type: 'SECTOR' | 'THEME', name: string, userOpinion: string, currentReason: string }) {
        const { date, type, name, userOpinion, currentReason } = params;
        
        console.log(`[ThemeIntelligence] 🤔 사용자 개입 감지: [${name}]에 대한 검증 시작... -> "${userOpinion}"`);

        try {
            // 1. 네이버 뉴스 실시간 검색 연동 (동적 RAG)
            let searchNewsContext = "[추가 서치 뉴스 없음]";
            try {
                const searchKeyword = `${name.replace(/\(.*?\)/g, '')} ${userOpinion.split(' ')[0]}`.trim();
                const { NaverSearchCollector } = await import('../v2_pipeline/collectors/NaverSearchCollector');
                const { NaverSearchAggregator } = await import('../v2_pipeline/aggregators/NaverSearchAggregator');
                
                const collector = new NaverSearchCollector();
                const aggregator = new NaverSearchAggregator();
                
                // 가벼운 검색 수행
                const rawSearch = await collector.collect({ keyword: searchKeyword });
                const searchMarkdown = await aggregator.process(rawSearch);
                searchNewsContext = `[실시간 특성 키워드 '${searchKeyword}' 뉴스 검색 결과]\n${searchMarkdown}`;
            } catch (e: any) {
                console.error(`[ThemeIntelligence] 검증용 실시간 뉴스 검색 실패:`, e.message);
            }

            // 2. 심층 반박 리플렉션 프롬프트
            const systemInstruction = `당신은 최상위 퀀트 분석가이자 유연한 사고를 가진 AI 코파일럿입니다. 기존 판단 결과가 틀렸을 수 있다는 전문 트레이더(사용자)의 피드백을 수용하여 사실관계를 철저히 재검토합니다.`;
            
            const userPrompt = `
[검증 대상: ${type === 'SECTOR' ? '섹터' : '테마'}]
- 이름: ${name}
- 기존 AI 분석: ${currentReason}

[사용자 반박/의견]
💬 "${userOpinion}"

[최신 실시간 연관 뉴스/동향 검색]
${searchNewsContext}

---
위 정보와 사용자의 의견을 종합하여, 기존 AI의 판단(또는 수명 분석) 오류를 정정하고 팩트체크 리포트를 작성하십시오.
반드시 아래의 구조를 가진 JSON 데이터만 순수하게 반환하십시오. (응답 메시지도 JSON 텍스트에 포함하세요)

{
  "copilot_message": "사용자에게 건네는 응답/피드백 메시지 (예: '사용자님 의견이 합리적입니다. 확인 결과...')",
  "revised_reason": "수정/보완된 핵심 상승 요인 요약",
  "new_lifespan_type": "단기 테마 (1주일 내외) 혹은 중기 트렌드 (1~3개월) 혹은 장기 메가트렌드",
  "new_lifespan_reasoning": "왜 이런 수명으로 변경 (또는 유지) 했는지에 대한 근거 요약"
}
`;
            
            // 3. 실행
            const responseText = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'THEME_INTELLIGENCE',
                agentName: '테마 심층 검증 코파일럿',
                triggerType: 'MANUAL',
                targetType: 'gemini',
                prompt: userPrompt,
                systemInstruction: systemInstruction,
            });

            const parsed = JSON.parse(responseText.replace(/```json/g, '').replace(/```/g, '').trim());

            // 4. DB 덮어쓰기 (Human Corrected State)
            const rawDb = (this.db as any).db;
            const updatedLifespanType = `[교정됨] ${parsed.new_lifespan_type}`;
            
            rawDb.prepare(`
                UPDATE theme_intelligence
                SET reason = ?,
                    lifespan_type = ?,
                    lifespan_reasoning = ?
                WHERE date = ? AND type = ? AND name = ?
            `).run(
                parsed.revised_reason,
                updatedLifespanType,
                parsed.new_lifespan_reasoning,
                date,
                type,
                name
            );

            // 5. IssueLedger 동기화 제안 (Insight Logging)
            try {
                const { IssueLedgerDB } = await import('./IssueLedgerDB');
                const ledger = IssueLedgerDB.getInstance();
                ledger.upsertIssue({
                    id: `ISSUE-${date.replace(/-/g, '')}-HUMAN-${Math.floor(Math.random() * 1000)}`,
                    name: `[인간피드백] ${name}`,
                    summary: `[사용자 교정: ${userOpinion}] ${parsed.copilot_message}`,
                    tags: ['HumanInsight', type, name],
                    date_created: this.db.getKstDate(),
                    date_updated: this.db.getKstDate(),
                    status: 'ACTIVE',
                    impact_level: 'MEDIUM',
                    confidence: 90,
                    source_context: parsed.revised_reason,
                    system_recommendation: `테마 수명 변경됨: ${parsed.new_lifespan_type}`,
                    related_stocks_json: JSON.stringify([])
                });
            } catch (e: any) {
                console.error(`[ThemeIntelligence] 이슈 장부 동기화 실패:`, e.message);
            }

            console.log(`[ThemeIntelligence] 🚀 사용자 피드백 DB 업데이트 완료`);
            
            return {
                copilotMessage: parsed.copilot_message,
                revisedReason: parsed.revised_reason,
                newLifespanType: updatedLifespanType,
                newLifespanReasoning: parsed.new_lifespan_reasoning
            };

        } catch (error: any) {
            console.error(`[ThemeIntelligence] 💥 검증 파이프라인 스크립트 에러:`, error.message);
            throw error;
        }
    }
}
