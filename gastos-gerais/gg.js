(function(){
'use strict';
var SBU = 'https://rdztzurfesnobfkazgpm.supabase.co';
var SBK = 'sb_publishable_4LHSO4TrP7F4m4tpJyH44g_BGmfC92h';
// Tipos de despesa do módulo Obras & Reformas (mesmos nomes da tela de Obras)
var CAT = {mao_de_obra_prestador:'Mão de obra', materiais_insumos:'Materiais e insumos', transporte_combustivel:'Combustível / transporte',
  alimentacao:'Alimentação', hospedagem:'Hospedagem', estacionamento:'Estacionamento', frete:'Frete',
  equipamento_manutencao:'Equipamentos / manutenção', taxas:'Taxas', diversos:'Diversos'};
var CAT_COR = {'Mão de obra':'#c2410c','Materiais e insumos':'#ea580c','Combustível / transporte':'#f59e0b','Alimentação':'#eab308',
  'Hospedagem':'#a16207','Estacionamento':'#d97706','Frete':'#fb923c','Equipamentos / manutenção':'#9a3412','Taxas':'#78350f','Diversos':'#fdba74'};
var MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
var MESL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

var OB = null, OB_ERR = '', OB_EM = null, CARREGANDO = false, LIM = 200, ULT = null;

function fR(v){ return 'R$ ' + Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fK(v){ var a = Math.abs(v||0); if (a >= 1e6) return 'R$ ' + (v/1e6).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' mi';
  if (a >= 1e3) return 'R$ ' + (v/1e3).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}) + ' mil'; return fR(v); }
function fP(v){ return Number(v||0).toFixed(1).replace('.', ',') + '%'; }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function norm(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); }
function iso(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function fD(s){ var p = String(s||'').split('-'); return p.length === 3 ? p[2]+'/'+p[1]+'/'+p[0] : (s||''); }
function fM(ym){ return MES[+ym.slice(5,7)-1] + '/' + ym.slice(2,4); }
function V(id){ var e = document.getElementById(id); return e && e.value ? String(e.value).trim() : ''; }
function soma(a, k){ return a.reduce(function(s, r){ return s + (r[k]||0); }, 0); }

// ── Login do Portal (mesma sessão do navegador) ──
function token(){
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (/^sb-.*-auth-token$/.test(k)) { var j = JSON.parse(localStorage.getItem(k)); var t = j && (j.access_token || (j.currentSession && j.currentSession.access_token)); if (t) return t; }
    }
  } catch(e) {}
  var ws = [window, window.parent, window.top];
  for (var w = 0; w < ws.length; w++) { try { var s = ws[w].__PORTAL_SESSION; if (s && s.access_token) return s.access_token; } catch(e) {} }
  return null;
}

// ── Obras & Reformas: despesas lançadas (mesmo critério da tela de Obras) ──
function carregarObras(){
  var tk = token(), rows = [], PAGE = 1000;
  var h = {apikey: SBK, Authorization: 'Bearer ' + (tk || SBK), 'Range-Unit': 'items'};
  var url = SBU + '/rest/v1/obras_despesas_pagamento?select=id,data_despesa,fornecedor,prestador,categoria,descricao,valor,obra,situacao,forma_pagamento&status=eq.lancado&order=data_despesa.desc.nullslast,id';
  function pagina(de){
    h.Range = de + '-' + (de + PAGE - 1);
    return fetch(url, {headers: h}).then(function(r){
      if (!r.ok) return r.text().then(function(t){ throw new Error('Obras: ' + r.status + ' ' + t.slice(0,140)); });
      return r.json();
    }).then(function(d){ rows = rows.concat(d); return d.length === PAGE ? pagina(de + PAGE) : rows; });
  }
  return pagina(0).then(function(all){
    return all.filter(function(r){ return r.situacao !== 'recusado' && r.data_despesa && Number(r.valor) > 0; });
  });
}

window.ggCarregar = function(forcar){
  if (CARREGANDO) return;
  if (OB && !forcar) { ggRender(); return; }
  CARREGANDO = true; OB_ERR = '';
  ggRender();
  carregarObras().then(function(d){ OB = d; OB_EM = new Date(); }).catch(function(e){ OB_ERR = e.message || String(e); if (!OB) OB = []; })
    .then(function(){ CARREGANDO = false; montarLojas(); ggRender(); });
};

