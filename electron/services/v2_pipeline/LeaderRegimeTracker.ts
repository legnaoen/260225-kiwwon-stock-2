/**
 * LeaderRegimeTracker.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Track A: 시장 대장 테마/섹터 레짐 추적 서비스
 *
 * [설계 원칙]
 * - Layer 1 (Leader Status): naver_market_flow 랭킹 빈도 기반 — 연속이 아닌 횟수
 * - Layer 2 (Entry Signal):  theme_price_index 60봉/120봉 저점 대비 상승률(Heat Score)
 *                            + market_ohlcv_history 거래량 추세(vol_ratio)
 * - 두 레이어는 완전히 독립 계산 후 조합 → combined_signal 산출
 * - DB: leader_regime_snapshot (Track A 전용, Track B 완전 분리)
 * ─────────────────────────────────────────────────────────────────────────
 */

import { DatabaseService } from '../DatabaseService'

// ── 타입 정의 ──────────────────────────────────────────────────────────────

export type LeaderStatus =
    | 'CONFIRMED'       // 10일 중 6일 이상 Top10
    | 'EMERGING'        // 3일 중 2일 이상 Top15, 첫 부각
    | 'STRENGTHENING'   // EMERGING이면서 순위 개선 추세
    | 'DECLINING'       // 순위 밀리기 시작 또는 AI 강제 하향(과열/설거지)
    | 'PAST'            // 과거 CONFIRMED였으나 현재 소강
    | 'CANDIDATE'       // Top20 1-2회, 판단 보류

export type EntryZone =
    | 'EARLY'           // heat<20%, vol≥1.0  — 최적 매수
    | 'MOMENTUM'        // heat 20~40%, vol≥1.0 — 모멘텀 탑승
    | 'RISK'            // heat 40~60%          — 위험, 단기만
    | 'AVOID'           // heat>60% 또는 vol<0.6 — 신규 금지
    | 'RELOAD'          // PAST + heat리셋       — 눌림목 재매수

export type CombinedSignal =
    | 'BEST_BUY'
    | 'BUY'
    | 'HOLD_ONLY'
    | 'SELL_ALERT'
    | 'EXIT'
    | 'PREPARE_EXIT'
    | 'REVIVAL_BUY'
    | 'WATCH'

interface FlowRecord {
    date: string
    type: string
    name: string
    rank_num: number
    change_rate: number
}

interface RegimeResult {
    type: string
    name: string
    leaderStatus: LeaderStatus
    appearances10d: number
    avgRank5d: number
    avgRankPrev5d: number
    rankToday: number | null
    changeRateToday: number
    lifespanType: string | null
    confirmedSince: string | null
    entryZone: EntryZone
    heatScore60d: number
    heatScore120d: number
    stockAvgHeat60: number
    volRatio5d20d: number
    combinedSignal: CombinedSignal
    leadingStocks: string | null  // JSON
}

// ── Combined Signal 매핑 테이블 ─────────────────────────────────────────────

const SIGNAL_MAP: Partial<Record<`${LeaderStatus}:${EntryZone}`, CombinedSignal>> = {
    'EMERGING:EARLY':         'BEST_BUY',
    'STRENGTHENING:EARLY':    'BEST_BUY',
    'CONFIRMED:EARLY':        'BEST_BUY',
    'EMERGING:MOMENTUM':      'BUY',
    'STRENGTHENING:MOMENTUM': 'BUY',
    'CONFIRMED:MOMENTUM':     'BUY',
    'CONFIRMED:RISK':         'HOLD_ONLY',
    'CONFIRMED:RELOAD':       'BEST_BUY',   // 대장 복귀
    'DECLINING:RISK':         'SELL_ALERT',
    'DECLINING:AVOID':        'EXIT',
    'DECLINING:RELOAD':       'SELL_ALERT', // DECLINING은 RELOAD여도 위험
    'CONFIRMED:AVOID':        'PREPARE_EXIT',
    'PAST:RELOAD':            'REVIVAL_BUY',
    'PAST:EARLY':             'REVIVAL_BUY',
    'CANDIDATE:EARLY':        'WATCH',
    'CANDIDATE:MOMENTUM':     'WATCH',
}

