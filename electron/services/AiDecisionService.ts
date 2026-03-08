import { MarketScannerService } from './MarketScannerService'
import { VirtualAccountService } from './VirtualAccountService'
import { KiwoomService } from './KiwoomService'
import { AiService } from './AiService'
import { DatabaseService } from './DatabaseService'
import { DataLoggingService } from './DataLoggingService'
import { eventBus, SystemEvent } from '../utils/EventBus'
import Store from 'electron-store';

const store = new Store();

export class AiDecisionService {
    private static instance: AiDecisionService;

    private scanner = MarketScannerService.getInstance();
    private account = VirtualAccountService.getInstance();
    private kiwoom = KiwoomService.getInstance();
    private ai = AiService.getInstance();
    private db = DatabaseService.getInstance();

    private isAutoPilot = false;
    private isEvaluating = false;

    private constructor() {
        this.isAutoPilot = store.get('ai_trade_autopilot', false) as boolean;

        // Ensure runtime config is initialized if empty
        if (!store.get('ai_runtime_config')) {
            this.syncRuntimeConfigWithActiveStrategy();
        }

        // Listen for internal AI analysis cycles (every 5 seconds)
        setInterval(() => this.analyzeMarket(), 5000);
    }

    public getActiveConfig() {
        // [Manual Priority] Use manually set parameters if they exist in runtime config
        const runtime = store.get('ai_runtime_config') as any;
        if (runtime && Object.keys(runtime).length > 0) return runtime; // Check if runtime is not empty object

        // Fallback to active strategy from DB
        const strategies = this.db.getAiStrategies();
        const active = strategies.find(s => s.isActive);
        if (active) {
            return {
                targetProfit: active.targetProfit,
                stopLoss: active.stopLoss,
                minAiScore: active.minAiScore,
                maxPositions: active.maxPositions,
                scoringWeights: active.scoringWeights,
                masterPrompt: active.masterPrompt
            };
        }

        // Default Defaults
        return {
            targetProfit: 3.0,
            stopLoss: -2.0,
            minAiScore: 60,
            maxPositions: 2,
            scoringWeights: { vwap: 30, velocity: 25, trend: 20, gap: 10, leader: 15 },
            masterPrompt: "당신은 대한민국 코스피/코스닥 시장의 실시간 단타 및 스캘핑 전문가입니다. 아래 제공된 지표와 최근 20일 일봉 및 15분 분봉 데이터를 분석하여 '강력한 수급이 동반된 눌림목' 자리인지 판단하세요.\n\n[분석 지침]\n1. 거래대금이 상위권인 '시장 주도주' 여부와 VWAP(당일평균단가) 지지 여부를 최우선으로 분석하십시오.\n2. [최근 20일 일봉] 데이터를 통해 오늘의 위치가 주요 저항선을 돌파하는 자리인지, 혹은 매물대 상단인지 파악하십시오.\n3. 매수 승인(BUY) 시, 일봉 맥락을 고려하여 3% 이상의 높은 수익이 가능한 구간이라면 그에 맞는 target_price(익절가)를, 단기 고점이라면 타이트한 stop_price(손절가)를 반드시 구체적인 숫자로 제안하십시오.\n4. 다음 형식을 지켜 100% JSON으로 응답해야 합니다."
        };
    }

    public syncRuntimeConfigWithActiveStrategy() {
        const strategies = this.db.getAiStrategies();
        const active = strategies.find(s => s.isActive);
        if (active) {
            const config = {
                targetProfit: active.targetProfit,
                stopLoss: active.stopLoss,
                minAiScore: active.minAiScore,
                maxPositions: active.maxPositions,
                scoringWeights: active.scoringWeights,
                masterPrompt: active.masterPrompt
            };
            store.set('ai_runtime_config', config);
            this.logToDashboard(`[Strategy] '${active.version}' 전략 설정이 시스템에 로드되었습니다.`, "info");
        } else {
            // If no active strategy, clear runtime config or set to defaults
            store.set('ai_runtime_config', {}); // Clear manual overrides
            this.logToDashboard(`[Strategy] 활성화된 전략이 없습니다. 기본 설정으로 작동합니다.`, "info");
        }
    }

