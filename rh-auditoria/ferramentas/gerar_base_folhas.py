"""Gera a base embutida de folhas (gzip+base64) a partir de arquivos FOLHA MM-AAAA.xlsx.

Uso:  python3 gerar_base_folhas.py SAIDA.b64 FOLHA_01-2026.xlsx FOLHA_02-2026.xlsx ...

Mesma regra do importador do navegador (rh-auditoria/folhas.js):
aba Sheet1 (uma linha por rubrica por funcionário); 2001 = bruto, 2002 = descontos,
2004 = salário contratual; líquido = 2001 - 2002.
"""
import base64, datetime, gzip, json, re, sys
import openpyxl

def s(v):
    if v is None: return ''
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).strip()
def n(v):
    try: return float(v or 0)
    except (TypeError, ValueError): return 0.0
def d(v):
    if isinstance(v, datetime.datetime): return v.strftime('%Y-%m-%d')
    return s(v)[:10] or None

def escolher_aba(wb):
    melhor = None
    for ws in wb.worksheets:
        h = [s(x) for x in next(ws.iter_rows(values_only=True), [])]
        if not ('Verba_Código' in h and 'Código' in h and 'Verba_Valor' in h): continue
        if ws.title.lower() == 'sheet1': return ws
        t = ws.title.lower()
        if 'liquido' in t.replace('í', 'i') or 'consig' in t or 'pix' in t: continue
        if melhor is None or ws.max_row > melhor.max_row: melhor = ws
    return melhor

def comp_key(c):
    m = re.match(r'(\d{1,2})/(\d{2,4})(?:-(\d+))?', c)
    a = int(m.group(2)); a += 2000 if a < 100 else 0
    return (a, int(m.group(1)), int(m.group(3) or 1))

def main(saida, arquivos):
    out = {}
    for f in arquivos:
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        ws = escolher_aba(wb)
        if ws is None: sys.exit(f'{f}: aba da folha não encontrada')
        rows = ws.iter_rows(values_only=True)
        h = [s(x) for x in next(rows)]
        ix = {}
        for i, k in enumerate(h):
            if k and k not in ix: ix[k] = i
        nome = re.sub(r'^[0-9a-f]{8}-', '', f.replace('\\', '/').split('/')[-1]).replace('_', ' ')
        g = lambda r, k: r[ix[k]] if k in ix and ix[k] < len(r) else None
        for r in rows:
            comp, mat = s(g(r, 'Mês_Ano Folha')), s(g(r, 'Código'))
            if not comp or not mat: continue
            C = out.setdefault(comp, {'comp': comp, 'arquivo': nome, 'linhas': 0, 'origem': 'embutida',
                                      'importado_em': datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S'), 'cat': {}, 'f': {}})
            C['linhas'] += 1
            e = C['f'].get(mat)
            if e is None:
                cpf = re.sub(r'\D', '', s(g(r, 'CPF')))
                e = C['f'][mat] = [s(g(r, 'Nome')), cpf.zfill(11) if cpf else '', s(g(r, 'Situação_Usual')),
                                   (s(g(r, 'CCusto')) or '—').zfill(4), s(g(r, 'CCusto_Titulo')), s(g(r, 'Cargo_Título')),
                                   d(g(r, 'Data de Admissão')), d(g(r, 'Data Desligament')), 0.0, 0.0, 0.0, {}]
            cod, v, tipo = s(g(r, 'Verba_Código')).zfill(4), n(g(r, 'Verba_Valor')), s(g(r, 'Verba_Tipo'))
            if cod == '2001': e[8] += v
            elif cod == '2002': e[9] += v
            elif cod == '2004': e[10] = v
            if tipo in ('Provento', 'Desconto'):
                if v: e[11][cod] = round(e[11].get(cod, 0) + v, 2)
                C['cat'][cod] = [s(g(r, 'Verba_Título')), tipo]
    lista = []
    for comp in sorted(out, key=comp_key):
        C = out[comp]
        for e in C['f'].values(): e[8], e[9] = round(e[8], 2), round(e[9], 2)
        b = sum(e[8] for e in C['f'].values()); ds = sum(e[9] for e in C['f'].values())
        print(f"{comp}: {C['arquivo']} · {C['linhas']} linhas · {len(C['f'])} funcionários · bruto {b:,.2f} · descontos {ds:,.2f}")
        lista.append(C)
    raw = json.dumps(lista, ensure_ascii=False, separators=(',', ':')).encode()
    open(saida, 'w').write(base64.b64encode(gzip.compress(raw, 9)).decode())

if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])
