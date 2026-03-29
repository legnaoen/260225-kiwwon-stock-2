import { AiService } from '../AiService'
import { AiExecutionQueue } from '../AiExecutionQueue'
import { DatabaseService } from '../DatabaseService'
import { eventBus } from '../../utils/EventBus'

export interface AgentRetrospective {
    id: number
    type: 'DAILY' | 'WEEKLY' | 'MONTHLY'
    target_period: string
    content: string
    created_at: string
}

export class MarketReviewAgent {
    private static instance: MarketReviewAgent
    private ai: AiService
    private db: DatabaseService

    private constructor() {
        this.ai = AiService.getInstance()
        this.db = DatabaseService.getInstance()
    }

    public static getInstance(): MarketReviewAgent {
        if (!MarketReviewAgent.instance) {
            MarketReviewAgent.instance = new MarketReviewAgent()
        }
        return MarketReviewAgent.instance
    }

    /**
     * Option 1: Pre-Close 일간 오답노트 작성 (15:00 실행)
     * 오늘 아침 Cycle A의 예측을 평가하고 `agent_predictions`의 feedback 컬럼에 기록
     */
    public async runPreCloseFeedback(): Promise<boolean> {
        const rawDb = (this.db as any).db;
        const dateStr = this.db.getKstDate();
        const aId = `mca_${dateStr.replace(/-/g, '')}_A`;

        const row = rawDb.prepare('SELECT predict, rationale FROM agent_predictions WHERE id = ?').get(aId);
        if (!row) {
            console.log('[MarketReview] 오늘 Cycle A 예측이 없어 Pre-Close 비판을 건너뜁니다.');
            return false;
        }

        const systemPrompt = `당신은 대한민국 거시경제 및 주식시장 트레이딩의 날카로운 퀀트 애널리스트입니다.
주요 임무: 메인 AI가 오늘 아침 개장 전(08:50)에 내렸던 시장 예측을 신랄하게 비판(Feedback)하는 것입니다.
현재 오후 3시(장마감 30분 전) 시점의 실제 장세와 아침의 예측이 일치했는지 평가하고, 내일 장을 준비하기 위한 짧고 강렬한 1~2줄짜리 오답/성공 노트를 작성하세요.
절대로 인사말이나 불필요한 서술 없이 핵심 비평만 텍스트로 즉시 출력하세요.`;

        const userPrompt = `[오늘 아침 08:50 메인 AI의 예측 내역]
판단 방향: ${row.predict}
작성 근거: ${row.rationale.substring(0, 500)}...

현재 코스피/코스닥 체감 지수와 아침의 위 근거를 대조하여, 1~2줄의 신랄한 '수정/보완 피드백'을 남겨라.`;

        console.log('[MarketReview] Pre-Close 로컬 피드백 프롬프트 전송 중...');
        try {
            const rawResponse = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'MRA_DAILY_FEEDBACK',
                agentName: '로컬 감시 스웜 (Pre-Close)',
                triggerType: 'CRON',
                targetType: 'local', // 로컬 AI 강제 호춟
                prompt: userPrompt,
                systemInstruction: systemPrompt,
            });

