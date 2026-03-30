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

            // 뉴스 — NewsDataHub 캐시 읽기 (PL-NewsFlow + PL-NewsKeyword 대체)
            try {
                const { NewsDataHub } = await import('../NewsDataHub')
                const hubMarkdown = NewsDataHub.getInstance().getNewsAsMarkdown({ maxPerCategory: 10 })
                if (!hubMarkdown.includes('캐시 없음')) {
                    dataParts.push(`[NEWS_HUB]\n${hubMarkdown}`)
                    console.log('[IssueAgent] NewsDataHub 캐시 주입 완료')
                } else {
                    console.warn('[IssueAgent] NewsDataHub 캐시 없음 — 뉴스 컨텍스트 누락')
                }
            } catch(e: any) {
                console.error('[IssueAgent] NewsDataHub 오류:', e.message)
            }

            if (dataParts.length === 0) {
                throw new Error('데이터 파이프라인 수집 실패')
            }

            // 2. 장부 불러오기
            const activeIssues = this.ledger.getActiveIssues()

            // 3. Prompt 준비
            const today = DatabaseService.getInstance().getKstDate()
            const systemPrompt = `당신은 한국 시장의 메인 서사(장기 테마 및 매크로 리스크)를 관리하는 최고 이슈 분석 에이전트입니다.`
            const userPrompt = `오늘 날짜: ${today}

[현재 추적 중인 이슈 장부 (Active Issues)]
${JSON.stringify(activeIssues, null, 2)}

[오늘의 파이프라인 수집 데이터]
${dataParts.join('\n\n---\n\n')}

당신의 임무:
위 파이프라인 데이터(뉴스, 키워드, 매크로, 리포트)를 심층 분석하여 다음을 수행합니다.
1. '현재 추적 중인 이슈 장부'에 있는 기존 이슈들의 연장선상에 있는 새로운 정보가 있다면, 해당 이슈를 'UPDATE' 하라. 완전히 영향력이 해소되었다면 'RESOLVE' 하라.
2. 기존 장부에 속하지 않는 완전히 새로운 거시적 돌발/메가 트렌드 이슈가 발생했다면 'CREATE' 하라.
6. 아주 자잘하고 노이즈성 뉴스인 경우 무시하라.
7. 추가로, 전체 시장 위험도(risk_score)와 현재 시장의 핵심 테제(summary_markdown)를 포함하는 briefing 객체도 같이 생성하라. (risk_score는 0~100 사이, VIX, KRW, TNX(미 10년물 국채), 그리고 OIL(WTI 유가) 코멘트 포함)

결과는 반드시 아래 JSON 형식의 객체로만 출력하라. (마크다운 백틱 허용, 기타 설명 금지)
{
  "briefing": {
    "risk_score": 68,
    "summary_markdown": "<p>...현재 시장 요약 2~3줄 HTML/Markdown...</p>",
    "macro_vix": "+2.4% (18.5)",
    "macro_krw": "+5.0원 (1340.5)",
    "macro_tnx": "+0.03%p (4.320%)",
    "macro_oil": "-0.5% ($78.50)"
  },
  "actions": [
    {
      "action": "CREATE" | "UPDATE" | "RESOLVE",
      "issue_id": "기존 이슈 ID (CREATE인 경우 새로운 고유 ID 생성, 예: 2603-05)",
      "name": "이슈 명칭",
      "severity": "위험도/파급력 (예: AA, B, C 등)",
      "status": "ESCALATING" | "FADING" | "RESOLVED" | "NEW",
      "impactDirection": "상승" | "하락" | "중립",
      "summary": "1~2문장의 핵심 상태 요약",
      "goodSectors": [{"name": "업종명", "reason": "이유"}],
      "badSectors": [{"name": "업종명", "reason": "이유"}],
      "timelineDetails": {
        "summary": "타임라인 트리에 표시할 짧은 요약 (제목격)",
        "ai_analysis": "해당 사건 혹은 뉴스가 무슨 파급력을 야기할지에 대한 AI의 심도 깊은 서술",
        "market_reaction": "PL-Macro나 수급 등을 통해 관찰되는 실제 통계적/정량적 시장 반응(없으면 생략)",
        "status_snapshot": "현재 판단된 상태(ESCALATING 등)"
      }
    }
  ]
}`

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
            const codeBlockMatch = rawResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1]
            }
            const jsonMatch = jsonStr.match(/\{\s*"briefing"[\s\S]*\}/) || jsonStr.match(/\{[\s\S]*\}/)
            if (!jsonMatch) {
                console.error('[IssueAgent] JSON 파싱 실패:', rawResponse.substring(0,200))
                return
            }

            const parsedObject = JSON.parse(jsonMatch[0])
            const briefing = parsedObject.briefing
            const actions = parsedObject.actions || []

            console.log(`[IssueAgent] 파싱된 액션 수: ${actions.length}`)

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
                            summary: act.summary || '',
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
