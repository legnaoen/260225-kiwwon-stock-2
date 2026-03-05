import { KiwoomService } from './KiwoomService'
import { VirtualAccountService } from './VirtualAccountService'
import { DataLoggingService } from './DataLoggingService'
import { eventBus, SystemEvent } from '../utils/EventBus'
import { DatabaseService } from './DatabaseService'
import Store from 'electron-store';

const store = new Store();

interface StockState {
    code: string;
    name: string;
    currentPrice: number;
    openPrice: number;
    highPrice: number;
    lowPrice: number;
    volume: number;
    cumVolume: number;
    cumAmount: number; // Volume * Price
    vwap: number;
    gap: number; // vs yesterday close
    velocity: number; // volume speed (approx)
    aiScore: number;
}

export class MarketScannerService {
    private static instance: MarketScannerService;
    private kiwoomService = KiwoomService.getInstance();
    private virtualAccount = VirtualAccountService.getInstance();
    private dataLogger: DataLoggingService | null = null;

    private monitoredStocks: Map<string, StockState> = new Map();
    private radarStocks: string[] = []; // Top 20 codes
    private logQueue: any[] = [];
    private logHistory: any[] = []; // Last 200 logs

    private scanTimer: NodeJS.Timeout | null = null;
    private broadcastTimer: NodeJS.Timeout | null = null;
    private dbSnapshotTimer: NodeJS.Timeout | null = null;
    private themeScanTimer: NodeJS.Timeout | null = null;

    private themeStocks: string[] = []; // Top trading value stocks (Market Leaders)

    private constructor() {
        // Listen for price updates from WebSocket
        eventBus.on(SystemEvent.PRICE_UPDATE, (data: any) => this.handlePriceUpdate(data));
        // Listen for internal AI logs to broadcast to UI
        eventBus.on('AI_LOG_INTERNAL', (log: any) => {
            this.logQueue.push(log);
            this.logHistory.push(log);
            if (this.logHistory.length > 200) this.logHistory.shift();
        });
    }

    public static getInstance(): MarketScannerService {
        if (!MarketScannerService.instance) {
            MarketScannerService.instance = new MarketScannerService();
        }
        return MarketScannerService.instance;
    }

    public getThemeStocks(): string[] {
        return this.themeStocks;
    }

    /**
     * Start the scanning & broadcasting loop
     */
    public start() {
        if (this.scanTimer) return;

        // 1. Initial Scans
        this.performScan();
        this.performThemeScan();

        // 2. Schedule Scans 
        this.scanTimer = setInterval(() => this.performScan(), 60000); // 1 min
        this.themeScanTimer = setInterval(() => this.performThemeScan(), 180000); // 3 mins (상위 주도주 갱신 주기 단축)

        // 3. Schedule Broadcast to UI (every 1 second)
        this.broadcastTimer = setInterval(() => this.broadcastToUI(), 1000);

        // 4. Schedule DB Snapshot (every 1 minute)
        this.dbSnapshotTimer = setInterval(() => this.saveSnapshotToDB(), 60000);

        console.log('[MarketScanner] Service Started');
        this.logQueue.push({
            time: new Date().toLocaleTimeString('en-US', { hour12: false }),
            message: 'AI 시장 스캐너 서비스가 가동되었습니다. 수급 포착을 시작합니다...',
            type: 'info'
        });
    }

    public stop() {
        if (this.scanTimer) clearInterval(this.scanTimer);
        if (this.broadcastTimer) clearInterval(this.broadcastTimer);
        if (this.dbSnapshotTimer) clearInterval(this.dbSnapshotTimer);
        if (this.themeScanTimer) clearInterval(this.themeScanTimer);
        this.scanTimer = null;
        this.broadcastTimer = null;
        this.dbSnapshotTimer = null;
        this.themeScanTimer = null;
        if (this.dataLogger) {
            console.log('[MarketScanner] Service Started, DataLogger initialized.');
        }
        console.log('[MarketScanner] Service Stopped');
    }

