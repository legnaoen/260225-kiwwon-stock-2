export interface Stock {
    name: string
    code: string
    price: number
    change: string
    changeRate: number
    volume: number
    value?: number
    profit?: string
    qty?: number
}

export interface AccountSummary {
    totalPurchase: number
    totalEvaluation: number
    totalProfit: number
    profitRate: number
}
