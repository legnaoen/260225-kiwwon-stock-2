import re

filepath = 'electron/services/SchedulerService.ts'
c = open(filepath, 'r', encoding='utf-8').read()

if 'TrackDBuyAgent' not in c:
    c = c.replace("import { TrackCBuyAgent } from './v2_agents/TrackCBuyAgent';", "import { TrackCBuyAgent } from './v2_agents/TrackCBuyAgent';\nimport { TrackDBuyAgent } from './v2_agents/TrackDBuyAgent';")
    
    # 1. scoreDailyPerformance (around line 235)
    target1 = "TrackCBuyAgent.getInstance().scoreDailyPerformance(pickDate);"
    c = c.replace(target1, target1 + "\n            TrackDBuyAgent.getInstance().scoreDailyPerformance(pickDate);")
    
    # 2. run at 15:05 (around line 290)
    target2 = "await TrackCBuyAgent.getInstance().run(today);"
    c = c.replace(target2, target2 + "\n            await TrackDBuyAgent.getInstance().run(today);")
    
    # 3. updateEntryPrices (around line 310)
    target3 = "TrackCBuyAgent.getInstance().updateEntryPrices(today);"
    c = c.replace(target3, target3 + "\n            TrackDBuyAgent.getInstance().updateEntryPrices(today);")

    open(filepath, 'w', encoding='utf-8').write(c)
    print("Scheduler updated.")
else:
    print("Already updated.")
