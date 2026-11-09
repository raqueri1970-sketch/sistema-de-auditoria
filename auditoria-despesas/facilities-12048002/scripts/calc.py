import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from dados import D
R=json.load(open(sys.argv[1])); S=R['stores']; M=R['dist']
KML=7.0; MARG=1.20
fuel=[d for d in D if d.get('litros')]
def wavg(c): 
    f=[d for d in fuel if d['comb']==c]; return sum(d['v'] for d in f)/sum(d['litros'] for d in f)
P={'Gasolina':wavg('Gasolina'),'Diesel':wavg('Diesel'),'Etanol':wavg('Etanol')}
P['Geral']=sum(d['v'] for d in fuel)/sum(d['litros'] for d in fuel)
total=sum(d['v'] for d in D)
# --- contas
contas={}
for d in D:
    c=contas.setdefault(d['conta'],dict(qtd=0,sis=0,doc=0)); c['qtd']+=1; c['sis']+=d['v']; c['doc']+=(d['vd'] if d['vd'] is not None else d['v'])
# glosa / retenção sugerida
RET={94598788:"Caixa d'água em CPF de terceiro, sem loja",94598636:'Cafeteira: não é manutenção; CPF de terceiro',94600530:'Item não descrito (loja de celular)',
     94598330:'Cartão pré-pago: risco de pagamento em dobro',94602375:'PJ não pode ser reembolso: pagar via Contas a Pagar com NF-e'}
# --- segmentos (macro)
def macro(s):
    s=s.lower()
    for k,v in [('marcenaria','Marcenaria'),('elétrica','Elétrica'),('ar-condicionado','Ar-condicionado / Refrigeração'),('hidrául','Hidráulica / Louças'),
                ('copa','Copa / Utensílios (fora de manutenção)'),('combust','Frota – Combustível'),('frota/manut','Frota – Pneus/Manutenção'),
                ('frota/','Frota – Estacionamento e guarda'),('mobilidade','Mobilidade (Uber/99)'),('esclarecer','A esclarecer'),('civil','Civil / Acabamento / Ferragens'),('ferragens','Civil / Acabamento / Ferragens')]:
        if k in s: return v
    return 'Outros'
seg={}
for d in D:
    m=macro(d['seg']); x=seg.setdefault(m,dict(qtd=0,v=0)); x['qtd']+=1; x['v']+=d['v']
# --- tabela CD x lojas
def regiao(s):
    uf=s['uf']; c=s['cidade'].lower(); k=s['km_ida']
    if uf=='RN': return 'RN – Natal e região'
    if uf=='PB': return 'PB – João Pessoa e região'
    if uf=='AL': return 'AL – Maceió'
    if uf=='BA' or 'petrolina' in c or 'salgueiro' in c: return 'Sertão / São Francisco'
    if k<=35: return 'Grande Recife'
    if k<=70: return 'Região Metropolitana estendida'
    if 'palmares' in c: return 'Mata Sul'
    return 'Agreste / Interior PE'
tab=[]
for i,s in enumerate(S):
    if i==0: continue
    km=s['km_ida']+s['km_volta']; L=km/KML
    tab.append(dict(loja=s['loja'].replace('  ',' '),cidade=f"{s['cidade']}/{s['uf']}",regiao=regiao(s),tipo=s['tipo'],km_ida=s['km_ida'],km_rt=round(km,1),h_ida=s['h_ida'],
        litros=L,custo_g=L*P['Gasolina'],teto_g=L*P['Gasolina']*MARG,custo_d=L*P['Diesel'],teto_d=L*P['Diesel']*MARG,idx=i,geo=s['geo']))
# --- rotas regionais (vizinho mais próximo + 2-opt no OSRM)
def tour(ids):
    rt=[0]; left=set(ids)
    while left:
        n=min(left,key=lambda j:M[rt[-1]][j]); rt.append(n); left.remove(n)
    rt.append(0)
    def L(r): return sum(M[r[k]][r[k+1]] for k in range(len(r)-1))
    imp=True
    while imp:
        imp=False
        for a in range(1,len(rt)-2):
            for b in range(a+1,len(rt)-1):
                nr=rt[:a]+rt[a:b+1][::-1]+rt[b+1:]
                if L(nr)<L(rt)-1: rt=nr; imp=True
    return rt,L(rt)/1000