// ── Lojas: a obra vinculada vira a loja; casa com o destino dos pedidos quando o nome bate ──
var STOP = {loja:1, de:1, do:1, da:1, das:1, dos:1, e:1, obras:1, reformas:1, shopping:0};
function destinos(){ var m = {}; comprasBase().forEach(function(r){ if (r.loja) m[r.loja] = 1; }); return Object.keys(m); }
var MAPA = {};
function lojaDaObra(obra){
  var n = String(obra || '').replace(/^Obras\/Reformas\s*[—-]\s*/i, '').trim();
  if (!n) return 'Obra sem loja';
  if (MAPA[n]) return MAPA[n];
  var ds = destinos(), alvo = null;
  if (/^cd\b/i.test(norm(n))) alvo = ds.filter(function(d){ return /^\d+\s*-\s*cd\b/.test(norm(d)); })[0] || null;
  if (!alvo && !/^hist/i.test(norm(n))) {
    var base = n.replace(/^Loja\s+/i, '').replace(/\(.*?\)/g, ' ');
    var tk = norm(base).split(/[^a-z0-9]+/).filter(function(t){ return t.length > 2 && !STOP[t]; });
    if (tk.length) {
      var cand = ds.filter(function(d){ var nd = norm(d); return tk.every(function(t){ return nd.indexOf(t) >= 0; }); })
        .sort(function(a, b){ return a.length - b.length; });
      alvo = cand[0] || null;
    }
  }
  return (MAPA[n] = alvo || n.replace(/^Loja\s+/i, ''));
}

function comprasBase(){
  var src = [];
  try { src = (typeof RAW !== 'undefined' && Array.isArray(RAW)) ? RAW : []; } catch(e) {}
  return src.filter(function(r){ return r && r.d; }).map(function(r){
    var dest = String(r.dest || '').trim();
    return {o:'C', d:String(r.d).slice(0,10), f:r.f || '', loja:(!dest || /^n[aã]o informado$/i.test(dest)) ? 'Não informado' : dest,
      tipo:r.cat || 'Sem categoria', desc:r.desc || '', v:+r.od || 0, ec:+r.ec || 0, ar:r.ar || '', p:r.p || ''};
  });
}
function obrasBase(){
  return (OB || []).map(function(r){
    return {o:'O', d:String(r.data_despesa).slice(0,10), f:r.fornecedor || r.prestador || '', loja:lojaDaObra(r.obra), obra:r.obra || '',
      tipo:CAT[r.categoria] || 'Sem categoria', desc:r.descricao || '', v:+r.valor || 0, ec:0, prest:r.prestador || '', fp:r.forma_pagamento || ''};
  });
}

function montarLojas(){
  var sel = document.getElementById('ggLoja'); if (!sel) return;
  var atual = sel.value, m = {};
  comprasBase().concat(obrasBase()).forEach(function(r){ m[r.loja] = (m[r.loja] || 0) + r.v; });
  var ks = Object.keys(m).sort(function(a, b){ return a.localeCompare(b, 'pt-BR', {numeric:true}); });
  sel.innerHTML = '<option value="">Todas</option>' + ks.map(function(k){ return '<option value="' + esc(k) + '">' + esc(k) + '</option>'; }).join('');
  if (atual && m[atual] != null) sel.value = atual;
}

// ── Período ──
window.ggSetPer = function(v){
  var hoje = new Date(), de = '', ate = '';
  if (v === 'painel') { de = V('fFrom'); ate = V('fTo'); }
  else if (v === 'mes') { de = iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)); ate = iso(hoje); }
  else if (v === '3m' || v === '6m') { de = iso(new Date(hoje.getFullYear(), hoje.getMonth() - (v === '3m' ? 2 : 5), 1)); ate = iso(hoje); }
  else if (v === 'ano') { de = hoje.getFullYear() + '-01-01'; ate = iso(hoje); }
  else if (v === 'livre') { ggRender(); return; }
  document.getElementById('ggDe').value = de; document.getElementById('ggAte').value = ate;
  ggRender();
};
window.ggLivre = function(){ document.getElementById('ggPer').value = 'livre'; ggRender(); };

