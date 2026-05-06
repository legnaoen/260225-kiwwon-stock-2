/**
 * ReportScoutAgent (Phase 1 - 발굴 AI)
 * ─────────────────────────────────────────────────────────────────
 * [역할] 네이버 증권 리서치 리포트(naver_research_flow DB)를 읽어
 *        가장 유망한 신규 매수 후보 종목 최대 5개를 선별한다.
 *
 * [실행 트리거]
 *   - SchedulerService → 장 마감 후 15:48 CRON
 *   - 수동 IPC: 'report-tracker:run-scout'
 *
 * [데이터 흐름]
 *   Step 1: naver_research_flow DB에서 최근 5영업일치 리포트 조회
 *   Step 2: 집중 산업 탑3(rank>0)와 카테고리별 리포트 가공 → 다이제스트 생성
 *   Step 3: Gemini AI에 다이제스트 주입 → 신규 후보 최대 5개 JSON 반환
 *   Step 4: DB 저장 없이 후보 목록 반환 (Manager가 최종 편입 결정)
 *
 * [선발 기준 (AI 프롬프트)]
 *   - 집중 산업 탑3 트렌드 일치 여부 (최근 3~5일 연속 등장 = 강한 시그널)
 *   - 시황/경제 리포트와의 매크로 정합성
 *   - 개별 종목 리포트의 목표가 상향 / 신규 커버리지 여부
 *   - 리포트 내러티브의 강도 및 구체성
 */

import { DatabaseService } from '../DatabaseService';
import { AiExecutionQueue } from '../AiExecutionQueue';
import { getKstDate } from '../../utils/DateUtils';

// ── 상수 ───────────────────────────────────────────────────────
const MAX_SCOUT_PICKS = 5;
const RESEARCH_DAYS = 7;       // 최근 7영업일치 리포트 조회
const MAX_REPORT_CHARS = 8000; // 프롬프트 토큰 최적화 상한선

// ── 타입 ───────────────────────────────────────────────────────
export interface ScoutCandidate {
    stock_code: string;        // 종목코드 (6자리, 없으면 '' 허용)
    stock_name: string;        // 종목명
    report_source: string;     // 발간 증권사
    industry_name: string;     // 산업 분류
    target_return_pct: number; // AI 추정 목표수익률 (%)
    target_days: number;       // AI 추정 목표보유일 (영업일 기준)
    ai_score: number;          // Scout AI 확신 점수 (0~100)
    ai_reason: string;         // 편입 사유 (리포트 내러티브 기반)
    raw_report_title: string;  // 원본 리포트 제목
}

export interface ScoutResult {
    success: boolean;
    runDate: string;
    candidates: ScoutCandidate[];
    digest: string;            // AI에 주입한 다이제스트 (디버깅용)
    error?: string;
}

// ── System Prompt ───────────────────────────────────────────────
const SYSTEM_PROMPT = `당신은 국내 최고 수준의 모멘텀 트레이딩 퀀트 매니저입니다.
증권사 애널리스트 리포트를 분석하여 **"향후 10거래일 이내에 최대 수익을 발생시킬 것으로 기대되는 가장 핫한 종목 후보"**를 선별합니다.

[선발 기준 - 단기 폭발력 우선]
1. (최중요) 무겁고 느린 장기 우량주(가치주) 편향을 버리십시오. 10일 이내에 단기 슈팅이 나올 만한 강력한 촉매(Catalyst)가 있는 종목을 최우선으로 합니다.
2. 집중 산업 탑3에 3일 이상 연속 등장한 산업의 종목에 높은 가중치를 부여합니다. (시장의 돈이 몰리는 트렌드)
3. 목표가 대폭 상향 조정, 어닝 서프라이즈, 신규 수주 등 폭발적인 재료가 담긴 리포트를 우선합니다.
4. 시황/경제분석과 매크로 방향성이 일치하는 주도 테마주를 선호합니다.
5. 단순 중립 의견, 목표가 하향, 또는 촉매가 불분명하여 단기 모멘텀이 없는 종목은 엄격히 제외합니다.

[응답 규칙]
- 반드시 아래 JSON 형식만 반환 (마크다운 코드블록 사용하지 말 것)
- stock_code는 종목코드 6자리, 코드를 모르면 ""로 작성
- target_return_pct: 7~30 범위 (무리한 목표 설정 금지)
- target_days: 5~10 범위 (철저한 단기 스윙 관점)
- ai_score: 0~100 (확신도, 60 미만은 선발하지 말 것)
- 최대 ${MAX_SCOUT_PICKS}개까지만 선발. 확신이 없으면 그 이하로 선발.

{
  "candidates": [
    {
      "stock_code": "005930",
      "stock_name": "삼성전자",
      "report_source": "한국투자증권",
      "industry_name": "반도체",
      "target_return_pct": 12,
      "target_days": 15,
      "ai_score": 78,
      "ai_reason": "HBM 수요 급증 및 목표가 85,000원 상향 조정. 최근 3일 연속 집중 산업 탑3 등장.",
      "raw_report_title": "삼성전자 - AI 사이클 최대 수혜 시작"
    }
  ]
}`;

