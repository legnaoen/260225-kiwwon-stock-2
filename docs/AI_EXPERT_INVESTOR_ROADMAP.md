# 전문 투자자 수준 AI 분석 시스템 — 단계별 발전 로드맵

> 작성일: 2026-03-10
> 목표: 급등주 사후 분석에서 시작하여 거시 이벤트 기반의 선행 예측 엔진으로 진화

---

## 최종 목표

> "중동에서 분쟁이 발생했다는 뉴스가 있으면, 관련 방산·정유 섹터가 오를 것으로 예측하고
> 구체적인 종목과 타임라인을 제시한다.
> 과거 유사 이벤트에서의 적중률과 이번 예측의 신뢰도를 함께 표시한다."

이 시스템은 단순 AI 뉴스 요약이 아닌, **누적 데이터에서 패턴을 스스로 학습하여
지식이 성장하는 전문 투자 보조 엔진**입니다.

---

## 전체 아키텍처 개요

```
[DATA COLLECTION LAYER]
키움 API | 네이버 뉴스 | DART | 한국은행 | Yahoo Finance | RSS
        ↓
[KNOWLEDGE BASE — SQLite DB]
급등주 분석 | 거시 이벤트 | 인과관계 맵 | 예측 기록 | 학습 로그
        ↓
[AI INTELLIGENCE LAYER]
Gemini + Skills 파일(투자원칙) + 과거 맥락 주입
        ↓
[OUTPUT LAYER]
① 당일 급등주 분석 리포트
② 시장 총평 (섹터 흐름 + 수급 분석)
③ 선행 예측 ("이번 주 주목: 방산 섹터, 신뢰도 78%")
④ 텔레그램 브리핑
```

---

## 데이터 소스 전체 지도

### 현재 수집 중 (Phase 1 기반)

| 소스 | 데이터 | 용도 |
|------|--------|------|
| 키움 ka10027 | 등락률 상위 종목 | 급등주 포착 |
| 키움 ka10081 | 일봉 80봉 차트 | 기술적 분석 |
| 네이버 뉴스 API | 종목별 뉴스 5건 | 상승 사유 파악 |
| DART API | 기업 공시 | 상승 사유 파악 |
| DART API | 기업 재무 | 재무 건전성 |
| Yahoo Finance | 미국증시 히스토리 | AI 학습 데이터 |

### 단계별 추가 예정

| 단계 | 소스 | 데이터 | 용도 | 비용 |
|------|------|--------|------|------|
| Phase 2 | 키움 ka10030 | 거래대금 상위 | 수급 주도주 파악 | 무료 |
| Phase 2 | 키움 ka10040 | 업종 등락률 | 섹터 흐름 파악 | 무료 |
| Phase 2 | 네이버 뉴스 확장 | 정책/금리/지정학 뉴스 | 거시 이벤트 수집 | 무료 |
| Phase 2 | Yahoo Finance 확장 | 환율, 유가, 미국 금리 | 거시 지표 수집 | 무료 |
| Phase 3 | 한국은행 ECOS API | 기준금리, CPI, GDP | 거시 경제 지표 | 무료 |
| Phase 3 | RSS 피드 | 이데일리/한경/매경 헤드라인 | 실시간 경제 뉴스 | 무료 |
| Phase 4 | FRED API (미 연준) | 미국 금리, 고용 지표 | 미국 정책 방향 | 무료 |
| Phase 4 | 키움 ka10017 | 업종별 시가총액 | 섹터별 자금 흐름 | 무료 |
| Phase 5 | 크롤링 | 국회 입법예고, 행정예고 | 선행 정책 파악 | 무료 |

---

## Phase 1: 기초 분석 엔진 (현재 진행 중)

### 구현 완료 항목
- [x] 급등주 상위 25개 자동 포착 (키움 ka10027)
- [x] 뉴스 + 공시 + 차트 80봉 수집
- [x] Gemini AI 분석 → JSON 저장 (ai_score, theme_sector, reason, chart_insight)
- [x] DB 축적 (daily_rising_stocks, market_daily_reports, stock_raw_data)
- [x] UI: 날짜별 목록, AI 점수 배지, 뉴스/DART 탭

### Phase 1 잔존 작업 (미완료)
- [ ] **`rising_stock_skill.md` 내용을 AI systemInstruction에 주입** → 즉시 가능, 분석 품질 즉각 향상
- [ ] **거래대금 상위 (ka10030) 수집 추가** → 수급 주도주 파악 (상승률 낮아도 돈 몰린 종목)
- [ ] **오전 10:00 / 오후 15:40 자동 실행 스케줄러** → 매일 자동으로 급등주 분석 실행

