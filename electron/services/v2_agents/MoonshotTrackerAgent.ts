/**
 * MoonshotTrackerAgent.ts
 * 
 * 매일 1회 액티브 트래킹 포트폴리오를 검증하는 데일리 리뷰 에이전트.
 * 
 * 파이프라인:
 *   [Phase 1] 개별 종목 하네스 (로컬 AI)
 *     - 최근 뉴스 수집 (3-angle)
 *     - 수급/신용 데이터 수집
 *     - 로컬 AI로 "가설 방어력" 일일 보고서 생성
 *   [Phase 2] 카테고리별 제미나이 배틀로얄
 *     - 전 종목 일일 보고서를 카테고리별로 묶어 제미나이에 일괄 전달
 *     - 각 종목에 Alpha Score(100점) 부여
 *     - 정원(10개) 초과 시 최하위 종목 자동 방출
 *     - 각 종목에 Hold | Warning | Drop 판정
 */

import { LocalAiService } from '../LocalAiService';
import { AiExecutionQueue } from '../AiExecutionQueue';
import { NaverSearchCollector } from '../v2_pipeline/collectors/NaverSearchCollector';
import { SmartMoneyCollector } from '../v2_pipeline/collectors/SmartMoneyCollector';
import { FundamentalCollector } from '../v2_pipeline/collectors/FundamentalCollector';
import { BrowserWindow } from 'electron';

export interface TrackerReviewResult {
    code: string;
    name: string;
    tag: string;
    verdict: 'hold' | 'warning' | 'drop';
    alphaScore: number;
    dailyNarrative: string;       // 오늘의 복기 요약
    hypothesisIntact: boolean;    // 기존 투자 가설이 아직 살아있는지
    dropReason?: string;          // Drop 판정 시 이유
    updatedAt: string;
}

const CAP_PER_CATEGORY = 10;

export class MoonshotTrackerAgent {
    private static instance: MoonshotTrackerAgent;
    private localAi = LocalAiService.getInstance();
    private naverCollector = new NaverSearchCollector();
    private smartMoneyCollector = new SmartMoneyCollector();
    private fundamentalCollector = new FundamentalCollector();

    private constructor() {}

    public static getInstance(): MoonshotTrackerAgent {
        if (!MoonshotTrackerAgent.instance) {
            MoonshotTrackerAgent.instance = new MoonshotTrackerAgent();
        }
        return MoonshotTrackerAgent.instance;
    }

    private sendProgress(win: BrowserWindow | undefined, msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
        const log = { time: new Date().toLocaleTimeString('en-US', { hour12: false }), step: 'TRACKER', msg, type };
        console.log(`[MoonshotTracker] ${msg}`);
        if (win && !win.isDestroyed()) {
            win.webContents.send('moonshot:tracker-progress', log);
        }
    }