export class ReportScoutAgent {
    private static instance: ReportScoutAgent;
    private db = DatabaseService.getInstance();
    private aiQueue = AiExecutionQueue.getInstance();

    private constructor() {}

    public static getInstance(): ReportScoutAgent {
        if (!ReportScoutAgent.instance) {
            ReportScoutAgent.instance = new ReportScoutAgent();
        }
        return ReportScoutAgent.instance;
    }

    /**
     * Scout 메인 실행: 리포트 DB → AI 분석 → 후보 5개 반환
     */
    public async run(): Promise<ScoutResult> {
        const runDate = getKstDate();
        console.log(`[ReportScoutAgent] 🔍 Scout 실행 시작 (${runDate})`);

        try {
            // Step 1: 리포트 데이터 조회
            const reports = this.db.getNaverResearchReports(500);
            const topSectors = this.db.getNaverResearchTopSectors(RESEARCH_DAYS);

            if (reports.length === 0) {
                return { success: false, runDate, candidates: [], digest: '', error: '리서치 리포트 데이터 없음' };
            }

            // Step 2: AI 주입용 다이제스트 생성
            const digest = this.buildDigest(reports, topSectors);

            // Step 3: Gemini AI 호출
            const rawResponse = await this.aiQueue.enqueue({
                agentId: 'ReportScoutAgent',
                agentName: 'Report Scout',
                triggerType: 'CRON',
                prompt: `[오늘 날짜: ${runDate}]\n\n${digest}`,
                systemInstruction: SYSTEM_PROMPT,
            });

            // Step 4: JSON 파싱
            const candidates = this.parseResponse(rawResponse);

            console.log(`[ReportScoutAgent] ✅ Scout 완료: ${candidates.length}개 후보 선발`);
            candidates.forEach((c, i) =>
                console.log(`  ${i + 1}. ${c.stock_name}(${c.stock_code}) | 점수:${c.ai_score} | 목표:${c.target_return_pct}%/${c.target_days}일`)
            );

            return { success: true, runDate, candidates, digest };

        } catch (e: any) {
            console.error('[ReportScoutAgent] ❌ Scout 실패:', e.message);
            return { success: false, runDate, candidates: [], digest: '', error: e.message };
        }
    }