### 현재 DB 스키마

```sql
daily_rising_stocks     -- 종목별 AI 분석 결과
market_daily_reports    -- 당일 시장 총평
stock_raw_data          -- 수집 원본 데이터 (뉴스/공시 배열)
ai_learning_log         -- 학습 로그 (기초)
dart_corp_code          -- DART 법인코드
financial_data          -- 기업 재무 데이터
```

---

## Phase 2: 거시 컨텍스트 수집 (Phase 1 완료 후 1~2주)

### 목표
종목 개별 분석에 "시장 배경"을 추가하여 상승 이유의 맥락을 이해한다.

오늘 반도체 주가 올랐다 → **왜?** → 어제 밤 엔비디아 +8% → 미국 AI 투자 확대 기조 지속
이런 연결 고리를 자동으로 수집하고 분석에 주입한다.

### 구현 항목
- [ ] 키움 ka10040 업종별 등락률 수집 → `sector_daily_performance` 테이블
- [ ] Yahoo Finance 확장: 원달러 환율, WTI 유가, 나스닥, 미국 10년 국채금리 → `macro_indicators` 테이블
- [ ] 네이버 뉴스 거시 키워드 자동 수집 → `macro_events` 테이블
- [ ] 브리핑에 "오늘의 거시 배경" 섹션 추가

### 거시 뉴스 수집 키워드

```typescript
const MACRO_KEYWORDS = [
    '기준금리', '한국은행', '연준', 'FOMC',
    '정부정책', '반도체지원', '바이오규제',
    '원달러환율', '국제유가', '중동분쟁',
    '수출규제', '무역분쟁', '긴축완화'
]
// 매일 09:00 자동 수집 → macro_events 테이블 저장
```

### 신규 DB 테이블

```sql
-- 거시 이벤트 기록
CREATE TABLE macro_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_date TEXT NOT NULL,
    event_type TEXT NOT NULL,
    -- POLICY | RATE | GEOPOLITICAL | GLOBAL_MARKET | REGULATION | MACRO_INDICATOR
    title TEXT NOT NULL,
    description TEXT,
    impact_summary TEXT,      -- AI가 요약한 이 뉴스의 시장 영향
    source_url TEXT,
    source_type TEXT,         -- NAVER_NEWS | YAHOO | ECOS | RSS | MANUAL
    raw_json TEXT,
    collected_at TEXT
);

-- 섹터 일일 퍼포먼스 (어느 섹터에 돈이 몰렸나)
CREATE TABLE sector_daily_performance (
    date TEXT NOT NULL,
    sector_name TEXT NOT NULL,
    change_rate REAL,
    trading_value REAL,
    top_stocks TEXT,          -- JSON: 섹터 대표 상위 종목
    PRIMARY KEY (date, sector_name)
);

-- 거시 지표 일일 스냅샷
CREATE TABLE macro_indicators (
    date TEXT PRIMARY KEY,
    usd_krw REAL,             -- 원달러 환율
    wti_oil REAL,             -- WTI 유가
    nasdaq REAL,              -- 나스닥 지수
    sp500 REAL,               -- S&P 500
    us_10y_yield REAL,        -- 미국 10년 국채금리
    base_rate REAL,           -- 한국 기준금리
    raw_json TEXT
);
```

### Phase 2 완료 시 브리핑 예시

```
[오늘의 거시 배경] 전일 나스닥 +2.1%, 원달러 1,420원(약세)
[수혜 추정] IT 수출주, 반도체 장비에 유리한 환경
[주도 섹터] 전기전자 +3.2%, 화학 +1.8%, 항공 -2.1%
[오늘 급등주] 한미반도체 +18% — 거시 환경과 일치하는 상승
```

---

## Phase 3: 인과 관계 지식 DB 구축 (Phase 2 완료 후 2~4주)

### 목표
"어떤 이벤트가 발생하면 어떤 섹터가 움직인다"는 인과 지식을 구조화하여
AI가 활용할 수 있는 DB로 만든다.

전문 투자자의 머릿속에 있는 지식:
```
이벤트 유형 → 영향받는 섹터 → 방향 / 강도 / 지속시간
```

