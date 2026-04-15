import Store from 'electron-store';
import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { IssueLedgerDB } from './IssueLedgerDB';
import { eventBus } from '../../utils/EventBus';

const _store = new Store();

const MEGA_THEME_AI_CONFIG_KEY = 'mega_theme_ai_config';

export interface MegaThemeAiConfig {
    targetType: 'gemini' | 'local';
}

export function getMegaThemeAiConfig(): MegaThemeAiConfig {
    const saved = _store.get(MEGA_THEME_AI_CONFIG_KEY) as MegaThemeAiConfig | null;
    return { targetType: saved?.targetType || 'gemini' };
}

export function setMegaThemeAiConfig(config: MegaThemeAiConfig): void {
    _store.set(MEGA_THEME_AI_CONFIG_KEY, config);
}

/**
 * ThemeContextBuilder v2 — 메가 테마 집계 엔진 (개편)
 *
 * ◆ 핵심 원칙
 *   1. 당일 데이터만 분석 (과거 Backfill 폐지)
 *   2. AI reason(상승 사유) 기반 클러스터링 (네이버 테마명 아님)
 *   3. 기존 메가 테마 사전 참조 → MERGE / RELATE / CREATE / NO_GROUP
 *   4. 서브 테마는 오늘 포착분만 증분 추가
 *   5. 10일 누적 스코어로 진짜 주도 테마 식별
 *
 * ◆ MERGE 기준 (엄격)
 *   - 대장주 Jaccard ≥ 0.7, 또는 reason이 사실상 동일한 경우만
 *
 * ◆ RELATE
 *   - 같은 상위 트리거에서 파생됐지만 종목군이 다른 경우
 *   - knowledge_edges 테이블에 엣지 기록
 */
export class ThemeContextBuilder {
    private static instance: ThemeContextBuilder;
    private db: DatabaseService;

