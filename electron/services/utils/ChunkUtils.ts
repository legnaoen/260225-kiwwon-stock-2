export class ChunkUtils {
    /**
     * 배열을 주어진 최대 크기 이하의 여러 청크(조)로 균등 분할합니다.
     * 예: 16개 종목, max=15 -> 8개, 8개
     *     31개 종목, max=15 -> 11개, 10개, 10개
     */
    public static createBalancedChunks<T>(array: T[], maxChunkSize: number = 15): T[][] {
        if (!array || array.length === 0) return [];
        if (array.length <= maxChunkSize) return [array];

        const numChunks = Math.ceil(array.length / maxChunkSize);
        const baseSize = Math.floor(array.length / numChunks);
        const remainder = array.length % numChunks;

        const chunks: T[][] = [];
        let start = 0;
        for (let i = 0; i < numChunks; i++) {
            // 나머지가 있는 경우 앞쪽 청크들에 1개씩 더 배분
            const currentSize = baseSize + (i < remainder ? 1 : 0);
            chunks.push(array.slice(start, start + currentSize));
            start += currentSize;
        }

        return chunks;
    }
}
