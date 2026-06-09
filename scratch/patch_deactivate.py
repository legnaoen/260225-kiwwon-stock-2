import os

filepath = r'electron/services/SchedulerService.ts'

# Read file with BOM handling
with open(filepath, 'r', encoding='utf-8-sig') as f:
    content = f.read()

# Normalize line endings to LF for easier replacement, we'll write back as LF or CRLF
# Actually, we can just replace strings directly by replacing \r\n with \n during matching,
# but it's simpler to do string replacement directly.
# Let's write the target strings with both \r\n and \n normalization.

content_norm = content.replace('\r\n', '\n')

# Target 1: themeAiJob
target_1 = """            // [Step 6.5] 14:55 테마 AI (ThemeIntelligence) 종가 베팅을 위한 전용 크론
            // 장 마감 직전(14:55) 당일 테마/섹터 랭킹을 수집하고 AI 추천 종목을 발굴
            const themeAiJob = this.createWatchdogCron('themeAiJob', '55 14 * * 1-5', async () => {
                console.log(`[SchedulerService] 🤖 14:55 테마주 AI (종가 베팅용) 일괄 분석 시작`)
                try {
                    // 테마 AI 실행 전, 최신 테마/섹터 순위를 확보하기 위해 NaverFlow 수집 파이프라인 1회 강제 실행
                    const { V2PipelineManager } = await import('./v2_pipeline/V2PipelineManager')
                    await V2PipelineManager.getInstance().runPipeline('PL-NaverFlow', { forceFetch: true })
                    
                    // 수집된 데이터를 바탕으로 테마 AI 분석 실행
                    const { ThemeIntelligenceAgent } = await import('./v2_agents/ThemeIntelligenceAgent')
                    await ThemeIntelligenceAgent.getInstance().runBatchAnalysis()
                } catch (e: any) {
                    console.error(`[SchedulerService] 테마 AI 전용 파이프라인 실패:`, e.message)
                }
            }, { timezone: 'Asia/Seoul' })"""

replacement_1 = """            // [Step 6.5] 14:55 테마 AI (ThemeIntelligence) 종가 베팅을 위한 전용 크론 (비활성화됨)
            const themeAiJob = this.createWatchdogCron('themeAiJob', '55 14 * * 1-5', async () => {
                console.log(`[SchedulerService] 🤖 14:55 테마주 AI (종가 베팅용) 비활성화됨 (실행 건너뜀)`)
                /*
                try {
                    // 테마 AI 실행 전, 최신 테마/섹터 순위를 확보하기 위해 NaverFlow 수집 파이프라인 1회 강제 실행
                    const { V2PipelineManager } = await import('./v2_pipeline/V2PipelineManager')
                    await V2PipelineManager.getInstance().runPipeline('PL-NaverFlow', { forceFetch: true })
                    
                    // 수집된 데이터를 바탕으로 테마 AI 분석 실행
                    const { ThemeIntelligenceAgent } = await import('./v2_agents/ThemeIntelligenceAgent')
                    await ThemeIntelligenceAgent.getInstance().runBatchAnalysis()
                } catch (e: any) {
                    console.error(`[SchedulerService] 테마 AI 전용 파이프라인 실패:`, e.message)
                }
                */
            }, { timezone: 'Asia/Seoul' })"""

# Target 2: ThemeMockTradingJudgeAgent
target_2 = """                        // 성과 판독(ThemeMockTradingJudgeAgent) 가동
                        try {
                            if (hr >= 15 && min >= 30) {
                                console.log(`[SchedulerService] ⚖️ 장 마감 후 스케줄 감지(${hr}:${min}): Theme 판독기(종가 업데이트) 가동`)
                                const { ThemeMockTradingJudgeAgent } = await import('./v2_agents/ThemeMockTradingJudgeAgent')
                                await ThemeMockTradingJudgeAgent.getInstance().evaluatePicks()
                            }
                        } catch (aiErr: any) {
                            console.error(`[SchedulerService] 테마 연계 파이프라인 실패:`, aiErr.message)
                        }"""

replacement_2 = """                        // 성과 판독(ThemeMockTradingJudgeAgent) 가동 (비활성화됨)
                        try {
                            if (hr >= 15 && min >= 30) {
                                console.log(`[SchedulerService] ⚖️ 장 마감 후 스케줄 감지(${hr}:${min}): Theme 판독기 비활성화됨 (실행 건너뜀)`)
                                /*
                                const { ThemeMockTradingJudgeAgent } = await import('./v2_agents/ThemeMockTradingJudgeAgent')
                                await ThemeMockTradingJudgeAgent.getInstance().evaluatePicks()
                                */
                            }
                        } catch (aiErr: any) {
                            console.error(`[SchedulerService] 테마 연계 파이프라인 실패:`, aiErr.message)
                        }"""

# Target 3: Moonshot
target_3 = """        // ═══ [Step 4] Moonshot AI 크론 등록 ═══
        const moonshotSettings = store.get('moonshot_settings') as any;
        if (moonshotSettings?.enabled) {"""

replacement_3 = """        // ═══ [Step 4] Moonshot AI 크론 등록 (비활성화됨) ═══
        const moonshotSettings = store.get('moonshot_settings') as any;
        if (false && moonshotSettings?.enabled) {"""

# Replace targets in normalized content
if target_1.replace('\r\n', '\n') in content_norm:
    content_norm = content_norm.replace(target_1.replace('\r\n', '\n'), replacement_1.replace('\r\n', '\n'))
    print("Target 1 found and replaced.")
else:
    print("WARNING: Target 1 not found!")

if target_2.replace('\r\n', '\n') in content_norm:
    content_norm = content_norm.replace(target_2.replace('\r\n', '\n'), replacement_2.replace('\r\n', '\n'))
    print("Target 2 found and replaced.")
else:
    print("WARNING: Target 2 not found!")

if target_3.replace('\r\n', '\n') in content_norm:
    content_norm = content_norm.replace(target_3.replace('\r\n', '\n'), replacement_3.replace('\r\n', '\n'))
    print("Target 3 found and replaced.")
else:
    print("WARNING: Target 3 not found!")

# Convert back to CRLF to match git preferences if needed, or write back directly.
# Let's match original line endings by checking if the original had CRLF.
if '\r\n' in content:
    final_content = content_norm.replace('\n', '\r\n')
else:
    final_content = content_norm

# Write back with BOM if original had BOM
# utf-8-sig automatically adds BOM when writing
with open(filepath, 'w', encoding='utf-8-sig') as f:
    f.write(final_content)

print("Patch complete.")
