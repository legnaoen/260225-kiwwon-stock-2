/**
 * PullbackScannerAgent
 *
 * 역할: "어제까지 강했던 종목 중, 오늘 잠깐 쉬는 종목" 자동 발굴
 *
 * 발굴 로직:
 *   1. MarketLeader Alpha 상위 20위 조회 (10일 초과수익률 기반)
 *   2. 각 종목의 OHLCV에서 차트 조건 필터링
 *      - MA20 위 유지 (추세 유지 확인)
 *      - 60일 고점 대비 -5% ~ -15% 조정 (타점 구간)
 *      - 오늘 등락률 -8% ~ +1% (쉬는 날)
 *      - 거래량이 20일 평균 대비 0.4~1.5배 (과열 아닌 소화 중)
 *   3. 과거 AI 추천 이력 교차 (신뢰도 가산)
 *   4. 이슈 맥락 교차 (수혜 섹터 가산)
 *   5. Gemini가 최종 판단 후 ai_analyst_picks에 PULLBACK 타입 저장
 *
 * 출력: ai_analyst_picks (agent_type = 'PULLBACK', lifespan_days = 3~7)
 */

import { AiExecutionQueue } from '../AiExecutionQueue';
import { DatabaseService } from '../DatabaseService';
import { MarketLeaderDiscoveryService } from '../v2_pipeline/MarketLeaderDiscoveryService';

// 차트 필터링 통과 종목 구조
interface PullbackCandidate {
    stockCode: string;
    stockName: string;
    marketAlpha: number;
    currentChangeRate: number;    // 오늘 등락률 (%)
    ma20: number;                 // 20일 이동평균
    currentPrice: number;         // 현재가 (오늘 종가 or 최근가)
    ma20Disparity: number;        // MA20 이격도 (현재가/MA20 - 1) * 100
    high60: number;               // 60일 최고가
    correctionPct: number;        // 고점 대비 조정폭 (%)
    volumeRatio: number;          // 오늘 거래량 / 20일 평균 거래량
    pastAiPick: boolean;          // 최근 5일 내 AI 추천 이력
    pastAiReason: string;         // 과거 AI 추천 이유 요약
    relatedThemes: string[];      // 관련 테마
}

export class PullbackScannerAgent {
    private static instance: PullbackScannerAgent;
    private db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    public static getInstance(): PullbackScannerAgent {
        if (!PullbackScannerAgent.instance) {
            PullbackScannerAgent.instance = new PullbackScannerAgent();
        }
        return PullbackScannerAgent.instance;
    }