### 구현 항목
- [ ] `sector_event_map` 테이블 생성
- [ ] `sector_representative_stocks` 테이블 생성
- [ ] 초기 50개 인과 규칙 수동 입력 UI (설정 메뉴)
- [ ] `market_knowledge.md` 초안 작성 (스킬스 파일)
- [ ] AI 분석 시 거시 컨텍스트 + 인과규칙 systemInstruction 주입 시작

### 신규 DB 테이블

```sql
-- 이벤트-섹터 인과관계 맵 (핵심 지식 베이스)
CREATE TABLE sector_event_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_category TEXT NOT NULL,  -- RATE/POLICY/GEOPOLITICAL/SUPPLY_CHAIN/REGULATION
    event_keyword TEXT NOT NULL,   -- "기준금리 인상", "중동 분쟁", "반도체 수출 규제"
    event_condition TEXT,          -- 조건 (예: "인상폭 0.5% 이상")
    sector TEXT NOT NULL,          -- "방산", "은행", "반도체 소재", "항공"
    impact_direction TEXT,         -- UP / DOWN / NEUTRAL
    impact_strength TEXT,          -- STRONG / MEDIUM / WEAK
    typical_duration TEXT,         -- "1-3일", "1-2주", "1-3개월"
    lag_days INTEGER DEFAULT 0,    -- 이벤트 후 몇 일 뒤에 반응?
    rationale TEXT,                -- 왜 이런 관계인지
    confidence REAL DEFAULT 0.5,   -- 0.0~1.0 (누적 학습으로 업데이트)
    sample_count INTEGER DEFAULT 0,
    hit_count INTEGER DEFAULT 0,
    source_type TEXT DEFAULT 'MANUAL',  -- MANUAL / AI_LEARNED
    created_at TEXT,
    updated_at TEXT
);

-- 섹터별 대표 종목
CREATE TABLE sector_representative_stocks (
    sector TEXT NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    relevance_rank INTEGER,        -- 1=대장주, 2=2등...
    added_at TEXT,
    PRIMARY KEY (sector, stock_code)
);
```

### 초기 입력 핵심 규칙 50개 (예시)

| 이벤트 | 섹터 | 방향 | 강도 | 기간 |
|--------|------|------|------|------|
| 기준금리 인상 | 은행주 | UP | STRONG | 1-2주 |
| 기준금리 인상 | 성장주/기술주 | DOWN | MEDIUM | 1-4주 |
| 기준금리 인상 | 리츠/부동산 | DOWN | STRONG | 장기 |
| 기준금리 인하 | 성장주/바이오 | UP | MEDIUM | 1-2주 |
| 원달러 환율 상승 | 자동차 수출주 | UP | MEDIUM | 당일-1주 |
| 원달러 환율 상승 | 항공주 | DOWN | MEDIUM | 단기 |
| 원달러 환율 상승 | 반도체 수출주 | UP | WEAK | 당일 |
| 유가 상승 | 정유화학주 | UP | STRONG | 1-2주 |
| 유가 상승 | 항공주 | DOWN | STRONG | 단기 |
| 유가 상승 | 해운주 | UP | MEDIUM | 단기 |
| 중동 분쟁 | 방산주 | UP | STRONG | 1-2주 |
| 중동 분쟁 | 유가 → 정유 | UP | STRONG | 당일 |
| 중동 분쟁 | 항공주 | DOWN | MEDIUM | 단기 |
| 미국 나스닥 급등 +3% | 국내 IT/반도체 | UP | MEDIUM | 다음날 |
| 미국 반도체 호실적 | 국내 소재/장비 | UP | MEDIUM | 당일-3일 |
| 정부 반도체 지원 정책 | 반도체 설계/소재/장비 | UP | MEDIUM | 1-3주 |
| 정부 바이오 규제 완화 | 제약/바이오 | UP | MEDIUM | 1-2주 |
| 정부 건설 경기 부양 | 건설/시멘트/철강 | UP | MEDIUM | 1-4주 |
| 금리 동결 (예상보다 비둘기) | 코스닥 성장주 | UP | MEDIUM | 단기 |
| 무역수지 적자 심화 | 시장 전반 | DOWN | WEAK | 단기 |
| ... (30개 추가) | | | | |

### Phase 3 완료 시 가능한 것

```
[입력] "한미 반도체 수출 통제 강화" 뉴스 감지
    ↓
[sector_event_map 조회]
   "수출 규제" → 반도체 설계주:    UNCERTAIN
   "수출 규제" → 반도체 소재/장비: UP STRONG (국산화 기대)
    ↓
[출력]
"국산 반도체 소재/장비주 수혜 가능성 높음 (신뢰도 72%)
 주목 종목: 원익IPS, 피에스케이, 솔브레인
 근거: 과거 수출규제 시 평균 +15% / 지속 3주"
```

