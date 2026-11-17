"""Injeta o importador de folhas (rh-auditoria/folhas.js) e a base embutida no módulo
"Central de Auditoria RH" do portal (index.html, MENC["rh"], HTML em base64).

Uso:  python3 embutir_no_portal.py index.html rh-auditoria/folhas.js base_folhas.b64

Idempotente: cada trecho fica entre marcadores RHF:<nome> e é substituído numa nova execução.
"""
import base64, re, sys

CSS = """
.folhas-banner{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 16px;margin:0 0 16px;border:1px solid var(--neon-blue);border-radius:12px;background:rgba(79,168,255,.08)}
.folhas-banner .sub{font-size:12.5px;color:var(--ink2);margin-top:3px}
.dash-btn.primary-imp{background:var(--blue);border-color:var(--blue);color:#fff}
.imp-drop{border:2px dashed var(--neon-blue);border-radius:14px;padding:34px 18px;text-align:center;cursor:pointer;background:rgba(79,168,255,.06);transition:.15s;margin-bottom:14px}
.imp-drop:hover,.imp-drop.over,.imp-drop:focus{background:rgba(79,168,255,.16);outline:none}
.imp-drop .big{font-size:18px;font-weight:800;color:var(--ink)}.imp-drop .sm{font-size:12.5px;color:var(--ink2);margin-top:6px}
#imp-log{display:flex;flex-direction:column;gap:6px;margin:10px 0 0}
.imp-log-l{font-size:12.5px;padding:8px 10px;border-radius:8px;background:var(--surface2);color:var(--ink2);border-left:3px solid var(--muted)}
.imp-log-l span{color:var(--muted);font-family:ui-monospace,monospace;margin-right:6px}
.imp-log-l.ok{border-left-color:var(--good)}.imp-log-l.err{border-left-color:var(--critical);color:var(--ink)}.imp-log-l.warn{border-left-color:var(--warning)}
.imp-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px}
.imp-chip{font-size:12px;padding:4px 9px;border-radius:999px;background:var(--surface2);border:1px solid var(--border);cursor:pointer}
.imp-chip:hover{border-color:var(--neon-blue)}
#pg-folhas details,#pg-folhas summary{font-size:13px}#pg-folhas summary{cursor:pointer;color:var(--neon-blue);margin:8px 0}
.nav-n{float:right;font-size:10.5px;background:var(--blue);color:#fff;border-radius:999px;padding:1px 7px;margin-left:6px}
#main{min-width:0}
.page .tablewrap{max-width:100%}
#pg-folhas .muted-box,#pg-historico .muted-box,#pg-comparativo .muted-box,#pg-anomalias .muted-box,#pg-previsoes .muted-box,#pg-importar .muted-box{font-size:13px;line-height:1.6}
@media print{.folhas-banner,.imp-drop,#imp-log{display:none!important}}
"""

NAV = """<button data-page="pg-importar" style="font-weight:700;color:var(--neon-blue)">📥 Importar Folhas</button>
  <button data-page="pg-folhas">🗓️ Folhas por Competência <span class="nav-n" id="nav-folhas-n"></span></button>"""

PAGES = """<section class="page" id="pg-importar">
    <h1>Importar Folhas</h1>
    <p class="sub">Carregue um ou vários arquivos de folha de uma vez (FOLHA MM-AAAA.xlsx, exportação com uma linha por rubrica). Cada arquivo vira uma competência; se a competência já existir, a versão nova substitui a anterior.</p>
    <div id="imp-drop" class="imp-drop" tabindex="0" role="button" aria-label="Selecionar arquivos de folha">
      <div class="big">📂 Arraste os arquivos de folha aqui ou clique para selecionar</div>
      <div class="sm">Pode selecionar vários .xlsx juntos (Ctrl/Shift + clique). A leitura é feita no seu navegador — nenhum arquivo é enviado para fora.</div>
      <input id="imp-file" type="file" accept=".xlsx,.xlsm,.xls" multiple hidden>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button id="imp-btn" class="dash-btn primary-imp" onclick="document.getElementById('imp-file').click()">📥 Selecionar arquivos de folha</button>
      <button class="dash-btn" onclick="gotoPage('pg-historico')">📈 Ver histórico</button><button class="dash-btn" onclick="gotoPage('pg-comparativo')">📅 Comparativo</button></div>
    <div id="imp-log"></div>
    <div class="card" style="margin-top:16px"><h2>Competências carregadas</h2><div id="imp-lista"></div>
      <p class="footnote">Formato esperado (aba Sheet1): Mês_Ano Folha, Estab, Código, Nome, Situação_Usual, Verba_Código, Verba_Título, Verba_Tipo, Verba_Valor, CCusto, CCusto_Titulo, Cargo_Título, Data de Admissão, Data Desligament, CPF. Totais: 2001 = bruto, 2002 = descontos, 2004 = salário; líquido = 2001 − 2002. Folhas "embutidas" valem para todos os usuários do portal; folhas importadas aqui ficam salvas neste navegador.</p></div>
  </section>
  <section class="page" id="pg-folhas">
    <h1>Folhas por Competência</h1>
    <p class="sub">Folha de cada mês carregado: totais, lojas, rubricas, funcionários e movimentação em relação ao mês anterior.</p>
    <div id="folhas-content"></div>
  </section>
  """

def troca(html, nome, ancora, bloco, antes=True, ultima=False):
    ini, fim = f'<!--RHF:{nome}-->', f'<!--/RHF:{nome}-->'
    html = re.sub(re.escape(ini) + '.*?' + re.escape(fim), '', html, flags=re.S)
    pos = html.rfind(ancora) if ultima else html.find(ancora)
    if pos < 0: sys.exit(f'âncora não encontrada para {nome}: {ancora!r}')
    if not antes: pos += len(ancora)
    return html[:pos] + ini + bloco + fim + html[pos:]

def main(index_path, js_path, b64_path):
    idx = open(index_path, encoding='utf-8').read()
    m = re.search(r'("rh":")([A-Za-z0-9+/=]+)(")', idx)
    if not m: sys.exit('MENC["rh"] não encontrado')
    rh = base64.b64decode(m.group(2)).decode('utf-8')
    js = open(js_path, encoding='utf-8').read().replace('__FOLHAS_EMB_GZ__', open(b64_path).read().strip())
    rh = troca(rh, 'css', '</head>', '<style>' + CSS + '</style>\n')
    rh = troca(rh, 'nav', '<div class="group-label">Dados</div>', NAV, antes=False)
    rh = troca(rh, 'pages', '<!-- ============ CENTRAL DE BASES ============ -->', PAGES)
    rh = troca(rh, 'bases', '<div class="card" id="qualidade-bases-card"></div>', '<div class="card" id="bases-folhas-card"></div>')
    rh = troca(rh, 'banner', '<div id="parecer-card"></div>', '<div id="folhas-banner"></div>')
    rh = rh.replace('Cada rodada do ETL grava um snapshot em <code>data/history/</code> — competência nunca sobrescreve outra.',
                    'Escolha quaisquer duas competências de folha carregadas — nenhuma competência sobrescreve outra.')
    rh = troca(rh, 'js', '</body>', '<script>\n' + js + '\n</script>\n', ultima=True)
    novo = base64.b64encode(rh.encode('utf-8')).decode()
    idx = idx[:m.start(2)] + novo + idx[m.end(2):]
    open(index_path, 'w', encoding='utf-8').write(idx)
    print(f'módulo rh: {len(rh):,} bytes · index.html: {len(idx):,} bytes')

if __name__ == '__main__':
    if len(sys.argv) != 4: sys.exit(__doc__)
    main(*sys.argv[1:])
