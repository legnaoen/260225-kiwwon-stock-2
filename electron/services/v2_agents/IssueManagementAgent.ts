import { V2PipelineManager } from '../v2_pipeline/V2PipelineManager'
import { AiService } from '../AiService'
import { AiExecutionQueue } from '../AiExecutionQueue'
import { DatabaseService } from '../DatabaseService'
import { IssueLedgerDB, IssueRecord, IssueTimelineNode } from './IssueLedgerDB'

export class IssueManagementAgent {
    private static instance: IssueManagementAgent
    private pipeline: V2PipelineManager
    private ai: AiService
    private ledger: IssueLedgerDB

    private constructor() {
        this.pipeline = V2PipelineManager.getInstance()
        this.ai = AiService.getInstance()
        this.ledger = IssueLedgerDB.getInstance()
    }

    public static getInstance(): IssueManagementAgent {
        if (!IssueManagementAgent.instance) {
            IssueManagementAgent.instance = new IssueManagementAgent()
        }
        return IssueManagementAgent.instance
    }

    public async runDailyAnalysis(): Promise<void> {
        console.log(`[IssueAgent] ═══ 일일 이슈 분석 시작 ═══`)
        
        try {
            // 1. 수집 — Macro/Research는 파이프라인, 뉴스는 Hub 캐시
            const [macroResult, researchResult] = await Promise.allSettled([
                this.pipeline.runPipeline('PL-Macro' as any, { forceFetch: false }),
                this.pipeline.runPipeline('PL-Research' as any, { forceFetch: false }),
            ])
            
            const dataParts: string[] = []

            // Macro
            if (macroResult.status === 'fulfilled' && macroResult.value.status === 'success') {
                const md = (macroResult.value as any).aggregatedMarkdown || ''
                if (md) dataParts.push(`[PL-Macro]\n${md}`)
            }
            // Research
            if (researchResult.status === 'fulfilled' && researchResult.value.status === 'success') {
                const md = (researchResult.value as any).aggregatedMarkdown || ''
                if (md) dataParts.push(`[PL-Research]\n${md}`)
            }

            // 뉴스 — NewsDataHub 강제 동기화 후 최대치로 데이터 추출 (제미나이 3.1 롱컨텍스트 대응)
            try {
                const { NewsDataHub } = await import('../NewsDataHub')
                const hub = NewsDataHub.getInstance()
                
                console.log('[IssueAgent] 뉴스 데이터 최신화 (강제 수집 시작...)')
                await hub.runBatchCollect() // 캐시에 의존하지 않고 신규 데이터를 즉시 병합
                
                // maxPerCategory 10 -> 50 으로 5배 상향. 5개 카테고리 기준 최대 250건의 뉴스가 통째로 들어감
                const hubMarkdown = hub.getNewsAsMarkdown({ maxPerCategory: 50 })
                if (!hubMarkdown.includes('캐시 없음')) {
                    dataParts.push(`[NEWS_HUB]\n${hubMarkdown}`)
                    console.log('[IssueAgent] NewsDataHub 최신 데이터 대량 주입 완료')
                } else {
                    console.warn('[IssueAgent] NewsDataHub 수집 결과 없음 — 뉴스 컨텍스트 누락')
                }
            } catch(e: any) {
                console.error('[IssueAgent] NewsDataHub 수집/주입 오류:', e.message)
            }

            if (dataParts.length === 0) {
                throw new Error('데이터 파이프라인 수집 실패')
            }

            // 2. 장부 불러오기
            const activeIssues = this.ledger.getActiveIssues()

            // 3-a. 네이버 어휘 사전 로드 (이슈 AI 정합 기준)
            const db = DatabaseService.getInstance()
            
            // 3-b. 장기 방치(Stale) 이슈 경고 태그 주입 (소멸 처리 유도)
            const todayKst = db.getKstDate()
            const MS_PER_DAY = 1000 * 60 * 60 * 24;
            const todayMs = new Date(todayKst).getTime();
            
            const annotatedIssues = activeIssues.map(issue => {
                const updatedMs = new Date(issue.updated_date).getTime();
                const daysOld = Math.floor((todayMs - updatedMs) / MS_PER_DAY);
                if (daysOld >= 3) {
                    return {
                        ...issue,
                        _AI_WARNING_: `[⚠️ 침묵 경고] 이 이슈는 ${daysOld}일 동안 관련 뉴스 갱신이 없었습니다. 오늘 데이터에도 모멘텀이 없다면 반드시 UPDATE하여 status를 FADING이나 RESOLVE로 낮추십시오.`
                    }
                }
                return issue;
            });
            const vocabSectors = db.getNaverVocabulary('SECTOR');
            const vocabThemes  = db.getNaverVocabulary('THEME');
            const sectorListStr = vocabSectors.length > 0
                ? vocabSectors.map(v => v.name).join(', ')
                : '(아직 수집된 섹터 없음)';
            const themeListStr = vocabThemes.length > 0
                ? vocabThemes.map(v => v.name).join(', ')
                : '(아직 수집된 테마 없음)';

            // 3. Prompt 준비
            const today = db.getKstDate()
            const systemPrompt = `당신은 한국 시장의 메인 서사(장기 테마 및 매크로 리스크)를 관리하는 최고 이슈 분석 에이전트입니다.

[🚨 이슈 명명 절대 규칙 (가치 중립 적용)]
- 이슈의 제목(name)은 '쇼크', '폭락', '공포', '기대', '우려', '가속화' 등의 감정적/방향성 단어를 철저히 배제합니다.
- 반드시 위키백과 표제어처럼 100% 가치 중립적이고 건조하게 명명해야 합니다. (예: "미-이란 중동 전쟁 폭발" ➔ "중동 지정학적 갈등 동향")
- **강제 지시:** 현재 장부에 있는 기존 이슈 제목 중 감정적인 단어가 하나라도 포함되어 있다면, 이번 업데이트를 통해 무조건 가치 중립적인 명칭으로 전면 개칭(Rename)하여 출력하십시오! 기존 명칭을 절대 답습하지 마십시오.

[🎯 신규 메가 트렌드 발굴 의무 (CREATE 강제)]
- 주어진 뉴스/데이터에서 기존 장부에 없는 "완전히 새로운 거시적 돌발 이슈"나 "새로운 기술 패러다임/메가 트렌드(예: 거대 인프라 수요 폭발, 초대형 IPO 등)"가 강하게 관측된다면, 기존 이슈에 억지로 병합하지 말고 무조건 비중 있는 새로운 이슈로 'CREATE' 하십시오.
- 기존 이슈들만 무사안일하게 UPDATE/RESOLVE 하고 넘어가는 소극적인 태도를 버리십시오.

[⏳ 방치된 좀비 이슈 소멸(Decay) 규정]
- 추적 중인 장부에 있는 이슈 중, 오늘 파이프라인에서 단 한 번도 언급되지 않거나 데이터에 [⚠️ 침묵 경고] 태그가 붙은 이슈를 결코 그대로 방치(무시)하지 마십시오.
- **무소식은 곧 영향력 해소를 의미합니다.** 관련 뉴스가 보이지 않는다면 반드시 해당 이슈를 'UPDATE' 액션으로 포함시켜 상태를 'FADING'으로 강등하거나, 완전히 식었다면 'RESOLVE' 처리하십시오.`
            const userPrompt = '오늘 날짜: ' + today + '\n\n'
                + '[현재 추적 중인 이슈 장부 (Active Issues)]\n'
                + JSON.stringify(annotatedIssues, null, 2) + '\n\n'
                + '[오늘의 파이프라인 수집 데이터]\n'
                + dataParts.join('\n\n---\n\n') + '\n\n'
                + '당신의 임무:\n'
                + '위 파이프라인 데이터(뉴스, 키워드, 매크로, 리포트)를 심층 분석하여 다음을 수행합니다.\n'
                + '1. \'현재 추적 중인 이슈 장부\'에 있는 기존 이슈들의 연장선상에 있는 새로운 정보가 있다면, 해당 이슈를 \'UPDATE\' 하라. 완전히 영향력이 해소되었다면 \'RESOLVE\' 하라.\n'
                + '2. 기존 장부에 속하지 않는 완전히 새로운 거시적 돌발/메가 트렌드 이슈가 발생했다면 \'CREATE\' 하라. (단순 노이즈성 제외, 시장 주도 테마 위주 발굴)\n'
                + '6. 아주 자잘하고 노이즈성 뉴스인 경우 무시하라.\n'
                + '7. 추가로, 전체 시장 위험도(risk_score)와 현재 시장의 핵심 테제(summary_markdown)를 포함하는 briefing 객체도 같이 생성하라. (risk_score는 0~100 사이, VIX, KRW, TNX(미 10년물 국채), 그리고 OIL(WTI 유가) 코멘트 포함)\n\n'
                + '결과는 반드시 아래 JSON 형식의 객체로만 출력하라. (마크다운 백틱 허용, 기타 설명 금지)\n'
                + '{\n'
                + '  "briefing": {\n'
                + '    "risk_score": 68,\n'
                + '    "summary_markdown": "<p><b>[오늘의 핵심 테제(Top Impact)]</b> 오늘 시장의 멱살을 잡고 흔드는 <b>단 하나의 가장 중요한 서사(Narrative)</b>를 첫 문장으로 선언하세요.</p><p>...그리고 분석된 데이터를 바탕으로 향후 시장 방향성을 예언적으로 추가 서술하세요...</p>",\n'
                + '    "macro_vix": "+2.4% (18.5)",\n'
                + '    "macro_krw": "+5.0원 (1340.5)",\n'
                + '    "macro_tnx": "+0.03%p (4.320%)",\n'
                + '    "macro_oil": "-0.5% ($78.50)"\n'
                + '  },\n'
                + '  "actions": [\n'
                + '    {\n'
                + '      "action": "CREATE" | "UPDATE" | "RESOLVE",\n'
                + '      "issue_id": "기존 이슈 ID (CREATE인 경우 새로운 고유 ID 생성, 예: 2603-05)",\n'
                + '      "name": "위키백과식 가치 중립적 이슈 명칭 (예: 글로벌 AI 반도체 수요 논란)",\n'
                + '      "current_stance": "[지속: 단기 1주내 / 중기 1~3개월 / 장기 구조적] 마이크론 실적 호조로... (반드시 맨 앞에 대괄호로 예상 지속 기간을 명시하고, 투자 심리를 요약할 것)",\n'
                + '      "severity": "위험도/파급력 (예: AAA, AA, A, B, C 등 - 전체 시장을 지배하는 1등 트렌드에만 AAA나 S를 부여하여 랭킹 격차를 둘 것)",\n'
                + '      "status": "ESCALATING" | "FADING" | "RESOLVED" | "NEW",\n'
                + '      "impactDirection": "상승" | "하락" | "중립",\n'
                + '      "market_bias": "-5부터 +5 사이의 정수 (해당 이슈가 전체 시장에 미치는 하방/상방 압력 강도)",\n'
                + '      "dominant_regime": "예: 지정학 리스크, 통화정책 등",\n'
                + '      "summary": "1~2문장의 핵심 상태 요약",\n'
                + '      "goodSectors": [{"name": "업종명 (아래 [네이버 추적 섹터 목록]에서 선택 권장)", "reason": "이유"}],\n'
                + '      "badSectors": [{"name": "업종명 (아래 [네이버 추적 섹터 목록]에서 선택 권장)", "reason": "이유"}],\n'
                + '      "timelineDetails": {\n'
                + '        "summary": "타임라인 트리에 표시할 짧은 요약 (제목격)",\n'
                + '        "ai_analysis": "해당 사건 혹은 뉴스가 무슨 파급력을 야기할지에 대한 AI의 심도 깊은 서술",\n'
                + '        "market_reaction": "PL-Macro나 수급 등을 통해 관찰되는 실제 통계적/정량적 시장 반응(없으면 생략)",\n'
                + '        "status_snapshot": "현재 판단된 상태(ESCALATING 등)"\n'
                + '      }\n'
                + '    }\n'
                + '  ]\n'
                + '}\n\n'
                + '[🔒 네이버 증권 추적 섹터 목록 (goodSectors/badSectors 작명 시 이 목록에서 선택 권장 - 완벽 일치하지 않아도 되나 최대한 근사한 이름 사용)]\n'
                + sectorListStr + '\n\n'
                + '[🔒 네이버 증권 추적 테마 목록 (참고용 - 이슈와 직결된 테마가 있으면 언급 가능)]\n'
                + themeListStr

            console.log('[IssueAgent] Gemini 판단 요청 중 (큐 대기)...')
            const rawResponse = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'IMA',
                agentName: '이슈 AI',
                triggerType: 'MANUAL',
                prompt: userPrompt,
                systemInstruction: systemPrompt,
            })
            
