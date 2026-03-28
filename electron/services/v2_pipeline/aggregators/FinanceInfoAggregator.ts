import { IBaseAggregator } from '../types/PipelineTypes';

export class FinanceInfoAggregator implements IBaseAggregator {
    public process(rawData: any): string {
        if (!rawData || !rawData.markdown) {
            return `### 📉 '${rawData?.keyword || '종목'}' 재무/기업개요 수집 실패\n데이터를 가져올 수 없습니다. 원인을 확인하세요.`;
        }

        const { keyword, stockCode, markdown } = rawData;
        
        let md = `### 🏢 [${keyword}] (${stockCode}) 펀더멘털 및 기업개요 (출처: Naver Finance CoInfo)\n\n`;
        
        // 네이버 증권 공통 내비게이션 및 쓰레기 헤더 제거.
        // 종목명, 기업개요, 기업실적분석 등의 핵심 키워드 이후부터 가져오기
        let content = markdown;
        
        // 1차 컷: PC용 SSR 메인 페이지(main.naver.com) 내장 표(Table) 기준 필터링.
        // 유일무이한 핵심 테이블인 '기업실적분석' 텍스트를 최우선 앵커로 잡습니다.
        const anchor = '기업실적분석';
        let startIndex = content.lastIndexOf(anchor);
        
        // 혹시라도 못찾을 경우에 대비해서 2차 후보군 '동일업종 PER'를 앞쪽에서 찾습니다. (lastIndexOf 아님)
        if (startIndex === -1) {
            startIndex = content.indexOf('동일업종 PER');
        }
        
        if (startIndex !== -1) {
            content = content.substring(startIndex).trim();
        }

        // 지저분한 URL 및 메뉴 텍스트 2차 컷 (정규식 패턴)
        content = content.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1');
        
        // 꼬리부분 자르기 (너무 긴 하단 정보들 2차 대청소)
        // AI 봇에게는 호가잔량, 최근조회, 용어 설명 같은 정보가 필요 없으므로 표 직후에서 칼같이 잘라버립니다.
        const possibleTails = [
            '* 손익계산서', 
            '#### 동종업종비교', 
            '### 호가 10단계', 
            '## 최근조회', 
            '[최근조회]', 
            '## 인기검색종목', 
            '## 주요뉴스', 
            'ⓒ NAVER Corp.'
        ];
        for (const tail of possibleTails) {
            const tailIdx = content.indexOf(tail); // 표 내용 내부가 아닌 명확한 꼬리표이므로 가장 위쪽(indexOf)부터 자릅니다.
            if (tailIdx !== -1 && tailIdx > 500) { 
                content = content.substring(0, tailIdx).trim();
            }
        }
        
        // 너무 길면 절삭
        const safeLimit = 15000;
        if (content.length > safeLimit) {
            content = content.substring(0, safeLimit) + "\n\n... (텍스트 길이 초과로 이후 내용 일부 생략)";
        }

        md += `\`\`\`text\n`;
        md += content;
        md += `\n\`\`\`\n\n`;
        md += `*이 상세 재무/기업개요 마크다운 데이터를 분석하여 사령관이 묻는 실적, 목표가, PBR/PER, 비즈니스 모델(사업의 내용)에 대한 팩트체크를 완벽하게 수행하십시오. 없는 내용은 지어내지 말고, 이 표/문자열에 기반하여 냉철하게 요약해 주십시오.*\n`;

        return md;
    }
}
