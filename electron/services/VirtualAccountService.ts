import Store from 'electron-store';
import { eventBus, SystemEvent } from '../utils/EventBus'

const store = new Store();

interface VirtualHolding {
    code: string;
    name: string;
    avgPrice: number;
    quantity: number;
    currentPrice: number;
    pnl: number;
    pnlRate: number;
    buyTime: string;
    targetPrice?: number;
    stopPrice?: number;
    maxPriceReached?: number;
}

interface TradeHistory {
    id: string;
    code: string;
    name: string;
    type: 'BUY' | 'SELL';
    price: number;
    quantity: number;
    time: string;
    pnl?: number;
    pnlRate?: number;
}

export class VirtualAccountService {
    private static instance: VirtualAccountService;

    private balance: number = 1000000; // 초기 자산 100만원
    private holdings: Map<string, VirtualHolding> = new Map();
    private history: TradeHistory[] = [];

    private constructor() {
        const aiSettings = store.get('ai_settings') as any;
        const initialDefault = aiSettings?.virtualInitialBalance ?? 1000000;

        // Load persisted state
        const saved = store.get('ai_virtual_account') as any;
        const today = new Date().toISOString().split('T')[0];

        if (saved) {
            this.balance = saved.balance ?? initialDefault;
            if (saved.holdings) {
                this.holdings = new Map(Object.entries(saved.holdings));
            }

            // Check if date has changed to clear daily history
            if (saved.lastUpdateDate && saved.lastUpdateDate !== today) {
                console.log(`[VirtualAccountService] New day detected (${today}). Clearing yesterday's trade history.`);
                this.history = [];
            } else {
                this.history = saved.history ?? [];
            }
        } else {
            this.balance = initialDefault;
        }

        this.saveStateToStore(); // Update with current date if needed

        // Listen for price updates to update holdings' PnL
        eventBus.on(SystemEvent.PRICE_UPDATE, (data: any) => this.updateHoldingsPrice(data));
    }

    public static getInstance(): VirtualAccountService {
        if (!VirtualAccountService.instance) {
            VirtualAccountService.instance = new VirtualAccountService();
        }
        return VirtualAccountService.instance;
    }

    public getAccountState() {
        const holdingsArray = Array.from(this.holdings.values());
        const totalHoldingsValue = holdingsArray.reduce((sum, h) => sum + (h.currentPrice * h.quantity), 0);

        return {
            balance: this.balance,
            totalAssets: this.balance + totalHoldingsValue,
            holdings: holdingsArray,
            history: this.history.slice(-20).reverse()
        };
    }

    public buy(code: string, name: string, price: number, quantity: number, targetPrice?: number, stopPrice?: number) {
        // [슬리피지 및 수수료 반영] 
        // 실제 시장에서는 호가 공백과 수수료(약 0.015%) 및 세금 등으로 인해 표시 가격보다 조금 더 비싸게 사게 됩니다.
        // 기본 0.15% 정도의 슬리피지/비용을 페널티로 부여합니다.
        const aiSettings = store.get('ai_settings') as any;
        const slippageRate = aiSettings?.slippageRate ?? 0.0015; // 0.15%

        const executionPrice = price * (1 + slippageRate);
        const cost = executionPrice * quantity;

        if (this.balance < cost) return { success: false, reason: 'Insufficient funds' };

        this.balance -= cost;

        const existing = this.holdings.get(code);
        if (existing) {
            const totalQty = existing.quantity + quantity;
            const newAvg = ((existing.avgPrice * existing.quantity) + (executionPrice * quantity)) / totalQty;
            existing.quantity = totalQty;
            existing.avgPrice = newAvg;
        } else {
            this.holdings.set(code, {
                code,
                name,
                avgPrice: executionPrice,
                quantity,
                currentPrice: price,
                pnl: 0,
                pnlRate: 0,
                buyTime: new Date().toLocaleTimeString('en-US', { hour12: false }),
                targetPrice,
                stopPrice,
                maxPriceReached: price
            });
        }

        this.addHistory(code, name, 'BUY', executionPrice, quantity);
        this.saveStateToStore();
        this.broadcastUpdate();
        return { success: true };
    }