function dados(){
  var de = V('ggDe'), ate = V('ggAte'), loja = V('ggLoja'), orig = V('ggOrig');
  var all = comprasBase().concat(obrasBase());
  var rows = all.filter(function(r){
    if (de && r.d < de) return false;
    if (ate && r.d > ate) return false;
    if (loja && r.loja !== loja) return false;
    if (orig && r.o !== orig) return false;
    return true;
  });
  var ks = rows.map(function(r){ return r.d.slice(0,7); }).sort();
  var a = de ? de.slice(0,7) : ks[0], b = ate ? ate.slice(0,7) : ks[ks.length-1];
  var hojeYM = iso(new Date()).slice(0,7);
  if (b && b > hojeYM && (!ks.length || ks[ks.length-1] <= hojeYM)) b = hojeYM;
  if (a && ks.length && a < ks[0] && !de) a = ks[0];
  var ms = [];
  if (a && b) { var y = +a.slice(0,4), m = +a.slice(5,7); for (var g = 0; g < 240; g++) { var k = y + '-' + String(m).padStart(2,'0'); if (k > b) break; ms.push(k); m++; if (m > 12) { m = 1; y++; } } }
  return {rows:rows, ms:ms, de:de, ate:ate, loja:loja, orig:orig};
}

function grp(rows, fn){
  var m = {};
  rows.forEach(function(r){ var k = fn(r); var g = m[k] || (m[k] = {k:k, c:0, o:0, t:0, n:0, nc:0, no:0, ec:0}); if (r.o === 'C') { g.c += r.v; g.nc++; g.ec += r.ec; } else { g.o += r.v; g.no++; } g.t += r.v; g.n++; });
  return Object.keys(m).map(function(k){ return m[k]; });
}

function svgMeses(M){
  var W = 1200, H = 210, pL = 60, pR = 10, pT = 22, pB = 40, n = M.length; if (!n) return '';
  var max = Math.max.apply(null, M.map(function(m){ return m.c + m.o; })) || 1;
  var p10 = Math.pow(10, Math.floor(Math.log10(max))); max = Math.ceil(max / p10 * 1.12) * p10;
  var cw = (W - pL - pR) / n, bw = Math.min(56, cw * 0.62), ih = H - pT - pB;
  var y = function(v){ return pT + ih - v / max * ih; };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" font-family="Nunito Sans,sans-serif">';
  for (var t = 0; t <= 4; t++) { var v = max * t / 4, yy = y(v); s += '<line x1="' + pL + '" x2="' + (W - pR) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="#eef2f7"/><text x="' + (pL - 7) + '" y="' + (yy + 4).toFixed(1) + '" fill="#94a3b8" font-size="10.5" text-anchor="end">' + fK(v).replace('R$ ', '') + '</text>'; }
  var step = Math.max(1, Math.ceil(n / 24));
  M.forEach(function(m, i){
    var x = pL + i * cw + (cw - bw) / 2, yc = y(m.c), yo = y(m.c + m.o);
    s += '<rect x="' + x.toFixed(1) + '" y="' + yc.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, y(0) - yc).toFixed(1) + '" fill="#2c4fa3"><title>' + fM(m.k) + ' — Compras ' + fR(m.c) + '</title></rect>';
    s += '<rect x="' + x.toFixed(1) + '" y="' + yo.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, yc - yo).toFixed(1) + '" fill="#ea580c"><title>' + fM(m.k) + ' — Obras ' + fR(m.o) + '</title></rect>';
    if (m.c + m.o > 0 && cw >= 34) s += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (yo - 5).toFixed(1) + '" fill="#0f172a" font-size="10.5" font-weight="800" text-anchor="middle">' + fK(m.c + m.o).replace('R$ ', '') + '</text>';
    if (i % step === 0 || i === n - 1) s += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - pB + 15) + '" fill="#334155" font-size="11" font-weight="800" text-anchor="middle">' + fM(m.k) + '</text>'
      + (m.o > 0 && cw >= 34 ? '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - pB + 29) + '" fill="#c2410c" font-size="9.5" font-weight="800" text-anchor="middle">obras ' + fK(m.o).replace('R$ ', '') + '</text>' : '');
  });
  return s + '</svg>';
}

