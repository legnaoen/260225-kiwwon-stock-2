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
                SELECT type, name, rank_num, change_rate
                FROM naver_market_flow
                WHERE date = ? AND rank_num <= 20
                ORDER BY type, rank_num ASC
            `).all(dateStr) as any[];

            if (!marketFlow || marketFlow.length === 0) {
                console.warn(`[ThemeIntelligence] ${dateStr} 일자의 테마/섹터 랭킹 데이터가 없어 분석을 스킵합니다.`);
                return null;
            }

            // 1.5 필터링: 테마 20위, 섹터 10위까지 수용하되 전체 카테고리 상승률이 2.0% 이하인 경우는 제외
            const topThemes = marketFlow.filter(m => m.type === 'THEME' && m.rank_num <= 20 && m.change_rate > 2.0).map(m => m.name);
            const topSectors = marketFlow.filter(m => m.type === 'SECTOR' && m.rank_num <= 10 && m.change_rate > 2.0).map(m => m.name);
            const targets = Array.from(new Set([...topThemes, ...topSectors]));

            // 2. 컨텍스트용 이슈/뉴스 수집
            let newsContext = "[최근 트래커 이슈 장부]\n";
            try {
                const issues = IssueLedgerDB.getInstance().getActiveIssues();
                const uniqueSummaries = new Set<string>();
                const uniqueIssues = issues.filter(i => {
                    const sumPrefix = i.summary.substring(0, 30).trim();
                    if (uniqueSummaries.has(sumPrefix)) return false;
                    uniqueSummaries.add(sumPrefix);
                    return true;
                });
                newsContext += uniqueIssues.map(i => `- ${i.name}: ${i.summary}`).join('\n');
            } catch (e) {
                console.error('[ThemeIntelligence] 이슈 장부 로드 실패', e);
            }

            newsContext += "\n\n[당일 수집된 핵심 뉴스]\n";
            try {
                newsContext += NewsDataHub.getInstance().getNewsAsMarkdown({ maxPerCategory: 20, skipKeywords: true });
            } catch (e) {
                console.error('[ThemeIntelligence] 뉴스 데이터 허브 로드 실패', e);
            }

            // 2.5 [핵심 고도화] 테마 파급력(Mega-ness) 등급별 주도주 동적 검색 및 프롬프트 주입
            
            let targetedNewsContext = "\n\n[🔥 최상위 주도 테마/섹터 심층 실시간 뉴스]\n";
            
            try {
                const { NaverSearchCollector } = await import('../v2_pipeline/collectors/NaverSearchCollector');
                const collector = new NaverSearchCollector();
                
                // 변경: 무조건 5% 이상 하드코딩 제거. 당일 0% 초과 상승한 유효 종목들을 가져와서 판단.
                // 1% 이상인 종목부터는 대형주라 할지라도 테마에 기여했다고 판단합니다.
                const stmtGetStocks = rawDb.prepare(`
                    SELECT stock_code, stock_name, change_rate FROM stock_theme_tags 
                    WHERE tag_name = ? AND change_rate > 0.0
                    ORDER BY change_rate DESC 
                `);

                const stmtInsertNews = rawDb.prepare(`
                    INSERT INTO naver_news_flow
                        (date, category, title, body_snippet, source, article_id, url, collected_at, time_bucket, article_hash, search_keyword)
                    VALUES
                        (@date, @category, @title, @body_snippet, @source, @article_id, @url, @collected_at, @time_bucket, @article_hash, @search_keyword)
                `);

                const insertNewsTx = rawDb.transaction((items: any[]) => {
                    for (const item of items) {
                        try { stmtInsertNews.run(item); } catch (e) { /* 중복 무시 */ }
                    }
                });

                const now = new Date();
                const timeBucket = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                let dbRowsToInsert: any[] = [];
                const searchedKeywords = new Set<string>();

                for (const targetName of targets) {
                    const stocks = stmtGetStocks.all(targetName) as any[];
                    // 너무 미미한 상승(1% 미만)만 있는 테마는 무시
                    const validStocks = stocks.filter(s => s.change_rate >= 1.0);
                    if (!validStocks || validStocks.length === 0) continue;
                    
                    const limitUps = validStocks.filter(s => s.change_rate >= 29.5).length;
                    const surges = validStocks.filter(s => s.change_rate >= 10.0).length;
                    
                    const maxChange = validStocks[0].change_rate;
                    const avgChange = validStocks.reduce((sum, s) => sum + s.change_rate, 0) / validStocks.length;

                    // 테마/섹터 분석을 위해 각 대상별 1~2개의 대장주의 뉴스를 대표 샘플로 수집합니다.
                    const pickCount = Math.min(2, validStocks.length);
                    const leadingStocks = validStocks.slice(0, pickCount);
                    
                    let themeTargetNewNews = "";

                    for (const st of leadingStocks) {
                        const keyword = st.stock_name; 
                        if (searchedKeywords.has(keyword)) continue;
                        searchedKeywords.add(keyword);

                        try {
                            const rawSearch = await collector.collect({ keyword: keyword });
                            const articles = rawSearch?.articles || [];
                            if (articles.length > 0) {
                                for (const a of articles.slice(0, 2)) { 
                                    const title = (a.title || '').replace(/<[^>]+>/g, '');
                                    const snippet = (a.description || '').replace(/<[^>]+>/g, '');
                                    themeTargetNewNews += `- (${keyword}) ${title} (${snippet.substring(0, 60)}...)\n`;
                                    
                                    let source = 'Naver';
                                    try { source = a.originallink ? new URL(a.originallink).hostname.replace('www.', '') : 'Naver'; } catch(e){}
                                    const hash = Math.abs((Math.imul(31, 0) + title.charCodeAt(0)) | 0).toString(16) + (a.pubDate || Date.now());

                                    dbRowsToInsert.push({
                                        date: dateStr, category: 'THEME_TARGET', title, body_snippet: snippet,
                                        source, article_id: hash, url: a.originallink || a.link || '',
                                        collected_at: now.toISOString(), time_bucket: timeBucket,
                                        article_hash: hash, search_keyword: keyword
                                    });
                                }
                            }
                        } catch (err: any) {
                            console.error(`[ThemeIntelligence] 타겟 뉴스 검색 실패 (${keyword}):`, err.message);
                        }
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                    
                    if (themeTargetNewNews) {
                        targetedNewsContext += `\n[${targetName} 주도주 최신 팩트]\n`;
                        targetedNewsContext += themeTargetNewNews;
                    }
                }

                if (dbRowsToInsert.length > 0) {
                    insertNewsTx(dbRowsToInsert);
                    console.log(`[ThemeIntelligence] 🎯 주도주 타겟 검색 완료: 뉴스 ${dbRowsToInsert.length}건 DB 저장`);
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

            // 3. Gemini Prompt 조립 (이슈 목록 주입 → 할루시네이션 방지)
            const activeIssues = IssueLedgerDB.getInstance().getActiveIssues();
            const issueListForPrompt = activeIssues.length > 0
                ? activeIssues.map((i: any) => `  - ID: "${i.id}" | 이름: "${i.name}" | 심각도: ${i.severity} | 상태: ${i.status}`).join('\n')
                : '  (현재 등록된 활성 거시 이슈 없음)';

            // [P1] 테마 간 동시 등장 이력 (Co-occurrence, 30일)
            let cooccurrenceContext = '[테마/섹터 간 동시 등장 이력 — 최근 30일: 같은 날 Top20에 함께 등장한 횟수]\n';
            try {
                if (targets.length >= 2) {
                    const ph = targets.map(() => '?').join(',');
                    const coRows = rawDb.prepare(`
                        SELECT a.name as ta, b.name as tb, COUNT(*) as codays
                        FROM naver_market_flow a
                        JOIN naver_market_flow b
                          ON a.date = b.date
                         AND a.type = b.type
                         AND a.name < b.name
                        WHERE a.date >= date(?, '-30 days')
                          AND a.date < ?
                          AND a.name IN (${ph})
                          AND b.name IN (${ph})
                        GROUP BY a.name, b.name
                        HAVING codays >= 2
                        ORDER BY codays DESC
                        LIMIT 15
                    `).all(dateStr, dateStr, ...targets, ...targets) as { ta: string; tb: string; codays: number }[];

                    if (coRows.length > 0) {
                        cooccurrenceContext += coRows
                            .map(r => `- ${r.ta} ↔ ${r.tb}: ${r.codays}일 동시 등장`)
                            .join('\n');
                        cooccurrenceContext += '\n(동시 등장 횟수가 많을수록 같은 메가트렌드에 속할 가능성이 높습니다)\n';
                    } else {
                        cooccurrenceContext += '- 데이터 누적 부족 (초기 실행)\n';
                    }
                }
            } catch (e: any) {
                console.error('[ThemeIntelligence] Co-occurrence 계산 오류:', e.message);
            }

            // [P2] 테마별 Breadth 지수 (상승 종목 비율 — 수급 확산도)
            let breadthContext = '[테마별 Breadth 지수]\n데이터 누적 부족 (초기 실행)\n';

            const systemInstruction = `당신은 대한민국 주식 시장의 메가트렌드와 테마를 분석하는 최상위 퀀트(Quant) 및 시황 전략가입니다. 뉴스 뿐만 아니라 수급 확산도를 복합적으로 추론합니다.`;
            
            const userPrompt = `[오늘 분석 대상 주도 섹터 목록]
