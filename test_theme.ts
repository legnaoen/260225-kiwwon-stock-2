import { ThemeIntelligenceAgent } from './electron/services/v2_agents/ThemeIntelligenceAgent';
ThemeIntelligenceAgent.getInstance().runBatchAnalysis().then(() => console.log('Done')).catch(console.error);