    public getThemeStocks(): string[] {
        return this.themeStocks;
    }

    private async performThemeScan() {
        try {
            const now = new Date();
            const hour = now.getHours();
            const minute = now.getMinutes();
            const timeVal = hour * 100 + minute;

            if (timeVal >= 1530) return;

            console.log('[MarketScanner] Running Theme Scan (Top Trading Value)...');
            const res = await this.kiwoomService.getTopTradingValueStocks();

            // ka10030 response keys: rkinfo, trde_prica_sdnin, Body, etc.
            const results = res?.rkinfo || res?.trde_prica_sdnin || res?.Body || res?.list || res?.output || [];
            if (!results || results.length === 0) {
                console.log('[MarketScanner] Theme Scan: No results returned from API.');
                return;
            }

            const newThemeStocks: string[] = [];
            for (const stock of results) {
                if (newThemeStocks.length >= 100) break; // 상위 100개로 확장

                const originalCode = String(stock.stk_cd || stock.code || '');
                const codeMatch = originalCode.match(/(\d{6})/); // 정확히 6자리 숫자 추출
                const code = codeMatch ? codeMatch[1] : '';
                if (!code) continue;

                const name = String(stock.stk_nm || stock.name || '');

                // 쓰레기 종목 차단 (ETF/ETN/SPAC 등)
                if (name) {
                    const upperName = name.toUpperCase();
                    if (upperName.includes('KODEX') || upperName.includes('TIGER') || upperName.includes('KBSTAR') ||
                        upperName.includes('KOSEF') || upperName.includes('ARIRANG') || upperName.includes('HANARO') ||
                        upperName.includes('RISE') || upperName.includes('ACE') || upperName.includes('SOL')) continue;
                    if (upperName.includes('ETN') || upperName.includes('스팩') || upperName.includes('인버스') || upperName.includes('레버리지')) continue;
                }

                newThemeStocks.push(code);
            }

            this.themeStocks = newThemeStocks;
            console.log(`[MarketScanner] Theme Scan complete. Identified ${this.themeStocks.length} leading stocks.`);
            // Debug: console.log('[MarketScanner] Theme Stocks:', this.themeStocks.join(', '));

            if (this.themeStocks.length > 0) {
                this.logQueue.push({
                    time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                    message: `[MARKET THEME] 당일 거래대금 상위(주도주) ${this.themeStocks.length}개 갱신 완료. (기준: 상위 100위 내 유효종목)`,
                    type: 'info'
                });
            }
        } catch (error) {
            console.error('[MarketScanner] Theme Scan Error:', error);
        }
    }

    private getDataLogger() {
        if (!this.dataLogger) {
            this.dataLogger = DataLoggingService.getInstance();
            this.dataLogger.init(); // lazy init
        }
        return this.dataLogger;
    }