    public async runDailyReview(win?: BrowserWindow): Promise<TrackerReviewResult[]> {
        const { DatabaseService } = await import('../DatabaseService');
        const db = DatabaseService.getInstance().getDb();
        const now = DatabaseService.getInstance().getKstTimestamp();

        this.sendProgress(win, '🔍 Active Tracking 데일리 리뷰 시작...', 'info');

        // ─── 데이터 무결성 검증 ───
        const { MarketDataCollectorService } = await import('../v2_pipeline/MarketDataCollectorService');
        const collector = MarketDataCollectorService.getInstance();
        const isDataValid = collector.verifyTodayDataIntegrity();
        let fallbackMsg = '';
        if (!isDataValid) {
            this.sendProgress(win, '⚠️ 전체 시장 데이터 갱신 누락 감지. 대상 종목 긴급 OHLCV 직접 수집 우회 실행.', 'warning');
            fallbackMsg = '\n[시스템 알림: 오늘 전체 시장 OHLCV 수집에 장애가 발생하여, 현재 시세는 긴급 재수집된 부분 데이터입니다. 전체 등수/알파 스코어가 다소 부정확할 수 있습니다.]';
        }

        // ─── 현재 Active Tracking 전 종목 로드 ───
        const activeRows: any[] = db.prepare(`
            SELECT stock_code, stock_name, tag, tbp_score, mega_trend, bull_case, bear_case,
                   milestones_json, invalidation_condition, entry_price, current_price,
                   entry_date, narrative
            FROM moonshot_active_tracking
            WHERE is_invalidated = 0
            ORDER BY tag, tbp_score DESC
        `).all();

        if (activeRows.length === 0) {
            this.sendProgress(win, '⚠️ Active Tracking에 종목이 없습니다.', 'warning');
            return [];
        }

        // ─── 긴급 우회 수집 (자생력) ───
        if (!isDataValid) {
            this.sendProgress(win, `🔄 대상 종목(${activeRows.length}개) 오늘 종가 긴급 갱신 중...`, 'info');
            const targetCodes = activeRows.map((r: any) => r.stock_code);
            await collector.refreshStocksClose(targetCodes);
        }

        this.sendProgress(win, `📋 총 ${activeRows.length}개 종목 대상 리뷰 시작 (A/B/C안 카테고리별)`, 'info');

        // ─── Phase 1: 개별 종목 하네스 (로컬 AI 일일 보고서) ───
        const dailyBriefings: { [code: string]: string } = {};

        for (const stock of activeRows) {
            this.sendProgress(win, `📰 [${stock.stock_name}] 뉴스/수급 수집 중...`, 'info');

            let rawNewsBuffer = '';
            let smDataPreview = '수급 데이터 없음';

            try {
                // (1) 뉴스 수집 (3-angle)
                const searchQueries = [
                    stock.stock_name,
                    `${stock.stock_name} 공시 뉴스`,
                    `${stock.stock_name} 수급 기관`,
                ];
                for (let i = 0; i < searchQueries.length; i++) {
                    try {
                        const newsData = await this.naverCollector.collect({ keyword: searchQueries[i] });
                        const headlines = newsData?.articles?.map((a: any) => `- ${a.title}`).join('\n') || '뉴스 없음';
                        rawNewsBuffer += `\n[탐색 ${i + 1}/3 | "${searchQueries[i]}"]\n${headlines}\n`;
                    } catch (e) {
                        rawNewsBuffer += `\n[탐색 ${i + 1}/3 | "${searchQueries[i]}"] → 수집 실패\n`;
                    }
                    if (i < searchQueries.length - 1) await new Promise(r => setTimeout(r, 300));
                }

                // (2) 수급 데이터 수집
                try {
                    const cleanCode = stock.stock_code.replace(/^A/, '');
                    const smData = await this.smartMoneyCollector.collect({ stk_cd: cleanCode });
                    if (smData?.data) {
                        const latest = smData.data.slice(0, 5);
                        smDataPreview = latest.map((d: any) =>
                            `${d.stck_bsop_date || ''}: 외인${d.frgn_ntby_qty || 0} 기관${d.orgn_ntby_qty || 0}`
                        ).join('\n');
                    }
                } catch (e) {
                    smDataPreview = '수급 수집 실패';
                }

                // (3) 로컬 AI: 일일 가설 방어력 리포트 생성
                const briefingPrompt = `당신은 'Moonshot Ten-bagger' 헤지펀드의 시니어 리서치 매니저입니다.
최근 수집된 뉴스와 수급/실적 데이터를 바탕으로, 이 종목의 기존 "투자 가설(Bull Case)"이 여전히 유효한지 
점검하는 일일 방어력 보고서를 작성하세요. ${fallbackMsg}

[입력 데이터]
- 종목명: ${stock.stock_name}
 (${stock.stock_code}) | ${stock.tag}
[편입 이유 (Original Thesis)] ${stock.narrative || stock.bull_case || '데이터 없음'}
[아이디어 폐기 조건] ${stock.invalidation_condition || '-'}

[오늘 최신 뉴스]
${rawNewsBuffer || '수집 없음'}

[최근 5일 수급]
${smDataPreview}

평가 형식 (3줄):
1. 가설 현황: (여전히 유효 | 부분 훼손 | 완전 훼손)
2. 오늘 핵심 팩트: (중요 뉴스/수급 변화 요약 1줄)
3. 한줄 복기: (액션 방향성을 제안하는 1줄 코멘트)`;

                const briefing = await this.localAi.askLocalAi(briefingPrompt, 'Write a concise daily briefing in Korean in 3 lines.');
                dailyBriefings[stock.stock_code] = briefing;
                this.sendProgress(win, `✅ [${stock.stock_name}] 일일 브리핑 완성`, 'success');

            } catch (err: any) {
                dailyBriefings[stock.stock_code] = `데이터 수집 실패: ${err.message}`;
                this.sendProgress(win, `❌ [${stock.stock_name}] 브리핑 생성 실패: ${err.message}`, 'error');
            }
        }

        // ─── Phase 2: 카테고리별 제미나이 배틀로얄 ───
        const categoryGroups: { [tag: string]: typeof activeRows } = {};
        for (const stock of activeRows) {
            const tag = stock.tag || '미분류';
            if (!categoryGroups[tag]) categoryGroups[tag] = [];
            categoryGroups[tag].push(stock);
        }

        const allResults: TrackerReviewResult[] = [];

        for (const [categoryTag, stocks] of Object.entries(categoryGroups)) {
            this.sendProgress(win, `⚔️ [${categoryTag}] 제미나이 포트폴리오 심사 중 (${stocks.length}개 종목)...`, 'info');

            const { ChunkUtils } = await import('../utils/ChunkUtils');
            const chunks = ChunkUtils.createBalancedChunks(stocks, 15);
            let aiResultArray: any[] = [];

            await Promise.all(chunks.map(async (chunkStocks, chunkIndex) => {
                const factsText = chunkStocks.map(s =>
                    `----- [${s.stock_name} | ${s.stock_code}] -----\n` +
                    `[편입 이유] ${s.narrative || s.bull_case || '없음'}\n` +
                    `[아이디어 폐기 조건] ${s.invalidation_condition || '-'}\n` +
                    `[오늘의 데일리 브리핑]\n${dailyBriefings[s.stock_code] || '브리핑 없음'}`
                ).join('\n\n');

                const judgePrompt = `당신은 "Project Moonshot" 텐베거 포트폴리오 최고 심판관입니다.
현재 [${categoryTag}] 카테고리에 아래 ${chunkStocks.length}개 종목이 있습니다. (그룹 ${chunkIndex + 1}/${chunks.length})

당신의 임무:
1. 각 종목의 오늘 데일리 브리핑을 보고, 기존 편입 가설이 유효한지 평가
2. 모든 종목에 "지금 이 자리에서 가장 빠르고 강력하게 오를" 기대수익 Alpha Score(0~100)를 부여
3. 각 종목에 verdict 결정: "hold"(현 상태 유지), "warning"(다음 리뷰에서 방출 후보), "drop"(즉시 방출)
4. 만약 총 종목 수가 ${CAP_PER_CATEGORY}개를 초과할 경우, 초과분을 Alpha Score 최하위부터 "drop"으로 처리

[중요 원칙]
- 목표 수익에 도달했더라도 가설이 살아있고 추가 상승 여력이 있으면 "hold"
- 주가 등락보다 "기존 투자 스토리가 유효한가"를 최우선으로 심사
- 폐기 조건(Invalidation Condition)이 명백히 발동된 종목은 즉시 "drop"

[현재 ${categoryTag} 명부]
${factsText}

순수 JSON 배열만 반환 (마크다운 코드블록 절대 금지):
[
  {
    "code": "종목코드",
    "alphaScore": 0~100,
    "verdict": "hold" | "warning" | "drop",
    "hypothesisIntact": true | false,
    "dailyNarrative": "오늘의 복기 1줄 요약",
    "dropReason": "drop인 경우 이유, 아니면 null"
  }
]`;

                try {
                    const aiResponse = await AiExecutionQueue.getInstance().enqueue({
                        agentId: 'MOONSHOT_TRACKER',
                        agentName: `문샷 트래커 (그룹 ${chunkIndex + 1})`,
                        triggerType: 'MANUAL',
                        prompt: judgePrompt,
                        systemInstruction: 'You are a portfolio manager. Return only valid JSON array.',
                    });

                    try {
                        const cleanJson = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
                        let parsed = JSON.parse(cleanJson);
                        if (!Array.isArray(parsed)) parsed = [parsed];
                        aiResultArray.push(...parsed);
                    } catch (e) {
                        this.sendProgress(win, `❌ [${categoryTag}] AI 응답 파싱 실패 (그룹 ${chunkIndex + 1})`, 'error');
                        console.error('[MoonshotTracker] Parse error:', e, 'Raw:', aiResponse);
                    }
                } catch (e) {
                    console.error(`[MoonshotTracker] Gemini error (그룹 ${chunkIndex + 1}):`, e);
                }
            }));

                for (const stock of stocks) {
                    const aiResult = aiResultArray.find((r: any) =>
                        r.code === stock.stock_code || r.code === stock.stock_code.replace(/^A/, '')
                    ) || {
                        alphaScore: 30,
                        verdict: 'warning',
                        hypothesisIntact: false,
                        dailyNarrative: 'AI 분석 결과 없음',
                        dropReason: null
                    };

                    const result: TrackerReviewResult = {
                        code: stock.stock_code,
                        name: stock.stock_name,
                        tag: stock.tag,
                        verdict: aiResult.verdict || 'warning',
                        alphaScore: aiResult.alphaScore || 30,
                        dailyNarrative: aiResult.dailyNarrative || '-',
                        hypothesisIntact: !!aiResult.hypothesisIntact,
                        dropReason: aiResult.dropReason || undefined,
                        updatedAt: now,
                    };

                    allResults.push(result);

                    // DB에 결과 업데이트
                    try {
                        // ── 공통: OHLCV DB에서 최신 종가 조회 ──
                        const cleanCode = stock.stock_code.replace(/^A/, '');
                        const latestOhlcv = db.prepare(`
                            SELECT close FROM market_ohlcv_history
                            WHERE stock_code = ?
                            ORDER BY date DESC
                            LIMIT 1
                        `).get(cleanCode) as { close: number } | undefined;
                        const latestClose = latestOhlcv?.close || stock.current_price || 0;

                        if (result.verdict === 'drop') {
                            // 방출: is_invalidated = 1 처리, 최신 현재가 반영
                            db.prepare(`
                                UPDATE moonshot_active_tracking
                                SET is_invalidated = 1, current_price = ?, updated_at = ?
                                WHERE stock_code = ?
                            `).run(latestClose, now, stock.stock_code);
                            this.sendProgress(win, `🚨 [${stock.stock_name}] DROP 판정 → 방출 처리 완료${result.dropReason ? ': ' + result.dropReason : ''}`, 'warning');
                        } else {
                            // 유지: Alpha Score + 현재가 동시 갱신
                            db.prepare(`
                                UPDATE moonshot_active_tracking
                                SET tbp_score = ?, current_price = ?, updated_at = ?
                                WHERE stock_code = ?
                            `).run(result.alphaScore, latestClose, now, stock.stock_code);
                            
                            const verdictEmoji = result.verdict === 'hold' ? '✅' : '⚠️';
                            this.sendProgress(win, `${verdictEmoji} [${stock.stock_name}] ${result.verdict.toUpperCase()} (Alpha ${result.alphaScore}점 | 현재가 ${latestClose.toLocaleString()}원)`, result.verdict === 'hold' ? 'success' : 'warning');
                        }


                        // 데일리 복기 로그 저장
                        db.prepare(`
                            INSERT INTO moonshot_daily_review
                            (stock_code, stock_name, tag, verdict, alpha_score, daily_narrative, hypothesis_intact, drop_reason, reviewed_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            stock.stock_code, stock.stock_name, stock.tag,
                            result.verdict, result.alphaScore,
                            result.dailyNarrative, result.hypothesisIntact ? 1 : 0,
                            result.dropReason || null, now
                        );
                    } catch (dbErr: any) {
                        console.error('[MoonshotTracker] DB update error:', dbErr.message);
                    }
                }

                this.sendProgress(win, `✅ [${categoryTag}] 카테고리 심사 완료`, 'success');

            } catch (err: any) {
                this.sendProgress(win, `❌ [${categoryTag}] 제미나이 심사 실패: ${err.message}`, 'error');
                console.error('[MoonshotTracker] Gemini error:', err);
            }
        }

        const dropCount = allResults.filter(r => r.verdict === 'drop').length;
        const holdCount = allResults.filter(r => r.verdict === 'hold').length;
        const warnCount = allResults.filter(r => r.verdict === 'warning').length;

        this.sendProgress(win,
            `🏁 데일리 리뷰 완료: HOLD ${holdCount}개 / WARNING ${warnCount}개 / DROP ${dropCount}개`,
            'success'
        );

        return allResults;
    }
}