window.ggRender = function(){
  var doc = document.getElementById('ggDoc'); if (!doc) return;
  var D = dados(), R = D.rows, now = new Date();
  var logo = (document.querySelector('.logo-img-wrap img, header img, .header img') || {}).src || '';
  var per = D.de || D.ate ? (D.de ? fD(D.de) : 'início') + ' a ' + (D.ate ? fD(D.ate) : 'hoje') : 'Todos os períodos';
  var head = '<div class="gg-head">' + (logo ? '<img src="' + logo + '" alt="Esposende"><div class="hb"></div>' : '')
    + '<div><h1>Gastos Gerais — Compras + Obras & Reformas</h1><p>Pedidos de compra e despesas de obras numa visão só · por loja e por tipo de despesa</p></div>'
    + '<div class="per"><b>' + esc(per) + '</b>' + (D.loja ? '<span style="display:block;color:#fde68a">Loja: ' + esc(D.loja) + '</span>' : '')
    + (D.orig ? '<span style="display:block;color:#fde68a">' + (D.orig === 'C' ? 'Só compras' : 'Só obras') + '</span>' : '')
    + '<span>Gerado em ' + now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) + '</span></div></div>';
  var avisos = '';
  if (CARREGANDO) avisos += '<div class="gg-warn gg-noprint">⏳ Buscando as despesas de Obras & Reformas…</div>';
  if (OB_ERR) avisos += '<div class="gg-warn">⚠️ Não foi possível ler as despesas de Obras agora (' + esc(OB_ERR) + '). Os valores abaixo estão só com os pedidos de compra. Clique em “Atualizar obras” para tentar de novo.</div>';
  if (!R.length) { doc.innerHTML = head + '<div class="gg-body">' + avisos + '<div class="gg-msg">Nenhum gasto no período e filtros escolhidos.</div></div>'; ULT = null; return; }

  var C = R.filter(function(r){ return r.o === 'C'; }), O = R.filter(function(r){ return r.o === 'O'; });
  var tC = soma(C, 'v'), tO = soma(O, 'v'), tT = tC + tO, tE = soma(C, 'ec');
  var LJ = grp(R, function(r){ return r.loja; }).sort(function(a, b){ return b.t - a.t; });
  var TO = grp(O, function(r){ return r.tipo; }).sort(function(a, b){ return b.t - a.t; });
  var TC = grp(C, function(r){ return r.tipo; }).sort(function(a, b){ return b.t - a.t; });
  var mm = {}; grp(R, function(r){ return r.d.slice(0,7); }).forEach(function(g){ mm[g.k] = g; });
  var M = D.ms.map(function(k){ var g = mm[k] || {c:0, o:0, t:0, n:0}; return {k:k, c:g.c, o:g.o, t:g.c + g.o, n:g.n}; });
  ULT = {R:R, LJ:LJ, TO:TO, TC:TC, M:M, tC:tC, tO:tO, tT:tT, per:per};

  var kp = [
    {c:'t', l:'Total geral', v:fR(tT), s:R.length + ' lançamentos'},
    {c:'c', l:'Compras (pedidos)', v:fR(tC), s:C.length + ' pedidos · ' + fP(tT ? tC / tT * 100 : 0)},
    {c:'o', l:'Obras & reformas', v:fR(tO), s:O.length + ' despesas · ' + fP(tT ? tO / tT * 100 : 0)},
    {c:'e', l:'Economia nas compras', v:fR(tE), s:'negociada nos pedidos'},
    {c:'', l:'Lojas com gasto', v:String(LJ.length), s:LJ.length ? 'maior: ' + LJ[0].k : ''},
    {c:'o', l:'Maior gasto de obra', v:TO.length ? TO[0].k : '—', s:TO.length ? fR(TO[0].t) + ' · ' + fP(tO ? TO[0].t / tO * 100 : 0) : 'sem despesas de obra'}
  ];
  var kpis = '<div class="gg-sec"><div class="gg-kpis">' + kp.map(function(k){ return '<div class="gg-k ' + k.c + '"><div class="l">' + k.l + '</div><div class="v" title="' + esc(k.v) + '">' + esc(k.v) + '</div><div class="s" title="' + esc(k.s) + '">' + esc(k.s) + '</div></div>'; }).join('') + '</div></div>';

  var mes = '<div class="gg-sec"><div class="gg-h">Gastos mês a mês <small>compras + obras, empilhado</small></div>'
    + '<div class="gg-leg"><span><i style="background:#2c4fa3"></i>Compras (pedidos)</span><span><i style="background:#ea580c"></i>Obras & reformas</span></div>'
    + '<div class="gg-chart">' + svgMeses(M) + '</div></div>';

  var maxL = LJ.length ? LJ[0].t || 1 : 1;
  var lojas = '<div class="gg-sec flow"><div class="gg-h">Gastos por loja <small>clique numa loja para filtrar · obras contam na loja da obra vinculada</small></div><div class="gg-scroll"><table class="gg-tbl"><thead><tr>'
    + '<th>Loja / destino</th><th>Compras</th><th>Obras</th><th>Total</th><th>% do total</th><th style="text-align:left">Composição</th></tr></thead><tbody>'
    + LJ.map(function(g){
        return '<tr class="click" onclick="ggFiltraLoja(' + esc(JSON.stringify(g.k)) + ')"><td class="l" title="' + esc(g.k) + '"><b>' + esc(g.k) + '</b></td>'
          + '<td class="' + (g.c ? 'c' : 'z') + '">' + (g.c ? fR(g.c) : '—') + '</td><td class="' + (g.o ? 'o' : 'z') + '">' + (g.o ? fR(g.o) : '—') + '</td>'
          + '<td class="t">' + fR(g.t) + '</td><td>' + fP(tT ? g.t / tT * 100 : 0) + '</td>'
          + '<td><div class="gg-bar2" style="width:' + Math.max(4, g.t / maxL * 100).toFixed(1) + '%"><i class="c" style="width:' + (g.t ? g.c / g.t * 100 : 0).toFixed(1) + '%"></i><i class="o" style="width:' + (g.t ? g.o / g.t * 100 : 0).toFixed(1) + '%"></i></div></td></tr>';
      }).join('')
    + '<tr class="tot"><td class="l">TOTAL — ' + LJ.length + ' lojas</td><td>' + fR(tC) + '</td><td>' + fR(tO) + '</td><td>' + fR(tT) + '</td><td>100%</td><td></td></tr></tbody></table></div></div>';

  function rk(list, tot, cor){
    var mx = list.length ? list[0].t || 1 : 1;
    return '<div class="gg-rk">' + list.map(function(g){
      return '<div class="r"><span class="n" title="' + esc(g.k) + '">' + esc(g.k) + ' <small style="color:#94a3b8">(' + g.n + ')</small></span><span class="tk"><i style="width:' + Math.max(1, g.t / mx * 100).toFixed(1) + '%;background:' + (typeof cor === 'function' ? cor(g.k) : cor) + '"></i></span>'
        + '<span class="v">' + fR(g.t) + '</span><span class="p">' + fP(tot ? g.t / tot * 100 : 0) + '</span></div>';
    }).join('') + '</div>';
  }
  var tipos = '<div class="gg-sec"><div class="gg-2">'
    + '<div><div class="gg-h">Obras & reformas por tipo de despesa <small>' + fR(tO) + '</small></div>' + (TO.length ? rk(TO, tO, function(k){ return CAT_COR[k] || '#ea580c'; }) : '<div class="gg-note">Sem despesas de obra no período.</div>') + '</div>'
    + '<div><div class="gg-h">Compras por categoria <small>' + fR(tC) + '</small></div>' + (TC.length ? rk(TC.slice(0, 12), tC, '#2c4fa3') + (TC.length > 12 ? '<div class="gg-note">+ ' + (TC.length - 12) + ' categorias menores (' + fR(TC.slice(12).reduce(function(s, g){ return s + g.t; }, 0)) + ')</div>' : '') : '<div class="gg-note">Sem pedidos de compra no período.</div>') + '</div>'
    + '</div></div>';

  // Obras: loja × tipo de despesa
  var mx = '';
  if (O.length) {
    var tps = TO.map(function(g){ return g.k; }), LO = grp(O, function(r){ return r.loja; }).sort(function(a, b){ return b.t - a.t; }), cel = {};
    O.forEach(function(r){ var k = r.loja + '|' + r.tipo; cel[k] = (cel[k] || 0) + r.v; });
    mx = '<div class="gg-sec flow"><div class="gg-h">Obras & reformas — cada loja por tipo de despesa <small>valores em R$</small></div><div class="gg-scroll"><table class="gg-tbl gg-mx"><thead><tr><th>Loja</th>'
      + tps.map(function(t){ return '<th>' + esc(t) + '</th>'; }).join('') + '<th>Total obras</th></tr></thead><tbody>'
      + LO.map(function(g){ return '<tr class="click" onclick="ggFiltraLoja(' + esc(JSON.stringify(g.k)) + ')"><td class="l"><b>' + esc(g.k) + '</b></td>' + tps.map(function(t){ var v = cel[g.k + '|' + t] || 0; return v ? '<td>' + fK(v).replace('R$ ', '') + '</td>' : '<td class="z">—</td>'; }).join('') + '<td class="o">' + fR(g.t) + '</td></tr>'; }).join('')
      + '<tr class="tot"><td class="l">TOTAL</td>' + TO.map(function(g){ return '<td>' + fK(g.t).replace('R$ ', '') + '</td>'; }).join('') + '<td>' + fR(tO) + '</td></tr></tbody></table></div></div>';
  }

  // Mês a mês em tabela
  var mt = '<div class="gg-sec flow"><div class="gg-h">Detalhamento mensal</div><div class="gg-scroll"><table class="gg-tbl"><thead><tr><th>Mês</th><th>Compras</th><th>Obras</th><th>Total</th><th>Lançamentos</th></tr></thead><tbody>'
    + M.map(function(m){ return '<tr><td class="l"><b>' + MESL[+m.k.slice(5,7)-1] + '/' + m.k.slice(0,4) + '</b></td><td class="c">' + fR(m.c) + '</td><td class="o">' + fR(m.o) + '</td><td class="t">' + fR(m.t) + '</td><td>' + m.n + '</td></tr>'; }).join('')
    + '<tr class="tot"><td class="l">TOTAL</td><td>' + fR(tC) + '</td><td>' + fR(tO) + '</td><td>' + fR(tT) + '</td><td>' + R.length + '</td></tr></tbody></table></div></div>';

  // Lista completa
  var L = R.slice().sort(function(a, b){ return a.d < b.d ? 1 : a.d > b.d ? -1 : b.v - a.v; });
  var printAll = document.getElementById('ggLista') && document.getElementById('ggLista').checked;
  var lin = function(r){ return '<tr><td class="l">' + fD(r.d) + '</td><td class="l"><span class="gg-badge ' + (r.o === 'C' ? 'c">COMPRA' : 'o">OBRA') + '</span></td><td class="l" title="' + esc(r.loja) + '">' + esc(r.loja) + '</td><td class="l" title="' + esc(r.tipo) + '">' + esc(r.tipo) + '</td><td class="l" title="' + esc(r.f) + '">' + esc(r.f) + '</td><td class="l" title="' + esc(r.desc) + '" style="max-width:300px">' + esc(r.desc) + '</td><td class="t">' + fR(r.v) + '</td></tr>'; };
  var lista = '<div class="gg-sec flow' + (printAll ? '' : ' gg-noprint') + '"><div class="gg-h">Todos os lançamentos <small>' + L.length + ' · mais recentes primeiro</small></div><div class="gg-scroll"><table class="gg-tbl"><thead><tr><th>Data</th><th>Origem</th><th>Loja</th><th>Tipo de despesa</th><th>Fornecedor / prestador</th><th>Descrição</th><th>Valor</th></tr></thead><tbody id="ggListaBody">'
    + L.slice(0, LIM).map(lin).join('') + '</tbody></table></div>'
    + (L.length > LIM ? '<div class="gg-more"><button onclick="ggTodos()">Mostrar todos os ' + L.length + ' lançamentos</button></div>' : '') + '</div>';
  ULT.lin = lin; ULT.L = L;

  var nota = '<div class="gg-note">Compras = valor negociado dos pedidos (já com desconto). Obras = despesas lançadas no módulo Obras & Reformas (sem recusadas, duplicadas ou canceladas)'
    + (OB_EM ? ', lidas em ' + OB_EM.toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}) : '') + '.</div>';
  doc.innerHTML = head + '<div class="gg-body">' + avisos + kpis + mes + lojas + tipos + mx + mt + lista + nota + '</div><div class="gg-foot">Compras / Auditoria</div>';
};

