// 시황 에이전트 — AI 시스템 프롬프트 빌더

import { AgentCycle, DataContext } from '../types/AgentTypes'

/**
 * AI 시스템 프롬프트(역할 정의, 출력 규격, 규칙)를 생성합니다.
 */
export function buildSystemPrompt(activeRules: string[]): string {
    const rulesBlock = activeRules.length > 0
        ? activeRules.map((r, i) => `  ${i + 1}. ${r}`).join('\n')
        : '  (아직 등록된 규칙 없음 — 자유 판단)'

    return `# 역할
너는 KOSPI 지수의 **단기 방향성(1영업일)**을 예측하여 ETF로 실행하는 전문 트레이딩 에이전트다.
이름: Market Condition Agent (MCA)

# 매매 대상
- 상승 예상 → KODEX 200 (069500) 매수
- 하락 예상 → KODEX 인버스 (114800) 매수  
- 판단 불가/혼조 → 관망(현금) 유지

# 출력 규격
반드시 아래 JSON 형태로만 응답하라. 다른 텍스트를 JSON 앞뒤에 쓰지 마라.

\`\`\`json
{
  "predict": "LONG | SHORT | HOLD",
  "position": "KODEX 200 | KODEX 인버스 | 관망(현금)",
  "confidence": 0.0 ~ 1.0,
  "rationale": "전문 애널리스트 리포트 수준의 상세 시황 전망 (Markdown 포맷 적극 활용).\n필수 포함 항목:\n1. 🎯 핵심 요약 (1줄)\n2. 📈 주요 수급 및 매크로 분석 (상세히)\n3. ⚠️ 리스크 요인 및 변수\n4. 💡 향후 전망 및 전략\n가독성을 위해 줄바꿈(\\\\n)과 기호(-, *)를 반드시 사용할 것.",
  "indicators": ["사용한 핵심 지표 이름 나열"],
  "key_sources": ["판단에 가장 크게 영향을 준 데이터 소스 1줄 요약, 최대 5개"]
}
\`\`\`

# 활동 규칙 (Active Rules)
과거 오답 복기를 통해 학습된 규칙들이다. 반드시 준수하라:
${rulesBlock}

# 판단 원칙
1. **양면 분석 필수**: 긍정 요인과 부정 요인을 반드시 모두 나열한 뒤 종합 판단
2. **신뢰도 솔직 표현**: 확신이 낮으면 confidence를 0.4 이하로 설정하고 HOLD 선택 권장
3. **누락 데이터 인지**: 아래에 "누락된 데이터"가 명시되어 있으면, 해당 정보 없이 판단한 한계를 rationale에 반영
4. **과적합 경고**: 단일 지표에만 의존하지 말 것. 복수 근거 교차 확인
`
}

/**
 * 사용자 프롬프트(데이터 주입 + 히스토리)를 생성합니다.
 */
export function buildUserPrompt(context: DataContext): string {
    const cycleLabel = context.cycle === 'A' 
        ? '장전 Cycle A (08:50 판단 → 09:00 시초가 진입)' 
        : '장마감 Cycle B (15:10 판단 → 15:20 동시호가 진입)'

    // 가용 데이터 블록
    const dataBlocks = context.available.map(d => 
        `## 📊 [${d.id}]\n${d.markdown}`
    ).join('\n\n---\n\n')

    // 누락 데이터 목록
    const missingBlock = context.missing.length > 0
        ? `\n⚠️ **누락된 데이터** (수집 실패 또는 미구현):\n${context.missing.map(m => `- ${m}`).join('\n')}\n위 데이터 없이 판단해야 합니다. 한계를 rationale에 반영하세요.`
        : '\n✅ 모든 등록된 파이프라인 데이터 수집 완료.'

    // 최근 예측 히스토리 (AI가 자기 편향을 인식하도록)
    let historyBlock = ''
    if (context.recentHistory.length > 0) {
        const rows = context.recentHistory.map(h => {
            const t1 = h.t1_final !== undefined && h.t1_final !== null ? `${h.t1_final > 0 ? '+' : ''}${h.t1_final.toFixed(2)}%` : '미확정'
            const result = h.t1_final !== undefined && h.t1_final !== null
                ? ((h.predict === 'LONG' && h.t1_final > 0) || (h.predict === 'SHORT' && h.t1_final < 0) ? '✅적중' : '❌오답')
                : '⏳대기'
            return `| ${h.date} ${h.cycle} | ${h.predict} | ${t1} | ${result} |`
        }).join('\n')
        historyBlock = `\n## 📈 최근 예측 히스토리\n| 날짜 | 판단 | T+1 Final | 결과 |\n|---|---|---|---|\n${rows}\n\n위 이력을 참고하여 반복적으로 틀리는 패턴이 있다면 보정하세요.`
    }

    return `# 시황 매매 판단 요청
**사이클**: ${cycleLabel}
**날짜**: ${new Date().toISOString().split('T')[0]}

${dataBlocks}
${missingBlock}
${historyBlock}

위 데이터를 종합 분석하여 KOSPI 지수의 내일(T+1) 방향성을 예측하고, 지정된 JSON 형식으로 응답하세요.`
}
