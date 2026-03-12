import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { DatabaseService } from './DatabaseService'

const SKILLS_DIR = path.join(__dirname, '../../.agents/skills/kiwoom_app_development')

export interface SkillsFileInfo {
    fileName: string
    displayName: string
    description: string
    filePath: string
    exists: boolean
    content: string
    lastModified: string | null
    dbVersion: number
    dbLastUpdated: string | null
}

/** 스킬스 파일 메타데이터 정의 */
const SKILLS_FILES = [
    {
        fileName: 'rising_stock_skill.md',
        displayName: '종목 분석 원칙',
        description: '재료 등급 평가, 차트 패턴, AI 사고 순서, 금기 사항 등 종목 분석의 핵심 원칙을 정의합니다.'
    },
    {
        fileName: 'market_knowledge.md',
        displayName: '거시 인과관계 지식',
        description: '이벤트-섹터 인과 관계 지식 (금리/환율/지정학 → 섹터 영향)을 정리합니다. Phase 3에서 생성됩니다.'
    },
    {
        fileName: 'prediction_track_record.md',
        displayName: '예측 적중률 기록',
        description: '섹터별 예측 적중률, 성공/실패 패턴을 기록합니다. Phase 5에서 생성됩니다.'
    }
]

export class SkillsService {
    private static instance: SkillsService
    private db = DatabaseService.getInstance()

    private constructor() {}

    public static getInstance(): SkillsService {
        if (!SkillsService.instance) {
            SkillsService.instance = new SkillsService()
        }
        return SkillsService.instance
    }

    /** 스킬스 파일 목록 + 현재 내용 반환 */
    public getAllSkillsInfo(): SkillsFileInfo[] {
        const dbList = this.db.getSkillsFileList()
        const dbMap = new Map(dbList.map((r: any) => [r.file_name, r]))

        return SKILLS_FILES.map(meta => {
            const filePath = path.join(SKILLS_DIR, meta.fileName)
            const exists = fs.existsSync(filePath)
            const content = exists ? fs.readFileSync(filePath, 'utf-8') : ''
            const stat = exists ? fs.statSync(filePath) : null
            const dbRow = dbMap.get(meta.fileName)

            return {
                ...meta,
                filePath,
                exists,
                content,
                lastModified: stat ? stat.mtime.toISOString() : null,
                dbVersion: dbRow?.version ?? 0,
                dbLastUpdated: dbRow?.last_updated ?? null
            }
        })
    }

    /** 특정 스킬스 파일 읽기 (AI 프롬프트 주입용) */
    public readSkillsFile(fileName: string): string {
        const filePath = path.join(SKILLS_DIR, fileName)
        if (!fs.existsSync(filePath)) return ''
        return fs.readFileSync(filePath, 'utf-8')
    }