// ── 메인 서비스 클래스 ─────────────────────────────────────────────────────

export class LeaderRegimeTracker {
    constructor(private db: DatabaseService) {}

    /**
     * 메인 진입점 — 매일 15:45 PortfolioJudgeScheduler에서 호출
     */
    public async analyzeDailyRegime(today: string): Promise<{
        processed: number
        bestBuyCount: number
        exitCount: number
        summary: string[]
    }> {
        console.log(`[LeaderRegimeTracker] 📊 ${today} 레짐 분석 요청됨...`)

        let targetDate = today;
        let todayFlow = this.db.getTodayMarketFlow(targetDate);

        if (todayFlow.length === 0) {
            console.warn(`[LeaderRegimeTracker] ⚠️ ${today} naver_market_flow 데이터 없음. 이전 최신 데이터 폴백 시도...`)
            const latestObj = this.db.db.prepare("SELECT MAX(date) as max_date FROM naver_market_flow WHERE date <= ?").get(today) as { max_date: string | null };
            if (latestObj && latestObj.max_date) {
                targetDate = latestObj.max_date;
                todayFlow = this.db.getTodayMarketFlow(targetDate);
                console.log(`[LeaderRegimeTracker] 🔄 ${targetDate} 기준 데이터로 레짐 분석 덮어쓰기 진행`);
            } else {
                return { processed: 0, bestBuyCount: 0, exitCount: 0, summary: ['데이터 없음'] }
            }
        }

        // [Step 1] Layer 1 데이터: 오늘 Top20 + 최근 20일 히스토리
        const allHistory  = this.loadFlowHistory(targetDate, 20)

        // [Step 2] Layer 2 데이터: 구성종목 과열도 (market_ohlcv_history)
        const stockHeat = this.db.getStockHeatByTheme(targetDate)

        // [Step 4] 오늘 Top20 각 테마/섹터별 레짐 판정
        const snapshots: any[] = []
        const summaryLines: string[] = []
        let bestBuyCount = 0
        let exitCount = 0

        for (const item of todayFlow) {
            if (item.name === '기타' || item.name.includes('기타')) continue;

            const result = this.assessSingleItem(item, allHistory, stockHeat, targetDate)
            snapshots.push(this.toSnapshotRow(targetDate, result))

            if (result.combinedSignal === 'BEST_BUY') bestBuyCount++
            if (result.combinedSignal === 'EXIT' || result.combinedSignal === 'SELL_ALERT') exitCount++
            summaryLines.push(`[${result.combinedSignal}] ${result.name} — ${result.leaderStatus}×${result.entryZone} heat=${result.heatScore60d.toFixed(0)}%`)
        }

        // [Step 5] Top20 밖이지만 PAST 이력 있는 테마 → RELOAD 체크
        const revivalItems = this.checkRevivalCandidates(targetDate, todayFlow, allHistory, stockHeat)
        for (const rev of revivalItems) {
            if (rev.name === '기타' || rev.name.includes('기타')) continue;

            snapshots.push(this.toSnapshotRow(targetDate, rev))
            if (rev.combinedSignal === 'REVIVAL_BUY') {
                summaryLines.push(`[🔄 REVIVAL] ${rev.name} — heat=${rev.heatScore60d.toFixed(0)}% 리셋`)
            }
        }

        // [Step 6] 일괄 저장 및 클린업
        this.db.db.prepare("DELETE FROM leader_regime_snapshot WHERE name = '기타' OR name LIKE '%기타%'").run();
        
        if (snapshots.length > 0) {
            this.db.saveLeaderRegimeSnapshots(snapshots)
        }

        console.log(`[LeaderRegimeTracker] ✅ 완료: ${snapshots.length}건 저장 | BEST_BUY=${bestBuyCount} | EXIT=${exitCount}`)
        return {
            processed:   snapshots.length,
            bestBuyCount,
            exitCount,
            summary: summaryLines,
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 단일 아이템 평가
    // ─────────────────────────────────────────────────────────────────────

    private assessSingleItem(
        item: FlowRecord,
        allHistory: FlowRecord[],
        stockHeat: Record<string, { avg_heat_60: number; avg_heat_120: number; vol_ratio: number; stock_count: number }>,
        today: string,
    ): RegimeResult {
        // Layer 1: Leader Status
        const { status, appearances10d, avgRank5d, avgRankPrev5d, confirmedSince } =
            this.determineLeaderStatus(item, allHistory, today)

        // Layer 2: Entry Zone (테마 자체의 Heat 대신 구성종목 Heat를 메인으로 사용)
        const { zone, heatScore60d, heatScore120d, stockAvgHeat60, volRatio, absVol } =
            this.determineEntryZone(item.name, stockHeat)

        // Combine
        const signal = this.combineLayers(status, zone)

        // AI lifespan
        const lifespanType = this.db.getThemeLifespan(item.type, item.name)

        return {
            type:           item.type,
            name:           item.name,
            leaderStatus:   status,
            appearances10d,
            avgRank5d,
            avgRankPrev5d,
            rankToday:      item.rank_num,
            changeRateToday: item.change_rate,
            lifespanType,
            confirmedSince,
            entryZone:      zone,
            heatScore60d,
            heatScore120d,
            stockAvgHeat60,
            volRatio5d20d:  volRatio,
            combinedSignal: signal,
            leadingStocks:  null,   // TODO: Phase 1-C에서 구현
            theme_abs_vol:  absVol,
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Layer 1: Leader Status 판정
    // ─────────────────────────────────────────────────────────────────────

    private determineLeaderStatus(
        item: FlowRecord,
        allHistory: FlowRecord[],
        today: string,
    ): {
        status: LeaderStatus
        appearances10d: number
        avgRank5d: number
        avgRankPrev5d: number
        confirmedSince: string | null
    } {
        const name = item.name
        const type = item.type

        // AI 생애주기 강제 하향 체크
        const lifespan = this.db.getThemeLifespan(type, name)
        if (lifespan === '과열' || lifespan === '설거지') {
            return {
                status: 'DECLINING',
                appearances10d: this.countAppearances(name, allHistory, today, 10, 10),
                avgRank5d:      this.calcAvgRank(name, allHistory, today, 5),
                avgRankPrev5d:  this.calcAvgRank(name, allHistory, today, 5, 5),
                confirmedSince: null,
            }
        }

        const appearances10d   = this.countAppearances(name, allHistory, today, 10, 10)  // 10일중 Top10
        const appearances3d15  = this.countAppearancesInRank(name, allHistory, today, 3, 15)  // 3일중 Top15
        const avgRank5d        = this.calcAvgRank(name, allHistory, today, 5)
        const avgRankPrev5d    = this.calcAvgRank(name, allHistory, today, 5, 5)

        let status: LeaderStatus
        let confirmedSince: string | null = null

        if (appearances10d >= 6) {
            // 순위가 밀리기 시작? (최근 5일 > 직전 5일 + 2)
            if (avgRank5d > avgRankPrev5d + 2) {
                status = 'DECLINING'
            } else {
                status = 'CONFIRMED'
                confirmedSince = this.findConfirmedSince(name)
            }
        } else if (appearances3d15 >= 2) {
            // 최근 3일중 2일 이상 Top15 등장
            if (avgRank5d < avgRankPrev5d - 1) {
                status = 'STRENGTHENING'  // 순위 개선 중
            } else {
                status = 'EMERGING'
            }
        } else if (this.db.hasPastConfirmedRegime(name)) {
            status = 'PAST'
        } else {
            status = 'CANDIDATE'
        }

        return { status, appearances10d, avgRank5d, avgRankPrev5d, confirmedSince }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Layer 2: Entry Zone 판정
    // ─────────────────────────────────────────────────────────────────────

    private determineEntryZone(
        name: string,
        stockHeat: Record<string, { avg_heat_60: number; avg_heat_120: number; vol_ratio: number; stock_count: number }>,
    ): {
        zone: EntryZone
        heatScore60d: number
        heatScore120d: number
        stockAvgHeat60: number
        volRatio: number
    } {
        // 구성종목 평균 과열도를 테마 과열도로 설정
        const sh60      = stockHeat[name]?.avg_heat_60  ?? 999
        const sh120     = stockHeat[name]?.avg_heat_120 ?? 999
        const volRatio  = stockHeat[name]?.vol_ratio    ?? 1.0

        const h60       = sh60
        const h120      = sh120

        const hasPast   = this.db.hasPastConfirmedRegime(name)

        // 거래량 급감 → AVOID (열도 무관)
        if (volRatio < 0.6) {
            return { zone: 'AVOID', heatScore60d: h60, heatScore120d: h120, stockAvgHeat60: sh60, volRatio }
        }

        // 과거 대장 + Heat 리셋 → RELOAD (눌림목 재매수)
        if (hasPast && h60 < 20 && sh60 < 25 && volRatio >= 0.9) {
            return { zone: 'RELOAD', heatScore60d: h60, heatScore120d: h120, stockAvgHeat60: sh60, volRatio }
        }

        // EARLY: 이격 여유 충분 + 수급 유입
        if (h60 < 20 && sh60 < 25 && volRatio >= 1.0) {
            return { zone: 'EARLY', heatScore60d: h60, heatScore120d: h120, stockAvgHeat60: sh60, volRatio }
        }

        // MOMENTUM: 메인 상승 구간
        if (h60 < 40 && sh60 < 50 && volRatio >= 1.0) {
            return { zone: 'MOMENTUM', heatScore60d: h60, heatScore120d: h120, stockAvgHeat60: sh60, volRatio }
        }

        // RISK: 과열 구간, 단기만
        if (h60 < 60 && sh60 < 70) {
            return { zone: 'RISK', heatScore60d: h60, heatScore120d: h120, stockAvgHeat60: sh60, volRatio }
        }

        // AVOID: 극도 과열
        return { zone: 'AVOID', heatScore60d: h60, heatScore120d: h120, stockAvgHeat60: sh60, volRatio }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Combine: Layer 1 + Layer 2 → Combined Signal
    // ─────────────────────────────────────────────────────────────────────

    private combineLayers(status: LeaderStatus, zone: EntryZone): CombinedSignal {
        return SIGNAL_MAP[`${status}:${zone}`] ?? 'WATCH'
    }

    // ─────────────────────────────────────────────────────────────────────
    // PAST 이력 테마 RELOAD 체크 (오늘 Top20 밖)
    // ─────────────────────────────────────────────────────────────────────

    private checkRevivalCandidates(
        today: string,
        todayFlow: FlowRecord[],
        allHistory: FlowRecord[],
        stockHeat: Record<string, { avg_heat_60: number; avg_heat_120: number; vol_ratio: number; stock_count: number }>,
    ): RegimeResult[] {
        const todayNames = new Set(todayFlow.map(f => f.name))
        const results: RegimeResult[] = []

        // stockHeat에 있는 모든 테마 중 오늘 Top20에 없고 PAST + RELOAD 조건인 것만
        for (const [name, heat] of Object.entries(stockHeat)) {
            if (todayNames.has(name)) continue
            if (!this.db.hasPastConfirmedRegime(name)) continue

            const sh60     = heat.avg_heat_60  ?? 999
            const sh120    = heat.avg_heat_120 ?? 999
            const volRatio = heat.vol_ratio    ?? 1.0
            const absVol   = heat.theme_abs_vol ?? 0

            // PAST + Heat 리셋 + 거래량 회복
            if (sh60 < 20 && volRatio >= 0.9) {
                results.push({
                    type:           'THEME', // 섹터 구분이 없으면 THEME으로 처리
                    name,
                    leaderStatus:   'PAST',
                    appearances10d: this.countAppearances(name, allHistory, today, 10, 10),
                    avgRank5d:      99,
                    avgRankPrev5d:  99,
                    rankToday:      null,
                    changeRateToday: 0,
                    lifespanType:   this.db.getThemeLifespan('THEME', name),
                    confirmedSince: null,
                    entryZone:      'RELOAD',
                    heatScore60d:   sh60,
                    heatScore120d:  sh120,
                    stockAvgHeat60: sh60,
                    volRatio5d20d:  volRatio,
                    combinedSignal: 'REVIVAL_BUY',
                    leadingStocks:  null,
                })
            }
        }

        return results
    }

    // ─────────────────────────────────────────────────────────────────────
    // 헬퍼 메서드
    // ─────────────────────────────────────────────────────────────────────

    /**
     * 역대 히스토리를 날짜별 배열로 로드
     * naver_market_flow에서 모든 type을 한 번에 읽어 메모리에서 처리 (N+1 방지)
     */
    private loadFlowHistory(today: string, days: number): FlowRecord[] {
        const cutoff = new Date(today)
        cutoff.setDate(cutoff.getDate() - days)
        const cutoffStr = cutoff.toISOString().slice(0, 10)

        // 직접 DB에서 날짜 범위로 읽기
        return (this.db as any).db.prepare(`
            SELECT date, type, name, rank_num, change_rate
            FROM naver_market_flow
            WHERE date >= ? AND date <= ?
            ORDER BY date ASC, rank_num ASC
        `).all(cutoffStr, today) as FlowRecord[]
    }

    /**
     * [빈도 기반] N일 중 rank ≤ rankThreshold 이하로 등장한 횟수
     */
    private countAppearances(
        name: string,
        history: FlowRecord[],
        today: string,
        windowDays: number,
        rankThreshold: number,
    ): number {
        const cutoff = new Date(today)
        cutoff.setDate(cutoff.getDate() - windowDays)
        const cutoffStr = cutoff.toISOString().slice(0, 10)
        return history.filter(h =>
            h.name === name &&
            h.date >= cutoffStr &&
            h.date <= today &&
            h.rank_num <= rankThreshold
        ).length
    }

    /**
     * [빈도 기반] 최근 windowDays 이내 rankThreshold 이하 등장 횟수
     */
    private countAppearancesInRank(
        name: string,
        history: FlowRecord[],
        today: string,
        windowDays: number,
        rankThreshold: number,
    ): number {
        return this.countAppearances(name, history, today, windowDays, rankThreshold)
    }

    /**
     * [평균 순위] offsetDays 이전부터 windowDays간 평균 랭킹
     * offsetDays=0: 가장 최근 window
     * offsetDays=5: 직전 window (비교용)
     */
    private calcAvgRank(
        name: string,
        history: FlowRecord[],
        today: string,
        windowDays: number,
        offsetDays: number = 0,
    ): number {
        const endDate = new Date(today)
        endDate.setDate(endDate.getDate() - offsetDays)
        const startDate = new Date(endDate)
        startDate.setDate(startDate.getDate() - windowDays)

        const endStr   = endDate.toISOString().slice(0, 10)
        const startStr = startDate.toISOString().slice(0, 10)

        const records = history.filter(h =>
            h.name === name &&
            h.date >= startStr &&
            h.date <= endStr
        )
        if (records.length === 0) return 99  // Top20 밖 = 99로 처리
        return records.reduce((sum, r) => sum + r.rank_num, 0) / records.length
    }

    /**
     * leader_regime_snapshot에서 CONFIRMED 최초 진입일 조회
     */
    private findConfirmedSince(name: string): string | null {
        const row = (this.db as any).db.prepare(`
            SELECT MIN(snapshot_date) as first_date
            FROM leader_regime_snapshot
            WHERE name = ? AND leader_status = 'CONFIRMED'
        `).get(name) as any
        return row?.first_date ?? null
    }

    /**
     * RegimeResult → DB 저장용 객체 변환
     */
    private toSnapshotRow(today: string, r: RegimeResult) {
        return {
            snapshot_date:     today,
            type:              r.type,
            name:              r.name,
            leader_status:     r.leaderStatus,
            appearances_10d:   r.appearances10d,
            avg_rank_5d:       r.avgRank5d,
            avg_rank_prev5d:   r.avgRankPrev5d,
            rank_today:        r.rankToday,
            change_rate_today: r.changeRateToday,
            lifespan_type:     r.lifespanType,
            confirmed_since:   r.confirmedSince,
            heat_score_60d:    r.heatScore60d,
            heat_score_120d:   r.heatScore120d,
            stock_avg_heat_60: r.stockAvgHeat60,
            vol_ratio_5d_20d:  r.volRatio5d20d,
            entry_zone:        r.entryZone,
            combined_signal:   r.combinedSignal,
            leading_stocks:    r.leadingStocks,
            theme_abs_vol:     r.theme_abs_vol,
            ai_summary:        r.lifespanType ? `AI 생애주기: ${r.lifespanType}` : null,
        }
    }
}
