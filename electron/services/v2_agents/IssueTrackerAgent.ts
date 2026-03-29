import { IssueLedgerDB } from './IssueLedgerDB';
import { LocalAiService } from '../LocalAiService';
import { AiExecutionQueue } from '../AiExecutionQueue';
import { eventBus, SystemEvent } from '../../utils/EventBus';

export class IssueTrackerAgent {
    private static instance: IssueTrackerAgent;

    private constructor() {}

    public static getInstance(): IssueTrackerAgent {
        if (!IssueTrackerAgent.instance) {
            IssueTrackerAgent.instance = new IssueTrackerAgent();
        }
        return IssueTrackerAgent.instance;
    }

    /**
     * 오전 시장 개장 전 (08:30) 이슈 장부 일점검 및 상태 진단
     */
    public async runMorningAnalysis() {
        console.log('[IssueTrackerAgent] 🕵️ 오전 08:30 이슈 트래킹 및 진단 시작...');
        const db = IssueLedgerDB.getInstance();
        const activeIssues = db.getActiveIssues();

        if (activeIssues.length === 0) {
            console.log('[IssueTrackerAgent] 추적할 활성 이슈가 없습니다. 종료합니다.');
            return;
        }

        // 큐 기반 오케스트레이션을 활용하여 안전하게 직렬화 실행
        AiExecutionQueue.getInstance().enqueue({
            id: 'MORNING_TRACKER_ALL',
            priority: 'CRON',
            targetModel: 'local',
            task: async () => {
                for (const issue of activeIssues) {
                    await this.analyzeIssue(issue);
                }
                
                // 모든 개별 이슈 분석이 끝나고 (필요 시 Swarm 작업들이 큐에 예약된 후)
                // 파이프라인의 가장 마지막(Tail)에 텔레그램 전송 작업을 추가합니다.
                // FIFO(선입선출) 구조이므로 스웜 투표가 전부 끝난 08:35 부근에 안전하게 텔레그램이 전송됩니다.
                AiExecutionQueue.getInstance().enqueue({
                    id: 'MORNING_TRACKER_TELEGRAM',
                    priority: 'CRON',
                    targetModel: 'local',
                    task: async () => {
                        await this.sendTelegramReport();
                        eventBus.emit(SystemEvent.AGENT_KICKOFF, { agent: 'ITA_MORNING_COMPLETE', timestamp: new Date().toISOString() });
                    }
                });
            }
        });
    }

