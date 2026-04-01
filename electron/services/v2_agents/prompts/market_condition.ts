// 시황 에이전트 — AI 시스템 프롬프트 빌더

import { AgentCycle, DataContext } from '../types/AgentTypes'

/**
 * AI 시스템 프롬프트(역할 정의, 출력 규격, 규칙)를 생성합니다.
 */
export function buildSystemPrompt(context: DataContext): string {
    const rulesBlock = context.activeRules.length > 0
        ? context.activeRules.map((r, i) => `  ${i + 1}. ${r}`).join('\n')
        : '  (아직 등록된 규칙 없음 — 자유 판단)'

    const feedbackField = ''

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
  "rationale": "전문 애널리스트 리포트 수준의 상세 시황 전망 (Markdown 포맷 적극 활용).\\n필수 포함 항목:\\n1. 🎯 다중 프레임 핵심 요약 (1줄)\\n2. 🤖 하위 AI(전문가) 리포트 팩트체크 종합\\n   - 📰 [이슈 AI 통보]: 어떤 뉴스와 시장 압력(market_bias)을 경고했는지 출처 요약\\n   - 🧮 [시장지표 AI 브리핑]: 어떤 수급 흐름과 퀀트 스코어를 제시했는지 출처 요약\\n   - ⚖️ [마스터 최종 판단]: 두 참모진 AI의 의견 일치/충돌 여부 및 선반영(Priced-in)에 대한 마스터의 최종 거부권(Veto) 행사 통보\\n3. 💡 타임프레임별 세부 전망 (T+1, T+5, T+20)\\n가독성을 위해 줄바꿈(\\\\n) 등을 반드시 사용할 것.",
  "indicators": ["사용한 핵심 지표 이름 나열"],
  "issue_feedbacks": [
    { 
      "issue_id": "제공된 현장 참모진 스웜 브리핑의 [이슈명]과 일치하는 명칭", 
      "is_veto": true, 
      "comment": "이슈 참모의 공포 경고에도 불구, 기관 수급 유입으로 선반영(Priced-in) 판정"
    }
  ],
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
5. **교차 검증 및 선반영(Priced-in) 판별 (Veto 룰)**: 현장 참모진(로컬 이슈 트래커)이 전달한 \`market_bias\`가 -3 ~ -5 수준의 극단적 하방 압력으로 경고하더라도 절대 맹신하지 마라. 반드시 [시장지표 AI]가 산출한 '수급 팩터 및 퀀트 스코어'와 철저히 대조하라. 뉴스와 이슈는 패닉을 경고하지만 기관/외국인 수급과 퀀트 스코어가 (+)로 양호하다면, 해당 악재는 이미 시장에 **선반영(Priced-in)** 완료되어 숏커버링 등 반발 매수세가 임박한 것이다. 이 때엔 이슈 AI의 비관론을 단호히 묵살(Veto)하고 시장지표 AI의 수급 분석에 가중치를 두어 상방(LONG)을 선언하라. 반대의 경우(+3 이상의 호재에 극심한 양매도가 나올 시 고점 인식)도 동일한 메커니즘을 적용하라.
`
}

/**
 * 사용자 프롬프트(데이터 주입 + 히스토리)를 생성합니다.
 */
