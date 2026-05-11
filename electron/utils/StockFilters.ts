export const ETF_KEYWORDS = [
    'ETF', 'ETN', 'KODEX', 'TIGER', 'ACE', 'KBSTAR', 'ARIRANG', 'HANARO', 'SOL', 'KOSEF', 'KINDEX', 'KB스타', '스팩', 'SPAC', 'VINA', 'TIMEFOLIO', '히어로즈', '마이티', 'TREX', 'FOCUS', 'HK', '파워', 'KoAct', 'WON', 'PLUS', 'KODEX', 'TIGER'
];

export function isETFOrSPAC(stockName: string): boolean {
    if (!stockName) return false;
    const upperName = stockName.toUpperCase();
    
    // Check if the name ends with "호" and contains "스팩"
    if (upperName.includes('스팩') || upperName.includes('SPAC')) return true;
    if (upperName.match(/\d+호$/)) return true;

    for (const keyword of ETF_KEYWORDS) {
        if (upperName.includes(keyword.toUpperCase())) {
            return true;
        }
    }
    return false;
}
