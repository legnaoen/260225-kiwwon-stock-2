# Theme AI (테마 관리 에이전트) 개발 계획

> [!IMPORTANT]
> 본 문서는 **Theme AI(테마 에이전트)의 phased 개발 로직 및 연동 방안**을 명세합니다.
> 초기 계획의 '즉시 매매 연결' 컨셉을 수정하여, **1단계(분석/추적 기능)** 구축을 최우선으로 진행한 후 **2단계(종목 매매 연동)** 로 확장합니다.

---

## 1. 개요 (Overview)
기존 L2 레이어에 위치했던 테마 에이전트를 `Issue AI`와 동급의 **독립적인 관찰 및 추적 시스템**으로 격상시킵니다. 
수동적인 질의응답을 넘어서서, `PL-NaverFlow` 데이터 등을 기반으로 현재 한국 시장의 **주도 섹터와 테마를 자율적으로 분석하고 장부(Ledger) 형태로 지속 추적 관리**하는 것이 기본 기능입니다.

---

## 2. Phase 1: 테마 분석 및 추적 플랫폼화 (우선 개발)

현재 가동 중인 `PL-NaverFlow`(마켓 흐름, Top 10 업종, 대표 주도주 태깅 등) 파이프라인의 아웃풋을 베이스로 작동하는 **테마 장부(Theme Ledger) 추적 시스템**을 구축합니다.

### 2.1 Theme Ledger DB (테마 장부)
Issue AI의 `IssueLedgerDB`와 유사한 형태로 **테마 생애주기 장부**를 운용합니다.
* **상태 관리**: `NEW`(신생 주도테마) -> `ESCALATING`(섹터 수급 폭발) -> `FADING`(차익 실현/수급 이탈) -> `RESOLVED`(테마 소멸)
* **스키마 구성**:
  * `theme_id`: 고유 식별자 (예: TH-2603-01)
  * `theme_name`: 테마/업종명 (예: 전력설비, AI 반도체)
  * `intensity_score`: 시장 장악력 점수 (NaverFlow 당일 등락률, 거래대금 비중 기반)
  * `flagship_stocks`: 해당 테마의 핵심 선도주 (대장주) 1~3개 추적
  * `narrative`: 이 테마가 почему 올랐는지에 대한 요약
  * `timeline`: 해당 테마의 N일간 흥망성쇠 히스토리 기록

### 2.2 Theme AI Controller (`ThemeManagementAgent.ts`)
매일/매시간 작동하는 배치 에이전트로 동작합니다.
1. **데이터 인제스트**: `PL-NaverFlow`를 최우선으로 수집하며, 필요 시 `PL-NewsFlow`의 키워드를 덧붙여 문맥을 파악.
2. **LLM 추론 (상태 판별)**:
   * 어제 장부에 있던 테마가 오늘 `PL-NaverFlow` Top 10에서 사라졌거나 하락했다면 상태를 `FADING`으로 업데이트.
   * 완전히 새롭게 급등한 업종이 있다면 `CREATE` 액션으로 테마 장부에 신규 등록.
   * 기존 주도 테마의 대장주가 변동되었다면 장부(Flagship stocks)를 `UPDATE`.
3. **결과 시각화 (UI)**:
   * 대시보드 내 **Theme Tracker** 메뉴 신설.
   * 현재 증시를 이끄는 팩터(주도 섹터)가 무엇인지 직관적인 카드 형태로 나열.

---

## 3. Phase 2: 실제 매매 로직으로의 연결 (Next Step)

Phase 1에서 테마에 대한 안정적이고 신뢰도 높은 추적 데이터(DB)가 쌓이기 시작하면, 이를 바탕으로 L3 **택티컬 매매 에이전트(Swing, Momentum)** 와 연동합니다.

### 3.1 거래 필터링 커플링 (L3 <-> L2)
* **모멘텀 에이전트 (단타)**:
  * 시장에서 갑자기 거래대금이 폭발하는 종목이 포착됐을 때, `Theme Ledger DB`를 조회.
  * 해당 종목이 상태가 `NEW` 또는 `ESCALATING`인 현재 주도 테마의 **대장주**로 등록된 종목이라면 진입 가중치를 대폭 상향.
  * 반대로 소멸(`FADING`) 중인 테마라면 진입 거부.

* **스윙 에이전트 (단기 보류)**:
  * `Theme Ledger`상 수일째 높은 intensity를 유지하고 있는 메가 트렌드 테마를 검색.
  * 해당 테마 대장주가 1차 랠리 후 눌림목 지지선에 도달하면 진입.

---

## 4. 구현 스텝 (Action Item)

1. [ ] `ThemeLedgerDB.ts` 작성 (IssueLedgerDB 구조 차용)
2. [ ] `ThemeManagementAgent.ts` 메인 로직 작성 (PL-NaverFlow 데이터 파싱 및 AI 프롬프트 체인)
3. [ ] React UI (주도 테마 트래커) 컴포넌트 추가 및 대시보드 탭 연결
4. [ ] _(이후 Phase 2 진행)_ 매매 시스템(MaiisCommandCenter/Agent) 내부에서 Theme DB 조회용 API 연동 