    /**
     * 리포트 데이터를 AI 프롬프트용 다이제스트로 가공
     * 입력 토큰 최적화: 핵심 정보만 압축하여 MAX_REPORT_CHARS 이내로 제한
     */
    private buildDigest(reports: any[], topSectors: any[]): string {
        const lines: string[] = [];

        // ── 섹션 1: 최근 7일 집중 산업 탑3 트렌드 ──────────────────
        if (topSectors.length > 0) {
            lines.push('=== [최근 집중 산업 탑3 트렌드] ===');
            // 날짜별로 그룹화
            const byDate: Record<string, any[]> = {};
            for (const row of topSectors) {
                if (!byDate[row.date]) byDate[row.date] = [];
                byDate[row.date].push(row);
            }
            // 최신 날짜 순 5개
            Object.keys(byDate).sort().reverse().slice(0, 5).forEach(date => {
                const sectors = byDate[date].sort((a, b) => a.rank - b.rank);
                lines.push(`${date}: ${sectors.map(s => `[${s.rank}위]${s.industry_name}`).join(', ')}`);
            });

            // 집중도 분석: 최근 5일간 탑3에 3회 이상 등장한 산업 강조
            const sectorCount: Record<string, number> = {};
            for (const row of topSectors) {
                sectorCount[row.industry_name] = (sectorCount[row.industry_name] || 0) + 1;
            }
            const hotSectors = Object.entries(sectorCount)
                .filter(([, cnt]) => cnt >= 3)
                .sort((a, b) => b[1] - a[1])
                .map(([name, cnt]) => `${name}(${cnt}회)`);
            if (hotSectors.length > 0) {
                lines.push(`→ 연속 등장 주목 산업: ${hotSectors.join(', ')}`);
            }
            lines.push('');
        }

        // ── 섹션 2: 카테고리별 최신 리포트 (최근 5일, 카테고리당 최대 8개) ──
        const recentDate = reports[0]?.date;
        if (!recentDate) return lines.join('\n');

        // 최근 5영업일 이내 리포트만
        const cutoffDate = new Date(recentDate);
        cutoffDate.setDate(cutoffDate.getDate() - 7);
        const cutoffStr = cutoffDate.toISOString().split('T')[0];

        const recent = reports.filter(r => r.date >= cutoffStr && r.rank === 0);

        // 카테고리별 그룹핑
        const BASE_CATEGORIES = ['투자전략', '경제분석', '산업분석', '국내종목', '데일리'];
        const catMap: Record<string, any[]> = {};
        for (const r of recent) {
            const cat = r.industry_name || '기타';
            if (!catMap[cat]) catMap[cat] = [];
            catMap[cat].push(r);
        }

        // 기본 카테고리 먼저, 나머지 산업 카테고리 후
        const orderedCats = [
            ...BASE_CATEGORIES.filter(c => catMap[c]),
            ...Object.keys(catMap).filter(c => !BASE_CATEGORIES.includes(c))
        ];

        for (const cat of orderedCats) {
            const items = catMap[cat]?.slice(0, 8) ?? [];
            if (items.length === 0) continue;
            lines.push(`=== [${cat}] ===`);
            for (const r of items) {
                const title = r.report_title ? r.report_title.slice(0, 60) : '-';
                const analyst = r.analyst ? ` (${r.analyst}/${r.broker})` : '';
                const snippet = r.content_snippet ? ` — ${r.content_snippet.slice(0, 80)}` : '';
                lines.push(`• [${r.date}] ${title}${analyst}${snippet}`);
            }
            lines.push('');

            // 전체 길이 초과 방지
            if (lines.join('\n').length > MAX_REPORT_CHARS) break;
        }

        return lines.join('\n').slice(0, MAX_REPORT_CHARS);
    }

    /**
     * AI 응답 JSON 파싱 → ScoutCandidate[]
     */
    private parseResponse(raw: string): ScoutCandidate[] {
        try {
            // 코드블록 제거
            const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            // JSON 추출 (중괄호 기반)
            const jsonStart = cleaned.indexOf('{');
            const jsonEnd = cleaned.lastIndexOf('}');
            if (jsonStart === -1 || jsonEnd === -1) throw new Error('JSON 구조 없음');

            const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
            const candidates: ScoutCandidate[] = (parsed.candidates || [])
                .filter((c: any) => c.stock_name && c.ai_score >= 60)
                .slice(0, MAX_SCOUT_PICKS)
                .map((c: any) => ({
                    stock_code: String(c.stock_code || '').replace(/\D/g, '').slice(0, 6),
                    stock_name: String(c.stock_name || ''),
                    report_source: String(c.report_source || ''),
                    industry_name: String(c.industry_name || ''),
                    target_return_pct: Math.min(30, Math.max(7, Number(c.target_return_pct) || 15)),
                    target_days: Math.min(30, Math.max(5, Number(c.target_days) || 15)),
                    ai_score: Math.min(100, Math.max(0, Number(c.ai_score) || 0)),
                    ai_reason: String(c.ai_reason || ''),
                    raw_report_title: String(c.raw_report_title || ''),
                }));

            return candidates;
        } catch (e: any) {
            console.error('[ReportScoutAgent] JSON 파싱 실패:', e.message, '\n원본:', raw.slice(0, 200));
            return [];
        }
    }
}