export function buildUserPrompt(context: DataContext): string {
    const cycleLabel = context.cycle === 'A' 
        ? '장전 Cycle A (08:50 판단 → 09:00 시초가 진입)' 
        : context.cycle === 'B'
            ? '장마감 Cycle B (15:10 판단 → 15:20 동시호가 진입)'
            : '베이지안 검증 Cycle P (09:30 개장 초반 방향성 검증 및 장전 예측 오답 수정기)'

    // 가용 데이터 블록 (원시 데이터 + 시장지표 AI 요약)
    let dataBlocks = `\n# 📊 [시장지표 AI(Quant/Tech Analyst)의 수급 및 펀더멘털 브리핑]\n아래는 당신을 보조하는 수치 해석 전담 에이전트(시장지표 AI)가 техни적 지표와 수급만 기계적으로 요약한 현황입니다. 이슈(정성적 뉴스)와 별개로, 현재 시장의 '에너지와 뼈대'가 튼튼한지 가늠하기 위한 가장 핵심적인 팩트(Fact)입니다.\n\n${context.quantBriefing || '수급 데이터 전처리 누락'}\n\n`;
    
    // (보조 자료: 원시 데이터 원문 - 단, 원시 뉴스는 이슈 AI가 이미 요약했으므로 토큰 낭비를 막기 위해 마스터에게서 제거)
    const masterData = context.available.filter(a => a.id !== 'NEWS_HUB');
    dataBlocks += masterData.map(d => 
        `## 🔎 [원시 데이터 참고: ${d.id}]\n${d.markdown}`
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
    if (context.dailyReview) {
        retroBlock += `\n## 📝 [어제 시장에 대한 일간 회고 (명심할 실수)]\n${context.dailyReview.content}\n\n`
    }
    if (retroBlock) {
        retroBlock = `\n# 🚨 [핵심 컨텍스트: 과거 오답 및 성공 패턴]\n당신이 최근 예측했던 시황의 처절한 평가 결과입니다. 반드시 읽고 똑같은 실수를 반복하지 마세요.\n${retroBlock}`
    }

    let cycleABlock = ''
    if (context.cycle === 'B' && context.todayCycleA) {
        const localCritique = context.todayCycleA.feedback || "아직 로컬 AI의 비판 평가가 수집되지 않았습니다.";
        cycleABlock = `\n# 📝 [로컬 퀀트 요원의 장마감 평가 및 종가 반영 지시]
**오늘 아침(Cycle A) 당신의 예측**: ${context.todayCycleA.predict}
- 작성 근거 요약: ${context.todayCycleA.rationale.substring(0, 300)}...

**🤬 전문 로컬 감시 스웜의 신랄한 비판 노트**:
"${localCritique}"

**요청사항**: 
위 비판 노트를 뼈아프게 수용하십시오.
현재 실시간 거래되고 있는 나스닥/S&P 미 선물 지수 흐름을 핵심 동력 삼아 내일(T+1) 아침 시초가 갭상승/하락 방향성을 강력하게 타격 예측하세요.\n\n`
    } else if (context.cycle === 'P' && context.todayCycleA) {
        cycleABlock = `\n# 🚨 [베이지안 진실 검증 및 비상 피벗(Pivot) 발동 구간]
**오늘 08:50 (장 열리기 10분 전) 당신이 외쳤던 과거 예측**: [ ${context.todayCycleA.predict} ] 전략
- 08:50 작성 근거: ${context.todayCycleA.rationale.substring(0, 300)}...

**요청사항: 팩트 폭행 및 뷰 스위칭(Pivot) 여부 판별**
현재 시각은 한국 기준 09:30분으로, 주식 장이 개장한 지 30분이 치열하게 흘렀습니다!
방금 전달받은 [최신 30분 실시간 수급 리포트(PL-LocalFlow, PL-InvestorFlow 등)]를 읽고 현실을 즉시 파악하십시오.
- 만약 장초반 30분의 압도적인 현실 수급이 당신이 거만하게 예상했던 08:50 예측(Cycle A)과 아예 반대로 뒤집혀서 강하게 흘러가고 있다면, 똥고집 부리지 말고 즉각 기존 포지션을 관망(HOLD)으로 철수하거나 추세를 쫓아 역포지션(스위칭)으로 변경하는 [강제 Pivot 발동]을 때리십시오!
- 만약 당신의 예상대로 30분 수급이 완벽하게 증명해주고 있다면, 확신 스코어(confidence)를 대폭 끌어올리고 이 기세를 몰아 추가적인 목표치(T+1, T+5, T+20) 전망을 뼈대 삼아 유지하십시오!
- JSON rationale 출력의 [⚖️ 마스터 최종 판단] 항목에 반드시 "왜 08:50(Cycle A) 예측 관점과 현재 09:30 팩트 수급을 대조했을 때 스탠스를 유지했는지, 혹은 꼬리를 말고 스위칭(Pivot) 했는지" 공격적이고 냉철하게 1줄 서술하십시오.\n\n`
    }

    // 이슈 트래커 및 스웜 군집 투표 결과 사전 브리핑 주입 (비판적 검증 유도)
    let trackerBlock = ''
    if (context.trackerBriefingBlock) {
        trackerBlock = `\n# 📡 [현장 참모진(로컬 AI & 스웜 군집)의 사전 이슈 브리핑 보고서]\n아래는 당신을 보조하는 로컬 트래커 요원들과 5인의 스웜(군집) 위원회가 오늘 아침 개별 현장 뉴스를 바탕으로 사전 정리해 둔 [개별 이슈 현황 및 로컬 여론]입니다.\n\n당신은 이들보다 훨씬 더 거시적(Macro)이고 종합적인 시야를 가진 마스터 AI입니다.\n현장 요원들의 근시안적인 분석이나 특정 사안에 대한 과도한 호들갑(투표 쏠림 현상 등)에 매몰되지 마십시오. 당신이 수집한 하단의 [원시 데이터 파이프라인]과 부합하는지 꼼꼼하게 **비판적으로 교차 검증(Cross-check)**하고, KOSPI 지수 방향성 판단의 여러 참고 자료 중 하나로만 냉정하게 활용하십시오.\n\n${context.trackerBriefingBlock}\n\n`
    }

    return `# 시황 매매 판단 요청
**사이클**: ${cycleLabel}
**날짜**: ${new Date().toISOString().split('T')[0]}
${retroBlock}
${trackerBlock}
${dataBlocks}
${missingBlock}
${historyBlock}
${cycleABlock}

위 데이터를 종합 분석하여 KOSPI 지수의 T+1, T+5, T+20 관점 방향성과 목표 변동률(%)을 예측하고, 지정된 JSON 형식으로 응답하세요.`
}