    public async runScan(targetDate?: string) {
        const dateStr = targetDate || this.db.getKstDate();
        console.log(`[PullbackScanner] 🔍 ${dateStr} 눌림목 후보 스캔 시작...`);

        try {
            const rawDb = (this.db as any).db;

            // ─── Step 1: MarketLeader Alpha 상위 종목 조회 ───────────────────
            const alphaLeaders = MarketLeaderDiscoveryService.getInstance().getMarketLeaders(10, 0, 30);

            if (!alphaLeaders || alphaLeaders.length === 0) {
                console.warn('[PullbackScanner] ⚠️ Alpha 랭킹 데이터 없음. OHLCV 수집 여부 확인 필요. 스캔 건너뜀.');
                return null;
            }

            console.log(`[PullbackScanner] Alpha 상위 ${alphaLeaders.length}개 종목 로드 완료. 차트 필터링 시작...`);

            // ─── Step 2: 종목별 OHLCV 기반 차트 필터링 ─────────────────────
            const candidates: PullbackCandidate[] = [];

            for (const leader of alphaLeaders) {
                try {
                    // 최근 60일 OHLCV 조회
                    const ohlcvRows = rawDb.prepare(`
                        SELECT date, open, high, low, close, volume, trading_value
                        FROM market_ohlcv_history
                        WHERE stock_code = ?
                        ORDER BY date DESC
                        LIMIT 62
                    `).all(leader.stockCode) as any[];

                    if (!ohlcvRows || ohlcvRows.length < 21) {
                        // 데이터 부족 — 스킵
                        continue;
                    }

                    // 최신 순 정렬 → 날짜순 정렬로 변환
                    const rows = [...ohlcvRows].reverse(); // 과거 → 최신

                    const latest = ohlcvRows[0]; // 가장 최신 데이터
                    const currentPrice = latest.close;
                    const currentChangeRate = ohlcvRows.length >= 2
                        ? ((ohlcvRows[0].close - ohlcvRows[1].close) / ohlcvRows[1].close) * 100
                        : 0;

                    // MA20 계산 (최신 20개)
                    const last20Closes = ohlcvRows.slice(0, 20).map((r: any) => r.close);
                    const ma20 = last20Closes.reduce((a: number, b: number) => a + b, 0) / last20Closes.length;
                    const ma20Disparity = ((currentPrice - ma20) / ma20) * 100;

                    // 60일 최고가
                    const high60 = Math.max(...ohlcvRows.slice(0, 60).map((r: any) => r.high));
                    const correctionPct = ((currentPrice - high60) / high60) * 100;

                    // 거래량 비율 (오늘 vs 20일 평균)
                    const avgVolume20 = ohlcvRows.slice(1, 21).reduce((a: number, r: any) => a + (r.volume || 0), 0) / 20;
                    const volumeRatio = avgVolume20 > 0 ? (latest.volume || 0) / avgVolume20 : 0;

                    // ──── 핵심 필터 조건 ────────────────────────────────────
                    // 조건 1: MA20 위에 있어야 함 (추세 유지)
                    if (ma20Disparity < -0.5) continue; // MA20 아래 0.5% 이상이면 제외

                    // 조건 2: 고점 대비 -5% ~ -20% 조정
                    if (correctionPct > -3 || correctionPct < -25) continue;

                    // 조건 3: 오늘 등락률 -8% ~ +2% (쉬는 날, 폭락 제외)
                    if (currentChangeRate < -8 || currentChangeRate > 2) continue;

                    // 조건 4: 거래량 과열 아닌 상태 (0.3~2.0배)
                    if (volumeRatio > 3.0) continue; // 갑작스러운 거래량 폭증은 제외 (다른 이슈 가능)

                    // ─── Step 3: 과거 AI 추천 이력 확인 ─────────────────────
                    const pastPickRows = rawDb.prepare(`
                        SELECT reason, confidence, agent_type
                        FROM ai_analyst_picks
                        WHERE stock_code = ?
                          AND date >= date(?, '-5 days')
                        ORDER BY date DESC
                        LIMIT 1
                    `).all(leader.stockCode, dateStr) as any[];

                    const pastAiPick = pastPickRows.length > 0;
                    const pastAiReason = pastAiPick
                        ? `[${pastPickRows[0].agent_type} | 신뢰도 ${pastPickRows[0].confidence}] ${String(pastPickRows[0].reason || '').substring(0, 100)}`
                        : '';

                    candidates.push({
                        stockCode: leader.stockCode,
                        stockName: leader.stockName,
                        marketAlpha: leader.marketAlpha,
                        currentChangeRate: Math.round(currentChangeRate * 10) / 10,
                        ma20,
                        currentPrice,
                        ma20Disparity: Math.round(ma20Disparity * 10) / 10,
                        high60,
                        correctionPct: Math.round(correctionPct * 10) / 10,
                        volumeRatio: Math.round(volumeRatio * 100) / 100,
                        pastAiPick,
                        pastAiReason,
                        relatedThemes: leader.relatedThemes || [],
                    });

                } catch (stockErr: any) {
                    console.warn(`[PullbackScanner] ${leader.stockCode} 처리 중 오류 (스킵):`, stockErr.message);
                }
            }

            console.log(`[PullbackScanner] 필터 통과 종목: ${candidates.length}개 / Alpha 전체: ${alphaLeaders.length}개`);

            if (candidates.length === 0) {
                console.log('[PullbackScanner] ✅ 오늘은 눌림목 조건 충족 종목 없음. 정상 종료.');
                return [];
            }

            // ─── Step 4: 이슈 맥락 + AI 최종 판단 ──────────────────────────
            // 이슈 맥락 수집
            let issueContext = '';
            try {
                const { IssueLedgerDB } = await import('./IssueLedgerDB');
                const briefing = IssueLedgerDB.getInstance().getLatestBriefing();
                const activeIssues = IssueLedgerDB.getInstance().getActiveIssues(5);

                if (briefing) {
                    issueContext = `\n[오늘 시황 브리핑 | 리스크 ${briefing.risk_score}/100 | 국면: ${briefing.dominant_regime}]\n${String(briefing.briefing_text || '').substring(0, 300)}\n`;
                }
                if (activeIssues && activeIssues.length > 0) {
                    const sectors = activeIssues.map((iss: any) => {
                        const good = Array.isArray(iss.good_sectors) ? iss.good_sectors.join(', ') : (iss.good_sectors_json ? JSON.parse(iss.good_sectors_json || '[]').join(', ') : '');
                        const bad = Array.isArray(iss.bad_sectors) ? iss.bad_sectors.join(', ') : (iss.bad_sectors_json ? JSON.parse(iss.bad_sectors_json || '[]').join(', ') : '');
                        return `이슈: ${iss.headline} → 수혜: [${good}] / 피해: [${bad}]`;
                    }).join('\n');
                    issueContext += `\n[활성 이슈 수혜·피해 섹터]\n${sectors}\n`;
                }
            } catch (e) {
                console.warn('[PullbackScanner] 이슈 맥락 수집 실패 (무시):', (e as any).message);
            }

            // AI 프롬프트 구성
            const candidateText = candidates.map((c, i) =>
                `${i + 1}. ${c.stockName}(${c.stockCode})\n` +
                `   - Alpha(10일 초과수익률): +${c.marketAlpha.toFixed(1)}%\n` +
                `   - 오늘 등락률: ${c.currentChangeRate > 0 ? '+' : ''}${c.currentChangeRate}%\n` +
                `   - MA20 이격도: ${c.ma20Disparity > 0 ? '+' : ''}${c.ma20Disparity}% (MA20 ${c.ma20Disparity >= 0 ? '위' : '아래'})\n` +
                `   - 고점 대비 조정: ${c.correctionPct}% (60일 고점 ${c.high60.toLocaleString()}원)\n` +
                `   - 거래량 비율: ${c.volumeRatio}배 (20일 평균 대비)\n` +
                `   - 관련 테마: ${c.relatedThemes.slice(0, 3).join(', ') || '정보 없음'}\n` +
                `   - 과거 AI 이력: ${c.pastAiPick ? `있음 — ${c.pastAiReason}` : '없음'}\n`
            ).join('\n');

            const systemPrompt = `당신은 대한민국 주식시장의 눌림목 매수 전략 전문가입니다.
당신에게는 최근 10일간 시장 대비 초과수익률(Alpha)이 높았던 주도주들 중, 오늘 차트 조건(MA20 지지, 고점 대비 -5~-20% 조정, 거래량 소화)을 통과한 후보 종목 목록이 주어집니다.

[눌림목 매수 핵심 판단 기준]
1. **"이미 증명된 강한 종목인가"** — Alpha 높을수록 시장이 인정한 종목. 과거 AI 추천 이력이 있으면 신뢰도 증가.
2. **"지금 진입 가격이 합리적인가"** — MA20 위에서 쉬어가는 구간 = 교과서적 눌림목. MA20 가까울수록 리스크 낮음.
3. **"조정 이유가 개별 악재인가, 시장 전체 조정인가"** — 이슈 수혜 섹터이면서 시장 전체 조정 → 절호의 타점. 개별 악재 발생 종목은 제외.
4. **"거래량이 매물 소화 구간인가"** — 거래량 감소 = 매물 소화 완료 신호. 급증이면 새로운 이슈 발생 의심.

[이슈 맥락 활용]
- 이슈 수혜 섹터 종목 = 확신도 +15점 가산
- 이슈 피해 섹터 종목 = 확신도 -20점 차감 (또는 제외)

[결과물]
오직 JSON으로만 반환. 최종 추천 최대 5개(확신도 60 이상).
- **[매우 중요 - 매수 가설(Thesis) 구체화 및 기각 조건 명시]**:
  reason 서술 시 단순히 "눌림목 타점이다"라고 표현하지 말고, 반드시 아래 3가지 요소를 포함하여 구체적이고 완결성 있는 매수 가설로 서술하라.
  ① **이슈 맥락 및 수급 환경** (수혜/피해 여부와 눌림목 매수 주체)
  ② **매수 가설 (Catalyst)**: 향후 3~5일 내에 기술적 반등이나 지지 후 랠리를 기대하는 구체적 이유
  ③ **기각 조건 (Invalidation Point)**: 이 추천이 틀렸음을 증명하는 구체적인 기술적/재료적 조건 (예: 20일선 이탈 마감 시 기각, 특정 지지 지점 붕괴 시 기각 등)`;

            const userPrompt = `${issueContext ? `[시장 맥락]\n${issueContext}\n` : ''}
[눌림목 필터 통과 후보 ${candidates.length}개]
${candidateText}

위 후보들을 심층 분석하여, 지금 진입 가능한 눌림목 종목을 최대 5개 선정하라.
결과를 JSON으로:
\`\`\`json
{
  "pullback_picks": [
    {
      "stock_code": "000000",
      "stock_name": "종목명",
      "reason": "[눌림목 타점 분석] MA20 위 +N% 이격. 고점 대비 -N% 조정. 이슈 수혜 섹터 해당. 과거 AI 추천 이력 있음. 현재가 N원이 좋은 진입 구간.",
      "confidence": 75,
      "lifespan_days": 5
    }
  ]
}
\`\`\``;

            console.log(`[PullbackScanner] AI 최종 심사 요청 (${candidates.length}개 → 최대 5개 선정)...`);

            const response = await AiExecutionQueue.getInstance().enqueue({
                agentId: 'PULLBACK_SCANNER',
                agentName: '눌림목 스캐너 AI',
                triggerType: 'CRON',
                targetType: 'gemini',
                prompt: userPrompt,
                systemInstruction: systemPrompt,
            });

            // ─── Step 5: 파싱 및 DB 저장 ──────────────────────────────────
            const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
            if (!jsonMatch || !jsonMatch[1]) {
                console.warn('[PullbackScanner] JSON 파싱 실패. 응답 원문:', response.substring(0, 200));
                return null;
            }

            const parsed = JSON.parse(jsonMatch[1]);
            const pullbackPicks = parsed.pullback_picks || [];

            if (pullbackPicks.length === 0) {
                console.log('[PullbackScanner] ✅ AI 판단: 오늘은 추천할 눌림목 없음.');
                return [];
            }

            const mappedPicks = pullbackPicks.map((p: any) => ({
                date: dateStr,
                agent_type: 'PULLBACK',
                stock_code: p.stock_code,
                stock_name: p.stock_name,
                reason: p.reason,
                confidence: Math.min(100, Math.max(0, Number(p.confidence) || 60)),
                lifespan_days: Math.min(10, Math.max(2, Number(p.lifespan_days) || 5)),
                created_at: this.db.getKstTimestamp(),
            }));

            this.db.saveAiAnalystPicks(mappedPicks);
            console.log(`[PullbackScanner] ✅ ${mappedPicks.length}개 눌림목 후보 DB 저장 완료.`);
            mappedPicks.forEach((p: any) => {
                console.log(`  → ${p.stock_name}(${p.stock_code}) | 확신도: ${p.confidence} | 수명: ${p.lifespan_days}일`);
            });

            return mappedPicks;

        } catch (e: any) {
            console.error('[PullbackScanner] ❌ 스캔 중 오류:', e.message);
            throw e;
        }
    }
}
