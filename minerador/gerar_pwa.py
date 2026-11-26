# -*- coding: utf-8 -*-
"""Gera o app de celular (PWA) minerador/index.html a partir do painel_template.html.
O app le os dados da edge function minerador-api (Supabase, projeto Mapa da mima)."""
import os

AQUI = os.path.dirname(os.path.abspath(__file__))
API = "https://tazyeczbbgspqbyluynf.supabase.co/functions/v1/minerador-api"

CABECA = """<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0f2a44">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Minerador">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-192.png">
<style>
.app-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.app-bar select{background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:6px 8px;font:inherit}
.app-bar select option{color:#1b2430}
.app-bar button{background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer}
#login{position:fixed;inset:0;background:var(--bg);display:none;align-items:center;justify-content:center;padding:20px;z-index:9}
#login .box{max-width:380px;width:100%}
#login input{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;font:inherit;margin:10px 0;background:var(--card);color:var(--txt)}
#offline{display:none;background:var(--warnbg);color:var(--warn);text-align:center;padding:6px;font-size:12.5px}
</style>
</head>"""

BARRA = """<p id="sub"></p>
  <div class="app-bar"><select id="selRodada"></select><button id="btnAtualizar">Atualizar</button><span id="atualizadoEm" style="font-size:12px;opacity:.8"></span></div>"""

LOGIN = """<div id="offline">Sem conexão — mostrando os últimos dados salvos.</div>
<div id="login"><div class="box"><h2>Minerador Meta Ads</h2>
<p style="color:var(--sub)">Digite a chave de acesso (enviada no seu e-mail). Ela fica salva neste aparelho.</p>
<input id="inChave" placeholder="mm-..." autocomplete="off"><button class="btn" id="btnEntrar" style="width:100%">Entrar</button>
<p id="loginErro" style="color:var(--warn)"></p></div></div>"""

BOOT = r"""
const API = '__API__';
let CHAVE = (location.hash.match(/chave=([^&]+)/) || [])[1];
if (CHAVE) { CHAVE = decodeURIComponent(CHAVE); try { localStorage.setItem('mm_chave', CHAVE); } catch (e) {} history.replaceState(null, '', location.pathname); }
else { try { CHAVE = localStorage.getItem('mm_chave'); } catch (e) {} }
let RODADAS = [], ULTIMA = null;
const nomeTipo = t => t === 'dores' ? 'Por DOR' : t === 'geral' ? 'Geral' : 'Palavra-chave';
function aplicarRodada(i) {
  const r = RODADAS[i]; if (!r) { D.linhas = []; D.anunciantes = []; D.gerado_em = ''; montar(); return; }
  D = Object.assign({min_anuncios: 40, max_dias: 45}, r.resumo || {}, {linhas: r.linhas || [], anunciantes: r.anunciantes || [], versao: r.versao});
  montar();
}
async function api(acao) {
  const r = await fetch(API + '?acao=' + acao, {headers: {'x-minerador-chave': CHAVE || ''}, cache: 'no-store'});
  if (r.status === 401) { try { localStorage.removeItem('mm_chave'); } catch (e) {} pedirChave('Chave inválida.'); throw new Error('401'); }
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}
async function carregarTudo() {
  try {
    const j = await api('painel');
    try { localStorage.setItem('mm_cache', JSON.stringify(j)); } catch (e) {}
    usar(j); $('offline').style.display = 'none';
  } catch (e) {
    if (e.message === '401') return;
    try { const c = JSON.parse(localStorage.getItem('mm_cache')); if (c) usar(c); } catch (e2) {}
    $('offline').style.display = '';
  }
}
function usar(j) {
  RODADAS = j.rodadas || [];
  const sel = $('selRodada'), atual = sel.value;
  sel.innerHTML = RODADAS.map((r, i) => `<option value="${i}">${nomeTipo(r.tipo)} · ${new Date(r.criado_em).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}</option>`).join('')
    || '<option>Nenhuma rodada ainda</option>';
  if (atual && RODADAS[+atual]) sel.value = atual;
  aplicarRodada(+sel.value || 0);
  ULTIMA = RODADAS[0] ? RODADAS[0].versao : null;
  if (j.status) mostrarStatus(j.status);
  $('atualizadoEm').textContent = 'atualizado ' + new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
}
function mostrarStatus(s) {
  if (s && s.dados && s.dados.versao) window.atualizarStatus(s.dados);
}
async function pollStatus() {
  if (!CHAVE || document.hidden) return;
  try {
    const s = await api('status'); mostrarStatus(s); $('offline').style.display = 'none';
    if (s.ultima_rodada && s.ultima_rodada !== ULTIMA) carregarTudo();
  } catch (e) { if (e.message !== '401') $('offline').style.display = ''; }
}
function pedirChave(msg) { $('login').style.display = 'flex'; $('loginErro').textContent = msg || ''; }
$('btnEntrar').onclick = () => { CHAVE = $('inChave').value.trim(); try { localStorage.setItem('mm_chave', CHAVE); } catch (e) {} $('login').style.display = 'none'; carregarTudo(); };
$('selRodada').onchange = () => aplicarRodada(+$('selRodada').value);
$('btnAtualizar').onclick = carregarTudo;
$('lvRecarregar').onclick = carregarTudo;
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollStatus(); });
montar();
if (!CHAVE) pedirChave(); else { carregarTudo(); }
setInterval(pollStatus, 6000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
"""


def gerar():
    t = open(os.path.join(AQUI, "painel_template.html"), encoding="utf-8").read()
    t = t.replace("__DADOS__", "null").replace("__AO_VIVO__", "false")
    t = t.replace("</head>", CABECA, 1)
    t = t.replace('<p id="sub"></p>', BARRA, 1)
    t = t.replace("<body>", "<body>\n" + LOGIN, 1)
    ini, fim = t.index("/*BOOT*/"), t.index("/*FIMBOOT*/") + len("/*FIMBOOT*/")
    t = t[:ini] + BOOT.replace("__API__", API) + t[fim:]
    # o botao "Ver resultados" no app recarrega pela API (sem location.reload)
    t = t.replace("$('lvRecarregar').onclick = () => location.reload();", "")
    t = t.replace("st.versao !== D.versao", "st.versao !== ULTIMA")
    with open(os.path.join(AQUI, "index.html"), "w", encoding="utf-8") as f:
        f.write(t)
    print("ok: minerador/index.html")


if __name__ == "__main__":
    gerar()
