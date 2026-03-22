import { DatabaseService } from './DatabaseService'
import { AiService } from './AiService'
import { SkillsService } from './SkillsService'
import { VirtualPortfolioEngine } from './VirtualPortfolioEngine'
import { eventBus, SystemEvent } from '../utils/EventBus'

/**
 * Phase 2: Portfolio Manager AI Service
 * 
 * daily_rising_stocks + Master AI thesis를 기반으로
 * 개별 종목의 conviction_score를 판단하고 BUY/HOLD/SELL 시그널을 발행합니다.
 * 
 * 상태 머신: WATCHLIST → BUY_SIGNAL → HOLDING → REDUCE → SELL_SIGNAL → CLOSED
 */
export class PortfolioManagerService {
    private static instance: PortfolioManagerService
    private db = DatabaseService.getInstance()
    private ai = AiService.getInstance()
    private skills = SkillsService.getInstance()
    private isRunning = false

    private constructor() {}

    public static getInstance(): PortfolioManagerService {
        if (!PortfolioManagerService.instance) {
            PortfolioManagerService.instance = new PortfolioManagerService()
        }
        return PortfolioManagerService.instance
    }

    /**
     * PM AI 수동 실행 (UI 버튼 트리거)
     * 1. 현재 포트폴리오 현황 조회
     * 2. 오늘의 daily_rising_stocks에서 신규 후보 수집
     * 3. 마스터 AI thesis 조회
     * 4. PM AI 프롬프트로 conviction 판단
     * 5. 결과에 따라 maiis_portfolio 상태 전이
     */
    public async runPortfolioReview(): Promise<any> {
        if (this.isRunning) {
            return { success: false, error: 'PM AI가 이미 실행 중입니다.' }
        }

        this.isRunning = true
        console.log('[PortfolioManager] === PM AI Review 시작 ===')
        eventBus.emit(SystemEvent.AUTO_TRADE_LOG, {
            time: new Date().toLocaleTimeString('en-US', { hour12: false }),
            message: '[PM AI] 포트폴리오 리뷰 시작...',
            level: 'INFO'
        })

        try {
            // 1. 현재 포트폴리오 현황
            const currentPortfolio = this.db.getPortfolio()
            console.log(`[PortfolioManager] 현재 포트폴리오: ${currentPortfolio.length}건`)

            // 2. 오늘의 rising stocks (후보 풀)
            const today = new Date().toISOString().slice(0, 10)
            let candidates = this.db.getRisingStocksByDate(today, 'EVENING')
            if (candidates.length === 0) candidates = this.db.getRisingStocksByDate(today, 'MORNING')
            if (candidates.length === 0) candidates = this.db.getRisingStocksByDate(today, 'MANUAL')
            
            // 최근 날짜 폴백
            if (candidates.length === 0) {
                const latestRow = this.db.getDb().prepare(
                    'SELECT date, timing FROM daily_rising_stocks ORDER BY date DESC, timing DESC LIMIT 1'
                ).get() as any
                if (latestRow) {
                    candidates = this.db.getRisingStocksByDate(latestRow.date, latestRow.timing)
                }
            }
            console.log(`[PortfolioManager] 후보 종목: ${candidates.length}건`)

            // 3. 마스터 AI thesis
            const compactDate = today.replace(/-/g, '')
            const masterState = this.db.getDb().prepare(
                'SELECT * FROM maiis_world_state_v2 WHERE date = ? ORDER BY timing DESC LIMIT 1'
            ).get(compactDate) as any

            const marketThesis = masterState?.market_thesis || '정보 없음'
            const sentimentScore = masterState?.sentiment_score || 0.5

            // 4. PM AI 프롬프트 구성
            const prompt = this.buildPmPrompt(currentPortfolio, candidates, marketThesis, sentimentScore)
            
            // 5. AI 호출
            const systemInstruction = `[역할: Portfolio Manager AI]
당신은 투자 포트폴리오 관리자입니다.
마스터 AI의 시장 대전제와 종목 분석 데이터를 기반으로
각 종목에 대한 투자 확신도(conviction_score, 0~100)와 행동(BUY/HOLD/SELL)을 판단합니다.

## 중요 규칙
- 반드시 순수 JSON만 응답하세요 (마크다운 코드블록 금지)
- reason은 반드시 30자 이내 한 문장으로 작성
- 주석(//) 절대 사용 금지
- conviction_score가 60 미만인 종목은 응답에 포함하지 마세요`

            console.log('[PortfolioManager] AI 호출 중...')
            const aiResponse = await this.ai.askGemini(prompt, systemInstruction, undefined, 'gemini-2.5-flash')

            // 6. 응답 파싱
            const decisions = this.parseAiResponse(aiResponse)
            if (!decisions || decisions.length === 0) {
                console.warn('[PortfolioManager] AI 응답 파싱 실패')
                return { success: false, error: 'AI 응답 파싱 실패', rawResponse: aiResponse?.substring(0, 500) }
            }

            // 7. 포트폴리오 상태 업데이트
            const results = this.applyDecisions(decisions)

            console.log(`[PortfolioManager] === PM AI Review 완료: ${results.updated}건 갱신, ${results.newEntries}건 신규 ===`)
            
            eventBus.emit(SystemEvent.AUTO_TRADE_LOG, {
                time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                message: `[PM AI] 리뷰 완료 — ${results.updated}건 갱신, ${results.newEntries}건 신규 편입, ${results.buySignals}건 BUY, ${results.sellSignals}건 SELL`,
                level: 'SUCCESS'
            })

            return { success: true, data: results }
        } catch (error: any) {
            console.error('[PortfolioManager] PM AI 실패:', error.message)
            eventBus.emit(SystemEvent.AUTO_TRADE_LOG, {
                time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                message: `[PM AI] 오류: ${error.message}`,
                level: 'ERROR'
            })
            return { success: false, error: error.message }
        } finally {
            this.isRunning = false
        }
    }

