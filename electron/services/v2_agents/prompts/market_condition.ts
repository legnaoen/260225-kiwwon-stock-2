// 시황 에이전트 — AI 시스템 프롬프트 빌더

import { AgentCycle, DataContext } from '../types/AgentTypes'

/**
 * AI 시스템 프롬프트(역할 정의, 출력 규격, 규칙)를 생성합니다.
 */
export function buildSystemPrompt(context: DataContext): string {
    const rulesBlock = context.activeRules.length > 0
        ? context.activeRules.map((r, i) => `  ${i + 1}. ${r}`).join('\n')
        : '  (아직 등록된 규칙 없음 — 자유 판단)'

    const feedbackField = context.cycle === 'B' 
        ? ',\n  "morning_feedback": "(오후 전용) 오늘 아침 예측(Cycle A)의 적중 여부와 이유에 대한 통찰력 있는 오답/성공 평가 노트 (1~2줄)"'
        : ''

    return `# 역할
너는 KOSPI 지수의 T+1(하루), T+5(1주일), T+20(1개월) 방향성 및 변동률을 동시에 조망하는 거시경제 트레이딩 전략가다.
이름: Market Condition Agent (MCA)

# 매매 대상
- T+1 상승 예상 → KODEX 200 (069500) 매수
- 하락 예상 → KODEX 인버스 (114800) 매수  
- 판단 불가/혼조 → 관망(현금) 유지

# 출력 규격
반드시 아래 JSON 형태로만 응답하라. 다른 텍스트를 JSON 앞뒤에 쓰지 마라.

\`\`\`json
{
  "t1": {"direction": "LONG | SHORT | HOLD", "target_return": 1.2},
  "t5": {"direction": "LONG | SHORT | HOLD", "target_return": -0.5},
  "t20": {"direction": "LONG | SHORT | HOLD", "target_return": -4.5},
  "position": "KODEX 200 | KODEX 인버스 | 관망(현금)",
  "confidence": 0.0 ~ 1.0,
  "rationale": "전문 애널리스트 리포트 수준의 상세 시황 전망 (Markdown 포맷 적극 활용).\\n필수 포함 항목:\\n1. 🎯 다중 프레임 핵심 요약 (1줄)\\n2. 📈 수급 및 매크로 분석\\n3. ⚠️ 리스크 요인 및 변수\\n4. 💡 타임프레임별 세부 전망 (T+1, T+5, T+20)\\n가독성을 위해 줄바꿈(\\\\n)과 기호(-, *)를 반드시 사용할 것.",
  "indicators": ["사용한 핵심 지표 이름 나열"],
  "key_sources": ["판단에 가장 크게 영향을 준 데이터 소스 1줄 요약, 최대 5개"]${feedbackField}
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

    // 과거 오답 노트 / 회고 리포트 (Cycle A만 해당됨)
    let retroBlock = ''
    if (context.monthlyReview) {
        retroBlock += `\n## 🌍 [최근 1개월 월간 매크로 회고]\n${context.monthlyReview.content}\n\n`
    }
    if (context.weeklyReview) {
        retroBlock += `\n## 📅 [지난 주 오전 예측 요약 결산]\n${context.weeklyReview.content}\n\n`
    }
    if (retroBlock) {
        retroBlock = `\n# 🚨 [핵심 컨텍스트: 과거 오답 및 성공 패턴]\n당신이 최근 5일/1달 동안 예측했던 시황의 결과입니다. 반드시 읽고 똑같은 실수를 반복하지 마세요.\n${retroBlock}`
    }

    let cycleABlock = ''
    if (context.cycle === 'B' && context.todayCycleA) {
        cycleABlock = `\n# 📝 [일간 오답노트 및 종가 반영 지시]
**오늘 아침(Cycle A) 당신의 예측**:
- 당신의 판단: ${context.todayCycleA.predict}
- 당시 근거: ${context.todayCycleA.rationale.substring(0, 300)}...

**요청사항**: 
1. 오늘 장마감 데이터(특징주, 외국인 수급)를 바탕으로, 아침의 위 가설이 맞았는지 분석하여 \`morning_feedback\` 필드에 1~2줄로 기록하세요.
2. 현재 실시간 거래되고 있는 나스닥/S&P 미 선물 지수 흐름을 핵심 동력 삼아 내일(T+1) 아침 시초가 갭상승/하락 변동성을 강력하게 타격 예측하세요.\n\n`
    }

    return `# 시황 매매 판단 요청
**사이클**: ${cycleLabel}
**날짜**: ${new Date().toISOString().split('T')[0]}
${retroBlock}
${dataBlocks}
${missingBlock}
${historyBlock}
${cycleABlock}

위 데이터를 종합 분석하여 KOSPI 지수의 T+1, T+5, T+20 관점 방향성과 목표 변동률(%)을 예측하고, 지정된 JSON 형식으로 응답하세요.`
}