    public static getInstance(): AiDecisionService {
        if (!AiDecisionService.instance) {
            AiDecisionService.instance = new AiDecisionService();
        }
        return AiDecisionService.instance;
    }

    public setAutoPilot(active: boolean) {
        this.isAutoPilot = active;
        store.set('ai_trade_autopilot', active);
        const statusMsg = active ? '▶ AI 자동매매 시스템이 시작되었습니다 (ENGAGED)' : '■ AI 자동매매 시스템이 중단되었습니다 (STOPPED)';
        const logType = active ? 'trade' : 'info';

        console.log(`[AiDecisionService] ${statusMsg}`);
        this.logToDashboard(statusMsg, logType);
    }

    public getIsAutoPilot() {
        return this.isAutoPilot;
    }

    /**
     * The Core AI Logic: Decision Loop
     */
    private aiTargets = new Map<string, { target: number, stop: number, high: number, entryTime: number }>();
    private aiCooldowns = new Map<string, number>();

    // API 요청 한도 (Rate Limiting)
    private hourlyApiRequests: number = 0;
    private lastApiResetTime: number = Date.now();
    private static readonly MAX_HOURLY_API_REQUESTS = 60; // 시간당 60회 (1분에 1번꼴)

    private analyzeMarket() {
        if (!this.isAutoPilot || this.isEvaluating) return;

        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const currentTimeVal = hour * 100 + minute;

        // [시간 제한 설정]
        // 1. 매수 가능 시작 시간 (기본값: 09:10, 장 초반 노이즈 여과)
        // 2. 매수 종료 시간 (기본값: 15:00, 장 마감 전 급락 및 오버나잇 방지)
        const aiSettings = store.get('ai_settings', {}) as any;
        const buyStartTimeStr = aiSettings.buyStartTime || '09:10';
        const buyEndTimeStr = aiSettings.buyEndTime || '15:00';

        // '09:10' -> 910
        const buyStartTime = parseInt(buyStartTimeStr.replace(':', ''), 10);
        const buyEndTime = parseInt(buyEndTimeStr.replace(':', ''), 10);

        // Reset API Request Counter every hour
        if (Date.now() - this.lastApiResetTime > 3600000) {
            this.hourlyApiRequests = 0;
            this.lastApiResetTime = Date.now();
        }

        // Check Rate Limit
        if (this.hourlyApiRequests >= AiDecisionService.MAX_HOURLY_API_REQUESTS) {
            this.logToDashboard(`[SYSTEM] 시간당 AI 허가 요청 횟수(${AiDecisionService.MAX_HOURLY_API_REQUESTS}회) 초과. 엔진 임시 대기 전환.`, "alert");
            return;
        }

        // 1. Get current market states from scanner
        const holdings = this.account.getAccountState().holdings;

        // 2. Logic: Should we SELL anything? (Exit Strategy using AI guidelines & Trailing Stop)
        const config = this.getActiveConfig();

        holdings.forEach(h => {
            const targets = this.aiTargets.get(h.code);
            const now = Date.now();

            if (targets) {
                // Update running high
                if (h.currentPrice > targets.high) {
                    targets.high = h.currentPrice;
                }

                const elapsedMins = (now - targets.entryTime) / (1000 * 60);

                // A. Trailing Stop (최고점 대비 -1% 빠지면 익절, 단 수익률이 config.targetProfit 이상일 때 발동)
                // If it's very profitable, we tighten the trail.
                if (h.pnlRate >= config.targetProfit && h.currentPrice <= targets.high * 0.99) {
                    this.executeSell(h.code, h.name, `트레일링 스탑 발동 (최고가 ${targets.high} 대비 하락). 수익 확정(+${h.pnlRate.toFixed(2)}%)`);
                    return;
                }

                // B. AI Target & Stop
                if (h.currentPrice >= targets.target) {
                    this.executeSell(h.code, h.name, `AI 목표가(${targets.target}원) 도달 익절 완료 (+${h.pnlRate.toFixed(2)}%)`);
                    return;
                }
                if (h.currentPrice <= targets.stop) {
                    this.executeSell(h.code, h.name, `AI 손절선(${targets.stop}원) 이탈 방어 손절 (${h.pnlRate.toFixed(2)}%)`);
                    return;
                }

                // C. Time Decay (15분이 지났는데도 1% 미만 수익이면 탈출)
                if (elapsedMins >= 15 && h.pnlRate < 1.0) {
                    this.executeSell(h.code, h.name, `타임 디케이 초과(15분). 탄력 부족으로 기회비용 확보 탈출 (${h.pnlRate.toFixed(2)}%)`);
                    return;
                }
            } else {
                // Fallback for manual or legacy trades using current strategy config
                if (h.pnlRate >= config.targetProfit) this.executeSell(h.code, h.name, `전략 익절 목표(+${config.targetProfit}%) 도달`);
                else if (h.pnlRate <= config.stopLoss) this.executeSell(h.code, h.name, `전략 손절폭(${config.stopLoss}%) 도달`);
            }
        });

        // 3. Logic: Should we BUY anything? (Entry Strategy - HUNTING MODE)
        if (holdings.length >= config.maxPositions) {
            // [Defense & Exit Mode] - Full Slot
            return;
        }

        // [HUNTING MODE 시간 체크]
        if (currentTimeVal < buyStartTime || currentTimeVal >= buyEndTime) {
            // 매수 가능 시간이 아니면 진입 로직 수행 안함
            return;
        }

        // 4. Radar Stock Check (Only for Buying)
        const radarCodes = (this.scanner as any).radarStocks as string[];
        if (radarCodes.length === 0) {
            // 정규장 마감 이후 스캐너가 멈췄을 때는 로그를 남기지 않음
            if (currentTimeVal < 1535) {
                this.logToDashboard("현재 레이더에 포착된 유효 종목이 없습니다. 스캔 대기 중...", "info");
            }
            return;
        }

        // 5. Hunt for candidates using minAiScore
        let anyCandidate = false;
        const sortedRadar = [...radarCodes].sort((a, b) => {
            const scoreA = (this.scanner as any).monitoredStocks.get(a)?.aiScore || 0;
            const scoreB = (this.scanner as any).monitoredStocks.get(b)?.aiScore || 0;
            return scoreB - scoreA;
        });

        for (const code of sortedRadar) {
            const state = (this.scanner as any).monitoredStocks.get(code);
            if (!state) continue;
            if (holdings.find(h => h.code === code)) continue;
            if (state.vwap === 0) continue;

            const aiScore = typeof state.aiScore === 'number' ? state.aiScore : 0;

            // Cooldown check (5 minutes = 300,000 ms)
            if (this.aiCooldowns.has(code) && Date.now() - this.aiCooldowns.get(code)! < 300000) {
                continue;
            }

            // Use dynamic minAiScore from config
            if (aiScore >= config.minAiScore) {
                anyCandidate = true;
                this.aiCooldowns.set(code, Date.now());
                this.evaluateCandidateAndExecuteBuy(state);
                break;
            }
        }

        if (!anyCandidate) {
            this.logToDashboard(`AI 채점 커트라인(${config.minAiScore}점) 통과 종목 대기 중...`, "info");
        }
    }

