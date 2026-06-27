import { DatabaseService } from '../DatabaseService';
import { AiExecutionQueue } from '../AiExecutionQueue';
import fs from 'fs';
import path from 'path';

export interface TrackRetrospectiveResult {
    success: boolean;
    skipped: boolean;
    reason?: string;
    error?: string;
}

export class TrackRetrospectiveAgent {
    private static instance: TrackRetrospectiveAgent;
    private db = DatabaseService.getInstance();

    private constructor() {
        this.initHistoryTable();
    }

    public static getInstance(): TrackRetrospectiveAgent {
        if (!TrackRetrospectiveAgent.instance) {
            TrackRetrospectiveAgent.instance = new TrackRetrospectiveAgent();
        }
        return TrackRetrospectiveAgent.instance;
    }

    /**
     * 자가학습 백업 이력 테이블 생성
     */
    private initHistoryTable() {
        const rawDb = (this.db as any).db;
        try {
            rawDb.exec(`
                CREATE TABLE IF NOT EXISTS track_self_learning_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    track TEXT NOT NULL,
                    run_date TEXT NOT NULL,
                    range_days INTEGER NOT NULL,
                    previous_guideline TEXT,
                    updated_guideline TEXT,
                    created_at TEXT NOT NULL
                )
            `);
        } catch (e) {
            console.error('[TrackRetrospectiveAgent] 히스토리 테이블 초기화 실패:', e);
        }
    }

