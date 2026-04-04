// 시황 에이전트 — AI 시스템 프롬프트 빌더 (통합 이슈 관리 포함)

import { AgentCycle, DataContext } from '../types/AgentTypes'

/**
 * AI 시스템 프롬프트(역할 정의, 출력 규격, 규칙)를 생성합니다.
 * Cycle A에서는 이슈 장부 관리(CREATE/UPDATE/RESOLVE) 기능이 추가됩니다.
 */
export function buildSystemPrompt(context: DataContext): string {
    const rulesBlock = context.activeRules.length > 0
        ? context.activeRules.map((r, i) => '  ' + (i + 1) + '. ' + r).join('\n')
        : '  (아직 등록된 규칙 없음 — 자유 판단)'

    // Cycle A일 때만 이슈 관리 역할 추가
    const issueManagementRole = (context.cycle === 'A') ? '\n\n# 추가 역할: 이슈 장부(Issue Ledger) 통합 관리자\n' +
        '당신은 KOSPI 방향성 예측과 동시에, 한국 시장의 메인 서사(장기 테마 및 매크로 리스크)를 관리하는 이슈 장부 관리자이기도 합니다.\n\n' +
        '[이슈 명명 규칙 (가치 중립)]\n' +
        '- 이슈 제목은 쇼크, 폭락, 공포, 기대, 우려 등 감정적 단어를 배제하고 위키백과 표제어처럼 가치 중립적으로 명명\n' +
        '- 기존 장부에 감정적 단어가 있으면 이번 업데이트에서 전면 개칭\n\n' +
        '[신규 메가 트렌드 발굴 의무]\n' +
        '- 기존 장부에 없는 새로운 거시적 돌발 이슈나 메가 트렌드가 관측되면 반드시 CREATE\n' +
        '- 기존 이슈만 무사안일하게 UPDATE/RESOLVE 하지 말 것\n\n' +
        '[좀비 이슈 소멸 규정]\n' +
        '- 뉴스에 전혀 언급되지 않거나 [침묵 경고] 태그가 붙은 이슈는 FADING 강등 또는 RESOLVE 처리\n' +
        '- 무소식은 영향력 해소를 의미' : ''

    // Cycle A 전용 확장 JSON 스키마
    const issueOutputSchema = (context.cycle === 'A') ? ',\n' +
        '  "briefing": {\n' +
        '    "risk_score": 55,\n' +
        '    "summary_markdown": "<p><b>[핵심 테제]</b> 시장의 가장 중요한 서사를 첫 문장으로 선언...</p>",\n' +
        '    "macro_vix": "+2.4% (18.5)",\n' +
        '    "macro_krw": "+5.0원 (1510.5)",\n' +
        '    "macro_tnx": "+0.03%p (4.320%)",\n' +
        '    "macro_oil": "-0.5% ($78.50)"\n' +
        '  },\n' +
        '  "issue_actions": [\n' +
        '    {\n' +
        '      "action": "CREATE | UPDATE | RESOLVE",\n' +
        '      "issue_id": "기존 이슈 ID 또는 새 ID (예: 2604-03)",\n' +
        '      "name": "위키백과식 가치 중립적 이슈 명칭",\n' +
        '      "current_stance": "[단기 1주내 / 중기 1~3개월 / 장기 구조적] 투자 스탠스 요약",\n' +
        '      "severity": "AAA|AA|A|B|C",\n' +
        '      "status": "ESCALATING|FADING|RESOLVED|NEW",\n' +
        '      "impactDirection": "상승|하락|중립",\n' +
        '      "market_bias": -5~+5,\n' +
        '      "dominant_regime": "지정학 리스크, 통화정책 등",\n' +
        '      "summary": "1~2문장 핵심 상태 요약",\n' +
        '      "goodSectors": [{"name": "업종명", "reason": "이유"}],\n' +
        '      "badSectors": [{"name": "업종명", "reason": "이유"}],\n' +
        '      "timelineDetails": {\n' +
        '        "summary": "타임라인 요약 제목",\n' +
        '        "ai_analysis": "파급력 서술",\n' +
        '        "market_reaction": "정량적 시장 반응",\n' +
        '        "status_snapshot": "현재 상태"\n' +
        '      }\n' +
        '    }\n' +
        '  ]' : ''

    const rationaleFormat = (context.cycle === 'A')
        ? '2. 🤖 데이터 상호 분리 검증 (Triangulation, 출처 엄격 준수)\\n   - 🚨 [오늘의 이슈 팩트 상세 (News Only, 소스: NEWS_HUB, PL-Macro)]: (※수급 언급 금지) 제공된 기사 전체를 바탕으로 현재 시장에 영향을 주는 최소 3~5가지 이상의 지정학·거시경제·산업별 사건 팩트를 개별 불릿포인트(-)로 상세히 나열\\n   - 📢 [증권가 및 언론 시각 (Reports Only, 소스: PL-Research)]: (※수급 언급 금지) 애널리스트들의 주요 리포트 뷰(비관/낙관/바닥론 등)와 투자 전략을 최소 3가지 이상의 핵심 논리로 분류하여 불릿포인트(-)로 상세 나열\\n   - 🧮 [시장 현황 (Market Data Only, 소스: PL-InvestorFlow, PL-LocalFlow)]: (※뉴스 언급 금지) 외국인/기관 수급액, 지수 등락 등 진짜 돈의 흐름만 명시\\n   - ⚖️ [최종 교차 판정 (Synthesis)]: 팩트(1번)와 기관 주장(2번), 투입된 진짜 돈(3번)을 대조하여 과장/선반영을 심판하고 시장의 진짜 압력을 계산'
        : '2. 🤖 장중/장후 데이터 교차 검증 (실수급 최우선 원칙)\\n   - 📰 [아침 수립 이슈 현황 검증]: 오늘 아침(Cycle A) 당신이 최초 수립한 이슈들이 현재 실시간 현장(뉴스/수급)과 맞아떨어지는지 최소 2~3가지 불릿포인트(-)로 상세 진단\\n   - 🧮 [실시간 수급 진단 (Market Data Only)]: (※가장 중요) 제공된 장중 실시간 외국인/기관 수급액 흐름을 최소 3가지 이상의 불릿포인트(-)로 철저히 해부. (※주의: 리포트/전망은 장전에 모두 소화했으므로, 현재는 백미러를 보지 말고 오로지 실시간 전광판의 \'현찰 흐름\'에만 집중할 것)\\n   - ⚖️ [최종 교차 판정 / Pivot 선언]: 아침의 예측과 현재 실시간 수급 데이터 간의 일치/충돌 여부를 심판하여, 기존 뷰를 유지할지 혹은 즉각 스위칭(Pivot)할지 선언';

    return '# 역할\n' +
        '너는 KOSPI 지수의 T+1(하루), T+5(1주일), T+20(1개월) 방향성 및 변동률을 동시에 조망하는 거시경제 트레이딩 전략가다.\n' +
        '이름: Market Condition Agent (MCA)\n' +
        issueManagementRole + '\n' +
        '\n# 매매 대상\n' +
        '- T+1 상승 예상 → KODEX 200 (069500) 매수\n' +
        '- 하락 예상 → KODEX 인버스 (114800) 매수\n' +
        '- 판단 불가/혼조 → 관망(현금) 유지\n' +
        '\n# 출력 규격\n' +
        '반드시 아래 JSON 형태로만 응답하라. 다른 텍스트를 JSON 앞뒤에 쓰지 마라.\n' +
        '\n```json\n{\n' +
        '  "t1": {"direction": "LONG | SHORT | HOLD", "target_return": 1.2},\n' +
        '  "t5": {"direction": "LONG | SHORT | HOLD", "target_return": -0.5},\n' +
        '  "t20": {"direction": "LONG | SHORT | HOLD", "target_return": -4.5},\n' +
        '  "position": "KODEX 200 | KODEX 인버스 | 관망(현금)",\n' +
        '  "confidence": 0.0 ~ 1.0,\n' +
        '  "rationale": "전문 애널리스트 리포트 수준의 상세 시황 전망 (Markdown 포맷 적극 활용).\\n필수 포함 항목:\\n1. 🎯 다중 프레임 핵심 요약 (1줄)\\n' + rationaleFormat + '\\n3. 💡 타임프레임별 세부 전망 (T+1, T+5, T+20)\\n가독성을 위해 줄바꿈(\\\\n) 등을 반드시 사용할 것.",\n' +
        '  "indicators": ["사용한 핵심 지표 이름 나열"],\n' +
        '  "issue_feedbacks": [\n' +
        '    {\n' +
        '      "issue_id": "이슈 장부 내의 이슈명과 일치하는 명칭",\n' +
        '      "is_veto": true,\n' +
        '      "comment": "선반영(Priced-in) 판정 등의 사유"\n' +
        '    }\n' +
        '  ],\n' +
        '  "key_sources": ["판단에 가장 크게 영향을 준 데이터 소스 1줄 요약, 최대 5개"]' +
        issueOutputSchema + '\n}\n```\n' +
        '\n# 활동 규칙 (Active Rules)\n' +
        '과거 오답 복기를 통해 학습된 규칙들이다. 반드시 준수하라:\n' +
        rulesBlock + '\n' +
        '\n# 판단 원칙\n' +
        '1. **양면 분석 필수**: 긍정 요인과 부정 요인을 반드시 모두 나열한 뒤 종합 판단\n' +
        '2. **신뢰도 솔직 표현**: 확신이 낮으면 confidence를 0.4 이하로 설정하고 HOLD 선택 권장\n' +
        '3. **누락 데이터 인지**: 아래에 "누락된 데이터"가 명시되어 있으면, 해당 정보 없이 판단한 한계를 rationale에 반영\n' +
        '4. **과적합 경고**: 단일 지표에만 의존하지 말 것. 복수 근거 교차 확인\n' +
        '5. **교차 검증 및 선반영(Priced-in) 판별 (Veto 룰)**: 뉴스가 극단적 하방 압력을 경고하더라도 절대 맹신하지 마라. 반드시 시장지표 AI가 산출한 수급 팩터 및 퀀트 스코어와 철저히 대조하라. 뉴스는 패닉을 경고하지만 기관/외국인 수급과 퀀트 스코어가 (+)로 양호하다면, 해당 악재는 이미 시장에 선반영(Priced-in) 완료된 것이다. 반대의 경우도 동일한 메커니즘을 적용하라.\n'
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

    // 가용 데이터 블록 (원시 데이터)
    let dataBlocks = '\n# [시장 수급 및 펀더멘털 원시 데이터]\n' +
        '아래는 현재 시점의 시장 매크로 및 수급 데이터입니다. 당신은 이 원시 데이터를 직접 읽고 퀀트/수급 스코어를 자체적으로 계산 및 판단해야 합니다.\n\n'

    // Cycle A: 뉴스(NEWS_HUB)를 포함하여 이슈 분석도 수행
    // Cycle B/P: 기존처럼 뉴스 제외 (이슈 AI가 이미 정리한 장부 활용)
    const masterData = (context.cycle === 'A')
        ? context.available  // Cycle A: 뉴스 포함 전체 데이터
        : context.available.filter(a => a.id !== 'NEWS_HUB' && a.id !== 'PL-Research')  // B/P: 뉴스/리포트 제외

    dataBlocks += masterData.map(d => {
        let interleaveInstruction = '';
        let finalMarkdown = d.markdown;

        if (context.cycle === 'A') {
            if (d.id === 'NEWS_HUB') {
                interleaveInstruction = '\n> ⚠️ **[AI 특명]**: 이 블록은 오직 `🚨 [이슈 팩트]` 작성에만 사용! 증권사 뷰나 수급은 철저히 무시하고, 실제 벌어진 물리적 팩트만 발췌하십시오.\n';
            } else if (d.id === 'PL-Research') {
                interleaveInstruction = '\n> ⚠️ **[AI 특명]**: 이 블록은 오직 `📢 [증권가 시각]` 작성에만 사용! 여의도 애널리스트들이 대중에게 어떤 시나리오(바닥론, 공포론 등)를 주입하고 있는지만 발췌하십시오.\n';
                // PL-Research에서 '종목분석' 파트는 노이즈이므로 정규식으로 제거 (국내종목 또는 개별종목)
                finalMarkdown = finalMarkdown.replace(/\[(국내종목|종목분석)\][\s\S]*?(?=\n\[|$)/g, '');
            } else if (d.id === 'PL-InvestorFlow' || d.id === 'PL-LocalFlow') {
                interleaveInstruction = '\n> ⚠️ **[AI 특명]**: 이 블록은 오직 `🧮 [시장 현황]` 작성에만 사용! 뉴스 내용 절대 언급 불가. 전광판에 찍힌 진짜 외인/기관의 현찰 이동 수치만 발췌하십시오.\n';
            }
        }

        return '## [원시 데이터: ' + d.id + ']' + interleaveInstruction + '\n' + finalMarkdown;
    }).join('\n\n---\n\n')

    // 누락 데이터 목록
    const missingBlock = context.missing.length > 0
        ? '\n\u26a0\ufe0f **누락된 데이터** (수집 실패 또는 미구현):\n' + context.missing.map(m => '- ' + m).join('\n') + '\n위 데이터 없이 판단해야 합니다. 한계를 rationale에 반영하세요.'
        : '\n\u2705 모든 등록된 파이프라인 데이터 수집 완료.'

    // 최근 예측 히스토리 (AI가 자기 편향을 인식하도록)
    let historyBlock = ''
    if (context.recentHistory.length > 0) {
        const rows = context.recentHistory.map(h => {
            const t1 = h.t1_final !== undefined && h.t1_final !== null ? (h.t1_final > 0 ? '+' : '') + h.t1_final.toFixed(2) + '%' : '미확정'
            const result = h.t1_final !== undefined && h.t1_final !== null
                ? ((h.predict === 'LONG' && h.t1_final > 0) || (h.predict === 'SHORT' && h.t1_final < 0) ? '\u2705적중' : '\u274c오답')
                : '\u23f3대기'
            return '| ' + h.date + ' ' + h.cycle + ' | ' + h.predict + ' | ' + t1 + ' | ' + result + ' |'
        }).join('\n')
        historyBlock = '\n## 최근 예측 히스토리\n| 날짜 | 판단 | T+1 Final | 결과 |\n|---|---|---|---|\n' + rows + '\n\n위 이력을 참고하여 반복적으로 틀리는 패턴이 있다면 보정하세요.'
    }

    // 과거 오답 노트 / 회고 리포트 (Cycle A만 해당)
    let retroBlock = ''
    if (context.monthlyReview) {
        retroBlock += '\n## [최근 1개월 월간 매크로 회고]\n' + context.monthlyReview.content + '\n\n'
    }
    if (context.weeklyReview) {
        retroBlock += '\n## [지난 주 오전 예측 요약 결산]\n' + context.weeklyReview.content + '\n\n'
    }
    if (context.dailyReview) {
        retroBlock += '\n## [어제 시장에 대한 일간 회고]\n' + context.dailyReview.content + '\n\n'
    }
    if (retroBlock) {
        retroBlock = '\n# [과거 오답 및 성공 패턴]\n최근 예측 평가 결과입니다. 반드시 읽고 똑같은 실수를 반복하지 마세요.\n' + retroBlock
    }

    let cycleABlock = ''
    if (context.cycle === 'B' && context.todayCycleA) {
        const localCritique = context.todayCycleA.feedback || "아직 로컬 AI의 비판 평가가 수집되지 않았습니다.";
        cycleABlock = '\n# [로컬 퀀트 요원의 장마감 평가 및 종가 반영 지시]\n' +
            '**오늘 아침(Cycle A) 당신의 예측**: ' + context.todayCycleA.predict + '\n' +
            '- 작성 근거 요약: ' + context.todayCycleA.rationale.substring(0, 300) + '...\n\n' +
            '**전문 로컬 감시 스웜의 비판 노트**:\n"' + localCritique + '"\n\n' +
            '**요청사항**: 위 비판 노트를 수용하고, 현재 나스닥/S&P 미 선물 지수 흐름을 핵심 동력 삼아 내일(T+1) 아침 시초가 방향성을 강력하게 예측하세요.\n\n'
    } else if (context.cycle === 'P' && context.todayCycleA) {
        cycleABlock = '\n# [베이지안 진실 검증 및 비상 피벗(Pivot) 발동 구간]\n' +
            '**오늘 08:50 당신이 외쳤던 과거 예측**: [ ' + context.todayCycleA.predict + ' ] 전략\n' +
            '- 08:50 작성 근거: ' + context.todayCycleA.rationale.substring(0, 300) + '...\n\n' +
            '**요청사항: 팩트 폭행 및 뷰 스위칭(Pivot) 여부 판별**\n' +
            '현재 시각은 한국 기준 09:30분으로, 주식 장이 개장한 지 30분이 치열하게 흘렀습니다!\n' +
            '방금 전달받은 [최신 30분 실시간 수급 리포트]를 읽고 현실을 즉시 파악하십시오.\n' +
            '- 만약 장초반 30분의 압도적인 현실 수급이 당신의 08:50 예측과 반대로 흘러가고 있다면, 즉각 HOLD로 철수하거나 역포지션으로 강제 Pivot을 때리십시오!\n' +
            '- 만약 예상대로 증명되고 있다면, confidence를 대폭 끌어올리십시오!\n\n'
    }

    // 이슈 트래커 브리핑 주입
    let trackerBlock = ''
    if (context.trackerBriefingBlock) {
        if (context.cycle === 'A') {
            trackerBlock = '\n# [기존 이슈 장부 현황 (UPDATE/RESOLVE 참고용)]\n' +
                '아래는 어제까지 유지된 기존 이슈 장부 현황입니다.\n' +
                '이 내용을 참고하여, 새로 분석한 뉴스와 통합 판단 후 UPDATE 하거나 파급력이 사라졌다면 RESOLVE 처리하십시오.\n\n' +
                context.trackerBriefingBlock + '\n\n'
        } else {
            trackerBlock = '\n# [오늘 장전(Cycle A) 본인이 수립한 이슈 장부 현황 및 군집 투표 결과]\n' +
                '아래는 오늘 아침 당신이 직접 생성/수정한 장부 현황과, 그에 대한 스웜 군집의 최신 투표 결과입니다.\n' +
                '아침의 내러티브(전망)가 현재 장중 실시간 수급에 의해 지켜지고 있는지 무자비하게 재평가하십시오.\n\n' +
                context.trackerBriefingBlock + '\n\n'
        }
    }

    // Cycle A 전용: 이슈 관리 임무 및 섹터/테마 목록 추가
    let issueTaskBlock = ''
    if (context.cycle === 'A') {
        issueTaskBlock = '\n# [이슈 장부 관리 임무 (Cycle A 전용)]\n' +
            '위 뉴스/데이터를 심층 분석하여 다음을 추가로 수행하십시오:\n' +
            '1. 기존 이슈 장부에 새 정보가 있으면 UPDATE, 영향력 해소 시 RESOLVE\n' +
            '2. 기존 장부에 없는 새로운 거시적 이슈/메가 트렌드 발견 시 CREATE\n' +
            '3. 노이즈성 뉴스는 무시\n' +
            '4. briefing 객체에 전체 시장 위험도(risk_score 0~100)와 핵심 테제(summary_markdown) 작성\n'

        if (context.sectorListStr) {
            issueTaskBlock += '\n[네이버 증권 추적 섹터 목록 (goodSectors/badSectors 참고)]\n' +
                context.sectorListStr + '\n'
        }
        if (context.themeListStr) {
            issueTaskBlock += '\n[네이버 증권 추적 테마 목록 (참고용)]\n' +
                context.themeListStr + '\n'
        }
    }

    return '# 시황 매매 판단 요청\n' +
        '**사이클**: ' + cycleLabel + '\n' +
        '**날짜**: ' + new Date().toISOString().split('T')[0] + '\n' +
        retroBlock +
        trackerBlock +
        dataBlocks + '\n' +
        missingBlock +
        historyBlock +
        cycleABlock +
        issueTaskBlock + '\n\n' +
        '위 데이터를 종합 분석하여 KOSPI 지수의 T+1, T+5, T+20 관점 방향성과 목표 변동률(%)을 예측하고, 지정된 JSON 형식으로 응답하세요.'
}
