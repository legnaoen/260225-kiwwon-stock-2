export function getTickSize(price: number): number {
    if (price < 2000) return 1;
    if (price < 5000) return 5;
    if (price < 20000) return 10;
    if (price < 50000) return 50;
    if (price < 200000) return 100;
    if (price < 500000) return 500;
    return 1000;
}

export function calculateOrderPrice(currentPrice: number, ticksToAdd: number = 1): number {
    let price = currentPrice;
    if (ticksToAdd > 0) {
        for (let i = 0; i < ticksToAdd; i++) {
            price += getTickSize(price);
        }
    } else if (ticksToAdd < 0) {
        for (let i = 0; i < Math.abs(ticksToAdd); i++) {
            price -= getTickSize(price - 1); // Subtract 1 to check the tick size of the lower bracket if on the edge
        }
    }
    return price;
}
