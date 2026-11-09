import re, json, sys
txt=open(sys.argv[1],encoding='utf-8').read()
pages=txt.split('\f')
body=[]
for p in pages:
    L=p.split('\n')
    # remove header até "SERVIÇOS INTERNOS/EXTERNOS"
    k=next((i for i,l in enumerate(L) if 'SERVIÇOS INTERNOS/EXTERNOS' in l),-1)
    L=L[k+1:] if k>=0 else L
    f=next((i for i,l in enumerate(L) if l.startswith('Legenda:')),len(L))
    L=L[:f]
    if body and L:
        # a primeira linha não vazia repete a última do bloco anterior
        fl=next((l for l in L if l.strip()),None)
        last=next((l for l in reversed(body) if l.strip()),None)
        if fl and last and fl.strip()==last.strip(): L=L[L.index(fl)+1:]
    body+=L
blocks=[];cur=None
for l in body:
    if 'Nº da OS:' in l:
        cur=[l]; blocks.append(cur)
    elif cur is not None: cur.append(l)
AT=re.compile(r'^\s{1,4}(PE|OC|SE|MO|MT|FT|TR|SO|CO|CT|PO|PR|LR|LI|AN|OB|AS)\s+(\d\d/\d\d/\d{4})\s+(.*?)\s*$')
out=[]
for b in blocks:
    o=dict(atividades=[])
    m=re.search(r'Nº da OS:\s*(\d+)\s+(Setor|Equipamento):\s+(.+?)(?:\s{2,}(Pendente|Aberta|\S[^\n]*?))?\s*$',b[0])
    o['os']=m.group(1); o['equipamento']=m.group(3) if m.group(2)=='Equipamento' else ''; o['setor_cod']=m.group(3) if m.group(2)=='Setor' else ''; o['status']=m.group(4) or ''
    t='\n'.join(b)
    def g(p,default=''):
        x=re.search(p,t); return x.group(1).strip() if x else default
    o['tipo']=g(r'Tipo da OS:\s+(.+?)\s{2,}')
    o['oficina']=g(r'Oficina:\s+(\S+)')
    o['aberta_em']=g(r'Aberta em (\d\d/\d\d/\d{4} \d\d:\d\d)')
    o['fechada_em']=g(r'Fechada em (\d\d/\d\d/\d{4} \d\d:\d\d)')
    o['avaliacao']=g(r'Avaliação:\s+(\S+)')
    o['setor']=g(r'\n\s+Setor:\s+(.+?)\s{2,}Prioridade')
    o['prioridade']=g(r'Prioridade:\s+(\S+)')
    o['responsavel']=g(r'Responsável:[ \t]+(\S.*?)\s{2,}Patrimônio')
    o['requisitante']=g(r'Requisitante:\s+(.+?)\s{2,}Nº Chamado')
    o['chamado']=g(r'Nº Chamado:\s+(\d+)')
    # textos multi-linha
    def multi(lbl,stops):
        i=next((j for j,l in enumerate(b) if l.strip().startswith(lbl)),None)
        if i is None: return ''
        out=[b[i].split(lbl,1)[1].strip()]
        for l in b[i+1:]:
            s=l.strip()
            if any(s.startswith(x) for x in stops): break
            if s: out.append(s)
        return ' '.join(x for x in out if x)
    o['reclamacao']=re.sub(r'\s+Avaliação:\s+\S+','',multi('Reclamação:',['Observação:','ATIVIDADES']))
    o['observacao']=multi('Observação:',['ATIVIDADES'])
    ia=next((j for j,l in enumerate(b) if l.strip().startswith('ATIVIDADES')),len(b))
    cur=None
    for l in b[ia+1:]:
        m=AT.match(l)
        if m:
            cod,dt,rest=m.groups()
            mq=re.search(r'\s{2,}(\d+(?:[.,]\d+)?\s+[A-Z]{1,4}|\d\d:\d\d)\s+(?:(\d[\d.]*,\d\d)\s+)?(\d[\d.]*,\d\d)\s*$',rest)
            vals=re.findall(r'(\d[\d.]*,\d\d)',rest)
            tofl=lambda v: float(v.replace('.','').replace(',','.'))
            if mq:
                desc=rest[:mq.start()].strip(); q=mq.group(1).strip(); unit=tofl(mq.group(2)) if mq.group(2) else None; tot=tofl(mq.group(3))
            else:
                desc=re.sub(r'\s+(\d[\d.]*,\d\d)(\s+\d[\d.]*,\d\d)*\s*$','',rest).strip(); q=''; unit=None; tot=tofl(vals[-1]) if vals else 0.0
            cur=dict(cod=cod,data=dt,hora='',desc=desc,qtd=q,unit=unit,det='',total=tot); o['atividades'].append(cur); continue
        s=l.strip()
        if not s or s.startswith('Total:') or cur is None: 
            if s.startswith('Total:'):
                v=re.findall(r'(\d[\d.]*,\d\d)',s); o['total']=float(v[-1].replace('.','').replace(',','.')) if v else 0.0
            continue
        if re.fullmatch(r'\d\d:\d\d',s): cur['hora']=s
        else: cur['det']=(cur['det']+' '+s).strip()
    out.append(o)
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
print(len(out))
from collections import Counter
print(Counter(o['status'] for o in out)); print(Counter(o['oficina'] for o in out)); print(Counter(o['tipo'] for o in out)); print(Counter(o['prioridade'] for o in out))
print('sem data',sum(1 for o in out if not o['aberta_em']),'sem setor',sum(1 for o in out if not o['setor']), 'sem reclam',sum(1 for o in out if not o['reclamacao']))
print('com valor',[(o['os'],o.get('total')) for o in out if o.get('total')])
print(Counter(a['cod'] for o in out for a in o['atividades']))
