import { TrackEBuyAgent } from './electron/services/v2_agents/TrackEBuyAgent';

async function test() {
    console.log('Starting TrackEBuyAgent test...');
    const result = await TrackEBuyAgent.getInstance().run();
    console.log('Result:', result);
    process.exit(0);
}

test();
