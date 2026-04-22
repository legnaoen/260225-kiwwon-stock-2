/**
 * StockSignalBuilder — PM2 팩트시트용 종목 신호 1차 가공기
 *
 * 각 Collector에서 원시 데이터를 받아 카테고리별로 필요한 신호만 추출·압축한 뒤
 * 간결한 텍스트 블록으로 변환하여 AI 프롬프트에 주입합니다.
 *
 * ═══ 카테고리별 사용 신호 ═══
 *   THEME    : OHLCV + 신용비율
 *   MOMENTUM : OHLCV + SmartMoney(풀 분석) + 신용비율
 *   PULLBACK : OHLCV + SmartMoney(이탈 여부만) + 신용비율
 *   REPORT   : OHLCV + FinanceInfo(재무 섹션 추출) + SmartMoney(확인매수) + 신용비율
 *
 * ═══ 설계 원칙 ═══
 *   - 원시 데이터 그대로 AI에 전달하지 않음 (노이즈 차단)
 *   - 60행 OHLCV → 5개 신호 / SmartMoney 60행 → 3개 신호
 *   - FinanceInfoCollector 마크다운 → 필요 섹션 3개만 슬라이스
 *   - 모든 외부 호출은 try/catch로 보호하여 실패 시 graceful degradation
 */

import { DatabaseService } from '../DatabaseService';
import { FundamentalCollector } from './collectors/FundamentalCollector';
import { SmartMoneyCollector } from './collectors/SmartMoneyCollector';
import { FinanceInfoCollector } from './collectors/FinanceInfoCollector';

// ─── 타입 정의 ────────────────────────────────────────────────────────────────
type Category = 'THEME' | 'MOMENTUM' | 'PULLBACK' | 'REPORT' | string;

interface OhlcvRow {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface SmartMoneyRow {
    date: string;
    frgnr_net_buy_amt: number;
    orgn_net_buy_amt: number;
    ind_net_buy_amt: number;
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────
const FINANCE_SECTION_KEYWORDS = ['분기별', '컨센서스', '기업실적', 'Consensus', '목표주가'];
const MAX_LINES_PER_SECTION = 25;

// ─────────────────────────────────────────────────────────────────────────────
export class StockSignalBuilder {
    private static instance: StockSignalBuilder;

    private constructor() {}