def uniq(codes):
    seen={}; out=[]
    for i,s in enumerate(S):
        if s['loja'][:3] in codes:
            key=(round(s['lat'],4),round(s['lon'],4))
            if key in seen: continue
            seen[key]=i; out.append(i)
    return out
GR={'RN – Natal e região (9 lojas)':['933','935','936','944','949','959','975','991','926'],
    'PB – João Pessoa e região (5 lojas)':['927','928','950','983','994'],
    'AL – Maceió (3 lojas)':['947','948','951'],
    'Agreste – eixo BR-232/BR-104 (13 lojas)':['941','978','960','939','923','929','932','943','952','958','961','955','953'],
    'Sertão – Pesqueira/Arcoverde/Garanhuns (3 lojas)':['982','977','995'],
    'São Francisco – Salgueiro/Petrolina/Juazeiro (4 lojas)':['980','934','964','937'],
    'Mata Sul / Litoral Sul (4 lojas)':['942','954','956','930']}
rotas=[]
for nome,codes in GR.items():
    ids=uniq(codes); rt,km=tour(ids)
    soma=sum((M[0][j]+M[j][0])/1000 for j in ids)
    rotas.append(dict(nome=nome,seq=' → '.join(['CD']+[S[j]['loja'][:3] for j in rt[1:-1]]+['CD']),paradas=len(ids),km=km,L=km/KML,
        custo=km/KML*P['Gasolina'],teto=km/KML*P['Gasolina']*MARG,km_ind=soma,custo_ind=soma/KML*P['Gasolina'],
        horas=sum(R['dur'][rt[k]][rt[k+1]] for k in range(len(rt)-1))/3600))
# --- coerência de combustível (deslocamentos comprovados pelos documentos)
def rt_km(code):
    t=next(x for x in tab if x['loja'].startswith(code)); return t['km_rt']
desl=[('29/10','FGQ-9128','CD → Gravatá (loja 960) → CD','Posto Petur Gravatá 16:42',rt_km('960')),
      ('03/11','GDR-6J38','CD → Paulista (913/996) → CD','Lepari + Bezerra + Pintmais + Petromega (Paulista)',rt_km('913')),
      ('03/11','EZS-1502','CD → Recife (Ilha do Retiro/Ilha do Leite) → CD','Posto Leão 10:12 + Penta Service 10:29',rt_km('908')),
      ('03/11','não identificado','CD → Afogados → Jiquiá → Cavaleiro → CD','Armazém Coral 11:22 / 12:58 + Expresso 13:54',52.0),
      ('04/11','FGQ-9128','CD → Paulista → CD','Investgas 09:31 + Bezerra 10:20–13:18 + NEM Pneus',rt_km('913')),
      ('04/11','EZS-1502','CD → Recife Centro (Concórdia) → CD','New Parking 10:00–16:26',rt_km('920')),
      ('04/11','não identificado','CD → Pombos (BR-232) → CD','Posto Carreteiro 14:03',128.0),
      ('04/11','não identificado','CD → Abreu e Lima → CD','Millena 17:23',rt_km('906'))]
km_doc=sum(x[4] for x in desl); L_doc=km_doc/KML; L_pago=sum(d['litros'] for d in fuel); v_pago=sum(d['v'] for d in fuel)
coer=dict(km_doc=km_doc,km_teto=km_doc*MARG,L_teto=L_doc*MARG,R_teto=L_doc*MARG*P['Geral'],L_pago=L_pago,km_cap=L_pago*KML,v_pago=v_pago,
          dif_R=v_pago-L_doc*MARG*P['Geral'],dif_L=L_pago-L_doc*MARG)
out=dict(total=total,P=P,contas=contas,RET=RET,seg=seg,tab=tab,rotas=rotas,desl=desl,coer=coer)
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,indent=1,default=float)
print('total',total); print('precos',P); print('coer',coer)
for r in rotas: print(r['nome'],round(r['km']),round(r['custo']),'vs ind',round(r['km_ind']),round(r['custo_ind']),round(r['horas'],1),r['seq'])
for k,v in sorted(seg.items(),key=lambda x:-x[1]['v']): print(k,v)