    public calculateAiScore(state: any): number {
        if (!state || state.vwap === 0 || state.currentPrice === 0) return 0;
        const config = this.getActiveConfig();
        const weights = config.scoringWeights || { vwap: 30, velocity: 25, trend: 20, gap: 10, leader: 15 };

        let score = 0;

        // 1. VWAP 타점 점수
        const vwapGap = ((state.currentPrice - state.vwap) / state.vwap) * 100;
        let vwapScore = 0;
        if (vwapGap >= 0 && vwapGap <= 2.0) vwapScore = weights.vwap;
        else if (vwapGap > 2.0 && vwapGap <= 5.0) vwapScore = weights.vwap * 0.5;
        else if (vwapGap > 5.0 && vwapGap <= 10.0) vwapScore = weights.vwap * 0.25;
        score += vwapScore;

        // 2. 수급(Velocity) 점수
        let velScore = (state.velocity / 200000) * weights.velocity;
        if (velScore > weights.velocity) velScore = weights.velocity;
        score += velScore;

        // 3. 당일 트렌드 (고점 돌파율)
        const highGap = state.highPrice > 0 ? ((state.currentPrice - state.highPrice) / state.highPrice) * 100 : -10;
        let trendScore = 0;
        if (highGap >= -1.0) trendScore = weights.trend;
        else if (highGap >= -3.0) trendScore = weights.trend * 0.75;
        else if (highGap >= -5.0) trendScore = weights.trend * 0.5;
        score += trendScore;

        // 4. 상승률(GAP) 적정성 점수
        const gap = state.gap || 0;
        let gapScore = 0;
        if (gap >= 5.0 && gap <= 15.0) gapScore = weights.gap;
        else if (gap > 15.0 && gap <= 22.0) gapScore = weights.gap * 0.5;
        score += gapScore;

        // 5. 시장 주도주 (Theme stock) 여부
        const themeStocks = this.scanner.getThemeStocks() || [];
        if (themeStocks.includes(state.code)) {
            score += (weights.leader || 0);
        }

        return Math.floor(score);
    }