    public static getInstance(): StockSignalBuilder {
        if (!StockSignalBuilder.instance) {
            StockSignalBuilder.instance = new StockSignalBuilder();
        }
        return StockSignalBuilder.instance;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC: 카테고리별 신호 블록 생성 (PM2 팩트시트 주입 엔트리포인트)
    // ═══════════════════════════════════════════════════════════════════════════
    public async buildSignals(stockCode: string, stockName: string, category: Category): Promise<string> {
        const parts: string[] = [];

        // ① 공통: OHLCV 신호 (DB 직접 조회 — 항상 포함)
        try {
            const ohlcvSignal = this.buildOhlcvSignals(stockCode);
            if (ohlcvSignal) parts.push(ohlcvSignal);
        } catch (e: any) {
            console.warn(`[StockSignalBuilder] OHLCV 신호 실패 (${stockCode}):`, e.message);
        }

        // ② 공통: 신용비율 (FundamentalCollector — 신용비율 전용)
        try {
            const fundData = await new FundamentalCollector().collect({ keyword: stockCode });
            if (fundData?.credit_ratio !== undefined) {
                parts.push(this.buildCreditSignal(fundData.credit_ratio));
            }
        } catch (e: any) {
            console.warn(`[StockSignalBuilder] 신용비율 실패 (${stockCode}):`, e.message);
        }

        // ③ 카테고리별 분기
        const cat = category?.toUpperCase() || 'MOMENTUM';

        if (cat === 'MOMENTUM') {
            try {
                const result = await new SmartMoneyCollector().collect({ keyword: stockCode });
                if (result?.flowData?.length > 0) {
                    parts.push(this.buildSmartMoneySignals(result.flowData, 'FULL'));
                }
            } catch (e: any) {
                console.warn(`[StockSignalBuilder] SmartMoney(FULL) 실패 (${stockCode}):`, e.message);
            }

        } else if (cat === 'PULLBACK') {
            try {
                const result = await new SmartMoneyCollector().collect({ keyword: stockCode });
                if (result?.flowData?.length > 0) {
                    parts.push(this.buildSmartMoneySignals(result.flowData, 'EXODUS_ONLY'));
                }
            } catch (e: any) {
                console.warn(`[StockSignalBuilder] SmartMoney(EXODUS) 실패 (${stockCode}):`, e.message);
            }

        } else if (cat === 'REPORT') {
            // FinanceInfo: 재무 섹션 추출 (REPORT 전용)
            try {
                const finResult = await new FinanceInfoCollector().collect({ keyword: stockCode });
                if (finResult?.markdown) {
                    const extracted = this.extractFinanceSections(finResult.markdown);
                    if (extracted.trim()) {
                        parts.push(`[📋 재무·컨센서스 (네이버 기준)]\n${extracted}`);
                    }
                }
            } catch (e: any) {
                console.warn(`[StockSignalBuilder] FinanceInfo 실패 (${stockCode}):`, e.message);
            }

            // SmartMoney: 리포트 후 기관 확인매수 여부
            try {
                const result = await new SmartMoneyCollector().collect({ keyword: stockCode });
                if (result?.flowData?.length > 0) {
                    parts.push(this.buildSmartMoneySignals(result.flowData, 'CONFIRM_ONLY'));
                }
            } catch (e: any) {
                console.warn(`[StockSignalBuilder] SmartMoney(CONFIRM) 실패 (${stockCode}):`, e.message);
            }
        }
        // THEME: OHLCV + 신용비율만 (①② 공통 신호로 충분)

        if (parts.length === 0) return '';
        return `[📡 수급·재무·신용 통합 신호]\n${parts.join('\n')}\n`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE: OHLCV 신호 (60일 → 5개 신호)
    // ═══════════════════════════════════════════════════════════════════════════
    private buildOhlcvSignals(stockCode: string): string {
        const db = DatabaseService.getInstance().getDb();

        // 최근 60일 OHLCV (최신순)
        const rows = db.prepare(`
            SELECT date, open, high, low, close, volume
            FROM market_ohlcv_history
            WHERE stock_code = ?
            ORDER BY date DESC
            LIMIT 60
        `).all(stockCode) as OhlcvRow[];

        if (!rows || rows.length < 5) return '';

        const close   = Number(rows[0].close);
        const todayVol = Number(rows[0].volume);

        // MA 계산 유틸
        const avg = (arr: OhlcvRow[], n: number, field: keyof OhlcvRow): number => {
            const slice = arr.slice(0, Math.min(n, arr.length));
            return slice.reduce((s, r) => s + Number(r[field]), 0) / slice.length;
        };

        const ma20  = avg(rows, 20,  'close');
        const ma60  = avg(rows, 60,  'close');
        const avg20vol = avg(rows, 20, 'volume');
        const avg5vol  = avg(rows, 5,  'volume');
        const max60high = Math.max(...rows.map(r => Number(r.high)));

        // 1) 거래량 신호
        const volRatio = avg20vol > 0 ? todayVol / avg20vol : 1;
        const volSignal = volRatio >= 2.0 ? `🔥 거래량 폭발 (20일 평균의 ${volRatio.toFixed(1)}배)`
                        : volRatio >= 1.5 ? `📈 거래량 증가 (20일 평균의 ${volRatio.toFixed(1)}배)`
                        : `📊 거래량 보통 (20일 평균의 ${volRatio.toFixed(1)}배)`;

        // 2) 60일 고점 대비 위치
        const fromPeak = max60high > 0 ? ((close - max60high) / max60high * 100).toFixed(1) : '0';
        const peakSignal = `60일 고점 대비 ${Number(fromPeak) >= 0 ? '+' : ''}${fromPeak}%`;

        // 3) MA20 괴리율
        const ma20Gap = ma20 > 0 ? ((close - ma20) / ma20 * 100).toFixed(1) : 'N/A';
        const ma60Gap = ma60 > 0 ? ((close - ma60) / ma60 * 100).toFixed(1) : 'N/A';
        const maSignal = `MA20 ${Number(ma20Gap) >= 0 ? '+' : ''}${ma20Gap}% / MA60 ${Number(ma60Gap) >= 0 ? '+' : ''}${ma60Gap}%`;

        // 4) 최근 10일 양봉 수
        const last10 = rows.slice(0, 10);
        const upDays = last10.filter(r => Number(r.close) > Number(r.open)).length;
        const upSignal = `최근 10일 양봉 ${upDays}일/${last10.length}일`;

        // 5) 거래량 추세 (5일 vs 20일)
        const volTrend = avg5vol > avg20vol * 1.2 ? '거래량 증가추세' : avg5vol < avg20vol * 0.8 ? '거래량 감소추세' : '거래량 보통';

        return [
            `[차트·거래량] ${volSignal} / ${peakSignal}`,
            `[이동평균]    ${maSignal} / ${upSignal} / ${volTrend}`,
        ].join('\n');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE: 신용비율 신호
    // ═══════════════════════════════════════════════════════════════════════════
    private buildCreditSignal(ratio: number): string {
        const r = Number(ratio) || 0;
        if (r <= 0)   return `[신용비율] 정보 없음`;
        if (r <= 1.0) return `[신용비율] ${r}% 🟢 안전 (레버리지 부담 없음)`;
        if (r <= 2.0) return `[신용비율] ${r}% 🟡 적정`;
        if (r <= 3.5) return `[신용비율] ${r}% 🟠 경계 — 반대매매 리스크 주의`;
        return             `[신용비율] ${r}% 🔴 고신용 경고 — 추가 하락 압력 상존`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE: SmartMoney 수급 신호 (모드별 가공)
    // ═══════════════════════════════════════════════════════════════════════════
    private buildSmartMoneySignals(
        flowData: SmartMoneyRow[],
        mode: 'FULL' | 'EXODUS_ONLY' | 'CONFIRM_ONLY'
    ): string {
        if (!flowData || flowData.length < 5) return '';

        const toEok = (v: number) => (v / 100_000_000).toFixed(0) + '억';

        const last5  = flowData.slice(0, 5);
        const last20 = flowData.slice(0, Math.min(20, flowData.length));

        const frgnr5d  = last5.reduce((s, d) => s + (Number(d.frgnr_net_buy_amt) || 0), 0);
        const orgn5d   = last5.reduce((s, d) => s + (Number(d.orgn_net_buy_amt)  || 0), 0);
        const frgnr20d = last20.reduce((s, d) => s + (Number(d.frgnr_net_buy_amt) || 0), 0);

        // 이탈 기준: 5일 누적 -100억 이상
        const EXODUS_THRESHOLD = -10_000_000_000;

        if (mode === 'EXODUS_ONLY') {
            const isExodus = frgnr5d < EXODUS_THRESHOLD;
            return isExodus
                ? `[수급 이탈] ⚠️ 눌림 중 외국인 이탈 감지 (5일 ${toEok(frgnr5d)})`
                : `[수급 유지] ✅ 눌림 중 외국인 이탈 없음 (5일 ${toEok(frgnr5d)})`;
        }

        if (mode === 'CONFIRM_ONLY') {
            return orgn5d > 0
                ? `[기관 확인] ✅ 최근 5일 기관 순매수 +${toEok(orgn5d)} → 리포트 신뢰도 높음`
                : `[기관 확인] 최근 5일 기관 순매수 없음 (리포트 선반영 가능성)`;
        }

        // FULL (MOMENTUM)
        const isAccel = frgnr5d > 0 && frgnr20d > 0 && frgnr5d > frgnr20d * 0.35;
        const bothBuy = frgnr5d > 0 && orgn5d > 0;
        const sign = (v: number) => v >= 0 ? '+' : '';

        return [
            `[외국인] 5일 ${sign(frgnr5d)}${toEok(frgnr5d)} / 20일 ${sign(frgnr20d)}${toEok(frgnr20d)}${isAccel ? ' (최근 가속 ✅)' : ' (분산)'}`,
            `[기관  ] 5일 ${sign(orgn5d)}${toEok(orgn5d)}${bothBuy ? ' → 외국인+기관 동시 매수 ⭐' : ''}`,
        ].join('\n');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE: FinanceInfoCollector 마크다운 → 필요 섹션만 추출 (REPORT 전용)
    // ═══════════════════════════════════════════════════════════════════════════
    private extractFinanceSections(markdown: string): string {
        if (!markdown) return '';

        const lines = markdown.split('\n');
        const result: string[] = [];
        let inSection = false;
        let sectionCount = 0;
        let lineCount = 0;
        const MAX_SECTIONS = 3;

        for (const line of lines) {
            // 최대 섹션 수 도달 시 종료
            if (sectionCount >= MAX_SECTIONS) break;

            const isTarget = FINANCE_SECTION_KEYWORDS.some(kw => line.includes(kw));

            if (isTarget && !inSection) {
                inSection = true;
                lineCount = 0;
                if (result.length > 0) result.push(''); // 섹션 구분 공백
                sectionCount++;
            }

            if (inSection) {
                // 빈 줄이 2줄 이상 연속이거나, 섹션 라인 초과 시 종료
                if (line.trim() === '' && result.length > 0 && result[result.length - 1].trim() === '') {
                    inSection = false;
                    continue;
                }
                if (lineCount >= MAX_LINES_PER_SECTION) {
                    inSection = false;
                    continue;
                }
                result.push(line);
                lineCount++;
            }
        }

        const extracted = result.join('\n').trim();

        // 추출 실패 시 fallback: 전체 마크다운 첫 40줄
        if (!extracted) {
            return lines.slice(0, 40).join('\n');
        }

        return extracted;
    }
}
