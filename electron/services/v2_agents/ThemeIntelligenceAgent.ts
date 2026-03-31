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

            // 3. Gemini Prompt 조립 (이슈 목록 주입 → 할루시네이션 방지)
            const activeIssues = IssueLedgerDB.getInstance().getActiveIssues();
            const issueListForPrompt = activeIssues.length > 0
                ? activeIssues.map(i => `  - ID: "${i.id}" | 이름: "${i.name}" | 심각도: ${i.severity} | 상태: ${i.status}`).join('\n')
                : '  (현재 등록된 활성 이슈 없음)';

            const systemInstruction = `당신은 대한민국 주식 시장의 메가트렌드와 단기 테마의 수명(Lifespan)을 분석하는 최상위 퀀트(Quant) 및 시황 분석가입니다.`;
            
            const userPrompt = `
[오늘 상위 랭크된 주도 섹터 목록 (Top 10)]
${sectorNames.join(', ')}

[오늘 상위 랭크된 주도 테마 목록 (Top 10)]
${themeNames.join(', ')}

[시장 컨텍스트 (뉴스 및 이슈 요약)]
${newsContext}

[🔒 현재 시스템에 등록된 활성 거시 이슈 목록 (이 목록 외의 이슈 ID를 임의로 생성하지 마시오)]
${issueListForPrompt}

---
위 컨텍스트를 완벽하게 분석하여, 오늘 랭크된 총 ${marketFlow.length}개의 (섹터 + 테마) 항목 각각에 대해 상승한 핵심 호재 이유를 짧게 요약하고, 해당 모멘텀의 예상 수명(단기/중장기)을 판단하시오.
알 수 없거나 뉴스가 부족한 경우, 자신의 범용 지식(가장 최근의 해당 테마 트렌드)을 동원하여 추론하시오.

[중요 제약] linked_issue_id는 반드시 위 "현재 활성 이슈 목록"에 존재하는 ID만 사용하시오.
매핑되는 이슈가 없으면 반드시 null로 설정하시오. 임의의 이슈 ID를 만들어내지 마시오.

반드시 아래의 구조를 가진 순수 JSON 배열만 출력하시오. (Markdown 백틱 금지)

[
  {
    "type": "THEME 혹은 SECTOR",
    "name": "항목 이름",
    "reason": "상승/주도 요인에 대한 1~2문장 요약",
    "lifespan_type": "단기 테마 (1주일 내외)" 혹은 "중기 트렌드 (1~3개월)" 혹은 "장기 메가트렌드" 혹은 "판단 불가" 중 하나 선택,
    "lifespan_reasoning": "왜 이런 수명으로 판단했는지 근거",
    "linked_issue_id": "위 이슈 목록의 ID 중 하나 또는 null",
    "linked_issue_path": "이슈→테마 연결 논리 경로 (예: '중동분쟁 → 나프타가격 → 대체재 부각') 또는 null"
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
                if (!linkedId || !activeIssueIds.has(linkedId)) continue; // 이슈 목록에 없는 ID는 무시 (할루시네이션 차단)

                const normalizedType = item.type?.toUpperCase().includes('SECTOR') ? 'SECTOR' : 'THEME';
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
                        source_id:   linkedId,
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
                    console.warn(`[ThemeIntelligence] Edge 기록 실패 (${linkedId}→${item.name}):`, edgeErr.message);
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
                tgMsg += `🔥 오늘의 주도 테마 및 섹터 분석 수명이 판별되었습니다.\n`;
                tgMsg += `👉 대시보드 [테마/섹터 트래커] 탭에서 상세 브리핑을 확인하세요.\n\n`;

                const themes = parsedArray.filter((i: any) => i.type.toUpperCase() === 'THEME');
                const sectors = parsedArray.filter((i: any) => i.type.toUpperCase() === 'SECTOR');

                if (themes.length > 0) {
                    tgMsg += `\n*[🔥 상위 주도 테마 TOP 3]*\n`;
                    tgMsg += themes.slice(0, 3).map((t: any, idx: number) => 
                        `${idx + 1}. *${t.name}* (${t.lifespan_type.includes('불가') ? '❓' : t.lifespan_type.includes('단기') ? '⚡ 단기' : '🚀 장기'})\n  - ${t.reason.replace(/[*_`]/g, '')}`
                    ).join('\n') + '\n';
                }

                if (sectors.length > 0) {
                    tgMsg += `\n*[📈 상위 주도 섹터 TOP 3]*\n`;
                    tgMsg += sectors.slice(0, 3).map((s: any, idx: number) => 
                        `${idx + 1}. *${s.name}* (${s.lifespan_type.includes('불가') ? '❓' : s.lifespan_type.includes('단기') ? '⚡ 단기' : '🚀 장기'})\n  - ${s.reason.replace(/[*_`]/g, '')}`
                    ).join('\n') + '\n';
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
