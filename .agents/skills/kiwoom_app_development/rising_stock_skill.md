# 🚀 급등주 및 시장 주도테마 분석 가이드 (AI 분석 스킬)

이 문서는 시장에서 급등하는 종목의 원인을 파악하고, 그 상승의 지속성과 위험성을 평가하기 위한 AI분석 엔진의 핵심 '사고 체계'를 정의합니다.

---

## 1. 상승의 질(Quality) 평가 기준

상승률보다 중요한 것은 그 상승을 만든 **'에너지의 질'**입니다.

### 1.1. 재료(Material)의 강력함
*   **A급 (구조적 변화):** 한 산업의 생태계를 바꾸는 뉴스 (예: 삼성전자의 대규모 M&A, 테슬라의 새로운 배터리 표준 채택). 6개월~1년 이상의 장기 테마 형성.
*   **B급 (직접적 수혜):** 대규모 수주 공시(매출액 대비 30% 이상), 어닝 서프라이즈, 정부의 강력한 정책 발표. 1~2주 이상의 중기 추세 형성.
*   **C급 (단발성 호재):** 단순 MOU 체결, 단순 테마 편입 찌라시, 임상 1상 시작. 1~3일 내 소멸 가능성 높음.

### 1.2. 거래대금 (Market Interest)
*   **시장의 주인공:** 당일 거래대금이 코스피/코스닥 전체 10위 내에 드는가?
*   **돈의 흔적:** 최근 3개월 평균 거래대금의 5배 이상 터졌는가? 돈이 들어오지 않은 상승은 '속임수'일 확률이 높음.

---

## 2. 기술적 분석(Chart) 관점

AI는 80일간의 일봉 차트를 보며 다음의 패턴을 읽어내야 합니다.

### 2.1. 박스권 돌파 (Breakout)
*   3개월 이상 횡보하던 박스권의 상단(저항선)을 거래량을 실어 돌파했는가? 이는 매우 강력한 매수 신호이며, 상승의 시발점이 될 수 있음.

### 2.2. 이격도 및 과열 (Overheating)
*   5일 이평선과의 이격이 20% 이상 벌어졌는가? 단기 과열권으로 보고 추격 매수의 위험성을 경고해야 함.

### 2.3. 매물대 분석
*   현재 주가 위치 바로 위에 1년 전 쌓인 대규모 매물대(악성 매물)가 있는가? 저항을 맞고 밀릴 가능성을 배제할 수 없음.

---

## 3. 테마 및 섹터 분석 (Cluster)

*   **대장주(Leader) 판별:** 동일 테마 내에서 가장 먼저 상한가에 도달하거나 가장 높은 등락률을 보이는 종목. 대장주가 꺾이면 테마 전체가 소멸함.
*   **후발주(Follower)의 위험:** 대장주가 상한가인데 뒤늦게 5% 오르는 종목은 대장주가 흔들릴 때 더 크게 하락함.

---

## 4. 리포트 작성 시 AI의 '사고 순서' (Thinking Process)

1.  **현상 파악:** "OO종목이 오늘 거래대금 3,000억을 동반하며 25% 급등함."
2.  **이유 추론 (Why?):** 뉴스 검색 결과 "전고체 배터리 핵심 소재 공급 계약" 공시가 확인됨.
3.  **차트 위치 확인:** "80일간의 매물대 상단을 시원하게 뚫어낸 '역사적 신고가' 영역임."
4.  **역사적 데이터 대조:** "과거 이 종목은 공급 계약 보도 이후 3일간 추가 상승하는 경향을 보였음."
5.  **결론 및 점수:** "재료의 크기도 크고 차트 위치도 바닥권 돌파이므로 지속성 점수 85점. 단, 단기 과열권 진입으로 눌림목 대응 권장."

---

## 5. 금기 사항 (Anti-Patterns)

*   추측성 보도(찌라시)를 공식 공시와 동일한 비중으로 다루지 말 것.
*   상한가 종목이라고 해서 무조건 '추가 상승'이라고 단정 짓지 말 것 (상한가 풀림 현상 주의).
*   차트 데이터 없이 뉴스만으로 일방적인 찬티/안티 리포트를 작성하지 말 것.

---

## AI 학습 교훈 (2026-03-10) — 급등주 분석 기능 구현 과정

### 6.1. 분석 대상 종목이 없다고 나오는 문제 (근본 원인)

**증상:** "분석할 종목이 없습니다" 메시지가 표시되며 분석 시작 불가.

