import openpyxl, json, time, urllib.request, urllib.parse, re, sys
X=sys.argv[1]; OUT=sys.argv[2]
wb=openpyxl.load_workbook(X,data_only=True); ws=wb.active
rows=[r for r in ws.iter_rows(min_row=2,values_only=True) if r[0]]
UA={'User-Agent':'auditoria-despesas/1.0'}
def geo(q):
    u='https://nominatim.openstreetmap.org/search?'+urllib.parse.urlencode({'q':q,'format':'json','limit':1,'countrycodes':'br'})
    r=json.load(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=20)); time.sleep(1.1)
    return (float(r[0]['lat']),float(r[0]['lon']),r[0]['display_name']) if r else None
# hand-tuned queries for known landmarks
special={'001':'Avenida da Recuperação, Guabiraba, Recife','908':'Shopping Boa Vista, Recife','912':'Shopping Recife, Boa Viagem','914':'Shopping Tacaruna, Recife',
'915':'Shopping Guararapes, Jaboatão dos Guararapes','918':'Shopping Patteo Olinda','923':'Caruaru Shopping','931':'RioMar Shopping, Recife','974':'RioMar Shopping, Recife',
'932':'Shopping Difusora, Caruaru','935':'Midway Mall, Natal','936':'Natal Shopping','944':'Natal Shopping','946':'Shopping Boa Vista, Recife',
'947':'Pátio Maceió','948':'Pátio Maceió','949':'Partage Norte Shopping Natal','959':'Partage Norte Shopping Natal','950':'Manaíra Shopping, João Pessoa',
'928':'Manaíra Shopping, João Pessoa','954':'Shopping Costa Dourada, Cabo de Santo Agostinho','964':'River Shopping, Petrolina','978':'Vitória Park Shopping',
'983':'Mangabeira Shopping, João Pessoa','996':'Shopping Paulista, Paulista','940':'Carrefour, Caçote, Recife'}
res=[]
for r in rows:
    loja,tipo,cnpj,end,cid=r[0],r[1],r[2],r[3],r[4]
    code=str(loja).split('-')[0].strip()
    city,uf=[s.strip() for s in str(cid).split('/')]
    city=re.sub(r'\s+',' ',city).replace('Sto','Santo')
    g=None; how=''
    for q in ([special[code]] if code in special else [])+[f"{end.split(' - ')[0]}, {city}, {uf}"]:
        try: g=geo(q)
        except Exception as e: g=None
        if g:
            how=q;break
    if not g or (abs(g[0])>12 or g[1]>-34): pass
    cg=geo(f"{city}, {uf}, Brasil")
    # sanity: if specific geocode > 15 km from city center, use city center
    import math
    if g and cg:
        d=math.hypot(g[0]-cg[0],(g[1]-cg[1])*math.cos(math.radians(g[0])))*111
        if d>15: g=None
    if not g: g=cg; how='CENTRO DA CIDADE'
    res.append(dict(loja=loja,tipo=tipo,end=end,cidade=city,uf=uf,regional=r[5],lat=g[0],lon=g[1],geo=how))
    print(loja,'|',how,'|',round(g[0],4),round(g[1],4),flush=True)
json.dump(res,open(OUT,'w'),ensure_ascii=False,indent=1)
