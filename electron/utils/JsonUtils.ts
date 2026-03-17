export class JsonUtils {
    /**
     * 문자열 내에서 JSON 블록을 찾아 파싱합니다.
     * Markdown 코드 블록(```json ... ```)이나 서술형 텍스트 사이의 JSON을 추출합니다.
     */
    public static extractAndParse(text: string): any {
        try {
            // 1. 단순 시도
            const simpleClean = text.replace(/```json|```/g, '').trim();
            try {
                return JSON.parse(simpleClean);
            } catch (e) {
                // 실패 시 다음 단계로
            }

            // 2. 가장 바깥쪽 { } 추출
            const startIdx = text.indexOf('{');
            const endIdx = text.lastIndexOf('}');
            
            if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const jsonStr = text.substring(startIdx, endIdx + 1);
                try {
                    return JSON.parse(jsonStr);
                } catch (e) {
                    // 유효하지 않은 JSON 조각일 수 있음
                }
            }

            throw new Error('유효한 JSON 형식을 찾을 수 없습니다.');
        } catch (error) {
            console.error('[JsonUtils] Parsing Failed:', error);
            console.error('Original Text:', text);
            throw error;
        }
    }
}
