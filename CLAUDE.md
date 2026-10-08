# Kiwoom Trader

키움증권 OpenAPI 기반 에이전틱 트레이딩 시스템.

## 🔗 Knowledge Links
- **Project Folder**: [[C:\Users\legna\OneDrive\문서\Obsidian Vault\AI tool research\20_Projects\Kiwoom-Trader]]
- **Plan**: [[C:\Users\legna\OneDrive\문서\Obsidian Vault\AI tool research\20_Projects\Kiwoom-Trader\plan.md]]
- **Architecture**: [[C:\Users\legna\OneDrive\문서\Obsidian Vault\AI tool research\20_Projects\Kiwoom-Trader\architecture.md]]

## 🛠 Tech Stack
- **Backend**: Electron (Node.js)
- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Database**: SQLite (better-sqlite3)
- **State Management**: Zustand
- **AI**: Google Gemini (via AiService)
- **External APIs**: Kiwoom REST API, Naver News, DART API, Yahoo Finance

## 📜 Project Principles (Core Rules)
1. **Obsidian as Single Source of Truth**: 모든 기획, 로드맵, 이슈 트래킹 및 진행 상황 기록은 **Obsidian의 `plan.md`**를 최우선으로 참조하고 업데이트합니다. 로컬의 `PLAN.md`는 더 이상 사용하지 않습니다.
2. **Service & Event-Driven**: `electron/services/` 모듈화를 준수하고, `EventBus`를 통해 통신합니다. 직접 참조를 지양합니다.
3. **Single Gateway (Kiwoom API)**: 모든 REST API/WebSocket 통신은 `KiwoomService`를 통해서만 이루어집니다.
4. **Knowledge-Driven Coding**: 작업 전 반드시 Obsidian의 관련 문서([[architecture]], [[plan]])를 읽고 현재 맥락을 파약합니다.

## 📜 Key Commands
- `npm run dev`: Start development environment (Vite + Electron)
- `npm run build`: Build for production
- `npm run check-db`: Run `check_db_status.js` to verify DB state

## 🚦 Essential Files
- `electron/main.ts`: Main entry point, service initialization.
- `electron/services/`: Core business logic (Trading, AI, Data).
- `src/components/`: Reusable React components.
- `docs/`: Technical manuals and API specifications (Local).

## 🛡️ 실행 프로필 (운영 데이터 보호)
- `npm run dev`(개발 실행)는 `%APPDATA%\kiwoom-trader-dev`를 사용한다. 운영 앱(`%APPDATA%\kiwoom-trader`)의 DB·API 키·실거래 설정과 분리되며, dev에는 키가 없어 주문이 나가지 않는다. 개발 중 키움 연동 시험이 필요하면 dev 설정 화면에 키를 직접 입력한다.
- 운영 데이터로 개발 실행이 꼭 필요할 때만 `KIWOOM_PROFILE=prod`, 경로 지정은 `KIWOOM_USER_DATA=<경로>`.
- 운영/custom 프로필은 단일 인스턴스 잠금(두 번째 실행은 즉시 종료 → 크론·주문 이중 실행 방지). 구현: `electron/profileGuard.ts` (main.ts 첫 import 유지 필수).