window.ggTodos = function(){
  if (!ULT) return; LIM = 1e9;
  document.getElementById('ggListaBody').innerHTML = ULT.L.map(ULT.lin).join('');
  var b = document.querySelector('.gg-more'); if (b) b.remove();
};
window.ggFiltraLoja = function(k){ var s = document.getElementById('ggLoja'); s.value = (s.value === k) ? '' : k; ggRender(); document.getElementById('ggOv').scrollTop = 0; };

window.ggAbrir = function(){
  var ov = document.getElementById('ggOv'); if (!ov) return;
  ov.classList.add('open'); document.body.classList.add('gg-open'); document.body.style.overflow = 'hidden';
  if (!V('ggDe') && !V('ggAte') && document.getElementById('ggPer').value === 'painel') ggSetPer('painel');
  montarLojas();
  ggCarregar(false);
};
window.ggFechar = function(){
  document.getElementById('ggOv').classList.remove('open'); document.body.classList.remove('gg-open'); document.body.style.overflow = '';
};
window.ggImprimir = function(){
  var lista = document.getElementById('ggLista').checked;
  if (lista && LIM < 1e9) { LIM = 1e9; }
  ggRender();
  setTimeout(function(){ window.focus(); window.print(); }, 80);
};
window.addEventListener('beforeprint', function(){ var ov = document.getElementById('ggOv'); if (ov && ov.classList.contains('open')) { document.body.classList.add('gg-open'); document.body.classList.remove('dir-open'); } });