    /**
     * 개별 이슈 트래커 동작: 로컬 AI에게 상황 악화 여부 분석 요청
     */
    private async analyzeIssue(issue: any) {
        console.log(`[IssueTrackerAgent] 🔍 [${issue.name}] 단독 분석 중...`);
        const localAi = LocalAiService.getInstance();
        
        // 4-Tier 아키텍처에 따르면, 여기서 Local Data Hub(캐시)에서 뉴스를 불러와야 함.
        // 현재는 로컬 AI의 자체 추론과 이슈 컨텍스트를 활용한 분석 파이프라인으로 1차 연결.
        
        const systemPrompt = `당신은 특정 거시 경제 이슈를 전담 추적하는 파견 기자이자 '이슈 트래커(Tracker)'입니다.
과거 타임라인과 입력된 이슈 맥락, 그리고 (가상의) 간밤 뉴스 흐름을 독해하여 이슈의 현재 진행 상태를 재평가하세요.
오직 아래의 JSON 포맷으로만 깔끔하게 응답하세요. 마크다운이나 다른 설명은 덧붙이지 마세요.

{
  "summary": "상태 변화에 대한 1~2줄 브리핑 요약",
  "status": "ACTIVE" | "ESCALATING" | "FADING" | "RESOLVED",
  "severity": "S" | "A" | "B" | "C",
  "needsSwarm": true 혹은 false
}

* needsSwarm이 true가 되는 조건: 사태가 심각해져 ESCALATING으로 변하거나, 시장의 증시 방향성(상승/하락)을 재평가받아야 할 만큼 중대한 충격파가 탐지되었을 때.`;

        const userPrompt = `[추적 대상 이슈 컨텍스트]
이슈명: ${issue.name}
현재 누적 상태: ${issue.status}
현재 지정된 파급력: ${issue.severity}
이전 요약: ${issue.summary}

위 정보와 현재 밤사이 시장의 보편적 상식(혹은 수집된 뉴스 캐시)을 바탕으로 이 이슈가 시장에 미칠 위협 및 상태를 재진단(JSON)해주세요.`;

        try {
            const aiResponse = await localAi.askLocalAi(userPrompt, systemPrompt);
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.error(`[IssueTrackerAgent] JSON 파싱 실패 답변: ${aiResponse}`);
                return;
            }
            
            const result = JSON.parse(jsonMatch[0]);
            console.log(`[IssueTrackerAgent] 📝 [${issue.name}] 분석 결과: Status=${result.status}, Swarm=${result.needsSwarm}`);

            const db = IssueLedgerDB.getInstance();
            
            // 이슈 원장(상태, 심각도) 업데이트
            issue.status = result.status;
            issue.severity = result.severity;
            issue.updated_date = new Date().toISOString();
            
            db.upsertIssue(issue);
            
            // 타임라인(히스토리) 노드 추가
            db.addTimelineNode(issue.id, {
                status_snapshot: result.status,
                severity: result.severity,
                summary: result.summary,
                ai_analysis: '[IssueTracker] 08:30 Morning Scan'
            });

            // 🌟 4-Tier 라우팅 로직: 트래커가 비상 사태 선언 시 군집(Swarm) 비상 소집
            if (result.status === 'ESCALATING' || result.needsSwarm) {
                console.log(`[IssueTrackerAgent] 🚨 [${issue.name}] 사태 악화 감지! 군집 위원회(Swarm) 비상 소집 큐 등록...`);
                
                AiExecutionQueue.getInstance().enqueue({
                    id: `SWARM_${issue.id}_MORNING`,
                    priority: 'CRON',
                    targetModel: 'local',
                    task: async () => {
                        const { SwarmSimulationAgent } = await import('./SwarmSimulationAgent');
                        await SwarmSimulationAgent.getInstance().runIssueSwarm(issue.id);
                        
                        console.log(`[IssueTrackerAgent] 🏁 [${issue.name}] 군집 다수결 회의 종료.`);
                    }
                });
            }
        } catch (error) {
            console.error(`[IssueTrackerAgent] Issue ${issue.name} 분석 중 에러 발생:`, error);
        }
    }

    /**
     * 분석 및 투표가 완료된 최신 이슈 상태를 텔레그램으로 요약 전송
     */
    private async sendTelegramReport() {
        console.log('[IssueTrackerAgent] 📱 텔레그램 데일리 브리핑 조립 및 전송 시작...');
        const db = IssueLedgerDB.getInstance();
        
        // 투표 결과(swarmSummary)가 포함된 최신 장부 데이터 다시 불러오기
        const activeIssues = db.getActiveIssues();
        
        const escalatingIssues = activeIssues.filter(i => i.status === 'ESCALATING');
        const fadingIssues = activeIssues.filter(i => i.status === 'FADING');

        const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

        let message = `🚨 [V2 이슈 & 군집 데일리 브리핑]\n⏰ 기준: 오늘 오전 ${nowStr}\n\n`;

        if (escalatingIssues.length > 0) {
            message += `🔥 [사태 악화 (ESCALATING) 이슈]\n`;
            escalatingIssues.forEach((issue, idx) => {
                message += `${idx + 1}. ${issue.name} (위험도 ➡️ ${issue.severity})\n`;
                message += `   ▫️ 트래커: ${issue.summary}\n`;
                if (issue.swarmSummary) {
                    message += `   ▫️ ${issue.swarmSummary}\n`;
                }
                message += `\n`;
            });
        }

        if (fadingIssues.length > 0) {
            message += `💤 [상태 완화 (FADING) 이슈]\n`;
            fadingIssues.forEach((issue) => {
                message += `* ${issue.name} (위험도 ➡️ ${issue.severity})\n`;
                message += `   ▫️ 트래커: ${issue.summary}\n`;
                if (issue.swarmSummary) {
                     message += `   ▫️ ${issue.swarmSummary}\n`;
                }
                message += `\n`;
            });
        }

        if (escalatingIssues.length === 0 && fadingIssues.length === 0) {
            message += `✅ [특이사항 없음]\n밤사이 상태가 크게 변동되거나 악화된 글로벌 이슈가 없습니다.\n`;
        }

        try {
            const { TelegramService } = await import('../TelegramService');
            await TelegramService.getInstance().sendMessage(message);
            console.log('[IssueTrackerAgent] 📱 텔레그램 전송 완료');
        } catch (error) {
            console.error('[IssueTrackerAgent] 텔레그램 전송 실패:', error);
        }
    }
}
