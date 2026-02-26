/**
 * 한글 초성 추출 및 검색 유틸리티
 */

const CHOSEONG = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

/**
 * 문자열에서 초성을 추출합니다.
 */
export function getChoseong(str: string): string {
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i) - 0xAC00;
        if (code > -1 && code < 11172) {
            result += CHOSEONG[Math.floor(code / 588)];
        } else {
            result += str.charAt(i);
        }
    }
    return result;
}

/**
 * 한글 초성 포함 여부를 확인합니다.
 * @param target 대상 문자열 (예: '삼성전자')
 * @param query 검색어 (예: 'ㅅㅅ')
 */
export function matchChoseong(target: string, query: string): boolean {
    const targetChoseong = getChoseong(target);
    const queryChoseong = getChoseong(query);

    // 검색어가 초성으로만 이루어져 있는지 확인
    const isQueryOnlyChoseong = query.split('').every(char => CHOSEONG.includes(char));

    if (isQueryOnlyChoseong) {
        return targetChoseong.includes(query);
    }

    return target.toLowerCase().includes(query.toLowerCase());
}