    /**
     * Perform Market Scans (ka10029, ka10023)
     */
    private async performScan() {
        try {
            const now = new Date();
            const hour = now.getHours();
            const minute = now.getMinutes();
            const timeVal = hour * 100 + minute;

            // [마감 이후 스캔 중단]
            // 정규장 마감(15:30) 이후에는 굳이 실시간 수급을 긁어올 필요가 없으므로 스캔 중지
            if (timeVal >= 1530) {
                if (now.getSeconds() < 10) {
                    // console.log('[MarketScanner] Market Closed (15:30). Stopping real-time scan.');
                }
                return;
            }

            let scanResults: any[] = [];

            if (timeVal < 900) {
                // Pre-market: Gap Up Scan (ka10029)
                const res = await this.kiwoomService.getGapUpStocks();
                scanResults = res?.Body || res?.list || [];
            } else {
                // Market Hours: Volume Spike Scan (ka10023)
                const res = await this.kiwoomService.getVolumeSpikeStocks();
                console.log('[MarketScanner] ka10023 raw data check:', res ? Object.keys(res) : 'empty');

                // Support multiple possible response keys (Body, list, output, trde_qty_sdnin)
                scanResults = res?.trde_qty_sdnin || res?.Body || res?.list || res?.output || [];

                if (scanResults.length === 0) {
                    console.log('[MarketScanner] No results found. Response preview:', JSON.stringify(res).slice(0, 150));
                }
            }

            if (scanResults.length > 0) {
                // 1. Pick Top 20 for internal monitoring and DB logging
                const top20 = scanResults.slice(0, 20);
                const newRadarCodes: string[] = [];
                for (const stock of scanResults) {
                    if (newRadarCodes.length >= 20) break;

                    const originalCode = String(stock.stk_cd || stock.code || '');
                    // For ETF/ETN (e.g., 114800_AL), we want just the numeric part "114800"
                    const codeMatch = originalCode.match(/^(\d+)/);
                    const code = codeMatch ? codeMatch[1] : '';
                    if (!code) continue;

                    const name = String(stock.stk_nm || stock.name || code);
                    const currentPrice = Math.abs(parseInt(stock.cur_prc || stock.stk_prc || stock.price || '0'));
                    const gap = parseFloat(stock.flu_rt || stock.flrt || stock.change_rate || '0');

                    // 1단계 필터: 잡주 및 파생상품 차단
                    if (name.includes('KODEX') || name.includes('TIGER') || name.includes('KBSTAR') || name.includes('KOSEF') || name.includes('ARIRANG') || name.includes('HANARO')) continue;
                    if (name.includes('ETN') || name.includes('스팩') || name.includes('인버스') || name.includes('인버스2X')) continue;
                    if (currentPrice < 1000) continue; // 동전주 차단
                    if (gap < 2.0) continue; // 최소 2% 이상 상승 종목만 포착 (하락시 급등량 차단)

                    newRadarCodes.push(code);

                    // Add to monitor if new or update existing
                    if (!this.monitoredStocks.has(code)) {
                        this.monitoredStocks.set(code, {
                            code,
                            name: name,
                            currentPrice: currentPrice,
                            openPrice: Math.abs(parseInt(stock.open_prc || stock.open || '0')),
                            highPrice: 0,
                            lowPrice: 0,
                            volume: 0,
                            cumVolume: Math.abs(parseInt(stock.now_trde_qty || stock.vol || stock.volume || '0')),
                            cumAmount: currentPrice * Math.abs(parseInt(stock.now_trde_qty || stock.vol || stock.volume || '0')),
                            vwap: currentPrice,
                            gap: gap,
                            velocity: parseInt(stock.sdnin_qty || stock.vol_velocity || '0'),
                            aiScore: 0
                        });
                        const state = this.monitoredStocks.get(code)!;
                        state.aiScore = this.calculateAiScore(state);
                    } else {
                        // Update basic info for existing
                        const state = this.monitoredStocks.get(code)!;
                        state.name = name !== code ? name : state.name; // 이름이 있으면 업데이트
                        state.gap = gap;
                        state.velocity = parseInt(stock.sdnin_qty || stock.vol_velocity || state.velocity);
                        // vwap이 0이면 초기화 (최초 스캔 시점 기준)
                        if (state.vwap === 0 && currentPrice > 0) {
                            state.cumVolume = Math.abs(parseInt(stock.now_trde_qty || stock.vol || stock.volume || '0'));
                            state.cumAmount = currentPrice * state.cumVolume;
                            state.vwap = currentPrice;
                        }
                        // Update score after basic info update
                        state.aiScore = this.calculateAiScore(state);
                    }
                }

                this.radarStocks = newRadarCodes;

                // 2. Register these codes to WebSocket to get real-time ticks
                this.kiwoomService.wsRegister(newRadarCodes);

                // Do not print all 20 codes to save console space
                console.log(`[MarketScanner] Radar Updated: Picked ${this.radarStocks.length} internal tracking stocks.`);
                this.logQueue.push({
                    time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                    message: `[RADAR] ${this.radarStocks.length}개 종목 실시간 수급 포착 중...`,
                    type: 'info'
                });
            }
        } catch (error) {
            console.error('[MarketScanner] Scan Error:', error);
        }
    }

