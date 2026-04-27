/**
 * AiExecutionQueue — 하이브리드 AI 듀얼 큐 호출 중계인 (Broker)
 * 
 * 모든 AI 에이전트의 API 호출을 직렬화(Serialize)하여 에러 및 충돌을 원천 차단합니다.
 * - Gemini 전용(Cloud) 큐와 Local(LM Studio) 전용 큐를 듀얼 레인(Two-Track)으로 분리.
 * - 로컬 모델이 장시간 점유하더라도 Gemini 요청은 즉각 병렬 실행 가능.
 * 
 * ═══ 설계 원칙 ═══
 * - 모든 새로운 AI 기능은 AiService.askGemini()를 직접 호출하지 않고,
 *   반드시 AiExecutionQueue.enqueue()를 통해서만 호출해야 합니다.
 * - 대상별 독립 FIFO 큐 기반, 한 번에 하나의 요청만 허용 (경로별 1채널)
 * - 크론잡(CRON) > 수동(MANUAL) > 채팅(CHAT) 우선순위
 * - 실행 이력을 메모리에 보관하여 UI에서 조회 가능
 */

import { AiService } from './AiService'
import { LocalAiService } from './LocalAiService'
import { eventBus } from '../utils/EventBus'
import { DatabaseService } from './DatabaseService'

export interface AiQueueJob {
    id: string
    agentId: string           // 'MCA', 'IMA', 'COPILOT', 'MRA' 등
    agentName: string         // '시황 AI', '이슈 AI' 등
    triggerType: 'CRON' | 'MANUAL' | 'CHAT'
    targetType: 'gemini' | 'local'  // 듀얼 레인 라우팅 (Phase 7)
    priority: number          // 낮을수록 높은 우선순위 (CRON=1, MANUAL=2, CHAT=3)
    prompt: string
    systemInstruction?: string
    customMessages?: any[]    // 로컬 AI 전용 채팅 기록 배열 전달
    customModel?: string      // 기본 모델 대신 사용할 모델
    customKey?: string        // 기본 키 대신 사용할 API 키
    status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED'
    queuedAt: number
    startedAt?: number
    finishedAt?: number
    durationMs?: number
    result?: string
    error?: string
    isCloudBypass?: boolean
}

export interface AiExecutionLogEntry {
    id: string
    agentId: string
    agentName: string
    triggerType: string
    targetType: string
    status: string
    queuedAt: string
    startedAt?: string
    finishedAt?: string
    durationMs?: number
    error?: string
    prompt?: string
    systemInstruction?: string
    result?: string
    modelName?: string
}

export class AiExecutionQueue {
    private static instance: AiExecutionQueue
    private ai: AiService
    private localAi: LocalAiService
    
    // 듀얼 레인 큐 시스템 도입
    private geminiQueue: AiQueueJob[] = []
    private localQueue: AiQueueJob[] = []
    private activeGeminiWorkers = 0
    private readonly MAX_GEMINI_CONCURRENCY = 5
    private isProcessingLocal = false
    
    private executionLog: AiExecutionLogEntry[] = []  // 최근 100건 보관
    private jobCounter = 0

    private constructor() {
        this.ai = AiService.getInstance()
        this.localAi = LocalAiService.getInstance()
    }

    public static getInstance(): AiExecutionQueue {
        if (!AiExecutionQueue.instance) {
            AiExecutionQueue.instance = new AiExecutionQueue()
        }
        return AiExecutionQueue.instance
    }