            // 4. 파싱
            let jsonStr = rawResponse
            const codeBlockRegex = new RegExp('[`]{3}(?:json)?\\s*\\n?([\\s\\S]*?)\\n?[`]{3}')
            const codeBlockMatch = rawResponse.match(codeBlockRegex)
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1]
            }
            const jsonMatch = jsonStr.match(/\{\s*"briefing"[\s\S]*\}/) || jsonStr.match(/\{[\s\S]*\}/)
            if (!jsonMatch) {
                console.error('[IssueAgent] JSON parse fail:', rawResponse.substring(0,200))
                return
            }

            const parsedObject = JSON.parse(jsonMatch[0])
            const briefing = parsedObject.briefing
            const actions = parsedObject.actions || []

            console.log('[IssueAgent] action count: ' + actions.length)

            // 5. 브리핑 저장
            if (briefing) {
                this.ledger.saveBriefing(
                    today, 
                    briefing.risk_score || 50, 
                    briefing.summary_markdown || '', 
                    briefing.macro_vix || '', 
                    briefing.macro_krw || '',
                    briefing.macro_tnx || '',
                    briefing.macro_oil || ''
                )
            }

            // 6. 실행 (DB 갱신) + 갱신된 이슈 ID 수집
            const updatedIssueIds: string[] = []

            for (const act of actions) {
                try {
                    if (act.action === 'CREATE' || act.action === 'UPDATE') {
                        const existing = activeIssues.find(i => i.id === act.issue_id)
                        const created_date = existing ? existing.created_date : today
                        const payload: IssueRecord = {
                            id: act.issue_id,
                            name: act.name,
                            severity: act.severity || 'C',
                            status: act.status || 'NEW',
                            impactDirection: act.impactDirection || '중립',
                            market_bias: act.market_bias || 0,
                            dominant_regime: act.dominant_regime || '기타',
                            summary: act.summary || '',
                            current_stance: act.current_stance || null,
                            created_date,
                            updated_date: today,
                            goodSectors: act.goodSectors || [],
                            badSectors: act.badSectors || []
                        }
                        this.ledger.upsertIssue(payload)

                        // 타임라인 기록 추가
                        if (act.timelineDetails) {
                            this.ledger.addTimelineNode(act.issue_id, {
                                snapshot_date: today,
                                status_snapshot: act.timelineDetails.status_snapshot || act.status,
                                severity: act.severity,
                                summary: act.timelineDetails.summary || act.summary,
                                ai_analysis: act.timelineDetails.ai_analysis,
                                market_reaction: act.timelineDetails.market_reaction
                            })
                        }

                        // ★ knowledge_edges에도 섹터 연결 저장 (BENEFITS/HURTS)
                        // → 이슈AI 분석 섹터와 테마AI 데이터를 하나의 knowledge_edges로 통합
                        try {
                            for (const g of (act.goodSectors || [])) {
                                if (!g.name) continue;
                                this.ledger.upsertEdge({
                                    source_type: 'ISSUE',
                                    source_id:   act.issue_id,
                                    target_type: 'SECTOR',
                                    target_id:   g.name,
                                    relation:    'BENEFITS',
                                    confidence:  0.85,
                                    logical_path: g.reason || null,
                                    created_by:  'ISSUE_AI',
                                });
                            }
                            for (const b of (act.badSectors || [])) {
                                if (!b.name) continue;
                                this.ledger.upsertEdge({
                                    source_type: 'ISSUE',
                                    source_id:   act.issue_id,
                                    target_type: 'SECTOR',
                                    target_id:   b.name,
                                    relation:    'HURTS',
                                    confidence:  0.85,
                                    logical_path: b.reason || null,
                                    created_by:  'ISSUE_AI',
                                });
                            }
                        } catch (edgeErr: any) {
                            console.warn(`[IssueAgent] knowledge_edges 저장 실패 (${act.issue_id}):`, edgeErr.message);
                        }

                        updatedIssueIds.push(act.issue_id)
                    } else if (act.action === 'RESOLVE') {
                        this.ledger.resolveIssue(act.issue_id)
                    }
                } catch(dbErr) {
                    console.error(`[IssueAgent] DB 저장 중 에러 (issue_id: ${act.issue_id}):`, dbErr)
                }
            }

            console.log(`[IssueAgent] ═══ 이슈 분석 및 반영 완료 ═══`)

            // 7. 갱신된 이슈에 대해서만 Swarm 자동 소집 (당일 중복 방지, 최대 3개)
            const MAX_SWARM_PER_RUN = 3
            const swarmTargets = updatedIssueIds
                .filter(id => !this.ledger.hasSwarmToday(id))
                .slice(0, MAX_SWARM_PER_RUN)

            if (swarmTargets.length > 0) {
                console.log(`[IssueAgent] 🌀 Swarm 자동 소집 대상: ${swarmTargets.length}개 이슈`)
                const { SwarmSimulationAgent } = await import('./SwarmSimulationAgent')
                for (const issueId of swarmTargets) {
                    console.log(`[IssueAgent] 🐟 Swarm 시작: ${issueId}`)
                    await SwarmSimulationAgent.getInstance().evaluateIssue(issueId)
                    console.log(`[IssueAgent] 🏁 Swarm 완료: ${issueId}`)
                }
            } else {
                console.log('[IssueAgent] Swarm 소집 대상 없음 (모두 당일 이미 완료 또는 갱신 없음)')
            }
        } catch (error: any) {
            console.error(`[IssueAgent] 실행 실패:`, error)
        }
    }
}