    /**
     * Handle incoming real-time price updates
     */
    private handlePriceUpdate(data: any) {
        // data: { code, price, open, high, low, volume, cumVolume, ... }
        const code = String(data.code).replace(/[^0-9]/g, '');
        if (!code) return;

        let state = this.monitoredStocks.get(code);
        if (!state) {
            // Initialize state for new stock
            state = {
                code,
                name: data.name || code, // 이름 없으면 코드라도 표시
                currentPrice: 0,
                openPrice: 0,
                highPrice: 0,
                lowPrice: 0,
                volume: 0,
                cumVolume: 0,
                cumAmount: 0,
                vwap: 0,
                gap: 0,
                velocity: 0,
                aiScore: 0
            };
            this.monitoredStocks.set(code, state);
        }

        const price = Math.abs(parseInt(data.price));
        const vol = Math.abs(parseInt(data.volume));
        const cumVol = Math.abs(parseInt(data.cumVolume));
        const cumAmtFromFid = data.cumAmount ? Math.abs(parseInt(data.cumAmount)) : 0;

        state.currentPrice = price;
        state.openPrice = data.open ? Math.abs(parseInt(data.open)) : state.openPrice;
        state.highPrice = data.high ? Math.abs(parseInt(data.high)) : state.highPrice;
        state.lowPrice = data.low ? Math.abs(parseInt(data.low)) : state.lowPrice;

        // Update VWAP
        if (cumAmtFromFid > 0 && cumVol > 0) {
            state.cumVolume = cumVol;
            state.cumAmount = cumAmtFromFid;

            let rawVwap = state.cumAmount / state.cumVolume;

            // 스마트 스케일링: 키움증권 FID14(거래대금)의 단위가 종목/시간에 따라 원/천원/만원/백만원으로 다를 수 있습니다.
            // 당일 VWAP은 이론적으로 현재가(price)의 하한가~상한가(±30%) 범위를 절대 벗어날 수 없으므로,
            // (price/2) 와 (price*1.5) 사이에 들어올 때까지 10씩 곱하거나 나누어 단위를 완벽히 맞춥니다.
            while (rawVwap > 0 && rawVwap < price * 0.5) {
                rawVwap *= 10;
                state.cumAmount *= 10;
            }
            while (rawVwap > 0 && rawVwap > price * 1.5) {
                rawVwap /= 10;
                state.cumAmount /= 10;
            }

            state.vwap = rawVwap;

            if (vol > 0) {
                // LOG TICK DATA TO DB
                this.getDataLogger().logTick(code, price, vol, state.cumAmount);
            }
        } else if (vol > 0) {
            // 초기화 후 누적거래대금이 없는 경우(fallback) - 기존 로직 최소 유지
            if (state.cumAmount === 0 && state.cumVolume === 0) {
                state.cumVolume = cumVol || vol;
                state.cumAmount = price * state.cumVolume;
                state.vwap = price;
            } else {
                state.cumAmount += (vol * price);
                state.cumVolume = cumVol || (state.cumVolume + vol);
                state.vwap = state.cumAmount / state.cumVolume;
            }
        }

        // Calculate velocity (volume spike)
        state.velocity = data.velocity || state.velocity;

        // Update AI Score whenever price updates
        state.aiScore = this.calculateAiScore(state);
    }