            // DB 업데이트 (Cycle A의 feedback 컬럼)
            rawDb.prepare('UPDATE agent_predictions SET feedback = ? WHERE id = ?').run(rawResponse.trim(), aId);
            console.log(`[MarketReview] Pre-Close 피드백(오답노트) 작성 완료: ${aId}`);
            return true;
        } catch(e: any) {
            console.error('[MarketReview] Pre-Close 피드백 생성 에러:', e.message);
            return false;
        }
    }

    /**
     * Option 2: Post-Market 일간 회고 AI (15:40 실행)
     * 오늘 하루 전체(Cycle A, B) 결과를 요약하여 Daily Retrospective 저장
     */
    public async runDailyReview(): Promise<AgentRetrospective> {
        const rawDb = (this.db as any).db;
        const dateStr = this.db.getKstDate();
        
        const rows = rawDb.prepare(`
            SELECT cycle, predict, rationale, t1_final, feedback
            FROM agent_predictions 
            WHERE date = ?
            ORDER BY cycle ASC
        `).all(dateStr) as any[];

        if (rows.length === 0) {
            throw new Error("일간 회고를 위한 오늘 예측 데이터가 없습니다.");
        }

        let logText = `[오늘(${dateStr}) 하루 동안의 AI 판단 내역]\n\n`;
        for (const r of rows) {
            logText += `사이클: ${r.cycle}\n`;
            logText += `예측방향: ${r.predict}\n`;
            logText += `작성근거: ${r.rationale.substring(0, 300)}...\n`;
            if (r.t1_final !== null) logText += `수익률: ${r.t1_final}%\n`;
            if (r.feedback) logText += `오답노트: ${r.feedback}\n`;
            logText += `\n`;
        }

        const systemPrompt = `당신은 대한민국 거시경제 및 주식시장 트레이딩의 최상위 AI 시황 전략가입니다.
당신의 역할은 오늘 하루 동안 AI 시스템이 쏟아낸 '아침 예측', '오후 예측' 로그들을 모두 훑어보고, 오늘의 가장 치명적인 실수나 중요한 시장의 변화를 포착하여 <일간 회고 리포트>를 작성하는 것입니다.

출력은 반드시 마크다운 포맷의 짧고 간결한 <일보> 형식이어야 합니다.
1. 오늘 시장 한 평 (가장 큰 이슈)
2. 오늘의 치명적 오판 / 성공 요인 (AI 판단에 대한 팩트체크)
3. 내일(T+1) 시초가를 위한 핵심 교훈 (Actionable Insight)`;

        const userPrompt = `다음은 오늘 하루 동안 기록된 매매 예측 로그입니다.\n\n${logText}\n\n위 데이터를 바탕으로 <일간 회고 리포트>를 마크다운 텍스트로 즉시 작성하라. (JSON 금지)`;

        console.log('[MarketReview] 일간 회고(Daily Retro) 로컬 프롬프트 전송 중...');
        let reportMarkdown = "분석 실패";
        try {
            reportMarkdown = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'MRA_DAILY_RETRO',
                agentName: '회고 AI (일간)',
                triggerType: 'CRON',
                targetType: 'local', // 로컬 AI 호출
                prompt: userPrompt,
                systemInstruction: systemPrompt,
            });
        } catch(e: any) {
            console.error('[MarketReview] 일간 회고 생성 에러:', e.message);
            reportMarkdown = "일간 회고 생성 실패: " + e.message;
        }

        return this.saveRetrospective('DAILY', dateStr, reportMarkdown.trim());
    }

    /**
     * 주간 회고 실행
     * 조건: 최근 5일의 Cycle 'A' 리포트만 가져와서 분석
     */
    public async runWeeklyReview(): Promise<AgentRetrospective> {
        const rawDb = (this.db as any).db
        
        // 최근 5개 Cycle A 결과 조회 (일간 오답노트 피드백 포함)
        const rows = rawDb.prepare(`
            SELECT date, predict, confidence, rationale, t1_final, feedback
            FROM agent_predictions 
            WHERE cycle = 'A'
            ORDER BY date DESC LIMIT 5
        `).all() as any[];

        if (rows.length === 0) {
            throw new Error("주간 회고를 위한 예측 데이터가 없습니다.");
        }

        const sortedRows = rows.sort((a, b) => a.date.localeCompare(b.date));
        let logText = `[지난 5일간의 실전 매매 기록 (Cycle: 장초반 A)]\n\n`;
        
        let correctCount = 0;
        let wrongCount = 0;

        for (const r of sortedRows) {
            const isCorrect = (r.predict === 'LONG' && r.t1_final > 0) || (r.predict === 'SHORT' && r.t1_final < 0);
            if (r.predict !== 'HOLD' && r.t1_final !== null) {
                if (isCorrect) correctCount++;
                else wrongCount++;
            }
            
            logText += `- 일자: ${r.date}\n`;
            logText += `  아침 예측: ${r.predict} (신뢰도 ${Math.round(r.confidence * 100)}%)\n`;
            logText += `  아침 근거: ${r.rationale}\n`;
            logText += `  실제 결과(T+1): ${r.t1_final !== null ? r.t1_final + '%' : '진행중'} -> ${isCorrect ? '✅ 적중' : (r.predict === 'HOLD' ? '관망' : '❌ 실패')}\n`;
            if (r.feedback) {
                logText += `  오후 자체평가(일간 오답노트): ${r.feedback}\n`;
            }
            logText += `\n`;
        }

        logText += `총합: ${correctCount}승 ${wrongCount}패\n`;

        const targetPeriod = `${sortedRows[0].date} ~ ${sortedRows[sortedRows.length-1].date}`;

        const systemPrompt = `당신은 대한민국 거시경제 및 주식시장 트레이딩의 최상위 AI 전략가입니다.
당신의 역할은 과거 5일간 AI가 내린 '아침 시황 예측' 로그와, 당일 장마감 시점에 스스로 작성한 '일간 오답노트(오후 자체평가)'를 함께 보고, 뼈아픈 실수와 훌륭한 성공 패턴을 분석하여 <주간 회고 리포트>를 작성하는 것입니다.

출력은 반드시 엄격한 JSON 형식으로 작성하세요:
\`\`\`json
{
  "report_markdown": "1. 주간 시장 요약 (한 줄 평)\\n2. 가장 치명적인 오판 분석\\n3. 성공 패턴 복기\\n4. 다음 주를 위한 새로운 원칙 (마크다운 텍스트로 자세히 작성)",
  "new_rules": ["RULE: 특정 지표가 0 이하일 때 무비판적으로 매수하지 않는다.", "RULE: 외인 선물 매도 시 뉴스 호재를 무시한다."]
}
\`\`\``

        const userPrompt = `다음은 지난 5일간의 오전 매매 예측 기록입니다.\n\n${logText}\n\n위 데이터를 바탕으로 이번 주 주간 회고 리포트와 새로운 시스템 룰을 JSON으로 작성하세요.`;

        console.log('[MarketReview] 주간 회고 프롬프트 전송 중...');
        const rawResponse = await AiExecutionQueue.getInstance().enqueue({
            agentId: 'MRA',
            agentName: '회고 AI (주간)',
            triggerType: 'MANUAL',
            prompt: userPrompt,
            systemInstruction: systemPrompt,
        });

        let reportMarkdown = "분석 실패"
        let newRules: string[] = []
        try {
            let jsonStr = rawResponse
            const codeBlockMatch = rawResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
            if (codeBlockMatch) jsonStr = codeBlockMatch[1]
            const parsed = JSON.parse(jsonStr)
            reportMarkdown = parsed.report_markdown || rawResponse
            newRules = parsed.new_rules || []
        } catch(e) {
            console.error('[MarketReview] JSON 파싱 에러:', e)
            reportMarkdown = rawResponse
        }

        if (newRules.length > 0) {
            const createdAt = this.db.getKstTimestamp()
            newRules.forEach(rule => {
                if (rule.trim().length > 0) {
                    rawDb.prepare(`INSERT INTO agent_rules (agent_type, rule_text, source_prediction_id, is_active, created_at) VALUES ('market_condition', ?, 'WEEKLY_REVIEW', 1, ?)`).run(rule.trim(), createdAt)
                    console.log(`[MarketReview] 신규 주간 학습 룰 등록: ${rule.trim()}`)
                }
            })
        }

        return this.saveRetrospective('WEEKLY', targetPeriod, reportMarkdown);
    }

    /**
     * 월간 회고 실행
     * 조건: 최근 4개의 'WEEKLY' 회고 본문을 요약
     */
    public async runMonthlyReview(): Promise<AgentRetrospective> {
        const rawDb = (this.db as any).db
        
        // 최근 4주 주간 회고 조회
        const rows = rawDb.prepare(`
            SELECT target_period, content
            FROM agent_retrospectives
            WHERE type = 'WEEKLY'
            ORDER BY id DESC LIMIT 4
        `).all() as any[];

        if (rows.length === 0) {
            throw new Error("월간 회고를 위한 주간 리포트가 없습니다.");
        }

        const sortedRows = rows.sort((a, b) => a.target_period.localeCompare(b.target_period));
        let logText = `[지난 4주간의 회고 기록]\n\n`;
        for (const r of sortedRows) {
            logText += `=== 주간: ${r.target_period} ===\n${r.content}\n\n`;
        }

        const monthStr = this.db.getKstDate().substring(0, 7); // yyyy-MM
        const targetPeriod = `${monthStr}월`;

        const systemPrompt = `당신은 거시경제 기반 포트폴리오 매니저입니다.
최근 4주간의 '주간 회고 리포트'들을 읽고, 거시 경제 트렌드의 거대한 변화(Structural Shift)를 분석하여 <월간 리캡 리포트>를 작성해주세요.

출력은 반드시 엄격한 JSON 형식으로 작성하세요:
\`\`\`json
{
  "report_markdown": "1. 매크로 총평\\n2. 월간 누적 오판 패턴\\n3. 다음 달 거시적 인사이트 (마크다운 텍스트)",
  "new_rules": ["RULE: 다음 달에는 환율 박스권 이탈 전까지 비중을 축소한다."]
}
\`\`\``

        const userPrompt = `아래 4주 치의 주간 회고를 종합하여 ${targetPeriod} 월간 리캡과 새로운 시스템 룰을 JSON으로 작성해라.\n\n${logText}`;

        console.log('[MarketReview] 월간 회고 프롬프트 전송 중...');
        const rawResponse = await AiExecutionQueue.getInstance().enqueue({
            agentId: 'MRA',
            agentName: '회고 AI (월간)',
            triggerType: 'MANUAL',
            prompt: userPrompt,
            systemInstruction: systemPrompt,
        });

        let reportMarkdown = "분석 실패"
        let newRules: string[] = []
        try {
            let jsonStr = rawResponse
            const codeBlockMatch = rawResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
            if (codeBlockMatch) jsonStr = codeBlockMatch[1]
            const parsed = JSON.parse(jsonStr)
            reportMarkdown = parsed.report_markdown || rawResponse
            newRules = parsed.new_rules || []
        } catch(e) {
            console.error('[MarketReview] JSON 파싱 에러:', e)
            reportMarkdown = rawResponse
        }

        if (newRules.length > 0) {
            const createdAt = this.db.getKstTimestamp()
            newRules.forEach(rule => {
                if (rule.trim().length > 0) {
                    rawDb.prepare(`INSERT INTO agent_rules (agent_type, rule_text, source_prediction_id, is_active, created_at) VALUES ('market_condition', ?, 'MONTHLY_REVIEW', 1, ?)`).run(rule.trim(), createdAt)
                    console.log(`[MarketReview] 신규 월간 학습 룰 등록: ${rule.trim()}`)
                }
            })
        }

        return this.saveRetrospective('MONTHLY', targetPeriod, reportMarkdown);
    }

    private saveRetrospective(type: 'DAILY' | 'WEEKLY' | 'MONTHLY', target_period: string, content: string): AgentRetrospective {
        const rawDb = (this.db as any).db;
        const createdAt = this.db.getKstTimestamp();
        
        try {
            rawDb.prepare(`
                INSERT INTO agent_retrospectives (type, target_period, content, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(type, target_period) DO UPDATE SET
                content = excluded.content,
                created_at = excluded.created_at
            `).run(type, target_period, content, createdAt);
        } catch (e) {
            console.error('[MarketReview] 저장 에러:', e);
        }

        const saved = rawDb.prepare(`
            SELECT * FROM agent_retrospectives WHERE type = ? AND target_period = ?
        `).get(type, target_period) as AgentRetrospective;

        return saved;
    }

    public getRetrospectives(type?: 'DAILY' | 'WEEKLY' | 'MONTHLY', limit: number = 10): AgentRetrospective[] {
        const rawDb = (this.db as any).db;
        try {
            if (type) {
                return rawDb.prepare(`
                    SELECT * FROM agent_retrospectives WHERE type = ? ORDER BY id DESC LIMIT ?
                `).all(type, limit) as AgentRetrospective[];
            } else {
                return rawDb.prepare(`
                    SELECT * FROM agent_retrospectives ORDER BY id DESC LIMIT ?
                `).all(limit) as AgentRetrospective[];
            }
        } catch {
            return [];
        }
    }
}
