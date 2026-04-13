import traceback
try:
    c = open('electron/services/v2_agents/TrackCBuyAgent.ts','r',encoding='utf-8').read()
    c = c.replace('TrackCBuyAgent', 'TrackDBuyAgent')
    c = c.replace('TRACK_C_BUY_AGENT', 'TRACK_D_BUY_AGENT')
    c = c.replace('track_c_phase', 'track_d_phase')
    c = c.replace("['PULLBACK_REBOUND', 'PULLBACK_DIP']", "['INTRADAY_SURGE']")
    c = c.replace("눌림목 스나이핑", "당일 급등주 종가베팅")
    open('electron/services/v2_agents/TrackDBuyAgent.ts','w',encoding='utf-8').write(c)
    print("Success")
except Exception as e:
    traceback.print_exc()
