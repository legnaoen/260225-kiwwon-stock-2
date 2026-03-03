
export class PriceStore {
    private static instance: PriceStore
    private prices: Map<string, number> = new Map()
    private lastUpdated: Map<string, number> = new Map()

    private constructor() { }

    public static getInstance(): PriceStore {
        if (!PriceStore.instance) {
            PriceStore.instance = new PriceStore()
        }
        return PriceStore.instance
    }

    /**
     * Update price for a stock.
     * @param stockCode Stock code (e.g., 'A005930' or '005930')
     * @param price Current price
     */
    public setPrice(stockCode: string, price: number) {
        const cleanCode = stockCode.replace(/[^0-9]/g, '')
        if (cleanCode.length !== 6) return

        this.prices.set(cleanCode, price)
        this.lastUpdated.set(cleanCode, Date.now())
    }

    /**
     * Get price from cache.
     * @param stockCode Stock code
     * @returns price or null
     */
    public getPrice(stockCode: string): number | null {
        const cleanCode = stockCode.replace(/[^0-9]/g, '')
        return this.prices.get(cleanCode) || null
    }

    public getAllPrices(): Record<string, number> {
        return Object.fromEntries(this.prices)
    }
}