    /**
     * AI 호출을 큐에 등록하고, 결과를 Promise로 반환합니다.
     */
    public enqueue(params: {
        agentId: string
        agentName: string
        triggerType: 'CRON' | 'MANUAL' | 'CHAT'
        targetType?: 'gemini' | 'local' // 생략 시 gemini(기본값)
        prompt: string
        systemInstruction?: string
        customMessages?: any[]
        customModel?: string
        customKey?: string
    }): Promise<string> {
        const priorityMap = { CRON: 1, MANUAL: 2, CHAT: 3 }
        let jobTarget = params.targetType || 'gemini'
        let isCloudBypass = false;

        // 중앙 라우팅: 설정값 기반의 동적 라우팅
        let finalCustomModel = params.customModel;
        try {
            const Store = require('electron-store');
            const store = new Store();
            const aiSettings = store.get('ai_settings') as any;
            
            if (aiSettings) {
                // 1. 로컬 크론 클라우드 우회 라우팅 처리
                if (jobTarget === 'local' && Array.isArray(aiSettings.lightweightCloudAgents)) {
                    const isBypass = aiSettings.lightweightCloudAgents.some((id: string) => params.agentId.includes(id) || params.agentId.startsWith(id));
                    if (isBypass) {
                        jobTarget = 'gemini'; // 로컬 타겟을 강제로 제미나이(클라우드)로 우회
                        finalCustomModel = aiSettings.lightweightCloudModel || 'gemini-1.5-flash';
                        isCloudBypass = true;
                        console.log(`[AiQueue] ☁️ 로컬 크론 클라우드 우회됨: ${params.agentName} -> ${finalCustomModel}`);
                    }
                }

                // 2. 심층 모델 적용 대상 확인 (우회 대상이더라도 심층 모델이 우선 체크되면 덮어씀)
                if (aiSettings.deepModelName && Array.isArray(aiSettings.deepModelAgents)) {
                    const isMatch = aiSettings.deepModelAgents.some((id: string) => params.agentId.includes(id) || params.agentId.startsWith(id));
                    if (isMatch) {
                        finalCustomModel = params.customModel || aiSettings.deepModelName;
                        console.log(`[AiQueue] 🧠 심층 모델 할당됨: ${params.agentName} -> ${finalCustomModel}`);
                    }
                }
            }
        } catch (e) {
            console.warn('[AiQueue] AI 설정 확인 실패, 기본 설정으로 진행', e);
        }

        const job: AiQueueJob = {
            id: `aiq_${++this.jobCounter}_${Date.now()}`,
            agentId: params.agentId,
            agentName: params.agentName,
            triggerType: params.triggerType,
            targetType: jobTarget,
            priority: priorityMap[params.triggerType],
            prompt: params.prompt,
            systemInstruction: params.systemInstruction,
            customMessages: params.customMessages,
            customModel: finalCustomModel,
            customKey: params.customKey,
            status: 'QUEUED',
            queuedAt: Date.now(),
            isCloudBypass: isCloudBypass,
        }

        // 라우팅 분기
        const targetQueue = jobTarget === 'local' ? this.localQueue : this.geminiQueue
        targetQueue.push(job)
        
        // 우선순위 정렬 (낮은 숫자 = 높은 우선순위, 같으면 먼저 들어온 것 우선)
        targetQueue.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt)

        console.log(`[AiQueue] 📥 등록: ${job.agentName} (${job.triggerType}/${job.targetType}) | 대기열 (Gemini:${this.geminiQueue.length}, Local:${this.localQueue.length})`)
        this.emitQueueUpdate()

