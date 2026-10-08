/**
 * 실행 프로필 가드 — main.ts의 **첫 번째 import**여야 한다.
 *
 * 이유: electron-store(`new Store()`)와 DatabaseService 등은 모듈 로드 시점에
 * app.getPath('userData')를 읽는다. 그 전에 경로를 바꾸지 않으면 개발 실행이
 * 운영 앱의 DB·API 키·설정·실거래 상태를 그대로 공유한다.
 *
 * 규칙
 *  - 패키징된 운영 앱:            기본 userData (%APPDATA%\kiwoom-trader) + 단일 인스턴스 잠금
 *  - 개발 실행(!app.isPackaged):  %APPDATA%\kiwoom-trader-dev (운영 데이터·키와 완전 분리)
 *  - KIWOOM_PROFILE=prod:         개발 실행이라도 운영 데이터를 쓴다 (의도적일 때만)
 *  - KIWOOM_PROFILE=dev:          패키징 빌드라도 dev 데이터를 쓴다 (빌드 시험용)
 *  - KIWOOM_USER_DATA=<경로>:     임의 경로 지정
 */
import { app, BrowserWindow } from 'electron'
import path from 'node:path'

export type ProfileMode = 'prod' | 'dev' | 'custom'

function resolveProfile(): { mode: ProfileMode; dir?: string } {
    const custom = process.env.KIWOOM_USER_DATA
    if (custom) return { mode: 'custom', dir: path.resolve(custom) }

    const profile = (process.env.KIWOOM_PROFILE || '').toLowerCase()
    if (profile === 'prod') return { mode: 'prod' }
    if (profile === 'dev' || !app.isPackaged) {
        return { mode: 'dev', dir: path.join(app.getPath('appData'), 'kiwoom-trader-dev') }
    }
    return { mode: 'prod' }
}

const { mode, dir } = resolveProfile()
if (dir) app.setPath('userData', dir)

process.env.KIWOOM_PROFILE_MODE = mode
console.log(`[Profile] mode=${mode} userData=${app.getPath('userData')}`)
if (mode === 'prod' && !app.isPackaged) {
    console.warn('[Profile] ⚠️ 개발 실행이 운영 데이터(DB·API 키·실거래 설정)를 사용합니다. KIWOOM_PROFILE=prod 로 의도적으로 지정된 상태입니다.')
}

// 같은 userData를 쓰는 인스턴스가 둘이면 크론·주문이 이중 실행되므로 두 번째 인스턴스는 즉시 종료한다.
// (dev 모드는 vite-plugin-electron 핫리로드 시 재시작 경쟁이 있어 잠금을 걸지 않는다 — dev 데이터에는 키가 없다)
if (mode !== 'dev') {
    if (!app.requestSingleInstanceLock()) {
        console.error('[Profile] 이미 실행 중인 인스턴스가 있어 종료합니다 (이중 크론/주문 방지).')
        app.exit(0)
        process.exit(0) // 이후 모듈(서비스 싱글톤·크론)이 평가되지 않도록 즉시 종료
    }
    app.on('second-instance', () => {
        const w = BrowserWindow.getAllWindows()[0]
        if (w) {
            if (w.isMinimized()) w.restore()
            w.focus()
        }
    })
}