    private async evaluateCandidateAndExecuteBuy(state: any) {
        this.isEvaluating = true;
        const config = this.getActiveConfig();
        eventBus.emit(SystemEvent.AI_EVALUATION_UPDATE, { isEvaluating: true, stock: { code: state.code, name: state.name } });
        try {
            this.logToDashboard(`[AI 분석 개시] ${state.name} 분석 중... (지침: ${config.version || 'Active Strategy'})`, "info");
            const minuteData = await this.kiwoom.getMinuteChartData(state.code);
            const chartData = minuteData?.output || minuteData?.Body || [];
            const simpleChart = chartData.slice(0, 15).reverse().map((d: any) =>
                `[${d.tm || d.stck_cntg_hour}] O:${Math.abs(d.open_prc || d.stck_oprc)} H:${Math.abs(d.high_prc || d.stck_hgpr)} L:${Math.abs(d.low_prc || d.stck_lwpr)} C:${Math.abs(d.cur_prc || d.stck_prpr)} V:${d.vol || d.cntg_vol}`
            ).join('\n');

            // 20일 일봉 데이터 추가 (Context 강화)
            const dailyData = await this.kiwoom.getChartData(state.code);
            const dailyList = dailyData?.output || dailyData?.Body || [];
            const monthlyContext = dailyList.slice(0, 20).reverse().map((d: any) =>
                `[${d.dt || d.stck_bsop_date}] C:${Math.abs(d.cur_prc || d.stck_prpr)} V:${d.vol || d.cntg_vol}`
            ).join('\n');

            this.hourlyApiRequests++;

            const prompt = `${config.masterPrompt}
            
종목명: ${state.name}
현재가: ${state.currentPrice}
VWAP 이격도: ${((state.currentPrice - state.vwap) / state.vwap * 100).toFixed(2)}%
수급속도: ${state.velocity}
AI 종합 스코어: ${state.aiScore}점

[최근 20일 일봉]
${monthlyContext}

[최근 15분 분봉]
${simpleChart}

다음 형식을 지켜 100% JSON으로 응답하세요:
{
  "action": "BUY" | "PASS",
  "reason": "사유 요약",
  "execution_guidelines": { 
    "max_buy_price": n, 
    "min_buy_price": n, 
    "target_price": n, 
    "stop_price": n 
  }
}`;

            const response = await this.ai.askGemini(prompt, "You are an API trading AI that outputs ONLY strict JSON.");
            const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const decision = JSON.parse(jsonStr);

            // DB 로깅: 나중에 똑같은 데이터로 다시 테스트(Backtest/Replay)할 수 있도록 모든 컨텍스트 저장
            DataLoggingService.getInstance().logAiDecision({
                code: state.code,
                name: state.name,
                aiScore: state.aiScore,
                context: {
                    currentPrice: state.currentPrice,
                    vwap: state.vwap,
                    velocity: state.velocity,
                    daily: monthlyContext,
                    minute: simpleChart
                },
                prompt: prompt,
                response: response,
                decision: decision
            });

            if (decision.action === 'BUY') {
                const currentLivePrice = (this.scanner as any).monitoredStocks.get(state.code)?.currentPrice || state.currentPrice;
                const { max_buy_price, min_buy_price, target_price, stop_price } = decision.execution_guidelines;

                if (currentLivePrice >= min_buy_price && currentLivePrice <= max_buy_price) {
                    this.executeBuy(state.code, state.name, currentLivePrice, `[AI 승인] ${decision.reason}`, target_price, stop_price);
                } else {
                    this.logToDashboard(`[AI 타점 이탈 방어] ${state.name} 지침 범위(${min_buy_price}~${max_buy_price}) 이탈. 현재가: ${currentLivePrice}. 매수 취소(Pass).`, "alert");
                }
            } else {
                this.logToDashboard(`[AI 매수 보류] ${state.name} - ${decision.reason}`, "info");
            }

        } catch (e) {
            console.error('[AiDecisionService] error in evaluateCandidateAndExecuteBuy:', e);
            this.logToDashboard(`[AI 분석 실패] API 오류 또는 형식 미스매치로 진행 취소.`, "alert");
        } finally {
            this.isEvaluating = false;
            eventBus.emit(SystemEvent.AI_EVALUATION_UPDATE, { isEvaluating: false, stock: null });
        }
    }