        return new Promise<string>((resolve, reject) => {
            const checkResult = setInterval(() => {
                if (job.status === 'SUCCESS') {
                    clearInterval(checkResult)
                    resolve(job.result!)
                } else if (job.status === 'FAILED') {
                    clearInterval(checkResult)
                    reject(new Error(job.error || 'AI 호출 실패'))
                }
            }, 100)

            // 큐 처리 시작 (이미 처리 중이면 스킵됨)
            if (jobTarget === 'local') {
                this.processLocalQueue()
            } else {
                this.processGeminiQueue()
            }
        })
    }

    /**
     * Gemini 전용 큐 (클라우드망) - 5개 병렬 워커 지원
     */
    private processGeminiQueue() {
        while (this.activeGeminiWorkers < this.MAX_GEMINI_CONCURRENCY && this.geminiQueue.length > 0) {
            this.activeGeminiWorkers++;
            this.runGeminiWorker().finally(() => {
                this.activeGeminiWorkers--;
                this.processGeminiQueue();
            });
        }
    }

    private async runGeminiWorker() {
        const job = this.geminiQueue.shift()
        if (!job) return

        job.status = 'RUNNING'
        job.startedAt = Date.now()

        console.log(`[AiQueue][☁️Gemini] ▶️ 실행: ${job.agentName} | 남은 대기: ${this.geminiQueue.length}건 | 활성 워커: ${this.activeGeminiWorkers}/${this.MAX_GEMINI_CONCURRENCY}`)
        this.emitQueueUpdate()

        let attempts = 0;
        const maxAttempts = 3;
        let success = false;

        while (attempts < maxAttempts && !success) {
            attempts++;
            try {
                const result = await this.ai.askGemini(
                    job.prompt,
                    job.systemInstruction,
                    job.customKey,
                    job.customModel,
                )
                
                job.status = 'SUCCESS'
                job.result = result
                job.finishedAt = Date.now()
                job.durationMs = job.finishedAt - job.startedAt
                success = true;

                if (attempts > 1) {
                    console.log(`[AiQueue][☁️Gemini] ⚠️ ${attempts}회 재시도 끝에 성공: ${job.agentName} (${job.durationMs}ms)`)
                } else {
                    console.log(`[AiQueue][☁️Gemini] ✅ 완료: ${job.agentName} (${job.durationMs}ms)`)
                }
            } catch (error: any) {
                const errMsg = error.message.toLowerCase();
                const isOverloaded = errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate-limit') || errMsg.includes('rate limits');
                
                if (isOverloaded && attempts < maxAttempts) {
                    const waitMs = attempts === 1 ? 10000 : 30000; // 1차 10초 대기, 2차 30초 대기
                    console.warn(`[AiQueue][☁️Gemini] ⚠️ 일시적 과부하/트래픽 감지 (${attempts}/${maxAttempts}). ${waitMs/1000}초 후 재시도... : ${job.agentName}`);
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                } else {
                    job.status = 'FAILED'
                    job.error = error.message
                    job.finishedAt = Date.now()
                    job.durationMs = job.finishedAt - (job.startedAt || job.queuedAt)

                    console.error(`[AiQueue][☁️Gemini] ❌ 실패: ${job.agentName} — ${error.message}`)
                    break;
                }
            }
        }

        this.recordLog(job)
        this.emitQueueUpdate()
    }

    /**
     * Local 전용 큐 (로컬망 분리)
     */
    private async processLocalQueue() {
        if (this.isProcessingLocal) return
        this.isProcessingLocal = true

        while (this.localQueue.length > 0) {
            const job = this.localQueue[0]
            job.status = 'RUNNING'
            job.startedAt = Date.now()

            console.log(`[AiQueue][🖥️Local] ▶️ 실행: ${job.agentName} | 남은 대기: ${this.localQueue.length - 1}건`)
            this.emitQueueUpdate()

            try {
                const result = await this.localAi.askLocalAi(
                    job.prompt,
                    job.systemInstruction,
                    job.customModel,
                    job.customMessages
                )
                
                job.status = 'SUCCESS'
                job.result = result
                job.finishedAt = Date.now()
                job.durationMs = job.finishedAt - job.startedAt

                console.log(`[AiQueue][🖥️Local] ✅ 완료: ${job.agentName} (${job.durationMs}ms)`)
            } catch (error: any) {
                job.status = 'FAILED'
                job.error = error.message
                job.finishedAt = Date.now()
                job.durationMs = job.finishedAt - (job.startedAt || job.queuedAt)

                console.error(`[AiQueue][🖥️Local] ❌ 실패: ${job.agentName} — ${error.message}`)
            }

            this.recordLog(job)
            this.localQueue.shift()
            this.emitQueueUpdate()
        }

        this.isProcessingLocal = false
    }

    /**
     * 실행 이력 기록 (DB에 영구 보관)
     */
    private recordLog(job: AiQueueJob) {
        const kstNow = (ts: number) => {
            const d = new Date(ts);
            const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
            const nd = new Date(utc + (3600000 * 9)); // KST (UTC+9)
            const pad = (n: number) => n.toString().padStart(2, '0');
            return `${nd.getFullYear()}-${pad(nd.getMonth()+1)}-${pad(nd.getDate())} ${pad(nd.getHours())}:${pad(nd.getMinutes())}:${pad(nd.getSeconds())}`;
        };

        const logEntry = {
            id: job.id,
            agentId: job.agentId,
            agentName: job.agentName,
            triggerType: job.triggerType,
            targetType: job.targetType,
            status: job.status,
            queuedAt: kstNow(job.queuedAt),
            startedAt: job.startedAt ? kstNow(job.startedAt) : undefined,
            finishedAt: job.finishedAt ? kstNow(job.finishedAt) : undefined,
            durationMs: job.durationMs,
            error: job.error,
            prompt: job.prompt,
            systemInstruction: job.systemInstruction,
            result: job.result,
            modelName: job.isCloudBypass ? `${job.customModel} (☁️ 우회)` : job.customModel,
        }

        this.executionLog.unshift(logEntry)

        if (this.executionLog.length > 100) {
            this.executionLog = this.executionLog.slice(0, 100)
        }

        // DB에 저장 (최근 일주일치 이상 확인 가능하도록 영구 보관)
        try {
            DatabaseService.getInstance().saveAiExecutionLog(logEntry)
        } catch (e) {
            console.error('[AiQueue] Failed to save execution log to DB:', e)
        }
    }

    /**
     * UI에 큐 상태 변경 알림
     */
    private emitQueueUpdate() {
        const totalQueueLength = this.geminiQueue.length + this.localQueue.length;
        const currentJob = this.geminiQueue[0] || this.localQueue[0] || null;

        eventBus.emit('AI_QUEUE_UPDATE' as any, {
            queueLength: totalQueueLength,
            isProcessing: (this.activeGeminiWorkers > 0) || this.isProcessingLocal,
            currentJob: currentJob ? {
                agentId: currentJob.agentId,
                agentName: currentJob.agentName,
                status: currentJob.status,
            } : null,
        })
    }

    // ═══ 조회 API (IPC용) ═══

    /** 현재 큐 상태 (두 큐 합산) */
    public getQueueStatus() {
        const allJobs = [...this.geminiQueue, ...this.localQueue];
        return {
            queueLength: allJobs.length,
            isProcessing: (this.activeGeminiWorkers > 0) || this.isProcessingLocal,
            pendingJobs: allJobs.map(j => ({
                id: j.id,
                agentId: j.agentId,
                agentName: j.agentName,
                triggerType: j.triggerType,
                targetType: j.targetType,
                status: j.status,
                waitingMs: Date.now() - j.queuedAt,
            })),
        }
    }

    /** 최근 실행 이력 (DB에서 조회) */
    public getExecutionLog(limit: number = 200): AiExecutionLogEntry[] {
        try {
            return DatabaseService.getInstance().getAiExecutionLogs(limit) as AiExecutionLogEntry[]
        } catch (e) {
            console.error('[AiQueue] DB fetch failed, returning in-memory log', e)
            return this.executionLog.slice(0, limit)
        }
    }
}