window.ggExcel = function(){
  if (!ULT) { alert('Sem dados no período.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel indisponível nesta tela.'); return; }
  var r2 = function(v){ return Math.round(v * 100) / 100; }, wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ULT.LJ.map(function(g){ return {'Loja':g.k, 'Compras':r2(g.c), 'Obras':r2(g.o), 'Total':r2(g.t), '% do total':r2(ULT.tT ? g.t / ULT.tT * 100 : 0), 'Pedidos':g.nc, 'Despesas de obra':g.no}; })), 'Por loja');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ULT.TO.map(function(g){ return {'Origem':'Obras', 'Tipo de despesa':g.k, 'Valor':r2(g.t), 'Lançamentos':g.n}; })
    .concat(ULT.TC.map(function(g){ return {'Origem':'Compras', 'Tipo de despesa':g.k, 'Valor':r2(g.t), 'Lançamentos':g.n}; }))), 'Por tipo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ULT.M.map(function(m){ return {'Mês':fM(m.k), 'Compras':r2(m.c), 'Obras':r2(m.o), 'Total':r2(m.t), 'Lançamentos':m.n}; })), 'Mês a mês');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ULT.L.map(function(r){ return {'Data':fD(r.d), 'Origem':r.o === 'C' ? 'Compra' : 'Obra', 'Loja':r.loja, 'Obra':r.obra || '', 'Tipo de despesa':r.tipo, 'Fornecedor / prestador':r.f, 'Prestador (obra)':r.prest || '', 'Pedido':r.p || '', 'Descrição':r.desc, 'Valor':r2(r.v), 'Economia (compra)':r2(r.ec)}; })), 'Lançamentos');
  XLSX.writeFile(wb, 'Gastos_Gerais_Compras_Obras_' + iso(new Date()) + '.xlsx');
};

document.addEventListener('keydown', function(e){ var ov = document.getElementById('ggOv'); if (e.key === 'Escape' && ov && ov.classList.contains('open')) ggFechar(); });

function botao(){
  if (document.getElementById('btnGgPatch')) return true;
  var b = document.createElement('button'); b.id = 'btnGgPatch'; b.type = 'button'; b.className = 'btn btn-gg'; b.textContent = '🏗️ Gastos Gerais (Compras + Obras)'; b.onclick = ggAbrir;
  var host = document.querySelector('.header-right');
  if (host) { var ref = document.getElementById('btnDirPatch'); host.insertBefore(b, ref || host.firstChild); return true; }
  var fab = document.querySelector('.dir-fab');
  if (fab) { fab.insertBefore(b, fab.firstChild); return true; }
  return false;
}
if (!botao()) { var tent = 0, it = setInterval(function(){ if (botao() || ++tent > 20) clearInterval(it); }, 500); }
})();
