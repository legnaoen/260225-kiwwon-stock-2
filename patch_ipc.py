import re

# main.ts
try:
    c = open('electron/main.ts', 'r', encoding='utf-8').read()
    if 'TrackDBuyAgent' not in c:
        # handle tricky import
        c = c.replace("import { TrackCBuyAgent } from './services/v2_agents/TrackCBuyAgent';", "import { TrackCBuyAgent } from './services/v2_agents/TrackCBuyAgent';\nimport { TrackDBuyAgent } from './services/v2_agents/TrackDBuyAgent';")
        
        target = "    ipcMain.handle('track-c:run-buy-agent', async () => {\n        try {\n            return await TrackCBuyAgent.getInstance().run();\n        } catch (e: any) {\n            return { success: false, error: e.message };\n        }\n    });"
        replacement = target + "\n\n    ipcMain.handle('track-d:run-buy-agent', async () => {\n        try {\n            return await TrackDBuyAgent.getInstance().run();\n        } catch (e: any) {\n            return { success: false, error: e.message };\n        }\n    });"
        c = c.replace(target, replacement)
        open('electron/main.ts', 'w', encoding='utf-8').write(c)
except Exception as e:
    print("main.ts error:", e)

# preload.ts
try:
    p = open('electron/preload.ts', 'r', encoding='utf-8').read()
    if 'runTrackDBuyAgent' not in p:
        p = p.replace("runTrackCBuyAgent: () => ipcRenderer.invoke('track-c:run-buy-agent'),", "runTrackCBuyAgent: () => ipcRenderer.invoke('track-c:run-buy-agent'),\n    runTrackDBuyAgent: () => ipcRenderer.invoke('track-d:run-buy-agent'),")
        open('electron/preload.ts', 'w', encoding='utf-8').write(p)
except Exception as e:
    print("preload.ts error:", e)