    public sell(code: string, price: number, quantity: number) {
        const holding = this.holdings.get(code);
        if (!holding || holding.quantity < quantity) {
            return { success: false, reason: 'Insufficient holdings' };
        }

        // [슬리피지 및 세금 반영]
        // 매도 시에는 거래세(약 0.18%)와 수수료가 발생하며, 호가 아래로 던지는 경우가 많습니다.
        // 기본 0.25% 정도의 페널티를 부여합니다.
        const aiSettings = store.get('ai_settings') as any;
        const slippageRate = aiSettings?.sellSlippageRate ?? 0.0025; // 0.25%

        const executionPrice = price * (1 - slippageRate);
        const pnl = (executionPrice - holding.avgPrice) * quantity;
        const pnlRate = ((executionPrice - holding.avgPrice) / holding.avgPrice) * 100;

        this.balance += (executionPrice * quantity);
        holding.quantity -= quantity;

        if (holding.quantity === 0) {
            this.holdings.delete(code);
        }

        this.addHistory(code, holding.name, 'SELL', executionPrice, quantity, pnl, pnlRate);
        this.saveStateToStore();
        this.broadcastUpdate();
        return { success: true };
    }

    private updateHoldingsPrice(data: any) {
        const code = String(data.code).replace(/[^0-9]/g, '');
        const holding = this.holdings.get(code);
        if (holding) {
            const currentPrice = Math.abs(parseInt(data.price));
            holding.currentPrice = currentPrice;
            holding.pnl = (holding.currentPrice - holding.avgPrice) * holding.quantity;
            holding.pnlRate = ((holding.currentPrice - holding.avgPrice) / holding.avgPrice) * 100;

            // 최고가 갱신 (수익 보존용)
            if (currentPrice > (holding.maxPriceReached || 0)) {
                holding.maxPriceReached = currentPrice;
            }

            // [수익 보존 전략] 
            // 목표가의 80% 이상 도달했을 때, 최고점 대비 특정 비율(예: 1.5%) 하락 시 자동 익절
            if (holding.targetPrice && holding.maxPriceReached) {
                const targetGap = holding.targetPrice - holding.avgPrice;
                const progress = (currentPrice - holding.avgPrice) / targetGap;

                if (progress >= 0.8) { // 목표가 80% 근접 시
                    const dropFromPeak = (holding.maxPriceReached - currentPrice) / holding.maxPriceReached * 100;
                    if (dropFromPeak >= 1.5) { // 고점 대비 1.5% 하락
                        console.log(`[Profit Protection] ${holding.name} 익절 보호 발동 (고점대비 ${dropFromPeak.toFixed(2)}% 하락)`);
                        this.sell(code, currentPrice, holding.quantity);
                        return;
                    }
                }
            }

            // AI가 지정한 하드 손절선 도달 시
            if (holding.stopPrice && currentPrice <= holding.stopPrice) {
                console.log(`[Dynamic Stop] ${holding.name} AI 지정 손절선 도달`);
                this.sell(code, currentPrice, holding.quantity);
                return;
            }
        }
    }

    private addHistory(code: string, name: string, type: 'BUY' | 'SELL', price: number, quantity: number, pnl?: number, pnlRate?: number) {
        this.history.push({
            id: Date.now().toString(),
            code,
            name,
            type,
            price,
            quantity,
            time: new Date().toLocaleTimeString('en-US', { hour12: false }),
            pnl,
            pnlRate
        });
    }

    private saveStateToStore() {
        const holdingsObj = Object.fromEntries(this.holdings);
        const today = new Date().toISOString().split('T')[0];
        store.set('ai_virtual_account', {
            balance: this.balance,
            holdings: holdingsObj,
            history: this.history,
            lastUpdateDate: today
        });
    }

    public resetAccount() {
        const aiSettings = store.get('ai_settings') as any;
        const initialBalance = aiSettings?.virtualInitialBalance ?? 1000000;

        this.balance = initialBalance;
        this.holdings.clear();
        this.history = [];
        this.saveStateToStore();
        this.broadcastUpdate();
        return { success: true };
    }

    private broadcastUpdate() {
        const state = this.getAccountState();
        eventBus.emit(SystemEvent.AI_TRADE_STREAM, {
            account: state,
            timestamp: Date.now()
        });
    }
}