    private executeBuy(code: string, name: string, price: number, reason: string, target?: number, stop?: number) {
        const balance = this.account.getAccountState().balance;
        const targetAmount = balance * 0.4;
        const quantity = Math.floor(targetAmount / price);

        if (quantity > 0) {
            const result = this.account.buy(code, name, price, quantity, target, stop);
            if (result.success) {
                this.logToDashboard(`[BUY ORDER] ${name}(${code}) | ${price.toLocaleString()}원 | ${quantity}주`, 'trade');
                this.logToDashboard(`[AI 전략 세팅] ${reason} 목표: ${target?.toLocaleString()}원, 손절: ${stop?.toLocaleString()}원`, 'trade');
            } else {
                this.logToDashboard(`[ERROR] ${name} 매수 주문 실패: ${result.reason}`, 'alert');
            }
        }
    }

    private executeSell(code: string, name: string, reason: string) {
        const holding = this.account.getAccountState().holdings.find(h => h.code === code);
        if (holding) {
            const result = this.account.sell(code, holding.currentPrice, holding.quantity);
            if (result.success) {
                this.aiTargets.delete(code); // Clean up tracking
                this.logToDashboard(`[SELL ORDER] ${name}(${code}) | ${holding.currentPrice.toLocaleString()}원 | ${holding.pnlRate.toFixed(2)}%`, 'trade');
                this.logToDashboard(`[청산 완료] ${reason}`, 'trade');
            } else {
                this.logToDashboard(`[ERROR] ${name} 매도 주문 실패: ${result.reason}`, 'alert');
            }
        }
    }

    private logToDashboard(message: string, type: 'info' | 'trade' | 'alert') {
        const log = {
            time: new Date().toLocaleTimeString('en-US', { hour12: false }),
            message,
            type
        };
        eventBus.emit('AI_LOG_INTERNAL', log);
    }
}