    /**
     * PM AI 프롬프트 구성
     */
    private buildPmPrompt(
        portfolio: any[],
        candidates: any[],
        marketThesis: string,
        sentimentScore: number
    ): string {
        const portfolioSummary = portfolio.length > 0
            ? portfolio.map(p => 
                `  - ${p.stock_name}(${p.stock_code}): 상태=${p.status}, conviction=${p.conviction_score}, ` +
                `전략=${p.strategy}, 수익률=${p.profit_rate?.toFixed(1)}%, 보유일=${p.days_held}일, ` +
                `사유=${p.last_signal_reason || '없음'}`
            ).join('\n')
            : '  (보유 종목 없음)'

        const candidateSummary = candidates.slice(0, 15).map(c =>
            `  - ${c.stock_name}(${c.stock_code}): 등락률=${c.change_rate?.toFixed(1)}%, ` +
            `AI점수=${c.ai_score}, 테마=${c.theme_sector || '미분류'}, ` +
            `사유=${(c.reason || '').substring(0, 80)}`
        ).join('\n')

        return `
## 오늘의 시장 대전제 (Master AI)
"${marketThesis}"
센티먼트: ${sentimentScore} (0=극도 비관, 1=극도 낙관)

## 현재 포트폴리오 (보유/관심 종목)
${portfolioSummary}

## 오늘의 신규 후보 종목 (급등주/주도주 분석 결과)
${candidateSummary}

## 요구사항
위 정보를 바탕으로 다음을 수행하세요:

1. **기존 보유 종목**: 각 종목의 conviction_score를 재평가하고 action을 결정하세요.
   - conviction >= 70이면 "HOLD" 유지
   - conviction 40~69이면 "REDUCE" (비중 축소 검토)
   - conviction < 40이면 "SELL" (매도 시그널)
   - 목표가 도달 또는 손절선 이탈 시 "SELL"

2. **신규 후보 종목**: conviction_score >= 70인 종목만 "BUY" 추천.
   - 마스터 대전제와 방향이 일치하는 종목 우선
   - target_price(목표가)와 stop_loss_price(손절가) 제시

3. **전략 분류**: DAYTRADING(당일) / SWING(2~10일) / POSITION(10~30일) / LONGTERM(30일+)

## 응답 형식 (순수 JSON만, 마크다운 코드블록 사용 금지)
{"portfolio_decisions":[{"stock_code":"005930","stock_name":"삼성전자","action":"BUY","conviction_score":82,"strategy":"SWING","target_price":85000,"stop_loss_price":72000,"weight_pct":8,"reason":"30자이내핵심사유"}]}

주의: reason은 반드시 30자 이내. conviction_score 60 미만은 제외.
`
    }

