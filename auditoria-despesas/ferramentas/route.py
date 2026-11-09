import json,urllib.request,sys
g=json.load(open(sys.argv[1]))
coords=';'.join(f"{s['lon']},{s['lat']}" for s in g)
u=f"https://router.project-osrm.org/table/v1/driving/{coords}?annotations=distance,duration"
r=json.load(urllib.request.urlopen(u,timeout=60))
for i,s in enumerate(g):
    s['km_ida']=round(r['distances'][0][i]/1000,1); s['km_volta']=round(r['distances'][i][0]/1000,1); s['h_ida']=round(r['durations'][0][i]/3600,2)
json.dump({'stores':g,'dist':r['distances'],'dur':r['durations']},open(sys.argv[2],'w'),ensure_ascii=False)
for s in g: print(s['loja'],s['km_ida'],s['km_volta'],s['h_ida'])
