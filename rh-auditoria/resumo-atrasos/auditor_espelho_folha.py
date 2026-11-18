"""Auditoria independente: espelho AbsisRH (txt do pdftotext -layout) x folha 10/2026 x ATIVOS."""
import re, sys, json, pickle
import pandas as pd

ESP, FOLHA_PKL, ATIVOS, OUT = sys.argv[1:5]
VER = re.compile(r'([A-Z]{4})-[^:]*?:\s*(-?\d+[:.]\d+)')
DAY = re.compile(r'^\s+(\d\d/\d\d) (SEG|TER|QUA|QUI|SEX|SAB|DOM)\b')

def hm(v):
    neg = v.startswith('-'); v = v.lstrip('-')
    if ':' in v:
        h, m = v.split(':'); x = int(h) * 60 + int(m)
    else:
        x = round(float(v) * 60)  # nos dias, "1.00" só aparece em FDVT/AJCT (quantidade)
    return -x if neg else x

txt = open(ESP, encoding='utf-8', errors='replace').read()
blocks = re.split(r'\n(?=\s*Funcionario\.:)', txt)
emps = []
for b in blocks:
    if 'Funcionario.:' not in b: continue
    g = lambda r: (re.search(r, b).group(1).strip() if re.search(r, b) else '')
    e = dict(name=g(r'Funcionario\.:\s*(.+?)\s+-\s+CPF'), code=g(r'Codigo\.+:\s*(\d+)'), lot=g(r'Lotacao\.+:\s*(.+)'),
             cargo=g(r'Cargo\.+:\s*(.+)'), estab=g(r'Estabelec\.+:\s*(\S+ \S+)'), days=[], tot={})
    mode = 'days'; vcol = 66; cur = None
    for ln in b.split('\n'):
        if re.search(r'\bDATA\b.*\bVERBA\b', ln): vcol = ln.index('VERBA') - 2; continue
        if 'SOMA DAS VERBAS' in ln: mode = 'soma'; cur = None
        if 'TOTAIS DO PERIODO' in ln: mode = 'tot'
        if mode == 'tot':
            for k, v in VER.findall(ln):
                if ':' not in v: e['tot'][k] = float(v)
            continue
        if mode != 'days': continue
        m = DAY.match(ln)
        if m:
            left = ln[:vcol]; rest = re.sub(r'^\s+\d\d/\d\d \w{3}', '', left)
            obs = re.sub(r'\s+', ' ', re.sub(r'\b\d\d:\d\d\b', '', rest)).strip()
            cur = dict(d=m.group(1), wd=m.group(2), obs=obs, t=re.findall(r'\b\d\d:\d\d\b', rest), v={})
            e['days'].append(cur); src = ln[vcol:]
        elif cur is not None and re.search(r'[A-Z]{4}-', ln) and not re.match(r'^\s*-{5}', ln):
            src = ln
        else:
            continue
        for k, v in VER.findall(src):
            if k in ('FDVT', 'AJCT'): continue
            cur['v'][k] = cur['v'].get(k, 0) + hm(v)
    emps.append(e)

def isComp(o): return 'COMP' in o and 'BCO' in o
rows = []
for e in emps:
    D = dict(debComp=0, debAtr=0, debOutros=0, faltAtrInj=0, faltDia=0, diasAtr=0, diasAtrInj=0, diasFalt=0, credDia=0, debDiaTot=0,
             faltAdv=0, obsDeb={}, tolDias=0, tolMin=0, puroMin=0, puroDias=0)
    for d in e['days']:
        v, o = d['v'], d['obs']; deb = v.get('DEBT', 0); fal = v.get('FALT', 0)
        D['debDiaTot'] += deb; D['credDia'] += v.get('CRED', 0)
        if deb:
            if isComp(o): D['debComp'] += deb
            else:
                D['debAtr'] += deb; D['diasAtr'] += 1
                k = o.split(' ')[0] if o else '(batida)'; D['obsDeb'][k] = D['obsDeb'].get(k, 0) + deb
                if not o:
                    D['puroMin'] += deb; D['puroDias'] += 1
                    if deb <= 15: D['tolDias'] += 1; D['tolMin'] += deb
        if fal:
            if 'ATRA' in o: D['faltAtrInj'] += fal; D['diasAtrInj'] += 1
            else: D['faltDia'] += fal; D['diasFalt'] += 1
            if 'ADV' in o: D['faltAdv'] += 1
    t = e['tot']
    rows.append(dict(code=e['code'], name=e['name'], lot=e['lot'], cargo=e['cargo'], estab=e['estab'], ndias=len(e['days']),
                     SANT=t.get('SANT'), CRED=t.get('CRED', 0), DEBT=t.get('DEBT', 0), SDBH=t.get('SDBH'), FALT=t.get('FALT', 0),
                     debComp=D['debComp']/60, debAtr=D['debAtr']/60, debDiaTot=D['debDiaTot']/60, credDia=D['credDia']/60,
                     faltAtrInj=D['faltAtrInj']/60, faltDia=D['faltDia']/60, diasAtr=D['diasAtr'], diasAtrInj=D['diasAtrInj'],
                     diasFalt=D['diasFalt'], faltAdvDias=D['faltAdv'], puroH=D['puroMin']/60, puroDias=D['puroDias'], tolDias=D['tolDias'], tolH=D['tolMin']/60, obsDeb=json.dumps({k: round(x/60, 2) for k, x in D['obsDeb'].items()})))
E = pd.DataFrame(rows)

F = pd.read_pickle(FOLHA_PKL)
F['code'] = F['Código'].astype(str).str.replace(r'\.0$', '', regex=True)
def piv(cod, col):
    s = F[F['Verba_Código'].astype(str) == cod].groupby('code')[col].sum(); return s
P = pd.DataFrame({'f1356h': piv('1356', 'Verba_Quant'), 'f1356v': piv('1356', 'Verba_Valor'), 'f1357h': piv('1357', 'Verba_Quant'),
                  'f1357v': piv('1357', 'Verba_Valor'), 'f2608d': piv('2608', 'Verba_Quant'), 'fCRED': piv('CRED', 'Verba_Quant'),
                  'fDEBT': piv('DEBT', 'Verba_Quant'), 'fSDBH': piv('SDBH', 'Verba_Quant'), 'f1060v': piv('1060', 'Verba_Valor')})
info = F.groupby('code').agg(situ=('Situação_Usual', 'first'), fEstab=('Estab_Usual', 'first'), deslig=('Data Desligament', 'first'),
                              cc=('CCusto_Titulo', 'first')).join(P, how='left').fillna({c: 0 for c in P.columns}).reset_index()
# salário contratual (2004) e base de horas para valor-hora
sal = F[F['Verba_Código'].astype(str) == '2004'].groupby('code')['Verba_Valor'].sum().rename('sal2004')
info = info.merge(sal, on='code', how='left')
A = pd.read_excel(ATIVOS); A['code'] = A['MATRICULA'].astype(str).str.replace(r'\.0$', '', regex=True)
A = A[['code', 'SITUACAO', 'NOME CCUSTO', 'COD ESTAB']].rename(columns={'SITUACAO': 'situAtivos', 'NOME CCUSTO': 'ccAtivos', 'COD ESTAB': 'estabAtivos'})
M = E.merge(info, on='code', how='outer', indicator='fonte').merge(A, on='code', how='left')
M.to_pickle(OUT)
print('espelho pessoas', len(E), '| folha pessoas', F['code'].nunique(), '| ativos', len(A))
print(M['fonte'].value_counts().to_dict())
