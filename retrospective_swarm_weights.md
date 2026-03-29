### Intraday Swarm AI 고도화: 동적 가중치(입김) 및 UI 통합 완료 보고서

#### 1. 개요
이전에 논의된 기획을 바탕으로 로컬 군집(Swarm) AI의 성능을 추적하고, 높은 적중률을 기록한 페르소나에게 더 높은 발언권(가중치)을 부여하여 최종 의사결정에 반영하는 아키텍처를 구현했습니다. 더불어 사용자가 UI를 통해 실시간으로 군집 여론과 개별 댓글, 그리고 의견 충돌 여부를 직관적으로 파악할 수 있도록 대시보드를 확장했습니다.

#### 2. 핵심 구현 상세

**Phase 2: 페르소나 개별 채점 (Database & PerformanceTracker)**
- `DatabaseService`의 `persona_performance` 테이블 고유 키(UNIQUE) 제약 조건을 `(date, persona_id)`에서 `(date, time_slot, persona_id)`로 마이그레이션하여 하루 2번(09:30, 13:00)의 평가 데이터를 모두 보존하도록 수정했습니다.
- `PerformanceTracker.ts`에 `trackPersonaPerformance` 메서드를 추가하여 장중 평가(15:35, 실시간) 시점에 Main AI의 `return_pct` 방향성과 페르소나별 `predict`를 대조(Hit/Miss)하고 개별 승점을 차곡차곡 누적합니다.

**Phase 3: 권력 양극화 (Weight Multipliers)**
- `PerformanceTracker.ts`에 최근 30일간의 데이터를 조회하여 페르소나별 승률(winRate)과 가중치(weight)를 반환하는 `getPersonaWeights` 로직을 구현했습니다.
  - *계산식:* 최근 승률을 50% 기준으로 환산하여 `Math.max(0.5, winRate / 50.0)` 수준의 가중치를 부여하되, 표본이 최소 5건 이상 누적되었을 때 적용됩니다.
- `IntradaySwarmAgent.ts`에서 위 가중치를 불러와 두 가지 핵심 로직에 적용했습니다.
  1. **군집 여론 (Swarm Sentiment):** 단순 다수결(Length)이 아닌, 발언권(Weight)의 합산으로 여론과 퍼센티지를 계산.
  2. **슈퍼 판별자 프롬프트 (Judge AI):** 페르소나의 이름, 의견에 발언권 및 현재 승률 데이터를 함께 주입하여, 판사 모델(Gemini or Local)이 신뢰도 높은 페르소나의 의견에 가산점을 주도록 프롬프트를 고도화.

**Phase 4: 대시보드 UI 연동 (MarketAgentTab.tsx)**
- **인트라데이 예측 테이블 확장:** 장중 타이밍 탭(Table)에 `Swarm Sentiment` 전용 열(Column)을 삽입하여 `UP (75%)`와 같은 여론을 직관적인 뱃지로 노출했습니다.
- **충돌 감지 시스템 (Conflict Alert):** 메인 파이프라인(Gemini)과 군집(Swarm)의 예측 방향이 서로 다를 경우 노란색 경고 아이콘(`ShieldAlert`)을 노출하여 사용자에게 주의를 줍니다.
- **댓글 스레드 모달 (Modal):** 장중 예측 행(Row) 클릭 시 나오는 상세 모달에 `comments_json`을 파싱하여, 개별 페르소나의 이름, 현재 적중률 트래킹, 포지션, 코멘트를 스레드 형식으로 깔끔하게 렌더링했습니다.

#### 3. 기대 효과 및 Next Action
- **RLHF 피드백 루프 완성:** 시간이 지날수록 예측력이 뛰어난 페르소나는 입김이 세지고, 성적이 부진한 페르소나는 필터링되는 자정 기작이 완성되었습니다.
- 본 기능은 장중 백그라운드에서 조용히 실행되며, UI와 분석 엔진 간에 Non-blocking 구조를 유지합니다.
- (선택) 향후 성적이 지속적으로 저조한 페르소나의 프롬프트나 데이터를 주기적으로 튜닝하거나 교체하는 "페르소나 리빌딩 자동화" 모듈을 추가할 수 있습니다.
