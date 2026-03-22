# 🗂 Legacy: 지식 베이스 (Knowledge Base) 메뉴

> **삭제일**: 2026-03-20  
> **삭제 사유**: 사용 빈도 낮음, 기능 역할이 MAIIS/Skills 아키텍처로 흡수됨  
> **복원 난이도**: ⭐ (낮음) — 아래 코드를 다시 연결하면 즉시 복원 가능

---

## 1. 기능 개요

**지식 베이스**는 AI 분석에 활용되는 투자 원칙 및 지식 파일을 UI에서 직접 편집/관리하는 메뉴였습니다.

### 주요 기능
- 스킬스 파일 목록 (좌측 패널) + 내용 뷰어/편집기 (우측 패널)
- 버전 관리: 변경 이력 (DB 스냅샷) + 특정 버전 복원
- 변경 유형 태그: `MANUAL`, `AI_LESSON`, `AI_BATCH`, `SYSTEM`
- 저장 시 diff 요약 필수 입력

### 관리 대상 파일
| 파일명 | 용도 |
|--------|------|
| `rising_stock_skill.md` | 종목 분석 원칙 (재료 등급, 차트 패턴, AI 사고 순서) |
| `market_knowledge.md` | 거시 인과관계 지식 (금리/환율/지정학 → 섹터 영향) |
| `prediction_track_record.md` | 예측 적중률 기록 (섹터별 성공/실패) |

---

## 2. 관련 파일 목록

### Frontend (삭제됨)
```
src/components/KnowledgeBase.tsx  ← 메인 UI 컴포넌트 (319줄)
```

### Backend (유지 중, 죽은 코드로 잔존)
```
electron/services/SkillsService.ts         ← 서비스 (파일 읽기/쓰기/스냅샷)
electron/main.ts                            ← IPC 핸들러 3개 (skills:get-all/get-history/get-version)
electron/preload.ts                         ← API 3개 (skillsGetAll/skillsGetHistory/skillsGetVersion)
src/types/electron.d.ts                     ← 타입 정의 (line 127)
```

### DB 테이블
- `skills_snapshots` — 버전별 파일 내용 스냅샷 (DatabaseService.ts에 정의)

---

## 3. 복원 방법

### Step 1: KnowledgeBase.tsx 복원
아래 코드를 `src/components/KnowledgeBase.tsx`로 저장:

<details>
<summary>KnowledgeBase.tsx 전체 코드 (접기/펼치기)</summary>

```tsx
import React, { useState, useEffect } from 'react'
import { BookOpen, Clock, ChevronDown, ChevronRight, Edit3, Save, X, RotateCcw, Sparkles, FileText, AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '../utils'

interface SkillsFile {
    fileName: string
    displayName: string
    description: string
    exists: boolean
    content: string
    lastModified: string | null
    dbVersion: number
    dbLastUpdated: string | null
}

interface HistoryEntry {
    id: number
    version: number
    diff_summary: string
    change_type: string
    trigger_context: string | null
    changed_at: string
}

const CHANGE_TYPE_BADGE: Record<string, { label: string; color: string }> = {
    MANUAL:    { label: '수동 편집', color: 'bg-blue-500/15 text-blue-400' },
    AI_LESSON: { label: 'AI 교훈', color: 'bg-emerald-500/15 text-emerald-400' },
    AI_BATCH:  { label: 'AI 배치', color: 'bg-violet-500/15 text-violet-400' },
    SYSTEM:    { label: '시스템', color: 'bg-muted text-muted-foreground' }
}

export default function KnowledgeBase() {
    // ... (원본 코드 참조)
}
```

</details>

### Step 2: Sidebar 메뉴 재추가
`src/components/Sidebar.tsx`의 `menuItems` 배열에 추가:
```tsx
{ id: 'knowledge-base', name: '지식 베이스', icon: BookOpen },
```

### Step 3: App.tsx 연결
```tsx
// import 추가
import KnowledgeBase from './components/KnowledgeBase'

// 렌더링 추가
{activeTab === 'knowledge-base' && <KnowledgeBase />}

// fallback 조건에 추가
activeTab !== 'knowledge-base' &&
```

---

## 4. 연관 서비스: SkillsService.ts

`SkillsService`는 2가지 역할을 겸합니다:
1. **UI용**: `getAllSkillsInfo()`, `getHistory()`, `getVersionContent()`, `saveAndSnapshot()` — KnowledgeBase UI에서 호출
2. **AI용**: `buildSystemInstruction()`, `readSkillsFile()` — AI 분석 프롬프트에 스킬 지식 주입

KnowledgeBase 삭제 후에도 **AI용 메서드는 계속 사용 가능**합니다.  
단, 현재 `RisingStockAnalysisService`와 `PortfolioManagerService`에서 import만 하고 실제 호출은 없는 상태입니다.

---

## 5. 비고

- `SkillsService.initSnapshots()`는 앱 시작 시 `main.ts`에서 호출되어 스킬 파일의 초기 스냅샷을 DB에 기록합니다.
- 향후 AI가 학습한 교훈을 자동 기록하는 기능(`appendLesson`)이 설계되어 있으나, 아직 실제로 호출되는 곳은 없습니다.