    /** AI 분석용 systemInstruction 빌드 (모든 스킬스 파일 통합) */
    public buildSystemInstruction(): string {
        const stockSkill = this.readSkillsFile('rising_stock_skill.md')
        const marketKnowledge = this.readSkillsFile('market_knowledge.md')
        const trackRecord = this.readSkillsFile('prediction_track_record.md')

        return `당신은 대한민국 주식 시장에서 15년 경력을 가진 전문 애널리스트입니다.
다음의 핵심 원칙과 지식을 바탕으로 분석을 수행하세요.

${stockSkill ? `## 핵심 종목 분석 원칙\n${stockSkill}` : ''}

${marketKnowledge ? `## 거시 이벤트-섹터 인과 관계 지식\n${marketKnowledge}` : ''}

${trackRecord ? `## 과거 예측 적중률 참고\n${trackRecord}` : ''}

분석 시 반드시 데이터로 근거를 뒷받침하고, 불확실한 사항은 명확히 표시하세요.`
    }

    /** 파일 내용 저장 + DB 스냅샷 (수동 편집) */
    public saveAndSnapshot(
        fileName: string,
        content: string,
        diffSummary: string,
        changeType: 'MANUAL' | 'AI_LESSON' | 'AI_BATCH' | 'SYSTEM' = 'MANUAL',
        triggerContext?: string
    ) {
        const filePath = path.join(SKILLS_DIR, fileName)

        // 디렉토리 없으면 생성
        if (!fs.existsSync(SKILLS_DIR)) {
            fs.mkdirSync(SKILLS_DIR, { recursive: true })
        }

        // 파일 저장
        fs.writeFileSync(filePath, content, 'utf-8')

        // DB 스냅샷
        this.db.saveSkillsSnapshot({
            file_name: fileName,
            content,
            diff_summary: diffSummary,
            change_type: changeType,
            trigger_context: triggerContext
        })

        console.log(`[SkillsService] ${fileName} saved (${changeType})`)
    }

    /** AI가 학습 교훈을 파일에 추가 */
    public async appendLesson(
        fileName: string,
        lessonContent: string,
        triggerContext?: string
    ) {
        const filePath = path.join(SKILLS_DIR, fileName)
        const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
        
        const today = new Date().toISOString().slice(0, 10)
        const newSection = `\n\n---\n## AI 학습 교훈 (${today})\n\n${lessonContent}`
        const updated = current + newSection

        this.saveAndSnapshot(
            fileName,
            updated,
            `AI 학습 교훈 추가: ${lessonContent.slice(0, 80)}...`,
            'AI_LESSON',
            triggerContext
        )
    }

    /** 변경 이력 조회 */
    public getHistory(fileName: string, limit = 30) {
        return this.db.getSkillsHistory(fileName, limit)
    }

    /** 특정 버전 내용 조회 */
    public getVersionContent(fileName: string, version: number): string | null {
        return this.db.getSkillsVersionContent(fileName, version)
    }

    /** 앱 시작 시 현재 파일 내용을 DB에 SYSTEM 스냅샷으로 기록 (최초 1회) 및 누락된 파일 생성 */
    public initSnapshots() {
        for (const meta of SKILLS_FILES) {
            const filePath = path.join(SKILLS_DIR, meta.fileName)
            
            // 파일이 없으면 기본 템플릿 생성
            if (!fs.existsSync(filePath)) {
                let defaultContent = `# ${meta.displayName}\n\n${meta.description}\n\n## 시작하기\n이 파일에 AI가 주식 시장의 인과관계를 학습하게 될 핵심 지식들을 정리하여 기록할 예정입니다.\n`
                
                if (meta.fileName === 'market_knowledge.md') {
                    defaultContent += `\n### 1. 거시 지표 인과관계\n- 고금리 -> 기술주 하락 / 금융주 상승\n- 고환율 -> 수출주 이익 증가 / 에너지 수입 단가 상승\n`
                } else if (meta.fileName === 'prediction_track_record.md') {
                    defaultContent += `\n### 1. 섹터별 적중 통계\n- 반도체: 0/0\n- 2차전지: 0/0\n`
                }

                // 디렉토리 생성 확인
                if (!fs.existsSync(SKILLS_DIR)) {
                    fs.mkdirSync(SKILLS_DIR, { recursive: true })
                }
                
                fs.writeFileSync(filePath, defaultContent, 'utf-8')
                console.log(`[SkillsService] Created default file: ${meta.fileName}`)
            }

            const content = fs.readFileSync(filePath, 'utf-8')
            const existing = this.db.getSkillsHistory(meta.fileName, 1)

            // DB에 아무 기록도 없을 때만 초기 스냅샷 저장
            if (existing.length === 0) {
                this.db.saveSkillsSnapshot({
                    file_name: meta.fileName,
                    content,
                    diff_summary: '초기 스냅샷 (앱 시작)',
                    change_type: 'SYSTEM'
                })
                console.log(`[SkillsService] Initial snapshot saved for ${meta.fileName}`)
            }
        }
    }
}