    /**
     * AI 응답 파싱
     */
    private parseAiResponse(response: string): any[] | null {
        console.log('[PortfolioManager] Raw AI response length:', response.length)
        
        // 1. 코드 블록 추출
        let jsonStr = response
        const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (jsonMatch) jsonStr = jsonMatch[1].trim()

        // 2. JSON 세척 — AI가 흔히 넣는 오류 수정
        const cleanJson = (str: string): string => {
            return str
                .replace(/\/\/.*$/gm, '')           // 한줄 주석 제거
                .replace(/\/\*[\s\S]*?\*\//g, '')    // 블록 주석 제거
                .replace(/,\s*([}\]])/g, '$1')       // trailing comma 제거
                .replace(/[\x00-\x1F\x7F]/g, (ch) => ch === '\n' || ch === '\r' || ch === '\t' ? ch : '') // 제어 문자 제거
                .trim()
        }

        // 3. portfolio_decisions 객체 시도
        try {
            const objMatch = jsonStr.match(/\{[\s\S]*"portfolio_decisions"[\s\S]*\}/)
            if (objMatch) {
                const parsed = JSON.parse(cleanJson(objMatch[0]))
                if (parsed.portfolio_decisions) return parsed.portfolio_decisions
            }
        } catch {}

        // 4. 전체 문자열 직접 시도
        try {
            const parsed = JSON.parse(cleanJson(jsonStr))
            return parsed.portfolio_decisions || (Array.isArray(parsed) ? parsed : null)
        } catch {}

        // 5. 배열 직접 추출 시도
        try {
            const arrMatch = jsonStr.match(/\[[\s\S]*\]/)
            if (arrMatch) return JSON.parse(cleanJson(arrMatch[0]))
        } catch {}

        // 6. 개별 객체 추출 시도 (배열이 깨진 경우)
        try {
            const objects: any[] = []
            const regex = /\{[^{}]*"stock_code"[^{}]*\}/g
            let match
            while ((match = regex.exec(jsonStr)) !== null) {
                try {
                    objects.push(JSON.parse(cleanJson(match[0])))
                } catch {}
            }
            if (objects.length > 0) return objects
        } catch {}

