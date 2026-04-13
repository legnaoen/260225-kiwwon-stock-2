import traceback
try:
    c = open('electron/services/v2_agents/TrackBBuyAgent.ts','r',encoding='utf-8').read()
    c = c.replace('TrackBBuyAgent', 'TrackCBuyAgent')
    c = c.replace('TRACK_B_BUY_AGENT', 'TRACK_C_BUY_AGENT')
    c = c.replace('track_b_phase', 'track_c_phase')
    c = c.replace("['EMERGING_STAR']", "['PULLBACK_REBOUND', 'PULLBACK_DIP']")
    open('electron/services/v2_agents/TrackCBuyAgent.ts','w',encoding='utf-8').write(c)
    print("Success")
except Exception as e:
    traceback.print_exc()