$topSectors.join(', ')

[오늘 분석 대상 주도 테마 목록]
$topThemes.join(', ')

$marketConditionContext

[시장 컨텍스트 (실시간 뉴스 및 이슈 요약)]
$newsContext

$cooccurrenceContext

$breadthContext

[🔒 현재 시스템에 등록된 활성 거시 이슈 목록 (아래 목록 외의 이슈 ID를 임의로 생성하지 마시오)]
$issueListForPrompt

---
위 컨텍스트를 완벽하게 분석하여, 오늘 분석 대상으로 지정된 총 $targets.length개의 (섹터 + 테마) 항목 전체에 대해 **예외 없이 하나도 누락하지 말고** 심층 브리핑을 작성하시오.

[분석 지침]
- 각 테마가 왜 오늘 집중적인 수급을 받았는지 구체적인 팩트와 파급 효과를 심층 분석하여 작성하십시오.
- **반드시 당일 이 테마를 이끈 대장주(리드 주식)의 흐름이나 상승 수준에 기반한 설명을 포함**하십시오. 
- 단답형 금지. 

[중요 제약]
- linked_issue_id는 반드시 위 "활성 거시 이슈 목록"에 존재하는 ID만 사용해야 합니다. 
- 만약 상위 3위 이내의 대장 테마임에도 매핑되는 기존 이슈가 없다면, 이것은 시황 AI가 놓친 신규 메타입니다. 이 경우 빈 칸으로 두지 말고, "ISSUE-NEW-임의의영문명" 형식으로 ID를 새로 생성하여 적으십시오. (시스템이 이를 파싱해 신규 이슈로 자동 등록할 것입니다).
- 기존 하위 테마인데 매핑할 원인이 없다면 원래대로 null로 설정하십시오.