    private getActiveConfig() {
        const runtime = store.get('ai_runtime_config') as any;
        if (runtime && Object.keys(runtime).length > 0) return runtime;

        const db = DatabaseService.getInstance();
        const active = db.getAiStrategies().find((s: any) => s.isActive);
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

        return {
            targetProfit: 3.0,
            stopLoss: -2.0,
            minAiScore: 60,
            maxPositions: 2,
            scoringWeights: { vwap: 30, velocity: 25, trend: 20, gap: 10, leader: 15 },
            masterPrompt: "당신은 대한민국 코스피/코스닥 시장의 실시간 단타 및 스캘핑 전문가입니다. 아래 제공된 지표와 최근 20일 일봉 및 15분 분봉 데이터를 분석하여 '강력한 수급이 동반된 눌림목' 자리인지 판단하세요.\n\n[분석 지침]\n1. 거래대금이 상위권인 '시장 주도주' 여부와 VWAP(당일평균단가) 지지 여부를 최우선으로 분석하십시오.\n2. [최근 20일 일봉] 데이터를 통해 오늘의 위치가 주요 저항선을 돌파하는 자리인지, 혹은 매물대 상단인지 파악하십시오.\n3. 매수 승인(BUY) 시, 일봉 맥락을 고려하여 3% 이상의 높은 수익이 가능한 구간이라면 그에 맞는 target_price(익절가)를, 단기 고점이라면 타이트한 stop_price(손절가)를 반드시 구체적인 숫자로 제안하십시오.\n4. 다음 형식을 지켜 100% JSON으로 응답해야 합니다."
        };
    }

    /**
     * AI Score Channeling Mechanism
     */
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

        // 5. 시장 주도주 (Theme/Trading Value rank) 보너스
        if (this.themeStocks.includes(state.code)) {
            score += (weights.leader || 0);
        }

        return Math.floor(score);
    }

    /**
     * Broadcast the current market state to the UI
     */
    private broadcastToUI() {
        // AI 스코어를 매겨서 1등부터 줄 세웁니다
        const radarCandidates = this.radarStocks.map(code => {
            const state = this.monitoredStocks.get(code);
            if (!state) return null;
            // 실시간 점수 계산 및 상태 업데이트 (매매 엔진 공유용)
            state.aiScore = this.calculateAiScore(state);
            return { ...state };
        }).filter(Boolean);

        // Sort by AI Score descending
        radarCandidates.sort((a, b) => b.aiScore - a.aiScore);

        // UI Dashboard only displays the Top 10 to keep it clean and focused
        const radarData = radarCandidates.slice(0, 10);
        const accountState = this.virtualAccount.getAccountState();

        // Construct the stream packet
        const packet = {
            radar: radarData,
            account: {
                balance: accountState.balance,
                totalAssets: accountState.totalAssets,
                holdings: accountState.holdings,
                history: accountState.history
            },
            logs: [...this.logQueue],
            timestamp: new Date().getTime(),
        };

        this.logQueue = []; // Clear queue after broadcast
        eventBus.emit(SystemEvent.AI_TRADE_STREAM, packet);
    }

    /**
     * Save the entire radar snapshot (all 20) to DB 
     */
    private saveSnapshotToDB() {
        const fullRadarData = this.radarStocks.map(code => this.monitoredStocks.get(code)).filter(Boolean);
        if (fullRadarData.length > 0) {
            this.getDataLogger().logRadarSnapshot(fullRadarData);
        }
    }

    /**
     * Add a stock to active monitoring (e.g. when AI buys it)
     */
    public addToMonitor(code: string, name: string) {
        const cleanCode = code.replace(/[^0-9]/g, '');
        if (!this.monitoredStocks.has(cleanCode)) {
            this.monitoredStocks.set(cleanCode, {
                code: cleanCode,
                name,
                currentPrice: 0,
                openPrice: 0,
                highPrice: 0,
                lowPrice: 0,
                volume: 0,
                cumVolume: 0,
                cumAmount: 0,
                vwap: 0,
                gap: 0,
                velocity: 0,
                aiScore: 0
            });
            // Ensure WebSocket registration
            this.kiwoomService.wsRegister([cleanCode]);
        }
    }

    public getLogHistory() {
        return this.logHistory;
    }
}