    /**
     * 특정 파이프라인의 자가학습 실행 (수동/정기 공용)
     */
    public async runRetrospective(track: 'A' | 'B' | 'C' | 'D' | 'E', rangeDays: number = 30): Promise<TrackRetrospectiveResult> {
        console.log(`[TrackRetrospectiveAgent] 🚀 Track ${track} 자가학습 가동 (학습 범위: 최근 ${rangeDays}일)...`);
        
        const rawDb = (this.db as any).db;
        const tableName = `track_${track.toLowerCase()}_buy_picks`;
        const todayStr = new Date().toISOString().substring(0, 10);

        try {
            // 1. 만료 청산 완료된 픽 조회
            const picks = rawDb.prepare(`
                SELECT * FROM ${tableName} 
                WHERE status = 'CLOSED' 
                  AND exit_date >= date('now', ?)
                ORDER BY exit_date DESC
            `).all(`-${rangeDays} days`) as any[];

            // 성공/실패 분류
            const fails = picks.filter(p => p.result === 'LOSS' || p.final_return < 0);
            const successes = picks.filter(p => p.result === 'HIT' || p.final_return >= p.target_return_pct);

            console.log(`[TrackRetrospectiveAgent] Track ${track} 수집 픽수: 총 ${picks.length}개 (성공: ${successes.length}개, 실패: ${fails.length}개)`);

            // [Noise Guard]: 실패 데이터가 최소 3건 이상 쌓였을 때만 오답노트 개정 진행
            if (fails.length < 3) {
                const skipMsg = `실패 사례 수 부족 (최근 ${rangeDays}일 내 ${fails.length}건, 최소 3건 필요)`;
                console.log(`[TrackRetrospectiveAgent] 🛡️ [Noise Guard] Track ${track} 자가학습 건너뜀 - ${skipMsg}`);
                return { success: true, skipped: true, reason: skipMsg };
            }

            // 2. 카테고리/테마별 실패 통계 요약 (Frequency Guard)
            const categoryStats: Record<string, number> = {};
            fails.forEach(f => {
                const cat = f.category || 'UNKNOWN';
                categoryStats[cat] = (categoryStats[cat] || 0) + 1;
            });
            const statsSummary = Object.entries(categoryStats)
                .map(([cat, cnt]) => `- ${cat} 카테고리: ${cnt}회 실패`)
                .join('\n');

            // 3. 기존 guidelines/track_x_phase2.md 지침 파일 로드 및 파싱 (과거 학습 참고용)
            const guidelinePath = path.join(process.cwd(), 'guidelines', `track_${track.toLowerCase()}_phase2.md`);
            let fileContent = '';
            if (fs.existsSync(guidelinePath)) {
                fileContent = fs.readFileSync(guidelinePath, 'utf-8');
            }

            // 구분자 기준으로 헤더 지침과 기존 AI 절대 규칙 분리
            const delimiterRegex = /^(?:##+|###+)\s*🚨\s*\[AI\s*자동\s*오답노트\s*&\s*회피\s*패턴\].*$/mi;
            const delimiter = '## 🚨 [AI 자동 오답노트 & 회피 패턴]';
            
            const match = fileContent.match(delimiterRegex);
            let header = fileContent.trim();
            let existingRules = '';
            
            if (match && match.index !== undefined) {
                header = fileContent.substring(0, match.index).trim();
                existingRules = fileContent.substring(match.index + match[0].length).trim();
            }

            // 4. LLM 피드백 프롬프트 빌드
            const systemPrompt = `당신은 대한민국 코스피/코스닥 모의투자 알고리즘의 투자 지침을 수정하고 실효성을 감사하는 감사관입니다.
담당 파이프라인(Track ${track})의 최근 매매 결과와 과거 오답노트를 정밀 대조하여 오답노트를 업데이트하십시오.

[기존 수립 규칙]
${existingRules || '수립된 규칙 없음'}

[최근 실패 통계 분포 (노이즈 필터링용)]
${statsSummary}

[최근 매수 성공 사례 (HIT - 목표수익 도달)]
${successes.slice(0, 5).map(s => `- 종목: ${s.stock_name}(${s.stock_code}) / 수익: +${s.final_return.toFixed(1)}% / 근거: ${s.reason}`).join('\n') || '사례 없음'}

[최근 매수 실패 사례 (LOSS - 손실 청산)]
${fails.slice(0, 5).map(f => `- 종목: ${f.stock_name}(${f.stock_code}) / 수익: ${f.final_return.toFixed(1)}% / 근거: ${f.reason} / 경고 리스크: ${f.risk}`).join('\n')}

임무 (규칙 성적 검증 및 보완 프레임워크):
1. [기존 규칙의 실효성 평가]: 최근 실패 사례(LOSS)들을 기존 수립 규칙과 대조하십시오.
   - **위반 실패**: 기존 규칙을 어기고 진입해서 실패한 종목이 있다면, 그 규칙의 중요성을 경고하고 규칙의 표현을 더욱 명확하고 강제력 있게 격상시키십시오.
   - **준수 실패**: 기존 규칙을 성실히 지켰음에도 불구하고 실패한 종목이 있다면, 기존 규칙 자체에 허점이 있는 것입니다. 규칙을 폐기하기보다 "단, ~할 때는 제외한다"와 같은 정밀한 예외 조건(Conditioning)을 덧붙여 규칙을 보완하십시오.
2. [과도한 매수 제한 검토]: 만약 최근 성공 사례가 거의 없고 연속적으로 0종목 매수(관망)만 유지되고 있다면, 기존 규칙이 주가를 지나치게 보수적으로 옭아매고 있지는 않은지 검토하여 합리적으로 허들을 완화하십시오.
3. [단순화 및 캡 적용]: 규칙의 개수는 중요도 순으로 **최대 5개**로 제한하며, 유사하거나 상충되는 규칙은 과감하게 하나로 병합하여 지침이 무한히 쌓이지 않도록 통제하십시오.

출력 형식 (반드시 아래 마크다운 형식으로만 JSON 없이 텍스트로 출력하십시오):
## 🚨 [AI 자동 오답노트 & 회피 패턴] (최종 갱신: {날짜})
* **실패 분석 요약**: [과거 규칙 실효성 분석 및 보완 결과 2줄 요약]
* **절대 규칙 1**: [규칙 내용]
* **절대 규칙 2**: ...`;

            console.log(`[TrackRetrospectiveAgent] Track ${track} LLM 회고 큐 진입...`);
            const newRules = await AiExecutionQueue.getInstance().enqueue({
                agentId: `TRACK_${track}_RETROSPECTIVE`,
                agentName: `Track ${track} 자가학습 에이전트`,
                triggerType: 'CRON',
                prompt: systemPrompt,
            });

            if (!newRules) {
                throw new Error('LLM으로부터 회고 결과를 받지 못했습니다.');
            }

            // 5. 지침 파일 업데이트
            const resolvedRules = newRules.replace('{날짜}', todayStr);
            const updatedContent = `${header}\n\n${resolvedRules}\n`;
            
            // guidelines 디렉토리 확인
            const guidelinesDir = path.dirname(guidelinePath);
            if (!fs.existsSync(guidelinesDir)) {
                fs.mkdirSync(guidelinesDir, { recursive: true });
            }
            
            fs.writeFileSync(guidelinePath, updatedContent, 'utf-8');
            console.log(`[TrackRetrospectiveAgent] 💾 Track ${track} 지침서 업데이트 완료: ${guidelinePath}`);

            // 6. DB 백업 아카이빙
            rawDb.prepare(`
                INSERT INTO track_self_learning_history (track, run_date, range_days, previous_guideline, updated_guideline, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(track, todayStr, rangeDays, fileContent, updatedContent, new Date().toISOString());

            return { success: true, skipped: false };

        } catch (e: any) {
            console.error(`[TrackRetrospectiveAgent] Track ${track} 자가학습 실패:`, e);
            return { success: false, skipped: false, error: e.message };
        }
    }
}
