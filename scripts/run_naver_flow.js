const { V2PipelineManager } = require('./dist-electron/services/v2_pipeline/V2PipelineManager');

process.env.NODE_ENV = 'development';

(async () => {
    try {
        console.log('Running PL-NaverFlow...');
        const manager = V2PipelineManager.getInstance();
        const result = await manager.runPipeline('PL-NaverFlow', { forceFetch: true });
        console.log('Result:', result.status);
    } catch(e) {
        console.error(e);
    }
})();
