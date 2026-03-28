import { PipelineId, V2PipelineResult } from './types/PipelineTypes';
import { MacroCollector } from './collectors/MacroCollector';
import { MacroAggregator } from './aggregators/MacroAggregator';
import { LocalFlowCollector } from './collectors/LocalFlowCollector';
import { LocalFlowAggregator } from './aggregators/LocalFlowAggregator';
import { RisingStockCollector } from './collectors/RisingStockCollector';
import { RisingStockAggregator } from './aggregators/RisingStockAggregator';
import { NewsKeywordCollector } from './collectors/NewsKeywordCollector';
import { NewsKeywordAggregator } from './aggregators/NewsKeywordAggregator';
import { ResearchCollector } from './collectors/ResearchCollector';
import { ResearchAggregator } from './aggregators/ResearchAggregator';

import { NaverFlowCollector } from './collectors/NaverFlowCollector';
import { NaverFlowAggregator } from './aggregators/NaverFlowAggregator';
import { NewsFlowCollector } from './collectors/NewsFlowCollector';
import { NewsFlowAggregator } from './aggregators/NewsFlowAggregator';

import { NaverSearchCollector } from './collectors/NaverSearchCollector';
import { NaverSearchAggregator } from './aggregators/NaverSearchAggregator';

import { FinanceInfoCollector } from './collectors/FinanceInfoCollector';
import { FinanceInfoAggregator } from './aggregators/FinanceInfoAggregator';

import { InvestorFlowCollector } from './collectors/InvestorFlowCollector';
import { InvestorFlowAggregator } from './aggregators/InvestorFlowAggregator';

export class V2PipelineManager {
    private static instance: V2PipelineManager;

    private macroCollector: MacroCollector;
    private macroAggregator: MacroAggregator;
    private localFlowCollector: LocalFlowCollector;
    private localFlowAggregator: LocalFlowAggregator;
    
    private risingStockCollector: RisingStockCollector;
    private risingStockAggregator: RisingStockAggregator;

    private newsKeywordCollector: NewsKeywordCollector;
    private newsKeywordAggregator: NewsKeywordAggregator;

    private researchCollector: ResearchCollector;
    private researchAggregator: ResearchAggregator;



    private naverFlowCollector: NaverFlowCollector;
    private naverFlowAggregator: NaverFlowAggregator;

    private newsFlowCollector: NewsFlowCollector;
    private newsFlowAggregator: NewsFlowAggregator;

    private naverSearchCollector: NaverSearchCollector;
    private naverSearchAggregator: NaverSearchAggregator;

    private financeInfoCollector: FinanceInfoCollector;
    private financeInfoAggregator: FinanceInfoAggregator;

    private investorFlowCollector: InvestorFlowCollector;
    private investorFlowAggregator: InvestorFlowAggregator;

    private constructor() {
        this.macroCollector = new MacroCollector();
        this.macroAggregator = new MacroAggregator();
        this.localFlowCollector = new LocalFlowCollector();
        this.localFlowAggregator = new LocalFlowAggregator();
        
        this.risingStockCollector = new RisingStockCollector();
        this.risingStockAggregator = new RisingStockAggregator();

        this.newsKeywordCollector = new NewsKeywordCollector();
        this.newsKeywordAggregator = new NewsKeywordAggregator();

        this.researchCollector = new ResearchCollector();
        this.researchAggregator = new ResearchAggregator();



        this.naverFlowCollector = new NaverFlowCollector();
        this.naverFlowAggregator = new NaverFlowAggregator();

        this.newsFlowCollector = new NewsFlowCollector();
        this.newsFlowAggregator = new NewsFlowAggregator();

        this.naverSearchCollector = new NaverSearchCollector();
        this.naverSearchAggregator = new NaverSearchAggregator();

        this.financeInfoCollector = new FinanceInfoCollector();
        this.financeInfoAggregator = new FinanceInfoAggregator();

        this.investorFlowCollector = new InvestorFlowCollector();
        this.investorFlowAggregator = new InvestorFlowAggregator();
    }

    public static getInstance(): V2PipelineManager {
        if (!V2PipelineManager.instance) {
            V2PipelineManager.instance = new V2PipelineManager();
        }
        return V2PipelineManager.instance;
    }

    /**
     * 프론트엔드의 IPC 명령 또는 스케줄러에 의해 호출됩니다.
     */
    public async runPipeline(pipelineId: PipelineId, options?: { forceFetch?: boolean, keyword?: string }): Promise<V2PipelineResult> {
        const startTime = Date.now();
        console.log(`[V2PipelineManager] Running pipeline: ${pipelineId} (force: ${options?.forceFetch})`);

        try {
            let rawData: any = null;
            let aggregatedMarkdown: string = '';

            switch (pipelineId) {
                case 'PL-Macro':
                    rawData = await this.macroCollector.collect(options);
                    aggregatedMarkdown = await this.macroAggregator.process(rawData);
                    break;
                case 'PL-LocalFlow':
                    rawData = await this.localFlowCollector.collect(options);
                    aggregatedMarkdown = await this.localFlowAggregator.process(rawData);
                    break;
                case 'PL-RisingStock':
                    rawData = await this.risingStockCollector.collect(options);
                    aggregatedMarkdown = await this.risingStockAggregator.process(rawData);
                    break;
                case 'PL-NewsKeyword':
                    rawData = await this.newsKeywordCollector.collect(options);
                    aggregatedMarkdown = await this.newsKeywordAggregator.process(rawData);
                    break;
                case 'PL-Research':
                    rawData = await this.researchCollector.collect(options);
                    aggregatedMarkdown = await this.researchAggregator.process(rawData);
                    break;

                case 'PL-NaverFlow':
                    rawData = await this.naverFlowCollector.collect(options);
                    aggregatedMarkdown = await this.naverFlowAggregator.process(rawData);
                    break;
                case 'PL-NewsFlow':
                    rawData = await this.newsFlowCollector.collect(options);
                    aggregatedMarkdown = await this.newsFlowAggregator.process(rawData);
                    break;
                case 'PL-NaverSearch':
                    rawData = await this.naverSearchCollector.collect(options);
                    aggregatedMarkdown = await this.naverSearchAggregator.process(rawData);
                    break;
                case 'PL-FinanceInfo':
                    rawData = await this.financeInfoCollector.collect(options);
                    aggregatedMarkdown = await this.financeInfoAggregator.process(rawData);
                    break;
                case 'PL-InvestorFlow':
                    rawData = await this.investorFlowCollector.collect();
                    aggregatedMarkdown = await this.investorFlowAggregator.process(rawData);
                    break;
                default:
                    throw new Error(`Unknown pipeline ID: ${pipelineId}`);
            }

            const executionTimeMs = Date.now() - startTime;
            
            return {
                id: pipelineId,
                status: 'success',
                executionTimeMs,
                lastRunTime: new Date().toISOString(),
                rawData,
                aggregatedMarkdown
            };

        } catch (error: any) {
            console.error(`[V2PipelineManager] Pipeline ${pipelineId} Failed:`, error);
            
            return {
                id: pipelineId,
                status: 'failed',
                executionTimeMs: Date.now() - startTime,
                lastRunTime: new Date().toISOString(),
                rawData: { error: error.message || 'Unknown Error', stack: error.stack },
                aggregatedMarkdown: `### ❌ 실행 실패\n${error.message}`
            };
        }
    }
}