---

## Phase 4: 선행 예측 엔진 (Phase 3 완료 후 1~2개월)

### 목표
이벤트 → 섹터/종목 예측 → 결과 검증 → 적중률 관리의 완전한 루프 구현

### 구현 항목
- [ ] `market_predictions` 테이블 생성
- [ ] 매일 09:00 예측 생성 배치 (`MacroBriefingService`)
- [ ] 3거래일 후 자동 복기 배치 (`RetrospectiveService`)
- [ ] 예측 브리핑 UI 패널 추가
- [ ] 텔레그램 예측 브리핑 전송
- [ ] 적중률 대시보드

### 신규 DB 테이블

```sql
CREATE TABLE market_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_date TEXT NOT NULL,
    target_period TEXT NOT NULL,        -- "내일", "이번주", "다음주"
    target_date_from TEXT,
    target_date_to TEXT,
    sector TEXT NOT NULL,
    representative_stocks TEXT,          -- JSON 배열
    direction TEXT NOT NULL,             -- UP / DOWN
    magnitude TEXT,                      -- STRONG / MEDIUM / WEAK
    confidence REAL,
    trigger_event_ids TEXT,              -- JSON: macro_events.id 배열
    applied_rules TEXT,                  -- JSON: sector_event_map.id 배열
    ai_reasoning TEXT,                   -- AI의 예측 근거 서술
    -- 검증 (나중에 채워짐)
    actual_direction TEXT,
    actual_return REAL,
    verified_at TEXT,
    accuracy TEXT,                       -- HIT / MISS / PARTIAL
    review_notes TEXT
);
```

### 예측 생성 파이프라인

```
매일 09:00 배치:
1. 전날 macro_events 조회
2. sector_event_map에서 관련 규칙 매칭
3. Gemini에게 예측 요청 (규칙 + 거시 환경 + 과거 적중률 주입)
4. market_predictions 저장
5. UI 브리핑 + 텔레그램 전송

매일 16:30 복기 배치:
1. 3거래일 전 예측 조회
2. 실제 섹터 등락률 조회
3. HIT / MISS / PARTIAL 판정
4. ai_learning_log 업데이트
5. sector_event_map confidence 자동 조정 (+0.05 or -0.05)
```

### 예측 브리핑 UI

```
┌──────────────────────────────────────┐
│  오늘의 시장 예측  2026-03-10        │
│ ───────────────────────────────────  │
│  ▲ 방산주   신뢰도 82%               │
│    근거: 중동 긴장 + 국방예산 증가   │
│    주목: 한화에어로스페이스, LIG넥스원│
│                                      │
│  ▲ 반도체 소재  신뢰도 71%          │
│    근거: 나스닥 +2.3%, 엔비디아 호실적│
│                                      │
│  ▼ 항공주   신뢰도 68%              │
│    근거: 유가 급등 + 환율 부담      │
│ ───────────────────────────────────  │
│  최근 30일 예측 적중률: 73.4%       │
└──────────────────────────────────────┘
```

---

## Phase 5: 자기 성장 루프 (Phase 4 완료 후 3~6개월)

### 목표
시스템이 스스로 지식을 성장시키는 완전한 순환 구조 완성

### 구현 항목
- [ ] 월 1회 패턴 분석 배치 (100건 이상의 예측+결과 분석)
- [ ] sector_event_map confidence 자동 갱신
- [ ] 신규 패턴 자동 발견 및 추가
- [ ] `rising_stock_skill.md` 자동 교훈 추가
- [ ] `market_knowledge.md` 자동 갱신
- [ ] `prediction_track_record.md` 자동 갱신
- [ ] 섹터별 신뢰도 메타 정보 리포트 표시

### 자기 학습 메커니즘

```
[데이터 100건 이상 축적]
    ↓
[월 1회 패턴 분석 배치]
    Gemini에게:
    "지난 100건의 예측과 결과를 분석하여
     어떤 패턴이 적중률이 높고 낮은지 분류하라.
     새로 발견된 패턴이 있으면 추가하라."
    ↓
[학습 결과 반영]
    1. sector_event_map confidence 조정
    2. 신규 패턴 → sector_event_map 추가
    3. rising_stock_skill.md 교훈 섹션 추가
    4. market_knowledge.md 업데이트
    ↓
[다음 분석부터 개선된 지식 활용]
```