**원인:** 급등주 조회 API(`ka10027`)를 호출하기 위해 장중 여부를 판별하는 로직이 과도하게 엄격했음.
키움 API는 장이 열리지 않은 시간대에도 전일 데이터를 반환하지만, 구현상 "장외 시간이면 빈 배열 반환"으로 처리하여 항상 종목이 0개로 나타남.

**해결 원칙:**
- 급등주 조회(`ka10027`, `ka10030`)는 장중 여부 판별 없이 항상 호출하고, 응답이 비어있을 때만 빈 배열 처리할 것.
- 장중 여부 체크는 "주문 실행" 단계에만 적용할 것. 데이터 조회 단계에서는 적용하지 말 것.

---

### 6.2. 이미 동작하는 유사 기능과 코드 비교 원칙

**교훈:** 급등주 분석 기능에서 종목 조회가 안 될 때, 이미 정상 동작 중인 "텔레그램 급등주 알림" 기능과 코드를 비교하여 차이점을 찾는 방식이 효과적이었음.

**원칙:** 새 기능에서 오류 발생 시, 동일한 API를 사용하는 기존 기능의 코드를 먼저 찾아 비교할 것. 특히 API 파라미터, 응답 파싱 방식, 에러 처리 방식의 차이가 원인인 경우가 많음.

---

### 6.3. DART API — `getCorpCodeByStockCode` vs `getCorpCodesByStockCodes`

**증상:** `this.dartApi.getCorpCodeByStockCode is not a function` 런타임 오류.

**원인:** `DartApiService`에는 단수형 메서드(`getCorpCodeByStockCode`)가 존재하지 않음. 복수형 배치 메서드(`getCorpCodesByStockCodes`)만 존재함.

**해결:**
```typescript
// 잘못된 방법 (단수 메서드 없음)
const corpCode = await this.dartApi.getCorpCodeByStockCode(stockCode)

// 올바른 방법 (배치 메서드로 단일 종목도 처리)
const corpCodeMap = await this.dartApi.getCorpCodesByStockCodes([stockCode])
const corpCode = corpCodeMap[stockCode]
```

---

### 6.4. EventBus Import 누락 오류

**증상:** `eventBus is not defined` / `SystemEvent is not defined` 런타임 오류.

**원인:** 새 서비스 파일(`RisingStockAnalysisService.ts`) 작성 시 EventBus import가 누락됨.

**해결:**
```typescript
// 필수 import — 이벤트 버스 사용 서비스는 반드시 포함
import { eventBus, SystemEvent } from '../utils/EventBus'
```

**원칙:** 새 서비스 파일 생성 시 상단에 아래 항목을 확인할 것:
- `eventBus`, `SystemEvent` (이벤트 발행/수신 사용 시)
- `DatabaseService` (DB 접근 시)
- `KiwoomService` (키움 API 호출 시)

---

### 6.5. 실시간 데이터와 DB 데이터 병합 시 상태 관리 원칙

**증상:** 급등주 목록이 표시되다가 AI 분석 결과가 DB에서 로드된 후 갑자기 리스트가 사라짐.

**원인:** `useState`로 관리하는 `realtimeRisingStocks`와 DB에서 불러오는 `reports` 간 병합 로직 부재.
DB 로드 시 실시간 리스트를 덮어써버리는 구조였음.

**해결 원칙:**
- 당일(오늘) 화면: 실시간 API 데이터(키움)를 기본으로, DB에 저장된 AI 분석 결과를 오버레이(덮어 쓰는 게 아닌 병합)하는 방식으로 구현할 것.
- DB 로드가 완료된 뒤에도 실시간 데이터가 살아있어야 함 (`setRealtimeRisingStocks`를 `loadReportDetails` 안에서 초기화하지 말 것).

```typescript
// 올바른 병합 패턴 (DB 결과로 실시간 리스트 보완)
const mergedStocks = realtimeStocks.map(rt => {
    const analyzed = dbStocks.find(db => db.code === rt.code)
    return analyzed ? { ...rt, ...analyzed } : rt  // DB 분석 결과가 있으면 덮어씌우기
})
```

---

### 6.6. raw 데이터 저장은 AI 호출 전에 반드시 수행

**원칙:** 뉴스/공시 데이터를 수집한 뒤 AI에 보내기 전에 `db.saveRawData()`를 먼저 호출할 것.
AI 호출이 타임아웃되거나 오류가 나더라도 수집한 raw 데이터는 반드시 DB에 보존되어야 함.

```typescript
// 올바른 순서
const rawData = await collectAllData(...)   // 1. 데이터 수집
await db.saveRawData(rawData)               // 2. raw 저장 (AI 호출 전!)
const aiResult = await gemini.analyze(...)  // 3. AI 분석
await db.saveAnalysisResult(aiResult)       // 4. 분석 결과 저장
```