    private static readonly FADING_AFTER_DAYS  = 3;
    private static readonly DORMANT_AFTER_DAYS = 7;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): ThemeContextBuilder {
        if (!ThemeContextBuilder.instance) {
            ThemeContextBuilder.instance = new ThemeContextBuilder();
        }
        return ThemeContextBuilder.instance;
    }

    // ─── 메인 진입점 ─────────────────────────────────────────────────────────

    /**
     * 매일 1회 실행: 당일 데이터만 분석 (Backfill 불필요)
     */
    public async runDaily(): Promise<{ processed: number; mode: string }> {
        const raw = (this.db as any).db;
        const row = raw.prepare(`
            SELECT MAX(date) as latest FROM naver_market_flow WHERE type = 'THEME'
        `).get() as { latest: string } | undefined;

        if (!row?.latest) {
            console.warn('[ThemeContextBuilder] naver_market_flow 데이터 없음');
            return { processed: 0, mode: 'daily' };
        }

        console.log(`[ThemeContextBuilder] 당일 분석 시작: ${row.latest}`);
        await this.processDate(raw, row.latest);
        return { processed: 1, mode: 'daily' };
    }

    // ─── 날짜별 처리 ─────────────────────────────────────────────────────────

    private async processDate(raw: any, date: string): Promise<void> {
        // Step 1: 당일 테마 + reason 조립
        const todayThemes = this.loadTodayThemes(raw, date);
        if (!todayThemes.length) {
            console.warn(`[ThemeContextBuilder] ${date}: 테마 데이터 없음`);
            return;
        }

        // Step 2: 기존 메가 테마 사전 로드 (활성 항목만)
        const existingLedger = this.loadActiveLedger(raw);

        // Step 3: AI 클러스터링 (reason 기반, 1회 호출)
        const aiResult = await this.clusterWithAI(todayThemes, existingLedger, date);
        if (!aiResult) return;

        // Step 4: DB 반영 (MERGE / CREATE / NO_GROUP)
        await this.applyAiResult(raw, aiResult, date, todayThemes);

        // Step 5: RELATE → knowledge_edges 적재
        this.processRelations(raw, aiResult, date);

        // Step 6: 미등장 테마 상태 갱신 (FADING / DORMANT)
        this.updateMissingThemes(raw, date, todayThemes.map(t => t.name));

        // Step 7: 누적 스코어 갱신
        this.updateCumulativeScores(raw);

        console.log(`[ThemeContextBuilder] ✅ ${date} 처리 완료`);
        eventBus.emit('MEGA_THEME_PROGRESS' as any, { step: 'DONE', detail: `${date} 메가 테마 갱신 완료` });
    }

    // ─── Step 1: 당일 테마 + reason 조립 ───────────────────────────────────

    private loadTodayThemes(raw: any, date: string): TodayTheme[] {
        const flows = raw.prepare(`
            SELECT name, rank_num, change_rate
            FROM naver_market_flow
            WHERE date = ? AND type = 'THEME' AND rank_num <= 20
            ORDER BY rank_num ASC
        `).all(date) as { name: string; rank_num: number; change_rate: number }[];

        return flows.map(f => {
            const intel = raw.prepare(`
                SELECT reason FROM theme_intelligence
                WHERE name = ? AND date <= ?
                ORDER BY date DESC LIMIT 1
            `).get(f.name, date) as { reason: string } | undefined;

            // 소속 종목 코드 (Jaccard용)
            const stocks = raw.prepare(`
                SELECT stock_code FROM stock_theme_tags WHERE tag_name = ?
            `).all(f.name) as { stock_code: string }[];

            return {
                name: f.name,
                rank_num: f.rank_num,
                change_rate: f.change_rate,
                reason: intel?.reason || '',
                stock_codes: new Set(stocks.map(s => s.stock_code)),
            };
        });
    }

    // ─── Step 2: 기존 활성 메가 테마 사전 로드 ──────────────────────────────

    private loadActiveLedger(raw: any): LedgerEntry[] {
        return raw.prepare(`
            SELECT mega_theme_name, sub_themes_json, core_narrative, status, first_seen_date, alive_days, daily_log_json
            FROM mega_theme_ledger
            WHERE status NOT IN ('DORMANT')
            ORDER BY ranking_score DESC
        `).all() as LedgerEntry[];
    }

    // ─── Step 3: AI 클러스터링 (reason 기반) ─────────────────────────────────

    private async clusterWithAI(
        todayThemes: TodayTheme[],
        existingLedger: LedgerEntry[],
        date: string
    ): Promise<AiClusterResult | null> {

        // 프롬프트 조립: 당일 테마 목록
        const themeListText = todayThemes.map((t, i) =>
            `${i + 1}. [${t.name}] 순위:${t.rank_num}위 | 등락:+${t.change_rate}%\n   상승사유: ${t.reason || '(분석 없음)'}`
        ).join('\n\n');

        // 프롬프트 조립: 기존 메가 테마 사전
        const ledgerText = existingLedger.length > 0
            ? existingLedger.map(l => {
                const subs = this.safeJson<{ name: string }[]>(l.sub_themes_json, []).map(s => s.name).join(', ');
                return `- ID: "${l.mega_theme_name}" | 현재사유: "${(l.core_narrative || '').slice(0, 80)}" | 서브: [${subs}]`;
            }).join('\n')
            : '(현재 활성 메가 테마 없음)';

        const prompt = `당신은 증권사 테마 애널리스트입니다.
오늘(${date}) 시장에서 Top20에 등장한 테마들을 분석하여 메가 테마로 분류하십시오.

[오늘 포착된 테마 목록]
${themeListText}

[기존 메가 테마 사전 (현재 활성 중인 항목)]
${ledgerText}

---
[판단 지침 - 필독🚨 위반 시 분석 무효]

━━━ 기본 철학 ━━━
메가 테마의 목적은 "네이버 테마명이 달라도 실제 투자 대상(종목)과 상승 사유가 완전히 동일한 것"을 묶는 것입니다.
"넓게 묶어서 큰 그림을 보자"가 아닙니다. 하나의 메가 테마는 하나의 뾰족한 투자 아이디어여야 합니다.

━━━ (1) MERGE 기준 — 극도로 엄격히 적용 ━━━
아래 조건을 "모두" 충족해야만 MERGE 가능합니다:
  ✅ 조건 A: 두 테마의 핵심 수혜 종목이 80% 이상 동일 (사실상 같은 종목군)
  ✅ 조건 B: 상승 사유(reason)의 핵심 키워드가 동일 (단어 하나 공유가 아닌, 문장의 핵심 로직이 동일)
  ✅ 조건 C: 네이버 테마명이 실질적 동의어 수준임 (예: "2차전지" = "전기차배터리")

⛔ MERGE 금지 사례 (이런 경우는 반드시 별도 CREATE 또는 NO_GROUP):
  - "둘 다 AI 관련이다" → AI 관련 테마는 세부 사유가 완전히 다름
  - "둘 다 첨단기술이다" → 기술 분야가 같다고 같은 테마가 아님
  - "광통신 + 통신장비" → 광케이블 기업 ≠ 네트워크 장비 기업, 별도 테마
  - "5G + 무선충전 + 갤럭시 부품주" → 완전히 다른 투자 아이디어임
  - "양자컴퓨팅 + 코로나19(음압병실)" → 사유가 다름, 절대 같은 메가 테마 불가
  - "삼성페이 + 유심(USIM) + 카메라모듈" → 단지 삼성 관련이라는 이유만으로 묶지 말 것

⚠️ 하나의 MERGE 그룹(today_sub_themes)에 최대 3개까지만 포함 가능합니다.
   4개 이상을 묶으려 한다면 반드시 쪼개어 각각 CREATE 또는 NO_GROUP으로 처리하십시오.

━━━ (2) RELATE ━━━
- 같은 상위 트리거(예: AI 데이터센터 투자 확대)에서 파생됐지만 종목군이 다른 경우
- 예: "광통신" RELATE "통신장비" → 같은 5G 인프라 수요지만 투자 종목이 다름
- MERGE가 안 되는 테마 쌍에만 사용하십시오.

━━━ (3) CREATE ━━━
- 기존 사전에 없는 내러티브일 때 사용
- 테마명: 10자 이내, 핵심 투자 아이디어 (예: "AI 냉각솔루션", "K-방산 수주", "전기차 배터리")
- 절대 금지 단어: "첨단", "고도화", "강화", "인프라 전반", "연결성", "신산업", "산업재"
- 하나의 CREATE 그룹에 최대 2개 서브 테마까지만 허용 (동의어 수준에서만)
- core_narrative 작성 규칙 (매우 중요):
  ★ 향후 다른 AI 에이전트가 이 텍스트만 보고도 어떤 종목군이고 왜 오르는지 완벽히 이해할 수 있도록 충분히 구체적으로 작성할 것.
  ★ 형식: "[핵심 키워드] 2~3줄의 구체적 설명" (예: "[데이터센터 전력난] AI 데이터센터 확충에 따라 전력 부족 우려가 커지면서 관련 인프라 기업 수혜 예상")
  ★ 반드시 위에서 제공된 "상승사유(reason)" 텍스트 내용만을 포함해야 함
  ★ AI가 스스로 연결고리를 상상하여 지어내는 것은 절대 금지 (원문 팩트 기반)
  ★ reason이 없거나 빈 문자열인 경우 → CREATE 금지, NO_GROUP으로 처리

━━━ (4) NO_GROUP ━━━
- 위 기준을 충족하지 못하는 모든 독립 테마 → 개별 NO_GROUP으로 처리
- 의심스러우면 NO_GROUP. "관련 있을 것 같다"는 추측으로 그룹화하지 말 것
- CREATE/MERGE 하고 싶은 충동이 생기면 MERGE 금지 사례를 다시 확인하라

━━━ 자체 검증 (출력 전 반드시 확인) ━━━
출력 전 스스로 각 그룹을 아래 질문으로 검증하십시오:
  Q1. "이 그룹의 종목에 투자하는 펀드매니저가 같을까?" → NO면 쪼개라
  Q2. "종목 교집합이 80% 이상인가?" → NO면 절대 MERGE 금지
  Q3. "하나의 그룹에 3개 이상 테마가 있지는 않은가?" → YES면 쪼개라
  Q4. "core_narrative가 구체적이고 디테일한가?" → NO면 다시 작성하라


오직 아래 JSON 형식만 출력하십시오. (백틱 금지)

{
  "mega_clusters": [
    {
      "action": "MERGE",
      "target_mega_id": "기존 mega_theme_name 값",
      "merge_reason": "왜 이것이 같은 테마인지 한 줄",
      "updated_narrative": "[키워드] 업데이트된 상세 설명 (reason 기반 2~3줄)",
      "today_sub_themes": ["테마명1", "테마명2"]
    },
    {
      "action": "RELATE",
      "source_theme": "테마명A",
      "target_theme": "테마명B",
      "relation": "CORRELATES",
      "logical_path": "인과 경로 설명",
      "confidence": 0.75
    },
    {
      "action": "CREATE",
      "mega_name": "새 메가 테마명 (10자 이내)",
      "core_narrative": "[키워드] 매우 상세한 사유 설명 (reason 원문 기반 2~3줄, AI 상상 금지)",
      "today_sub_themes": ["테마명"]
    },
    {
      "action": "NO_GROUP",
      "today_sub_themes": ["테마명"]
    }
  ]
}`;

        const { targetType } = getMegaThemeAiConfig();
        let response = '';
        let parsed: AiClusterResult | null = null;
        let lastError = '';
        
        // --- [Stage 1 & Stage 2] 자가 교정 루프 (최대 1회 재시도) ---
        const MAX_RETRIES = 1;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                let currentPrompt = prompt;
                if (attempt > 0) {
                    eventBus.emit('MEGA_THEME_PROGRESS' as any, { step: 'AI_CALL', detail: `[AI 자가 복구] 파싱 오류 교정 중... (${attempt}/${MAX_RETRIES})` });
                    currentPrompt = `당신이 이전에 출력한 텍스트에서 JSON 파싱 에러("${lastError}")가 발생했습니다.\n형식을 수정한 완벽한 JSON만 다시 출력하십시오.\n\n[이전 출력]\n${response}\n\n---\n${prompt}`;
                } else {
                    eventBus.emit('MEGA_THEME_PROGRESS' as any, { step: 'AI_CALL', detail: `[AI 클러스터링] reason 기반 분류 중... (${date})` });
                }

                response = await AiExecutionQueue.getInstance().enqueue({
                    agentId: 'MEGA_THEME_CLUSTER',
                    agentName: '메가 테마 클러스터링',
                    triggerType: 'CRON',
                    targetType,
                    prompt: currentPrompt,
                    systemInstruction: '당신은 증권사 테마 애널리스트입니다. 반드시 JSON만 출력하십시오.',
                });

                // [Stage 1] 1차 텍스트 교정 및 Sanitizing
                let clean = response.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1').trim();
                const match = clean.match(/\{[\s\S]*\}/);
                if (match) clean = match[0];
                clean = clean.replace(/,\s*([\]}])/g, '$1'); // 후행 쉼표 제거

                try {
                    parsed = JSON.parse(clean) as AiClusterResult;
                } catch (parseErr: any) {
                    // 불완전 종료 보완 (Missing closing brackets)
                    try { parsed = JSON.parse(clean + '}'); } 
                    catch (e2) {
                        try { parsed = JSON.parse(clean + ']}'); }
                        catch (e3) { throw parseErr; }
                    }
                }

                if (!parsed?.mega_clusters) throw new Error('mega_clusters 필드 없음');
                break; // 성공 시 루프 탈출
                
            } catch (err: any) {
                lastError = err.message;
                console.warn(`[TCB] AI 파싱/응답 실패 (시도 ${attempt+1}):`, lastError);
            }
        }

        // --- [Stage 3] 하위 호환 안전장치 - Gemini Fallback 전환 ---
        if (!parsed && targetType === 'local') {
            try {
                console.log(`[TCB] 로컬 AI 문법 파괴 지속. Gemini Fallback 모드로 전환하여 시도합니다.`);
                eventBus.emit('MEGA_THEME_PROGRESS' as any, { step: 'AI_CALL', detail: `[비상 가동] 로컬 AI 오류로 Gemini Fallback 투입...` });
                
                response = await AiExecutionQueue.getInstance().enqueue({
                    agentId: 'MEGA_THEME_CLUSTER',
                    agentName: '메가 테마 클러스터링 (Fallback)',
                    triggerType: 'CRON',
                    targetType: 'gemini', // 강제 전환
                    prompt: prompt,
                    systemInstruction: '당신은 증권사 테마 애널리스트입니다. 반드시 JSON만 출력하십시오.',
                });
                
                let clean = response.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1').trim();
                const match = clean.match(/\{[\s\S]*\}/);
                if (match) clean = match[0];
                clean = clean.replace(/,\s*([\]}])/g, '$1');
                
                parsed = JSON.parse(clean) as AiClusterResult;
                if (!parsed?.mega_clusters) throw new Error('mega_clusters 필드 없음');
                
                console.log(`[TCB] ✅ Gemini Fallback 성공`);
            } catch (fallbackErr: any) {
                console.error(`[TCB] ❌ Gemini Fallback 최종 실패:`, fallbackErr.message);
            }
        }

        if (!parsed) {
            console.error('[ThemeContextBuilder] 클러스터링 모든 시도 실패. DB 반영을 스킵합니다.');
            eventBus.emit('MEGA_THEME_PROGRESS' as any, { step: 'AI_DONE', detail: `❌ AI 분류 최종 실패 (JSON Broken)` });
            return null;
        }

        try {
            // ── 코드 레벨 강제 캡 (AI 무시 방어) ─────────────────────────────
            // 3개 이상 서브 테마를 묶은 그룹은 자동으로 NO_GROUP으로 분리
            const MAX_SUB_THEMES = 2;
            const enforced: AiClusterAction[] = [];
            for (const cluster of parsed.mega_clusters) {
                const subs = cluster.today_sub_themes ?? [];
                if ((cluster.action === 'MERGE' || cluster.action === 'CREATE') && subs.length > MAX_SUB_THEMES) {
                    console.warn(`[TCB] ⚠️ 과도 통합 차단: "${cluster.mega_name ?? cluster.target_mega_id}" (${subs.length}개 → NO_GROUP 분리)`);
                    enforced.push({ action: 'NO_GROUP', today_sub_themes: subs });
                } else {
                    enforced.push(cluster);
                }
            }
            parsed.mega_clusters = enforced;
            // ─────────────────────────────────────────────────────────────────

            eventBus.emit('MEGA_THEME_PROGRESS' as any, { step: 'AI_DONE', detail: `✅ AI 클러스터링 완료: ${parsed.mega_clusters.length}개 액션` });
            return parsed;

        } catch (err: any) {
            console.error('[ThemeContextBuilder] 클러스터링 후처리 실패:', err.message);
            return null;
        }
    }

    // ─── Step 4: DB 반영 ─────────────────────────────────────────────────────

    private async applyAiResult(raw: any, result: AiClusterResult, date: string, todayThemes: TodayTheme[]): Promise<void> {
        const nowStr = new Date().toISOString();

        for (const cluster of result.mega_clusters) {
            if (cluster.action === 'RELATE') continue; // RELATE는 별도 처리

            try {
                if (cluster.action === 'MERGE' && cluster.target_mega_id) {
                    await this.applyMerge(raw, cluster, date, nowStr, todayThemes);
                } else if (cluster.action === 'CREATE' && cluster.mega_name) {
                    await this.applyCreate(raw, cluster, date, nowStr, todayThemes);
                } else if (cluster.action === 'NO_GROUP') {
                    // 단독 테마 → 개별 레코드로 저장 (메가 미분류이지만 UI에 표시)
                    for (const themeName of (cluster.today_sub_themes || [])) {
                        const todayTheme = todayThemes.find(t => t.name === themeName);
                        await this.applyStandalone(raw, themeName, date, nowStr, todayTheme);
                    }
                }
            } catch (err: any) {
                console.error(`[TCB] applyAiResult 오류 (${cluster.action}):`, err.message);
            }
        }
    }

    private async applyMerge(raw: any, cluster: AiClusterAction, date: string, nowStr: string, todayThemes: TodayTheme[] = []): Promise<void> {
        const existing = raw.prepare(`
            SELECT * FROM mega_theme_ledger WHERE mega_theme_name = ?
        `).get(cluster.target_mega_id) as any;

        if (!existing) {
            console.warn(`[TCB] MERGE 대상 없음: ${cluster.target_mega_id} → CREATE로 전환`);
            await this.applyCreate(raw, {
                ...cluster,
                action: 'CREATE',
                mega_name: cluster.target_mega_id!,
                core_narrative: cluster.updated_narrative || '',
                catalyst_type: 'EVENT',
            }, date, nowStr, todayThemes);
            return;
        }

        // 서브 테마 증분 추가
        const prevSubs = this.safeJson<SubThemeEntry[]>(existing.sub_themes_json || '[]', []);
        const updatedSubs = this.mergeSubThemes(prevSubs, cluster.today_sub_themes || [], date);

        // 당일 실제 rank/power 기반 로그
        const { topRank, combinedPower, topStocks } = this.calcDayStats(raw, cluster.today_sub_themes || [], date, todayThemes);
        const prevLog = this.safeJson<LogEntry[]>(existing.daily_log_json || '[]', []);
        const newLog = this.appendLog(prevLog, date.slice(5), topRank, combinedPower);

        const aliveDays = this.calcAliveDays(existing.first_seen_date, date);
        const status = this.determineStatus(existing, aliveDays);
        const rankingScore = this.calcCumulativeScore(newLog, aliveDays, status);

        raw.prepare(`
            UPDATE mega_theme_ledger SET
                sub_themes_json = ?,
                core_narrative = ?,
                last_seen_date = ?,
                alive_days = ?,
                status = ?,
                ranking_score = ?,
                daily_log_json = ?,
                current_top_rank = ?,
                current_combined_power = ?,
                peak_combined_power = MAX(COALESCE(peak_combined_power, 0), ?),
                selected_stocks_json = ?,
                updated_at = ?
            WHERE mega_theme_name = ?
        `).run(
            JSON.stringify(updatedSubs),
            this.appendNarrative(existing.core_narrative, cluster.updated_narrative, date),
            date,
            aliveDays,
            status,
            rankingScore,
            JSON.stringify(newLog),
            topRank,
            combinedPower,
            combinedPower,
            JSON.stringify(topStocks),
            nowStr,
            cluster.target_mega_id,
        );

        // 흡수된 서브 테마들의 독립 레코드 정리
        for (const subName of (cluster.today_sub_themes || [])) {
            if (subName === cluster.target_mega_id) continue;
            const dup = raw.prepare(`SELECT mega_theme_name FROM mega_theme_ledger WHERE mega_theme_name = ?`).get(subName);
            if (dup) {
                raw.prepare(`DELETE FROM mega_theme_ledger WHERE mega_theme_name = ?`).run(subName);
                console.log(`[TCB] 🗑️ 흡수 삭제: "${subName}" → "${cluster.target_mega_id}"`);
            }
        }

        console.log(`[TCB] MERGE: "${(cluster.today_sub_themes || []).join(', ')}" → "${cluster.target_mega_id}" (${status}/${aliveDays}일, 파워:${combinedPower.toFixed(1)}%)`);
    }

    private async applyCreate(raw: any, cluster: AiClusterAction, date: string, nowStr: string, todayThemes: TodayTheme[] = []): Promise<void> {
        const megaName = cluster.mega_name!;

        const existing = raw.prepare(`SELECT * FROM mega_theme_ledger WHERE mega_theme_name = ?`).get(megaName) as any;
        if (existing) {
            await this.applyMerge(raw, {
                ...cluster,
                action: 'MERGE',
                target_mega_id: megaName,
                updated_narrative: cluster.core_narrative,
            }, date, nowStr, todayThemes);
            return;
        }

        const subThemes: SubThemeEntry[] = (cluster.today_sub_themes || []).map(name => ({ name, added_date: date }));
        const firstSeen = this.findFirstSeenDate(raw, cluster.today_sub_themes || [], date);
        const aliveDays = this.calcAliveDays(firstSeen, date);

        const { topRank, combinedPower, topStocks } = this.calcDayStats(raw, cluster.today_sub_themes || [], date, todayThemes);
        const log: LogEntry[] = [{ date: date.slice(5), rank: topRank, power: combinedPower }];
        // alive_days 기반으로 초기 상태 결정 (17일이면 DOMINANT, 3일이면 STRONG, 이하 EMERGING)
        const initialStatus = this.determineStatus(null, aliveDays);
        const rankingScore = this.calcCumulativeScore(log, aliveDays, initialStatus);

        this.db.upsertMegaThemeLedger({
            mega_theme_name:        megaName,
            sub_themes_json:        JSON.stringify(subThemes),
            core_narrative:         this.appendNarrative(null, cluster.core_narrative, date),
            catalyst_type:          'EVENT',
            first_seen_date:        firstSeen,
            last_seen_date:         date,
            alive_days:             aliveDays,
            peak_combined_power:    combinedPower,
            current_combined_power: combinedPower,
            current_top_rank:       topRank,
            ranking_score:          rankingScore,
            entry_timing:           'WATCH',
            selected_stocks_json:   JSON.stringify(topStocks),
            status:                 initialStatus,
            daily_log_json:         JSON.stringify(log),
            updated_at:             nowStr,
        });

        console.log(`[TCB] CREATE: "${megaName}" (${initialStatus}/${aliveDays}일, 파워:${combinedPower.toFixed(1)}%)`);
    }

    /** NO_GROUP 테마를 단독 레코드로 저장 (UI 표시용) */
    private async applyStandalone(raw: any, themeName: string, date: string, nowStr: string, todayTheme?: TodayTheme): Promise<void> {
        const rank      = todayTheme?.rank_num     ?? 20;
        const power     = todayTheme?.change_rate  ?? 0;
        const subThemes: SubThemeEntry[] = [{ name: themeName, added_date: date }];
        const firstSeen = this.findFirstSeenDate(raw, [themeName], date);
        const aliveDays = this.calcAliveDays(firstSeen, date);

        const stocks = this.getTopStocksForTheme(raw, themeName);
        const existing = raw.prepare(`SELECT * FROM mega_theme_ledger WHERE mega_theme_name = ?`).get(themeName) as any;

        if (existing) {
            // 이미 있으면 last_seen / 로그만 갱신
            const prevLog = this.safeJson<LogEntry[]>(existing.daily_log_json || '[]', []);
            const newLog  = this.appendLog(prevLog, date.slice(5), rank, power);
            const newStatus = this.determineStatus(existing, aliveDays);
            const score = this.calcCumulativeScore(newLog, aliveDays, newStatus);
            raw.prepare(`
                UPDATE mega_theme_ledger SET
                    last_seen_date = ?, alive_days = ?, status = ?,
                    ranking_score = ?, daily_log_json = ?,
                    current_top_rank = ?, current_combined_power = ?,
                    selected_stocks_json = ?, updated_at = ?
                WHERE mega_theme_name = ?
            `).run(date, aliveDays, newStatus, score, JSON.stringify(newLog),
                   rank, power, JSON.stringify(stocks), nowStr, themeName);
        } else {
            const log: LogEntry[] = [{ date: date.slice(5), rank, power }];
            // alive_days 기반 실제 상태 계산 (17일이면 DOMINANT, 3일+ STRONG, 미만 EMERGING)
            const initialStatus = this.determineStatus(null, aliveDays);
            const score = this.calcCumulativeScore(log, aliveDays, initialStatus);
            this.db.upsertMegaThemeLedger({
                mega_theme_name:        themeName,
                sub_themes_json:        JSON.stringify(subThemes),
                core_narrative:         this.appendNarrative(null, todayTheme?.reason, date),
                catalyst_type:          'EVENT',
                first_seen_date:        firstSeen,
                last_seen_date:         date,
                alive_days:             aliveDays,
                peak_combined_power:    power,
                current_combined_power: power,
                current_top_rank:       rank,
                ranking_score:          score,
                entry_timing:           'WATCH',
                selected_stocks_json:   JSON.stringify(stocks),
                status:                 initialStatus,
                daily_log_json:         JSON.stringify(log),
                updated_at:             nowStr,
            });
        }
        console.log(`[TCB] STANDALONE: "${themeName}" (${rank}위, +${power}%)`);
    }

    // ─── Step 5: RELATE → knowledge_edges 적재 ──────────────────────────────

    private processRelations(raw: any, result: AiClusterResult, date: string): void {
        let count = 0;
        const ledger = IssueLedgerDB.getInstance();

        for (const cluster of result.mega_clusters) {
            if (cluster.action !== 'RELATE') continue;
            if (!cluster.source_theme || !cluster.target_theme) continue;

            try {
                ledger.upsertEdge({
                    source_type:  'THEME',
                    source_id:    cluster.source_theme,
                    target_type:  'THEME',
                    target_id:    cluster.target_theme,
                    relation:     cluster.relation || 'CORRELATES',
                    confidence:   cluster.confidence ?? 0.7,
                    logical_path: cluster.logical_path || undefined,
                    created_by:   'MEGA_THEME_AI',
                });
                count++;
            } catch (err: any) {
                console.error('[TCB] knowledge_edges 적재 실패:', err.message);
            }
        }

        if (count > 0) console.log(`[TCB] 🕸️ 연관 엣지 ${count}개 적재 완료`);
    }

    // ─── Step 6: 미등장 테마 상태 갱신 ─────────────────────────────────────

    private updateMissingThemes(raw: any, date: string, todayNames: string[]): void {
        const activeLedger = raw.prepare(`
            SELECT mega_theme_name, sub_themes_json, last_seen_date, status, alive_days
            FROM mega_theme_ledger WHERE status NOT IN ('DORMANT')
        `).all() as any[];

        const nowStr = new Date().toISOString();

        for (const row of activeLedger) {
            const subNames = this.safeJson<SubThemeEntry[]>(row.sub_themes_json || '[]', []).map(s => s.name);
            // 오늘 등장한 이름과 부분 일치 확인 (이름 변형 대응)
            const isActive = subNames.some(n =>
                todayNames.some(tn => tn.includes(n) || n.includes(tn) || tn === n)
            );
            if (isActive) continue;

            const daysSince = this.daysBetween(row.last_seen_date, date);
            let newStatus = row.status;
            if (daysSince >= ThemeContextBuilder.DORMANT_AFTER_DAYS) newStatus = 'DORMANT';
            else if (daysSince >= ThemeContextBuilder.FADING_AFTER_DAYS) newStatus = 'FADING';

            if (newStatus !== row.status) {
                raw.prepare(`UPDATE mega_theme_ledger SET status = ?, updated_at = ? WHERE mega_theme_name = ?`)
                    .run(newStatus, nowStr, row.mega_theme_name);
                console.log(`[TCB] 상태 전환: "${row.mega_theme_name}" → ${newStatus} (${daysSince}일 미등장)`);
            }
        }

        // DORMANT 재등장 → REVIVAL
        const dormants = raw.prepare(`
            SELECT mega_theme_name, sub_themes_json, alive_days FROM mega_theme_ledger WHERE status = 'DORMANT'
        `).all() as any[];

        for (const d of dormants) {
            const subNames = this.safeJson<SubThemeEntry[]>(d.sub_themes_json || '[]', []).map(s => s.name);
            const isReturned = subNames.some(n =>
                todayNames.some(tn => tn.includes(n) || n.includes(tn) || tn === n)
            );
            if (!isReturned) continue;

            const newStatus = (d.alive_days || 0) >= 3 ? 'REVIVAL' : 'EMERGING';
            raw.prepare(`UPDATE mega_theme_ledger SET status = ?, updated_at = ? WHERE mega_theme_name = ?`)
                .run(newStatus, nowStr, d.mega_theme_name);
            console.log(`[TCB] 🌅 ${newStatus}: "${d.mega_theme_name}"`);
        }
    }

    // ─── Step 7: 누적 스코어 갱신 ───────────────────────────────────────────

    private updateCumulativeScores(raw: any): void {
        const allActive = raw.prepare(`
            SELECT mega_theme_name, daily_log_json, alive_days, status
            FROM mega_theme_ledger
        `).all() as any[];

        const nowStr = new Date().toISOString();

        for (const row of allActive) {
            const log = this.safeJson<LogEntry[]>(row.daily_log_json || '[]', []);
            const score = this.calcCumulativeScore(log, row.alive_days || 1, row.status);

            raw.prepare(`UPDATE mega_theme_ledger SET ranking_score = ?, updated_at = ? WHERE mega_theme_name = ?`)
                .run(score, nowStr, row.mega_theme_name);
        }
    }

    // ─── 유틸 ────────────────────────────────────────────────────────────────

    /**
     * 10일 누적 기준 스코어 산출
     * - 지속성 40%: 최근 10일 중 등장 빈도
     * - 파워   25%: 10일 평균 등락 파워
     * - 순위력 20%: 10일 평균 순위 역수
     * - 내구력 15%: 생존 일수
     */
    private calcCumulativeScore(log: LogEntry[], aliveDays: number, status: string): number {
        const recent = log.slice(-10);
        if (!recent.length) return 5;

        const freq     = recent.length / 10;                                              // 0~1
        const avgPower = recent.reduce((s, l) => s + (l.power || 0), 0) / recent.length;
        const avgRank  = recent.reduce((s, l) => s + (l.rank  || 20), 0) / recent.length;

        const A = freq * 40;
        const B = Math.min(avgPower / 30, 1) * 25;
        const C = Math.max(0, (20 - avgRank) / 20) * 20;
        const D = Math.min(aliveDays / 20, 1) * 15;

        const statusBonus: Record<string, number> = {
            DOMINANT: 10, REVIVAL: 8, STRONG: 5, EMERGING: 5, FADING: -5, DORMANT: -10
        };

        return Math.min(100, Math.max(0, Math.round(A + B + C + D + (statusBonus[status] ?? 0))));
    }

    /**
     * 서브 테마 증분 추가 (기존 유지, 신규만 추가)
     */
    private mergeSubThemes(existing: SubThemeEntry[], todayNames: string[], date: string): SubThemeEntry[] {
        const result = [...existing];
        for (const name of todayNames) {
            // 이름 변형 고려한 중복 확인 (부분 일치)
            const isDup = existing.some(e => e.name === name || e.name.includes(name) || name.includes(e.name));
            if (!isDup) {
                result.push({ name, added_date: date });
                console.log(`[TCB] 서브 테마 신규 추가: "${name}"`);
            }
        }
        return result;
    }

    private appendLog(log: LogEntry[], dateLabel: string, rank: number = 99, power: number = 0): LogEntry[] {
        const entry: LogEntry = { date: dateLabel, rank, power };
        if (log.find(l => l.date === dateLabel)) {
            return log.map(l => l.date === dateLabel ? entry : l);
        }
        return [...log.slice(-29), entry];
    }

    private findFirstSeenDate(raw: any, subThemeNames: string[], currentDate: string): string {
        if (!subThemeNames.length) return currentDate;
        const ph = subThemeNames.map(() => '?').join(',');
        const row = raw.prepare(`
            SELECT MIN(date) as first_date FROM naver_market_flow
            WHERE type = 'THEME' AND name IN (${ph}) AND date <= ?
        `).get(...subThemeNames, currentDate) as { first_date: string } | undefined;
        return row?.first_date || currentDate;
    }

    private determineStatus(existing: any, aliveDays: number): string {
        const prev = existing?.status || 'EMERGING';
        if (prev === 'DORMANT') return 'REVIVAL';
        if (prev === 'REVIVAL') return 'STRONG';
        if (aliveDays >= 10) return 'DOMINANT';
        if (aliveDays >= 3)  return 'STRONG';
        return 'EMERGING';
    }

    private calcAliveDays(firstSeen: string, date: string): number {
        return Math.max(1, this.daysBetween(firstSeen, date) + 1);
    }

    private daysBetween(a: string, b: string): number {
        return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
    }

    private safeJson<T>(str: string, fallback: T): T {
        try { return JSON.parse(str) as T; } catch { return fallback; }
    }

    private appendNarrative(existingStr: string | null, newText: string | null | undefined, date: string): string {
        if (!newText) return existingStr || '';
        let history: { date: string; text: string }[] = [];
        try {
            if (existingStr && existingStr.trim().startsWith('[')) {
                history = JSON.parse(existingStr);
            } else if (existingStr) {
                history = [{ date: '이전 기록', text: existingStr }];
            }
        } catch {
            if (existingStr) history = [{ date: '이전 기록', text: existingStr }];
        }
        
        const existingIdx = history.findIndex((h: any) => h.date === date);
        if (existingIdx !== -1) {
            history[existingIdx].text = newText;
        } else {
            history.unshift({ date, text: newText });
        }
        return JSON.stringify(history);
    }

    /**
     * 당일 포매 실제 rank/power/주도주 통계 산출
     * - topRank: 소속 서브 테마 중 최상위 rank
     * - combinedPower: 서브 테마 등락륙 합산
     * - topStocks: 각 서브 테마의 대장주 1위 동맹 (최대 5종목)
     */
    private calcDayStats(
        raw: any,
        subThemeNames: string[],
        date: string,
        todayThemes: TodayTheme[],
    ): { topRank: number; combinedPower: number; topStocks: any[] } {
        let topRank = 99;
        let combinedPower = 0;

        for (const name of subThemeNames) {
            const found = todayThemes.find(t => t.name === name);
            if (!found) continue;
            topRank = Math.min(topRank, found.rank_num);
            combinedPower += found.change_rate ?? 0;
        }

        const topStocks = this.getTopStocksForThemes(raw, subThemeNames);
        return { topRank, combinedPower, topStocks };
    }

    /** 서브 테마들의 대장주 목록 (stock_theme_tags 기반, 최대 5종목) */
    private getTopStocksForThemes(raw: any, themeNames: string[]): any[] {
        const result: any[] = [];
        const seen = new Set<string>();
        for (const name of themeNames) {
            const stocks = this.getTopStocksForTheme(raw, name);
            for (const s of stocks) {
                if (!seen.has(s.code)) {
                    seen.add(s.code);
                    result.push(s);
                    if (result.length >= 5) return result;
                }
            }
        }
        return result;
    }

    /** 단일 테마 대장주 조회 */
    private getTopStocksForTheme(raw: any, themeName: string): any[] {
        try {
            const rows = raw.prepare(`
                SELECT stock_code as code, stock_name as name, change_rate as confidence
                FROM stock_theme_tags
                WHERE tag_name = ?
                ORDER BY change_rate DESC
                LIMIT 5
            `).all(themeName) as any[];
            return rows.map(r => ({ code: r.code, name: r.name || r.code, entry_timing: 'WATCH', confidence: r.confidence }));
        } catch (e) { 
            console.error('[TCB] Failed to get stocks for theme:', themeName, e);
            return []; 
        }
    }
}

// ─── 내부 타입 ───────────────────────────────────────────────────────────────

interface TodayTheme {
    name: string;
    rank_num: number;
    change_rate: number;
    reason: string;
    stock_codes: Set<string>;
}

interface LedgerEntry {
    mega_theme_name: string;
    sub_themes_json: string;
    core_narrative: string;
    status: string;
    first_seen_date: string;
    alive_days: number;
    daily_log_json: string;
}

interface SubThemeEntry {
    name: string;
    added_date: string;
}

interface LogEntry {
    date: string;
    rank: number;
    power: number;
}

interface AiClusterAction {
    action: 'MERGE' | 'RELATE' | 'CREATE' | 'NO_GROUP';
    // MERGE
    target_mega_id?: string;
    merge_reason?: string;
    updated_narrative?: string;
    // RELATE
    source_theme?: string;
    target_theme?: string;
    relation?: string;
    logical_path?: string;
    confidence?: number;
    // CREATE
    mega_name?: string;
    core_narrative?: string;
    catalyst_type?: string;
    // 공통
    today_sub_themes?: string[];
}

interface AiClusterResult {
    mega_clusters: AiClusterAction[];
}