반드시 아래의 구조를 가진 순수 JSON 객체(Object)만 출력하시오. (Markdown 백틱 금지)

{
  "theme_evaluations": [
    {
      "type": "THEME 혹은 SECTOR",
      "name": "항목 이름",
      "reason": "[헤드라인 한 줄 요약]\\n\\n이슈에 대한 심층적 분석, 파급 효과, 파생될 하위 테마, 대장주의 구체적 흐름 등 최소 3~4문장 이상의 상세한 설명 작성",
      "linked_issue_id": "위 이슈 목록의 ID 중 하나 또는 신규 이슈 ID 또는 null",
      "linked_issue_path": "이슈→테마 연결 논리 경로 또는 null"
    }
  ]
}
`;

            // 4. Gemini 실행 큐 등재
            const rawResponse = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'THEME_INTELLIGENCE',
                agentName: '테마 수명 분석기',
                triggerType: 'MANUAL', // 일단 메뉴얼/테스트
                prompt: userPrompt,
                systemInstruction: systemInstruction,
            });

            // 원본 전문 DB 저장 추가
            this.db.saveAiDailyRawLog(dateStr, 'THEME_INTELLIGENCE', rawResponse);

            // 5. JSON 파싱
            const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("JSON 객체 파싱에 실패했습니다. (응답 포맷 오류)");
            }

            const parsedObj = JSON.parse(jsonMatch[0]);
            const parsedArray = parsedObj.theme_evaluations || [];

            // 6. DB에 기록 (Upsert Themes)
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
                    lifespan_type: '', // 더이상 AI가 판별하지 않음
                    lifespan_reasoning: ''
                };
            });

            this.db.upsertThemeIntelligence(mapDataForDb);
            
            console.log(`[ThemeIntelligence] 🤖 성공적으로 ${mapDataForDb.length}개의 테마/섹터 분석결과가 캐싱되었습니다.`);

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
                                system_recommendation: `테마AI(LLM)가 신규 발굴한 이슈`,
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

                let expiresAt: string | undefined;
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
                    ).join('\n\n') + '\n\n';
                }

                if (stockPicksArray && stockPicksArray.length > 0) {
                    tgMsg += `*[🎯 테마 AI 관심종목 추천]*\n\n`;
                    tgMsg += stockPicksArray.map((p: any) => 
                        `- *${p.stock_name}* (${p.confidence}점)\n  : ${p.reason.replace(/[*_`]/g, '')}`
                    ).join('\n\n') + '\n\n';
                }

                tgSvc.sendMessage(tgMsg).catch(err => console.error('[ThemeIntelligence] 텔레그램 발송 실패', err));
            } catch (tgErr) {
                console.error('[ThemeIntelligence] 텔레그램 연동 실패', tgErr);
            }

            return mapDataForDb;

        } catch (error: any) {
            console.error(`[ThemeIntelligence] 💥 분석 중 오류 발생:`, error.message);

            // Resilience Plan 2 & 3: 에러 알림 및 임시 크론 예약
            const errMsg = error.message ? error.message.toLowerCase() : '';
            if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate-limit') || errMsg.includes('rate limits')) {
                console.warn(`[ThemeIntelligence] API 과부하 감지. 5분 뒤 임시 크론으로 재시도를 예약합니다.`);
                try {
                    const { SchedulerService } = await import('../SchedulerService');
                    const { eventBus } = await import('../../utils/EventBus');
                    const { TelegramService } = await import('../TelegramService');
                    
                    eventBus.emit('system:error' as any, {
                        message: `[테마/섹터 AI] ⚠️ 구글 API 트래픽 과부하로 분석 지연. 5분 뒤 백그라운드 재시도.`,
                        code: 'AI_OVERLOAD',
                        time: new Date().toLocaleTimeString('ko-KR')
                    });

                    TelegramService.getInstance().sendMessage(`🚨 [테마 AI 대기] 구글 API 과부하로(503) 생애주기 분석이 지연되었습니다. 5분 뒤 자동으로 1회 재실행합니다.`);

                    SchedulerService.getInstance().scheduleOnceFallback(
                        '테마 AI 지연 재시도 (Batch)', 
                        5 * 60 * 1000, 
                        async () => {
                            await ThemeIntelligenceAgent.getInstance().runBatchAnalysis(targetDate);
                        }
                    );
                } catch (schedErr) {
                    console.error('[ThemeIntelligence] 재시도 스케줄링 실패:', schedErr);
                }
            }

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
위 정보와 사용자의 의견을 종합하여, 기존 AI의 판단 오류를 정정하고 팩트체크 리포트를 작성하십시오.
반드시 아래의 구조를 가진 JSON 데이터만 순수하게 반환하십시오. (응답 메시지도 JSON 텍스트에 포함하세요)

{
  "copilot_message": "사용자에게 건네는 응답/피드백 메시지 (예: '사용자님 의견이 합리적입니다. 확인 결과...')",
  "revised_reason": "수정/보완된 핵심 상승 요인 요약"
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
            
            rawDb.prepare(`
                UPDATE theme_intelligence
                SET reason = ?,
                    lifespan_type = '',
                    lifespan_reasoning = ''
                WHERE date = ? AND type = ? AND name = ?
            `).run(
                parsed.revised_reason,
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
                    system_recommendation: `원인 교정됨`,
                    related_stocks_json: JSON.stringify([])
                });
            } catch (e: any) {
                console.error(`[ThemeIntelligence] 이슈 장부 동기화 실패:`, e.message);
            }

            console.log(`[ThemeIntelligence] 🚀 사용자 피드백 DB 업데이트 완료`);
            
            return {
                copilotMessage: parsed.copilot_message,
                revisedReason: parsed.revised_reason
            };

        } catch (error: any) {
            console.error(`[ThemeIntelligence] 💥 검증 파이프라인 스크립트 에러:`, error.message);
            throw error;
        }
    }
}