        console.error('[PortfolioManager] JSON 파싱 실패. Raw 응답 앞부분:', response.substring(0, 500))
        return null
    }

    /**
     * AI 판단 결과를 DB에 반영
     */
    private applyDecisions(decisions: any[]): {
        updated: number, newEntries: number, buySignals: number, sellSignals: number
    } {
        let updated = 0, newEntries = 0, buySignals = 0, sellSignals = 0
        const vpe = VirtualPortfolioEngine.getInstance()
        const isMarketOpen = vpe.isMarketOpen()
        const today = this.db.getKstDate().replace(/-/g, '')

        for (const decision of decisions) {
            if (!decision.stock_code || !decision.stock_name) continue

            const existing = this.db.getPortfolioItem(decision.stock_code)
            const action = (decision.action || 'HOLD').toUpperCase()

            // 상태 머신 전이 로직
            let newStatus = 'WATCHLIST'
            let entryShares = existing?.entry_shares || 0
            let investedAmount = existing?.invested_amount || 0
            let actualEntryPrice = existing?.actual_entry_price || 0
            let entryPending = existing?.entry_pending || 0
            let entryDate = existing?.entry_date || ''

            if (action === 'BUY') {
                buySignals++
                // CLOSED 상태 종목은 재진입 불가 (새 레코드로 처리해야 하므로 skip)
                if (existing?.status === 'CLOSED') continue

                // 이미 보유중이면 HOLDING 유지
                if (existing && (existing.status === 'HOLDING' || existing.status === 'BUY_SIGNAL') && existing.entry_shares > 0) {
                    newStatus = 'HOLDING'
                } else {
                    // 신규 매수
                    const price = decision.current_price || decision.entry_price || 0
                    const buyResult = vpe.executeBuy(decision.stock_code, decision.stock_name, price, isMarketOpen)

                    if (buyResult.success) {
                        if (buyResult.pending) {
                            newStatus = 'BUY_SIGNAL'  // pending이면 아직 확정 아님
                            entryPending = 1
                            entryDate = today
                        } else {
                            newStatus = 'HOLDING'
                            entryShares = buyResult.shares
                            investedAmount = buyResult.investedAmount
                            actualEntryPrice = price
                            entryPending = 0
                            entryDate = today
                        }
                    } else {
                        newStatus = 'WATCHLIST'  // 현금 부족 등
                    }
                }
            } else if (action === 'HOLD') {
                newStatus = existing?.status === 'HOLDING' ? 'HOLDING' : (existing?.status || 'WATCHLIST')
            } else if (action === 'REDUCE') {
                newStatus = 'REDUCE'
            } else if (action === 'SELL') {
                sellSignals++
                if (existing && existing.entry_shares > 0) {
                    const sellPrice = decision.current_price || existing.current_price || 0
                    if (sellPrice > 0) {
                        const sellResult = vpe.executeSell(decision.stock_code, sellPrice)
                        if (sellResult.success) {
                            // DB에 청산 기록
                            this.db.closePortfolioItem(decision.stock_code, sellPrice, today)
                            updated++
                            continue  // upsert 대신 closePortfolioItem이 처리했으므로 skip
                        }
                    }
                }
                newStatus = 'SELL_SIGNAL'
            }

            // 보유일 계산
            const daysHeld = (() => {
                if (!entryDate) return 0
                const entry = new Date(
                    parseInt(entryDate.slice(0, 4)),
                    parseInt(entryDate.slice(4, 6)) - 1,
                    parseInt(entryDate.slice(6, 8))
                )
                const now = new Date()
                return Math.max(0, Math.floor((now.getTime() - entry.getTime()) / (1000 * 60 * 60 * 24)))
            })()

            this.db.upsertPortfolioItem({
                stock_code: decision.stock_code,
                stock_name: decision.stock_name,
                status: newStatus,
                strategy: decision.strategy || existing?.strategy || 'SWING',
                conviction_score: decision.conviction_score || 50,
                theme: decision.theme || existing?.theme || '',
                entry_price: actualEntryPrice || existing?.entry_price || 0,
                current_price: decision.current_price || existing?.current_price || 0,
                target_price: decision.target_price || existing?.target_price || 0,
                stop_loss_price: decision.stop_loss_price || existing?.stop_loss_price || 0,
                profit_rate: existing?.profit_rate || 0,
                weight_pct: decision.weight_pct || existing?.weight_pct || 0,
                entry_date: entryDate,
                last_signal: action,
                last_signal_reason: decision.reason || '',
                days_held: daysHeld,
                source: 'PM_AI'
            })

            // NAV 엔진용 컬럼 별도 업데이트 (upsert에서 다루지 않는 필드)
            if (entryShares > 0 || entryPending) {
                this.db.getDb().prepare(`
                    UPDATE maiis_portfolio SET
                        actual_entry_price = ?, entry_shares = ?, invested_amount = ?, entry_pending = ?
                    WHERE stock_code = ?
                `).run(actualEntryPrice, entryShares, investedAmount, entryPending, decision.stock_code)
            }

            if (existing) {
                updated++
            } else {
                newEntries++
            }
        }

        return { updated, newEntries, buySignals, sellSignals }
    }
}