### Skills 파일 생태계 설계

```
.agents/skills/kiwoom_app_development/
├── rising_stock_skill.md
│   용도: 종목 분석 원칙 (재료 강도, 차트 패턴, 금기 사항)
│   갱신: AI가 학습 후 교훈 섹션 자동 추가
│
├── market_knowledge.md  ← Phase 3에서 신규 생성
│   용도: 이벤트-섹터 인과 관계 지식
│   갱신: AI가 월 1회 sector_event_map 기반으로 업데이트
│
└── prediction_track_record.md  ← Phase 5에서 신규 생성
    용도: 예측 적중률 기록 ("반도체 섹터: 78%", "바이오: 41%")
    갱신: 복기 배치 후 자동 갱신
```

### Skills → AI 프롬프트 주입 (핵심 연결 고리)

```typescript
// RisingStockAnalysisService.ts
private buildSystemInstruction(): string {
    const skillsDir = path.join(__dirname, '../../.agents/skills/kiwoom_app_development')
    const stockSkill = fs.readFileSync(path.join(skillsDir, 'rising_stock_skill.md'), 'utf-8')
    const marketKnowledge = fs.existsSync(path.join(skillsDir, 'market_knowledge.md'))
        ? fs.readFileSync(path.join(skillsDir, 'market_knowledge.md'), 'utf-8') : ''
    const trackRecord = fs.existsSync(path.join(skillsDir, 'prediction_track_record.md'))
        ? fs.readFileSync(path.join(skillsDir, 'prediction_track_record.md'), 'utf-8') : ''
    
    return `
당신은 15년 경력 한국 주식 전문 애널리스트입니다.

[핵심 분석 원칙]
${stockSkill}

[시장 인과관계 지식]
${marketKnowledge || '(아직 구축 중)'}

[과거 예측 적중률 참고]
${trackRecord || '(아직 구축 중)'}

위 지식을 기반으로 분석하되, 항상 데이터로 근거를 뒷받침하세요.
    `
}
```

---

## 구현 일정 요약

| 단계 | 기간 | 핵심 결과물 | 상태 |
|------|------|-------------|------|
| **Phase 1 마무리** | 이번 주 | 스킬스 주입, 스케줄러, ka10030 수집 | 진행 중 |
| **Phase 2** | 2주 이내 | 거시 이벤트 자동 수집, 섹터 퍼포먼스 | 예정 |
| **Phase 3** | 2~4주 | sector_event_map + 초기 50개 규칙 | 예정 |
| **Phase 4** | 1~2개월 | 선행 예측 생성 + 복기 배치 | 예정 |
| **Phase 5** | 3~6개월 | 완전한 자기 학습 루프 | 예정 |

---

## 외부 API 확장 계획

| API | 추가 시기 | 데이터 | 비용 |
|-----|-----------|--------|------|
| 한국은행 ECOS | Phase 3 | 기준금리, CPI, GDP | 무료 (키 발급 필요) |
| 경제 뉴스 RSS | Phase 2 | 이데일리, 한경, 매경 헤드라인 | 무료 (키 불필요) |
| FRED API (미 연준) | Phase 4 | 미국 금리, 고용 지표 | 무료 (키 발급 필요) |
| 키움 ka10017 | Phase 4 | 업종별 시가총액 추이 | 무료 |
| 증권사 리서치 RSS | Phase 4 | NH, KB, LS 리서치 요약 | 무료 |

---

## 설계 핵심 원칙

1. **점진적 확장**: 각 Phase는 이전 Phase 위에 쌓임. 순서를 건너뛰지 않는다
2. **데이터 우선**: 예측 기능 전에 최소 1개월 데이터 축적이 필요
3. **인간 감수**: Phase 3의 초기 50개 규칙은 사람이 직접 검토·입력 (기초 품질이 이후 모든 학습의 품질을 결정)
4. **실패에서 배우기**: 예측 실패가 가장 값진 학습 데이터. 실패 원인 AI 분석이 핵심
5. **투명성**: AI가 왜 이런 예측을 했는지 항상 근거를 함께 표시

---

> **핵심 메시지**: 이 시스템의 가치는 6개월 후에 드러납니다.
> 매일 쌓이는 예측-결과 데이터와 스스로 성장하는 Skills 파일이
> 시간이 갈수록 다른 어떤 서비스도 갖지 못한 고유한 투자 지식 자산이 됩니다.
