/* Casamento de Saci — "Saci na Rede" (conta oficial) — __VER__
 *
 *   Pé Direito + Pé Esquerdo + Enviados 2026 = Saci na Rede (pés reais aguardando par)
 *   Casados = pares já resolvidos (10.217 pares = 20.434 pés) — histórico, NÃO sai da conta.
 *
 * O módulo Casamento de Saci (iframe ifr-saci, arquivo do Portal no Supabase Storage) ganha:
 *  - bloco "Saci na Rede — Conta Oficial" no topo (Direito + Esquerdo + Enviados = Saci na Rede, em pés,
 *    custo e venda; Casados à parte), por marca e por loja de origem dos Enviados;
 *  - os cartões do Resumo Geral passam a mostrar essa conta (Saci na Rede, Casados, Total recebido, custos, taxa);
 *  - exportação Excel da conta;
 *  - ao carregar um D1.xlsx novo (no botão do bloco ou no upload normal do módulo) a conta é refeita e
 *    gravada no Supabase (portal_sync, module_id "saci_rede") para todos os usuários.
 * Base inicial embutida: D1.xlsx de __DATA__ (só totais por aba, marca e loja — sem dados pessoais).
 * Fonte: repositório sistema-de-auditoria, pasta saci/ (gerado por saci/gerar_patch.js).
 * Uso no index.html do Portal:
 *   inserirAntesDoFimDoBody(html,'<scr'+'ipt src="'+new URL('saci-rede-patch.js?v=__VER__',location.href).href+'"></scr'+'ipt>');
 */
__RESUMO__
(function () {
  if (window.__saciRedePatch) return;
  window.__saciRedePatch = '__VER__';
  var SR = window.SaciRede;
  var BASE = __BASE__;
  var LS_KEY = 'saci_rede_v1';
  var MOD_ID = 'saci_rede';

  function fInt(v) { return Math.round(v || 0).toLocaleString('pt-BR'); }
  function fMoney(v) { return 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fMoney0(v) { return 'R$ ' + Math.round(v || 0).toLocaleString('pt-BR'); }
  function dataBase(R) { try { return new Date(R.geradoEm).toLocaleDateString('pt-BR'); } catch (e) { return ''; } }
  function fPct(v) { return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function quando(iso) { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso || ''; } }
  function maisNovo(a, b) { if (!a) return b; if (!b) return a; return new Date(b.geradoEm) > new Date(a.geradoEm) ? b : a; }

  var CSS = [
    '#saciRedeSec{margin-bottom:28px}',
    '#saciRedeSec .srflow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr auto 1.25fr auto 1.1fr;gap:8px;align-items:stretch}',
    '#saciRedeSec .srop{display:flex;align-items:center;justify-content:center;font:800 22px "JetBrains Mono",monospace;color:var(--tx3)}',
    '#saciRedeSec .src{background:linear-gradient(135deg,var(--bg2),var(--bg3));border:1px solid var(--b2);border-radius:12px;padding:12px 10px;text-align:center;min-width:0}',
    '#saciRedeSec .src .l{font-size:10px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}',
    '#saciRedeSec .src .q{font:800 26px "JetBrains Mono",monospace;line-height:1.05}',
    '#saciRedeSec .src .u{font-size:10px;color:var(--tx3);margin-top:2px}',
    '#saciRedeSec .src .m{font-size:11px;color:var(--tx2);margin-top:8px;line-height:1.5;font-family:"JetBrains Mono",monospace}',
    '#saciRedeSec .src.dir{border-top:2.5px solid #f472b6}#saciRedeSec .src.dir .q{color:#f472b6}',
    '#saciRedeSec .src.esq{border-top:2.5px solid var(--blu)}#saciRedeSec .src.esq .q{color:var(--blu)}',
    '#saciRedeSec .src.env{border-top:2.5px solid var(--amb)}#saciRedeSec .src.env .q{color:var(--amb)}',
    '#saciRedeSec .src.rede{border:1px solid var(--pbdr);border-top:3px solid var(--pur);background:linear-gradient(135deg,rgba(139,92,246,.10),var(--bg3))}#saciRedeSec .src.rede .q{color:var(--pur);font-size:30px}',
    '#saciRedeSec .src.cas{border-top:2.5px solid var(--grn)}#saciRedeSec .src.cas .q{color:var(--grn)}',
    '#saciRedeSec .src.sal{border:1px solid var(--rbdr);border-top:3px solid var(--red);background:linear-gradient(135deg,rgba(255,51,85,.10),var(--bg3))}#saciRedeSec .src.sal .q{color:var(--red);font-size:30px}',
    '#saciRedeSec .srbars{margin:14px 0 10px;display:grid;gap:8px}',
    '#saciRedeSec .srbar{display:flex;height:26px;border-radius:7px;overflow:hidden;background:var(--bg3);border:1px solid var(--b2)}',
    '#saciRedeSec .srbar div{display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;min-width:0}',
    '#saciRedeSec .srbl{font-size:10.5px;color:var(--tx3);margin-bottom:3px}',
    '#saciRedeSec .srchips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}',
    '#saciRedeSec .srchip{background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:7px 11px;font-size:11.5px;color:var(--tx2)}',
    '#saciRedeSec .srchip b{color:var(--tx1);font-family:"JetBrains Mono",monospace}',
    '#saciRedeSec .srchip.warn{border-color:var(--abdr);background:var(--abg);color:var(--amb)}',
    '#saciRedeSec .srgrid{display:grid;grid-template-columns:1.6fr 1fr;gap:12px}',
    '#saciRedeSec .srbox{background:var(--bg2);border:1px solid var(--b1);border-radius:10px;padding:12px;min-width:0}',
    '#saciRedeSec .srbox h3{font-size:12.5px;font-weight:800;margin:0 0 2px}',
    '#saciRedeSec .srbox .s{font-size:10.5px;color:var(--tx3);margin-bottom:8px}',
    '#saciRedeSec .srtw{overflow:auto;max-height:420px}',
    '#saciRedeSec table{width:100%;border-collapse:collapse;font-size:11.5px}',
    '#saciRedeSec th{position:sticky;top:0;background:var(--bg3);color:var(--tx3);font-weight:700;font-size:10px;text-transform:uppercase;padding:6px 7px;text-align:right;white-space:nowrap}',
    '#saciRedeSec th:first-child,#saciRedeSec td:first-child{text-align:left}',
    '#saciRedeSec td{padding:5px 7px;border-top:1px solid var(--b1);text-align:right;font-family:"JetBrains Mono",monospace;color:var(--tx2);white-space:nowrap}',
    '#saciRedeSec td:first-child{font-family:Inter,sans-serif;color:var(--tx1);font-weight:600}',
    '#saciRedeSec td.rd{color:var(--red);font-weight:700}#saciRedeSec td.gr{color:var(--grn)}#saciRedeSec td.pu{color:var(--pur);font-weight:700}',
    '#saciRedeSec tfoot td{border-top:1px solid var(--b3);font-weight:800;color:var(--tx1)}',
    '#saciRedeSec .srfonte{font-size:10.5px;color:var(--tx3);margin-top:10px}',
    '#saciRedeSec .srmais{margin-top:8px}',
    '@media(max-width:1100px){#saciRedeSec .srflow{grid-template-columns:1fr 1fr 1fr}#saciRedeSec .srop{display:none}#saciRedeSec .srgrid{grid-template-columns:1fr}}',
    '@media(max-width:600px){#saciRedeSec .srflow{grid-template-columns:1fr 1fr}#saciRedeSec .src .q{font-size:22px}}'
  ].join('\n');

  /* ---------- estado ---------- */
  function lerLocal(w) { try { var x = JSON.parse(w.localStorage.getItem(LS_KEY) || 'null'); return x && x.versao ? x : null; } catch (e) { return null; } }
  function gravarLocal(w, R) { try { w.localStorage.setItem(LS_KEY, JSON.stringify(R)); } catch (e) { } }
  function clienteSb(d) {
    var w = d.defaultView;
    if (w.__saciRedeSb !== undefined) return w.__saciRedeSb;
    try { var s = d.createElement('script'); s.textContent = 'try{window.__saciRedeSb=(typeof sb!=="undefined"&&sb)?sb:null}catch(e){window.__saciRedeSb=null}'; d.body.appendChild(s); s.remove(); } catch (e) { w.__saciRedeSb = null; }
    return w.__saciRedeSb || null;
  }
  /* Na nuvem, marcas/lojas vão como listas: o gatilho portal_sync_preserva_cargas mescla chaves de
     objetos (uma marca que sumiu no D1 novo ficaria presa), mas lista nova com dados substitui a antiga. */
  function paraNuvem(R) { var o = JSON.parse(JSON.stringify(R)); o.marcas = Object.keys(R.marcas).map(function (k) { return [k, R.marcas[k]]; }); o.lojas = Object.keys(R.lojas).map(function (k) { return [k, R.lojas[k]]; }); return o; }
  function deNuvem(P) { var o = JSON.parse(JSON.stringify(P)); ['marcas', 'lojas'].forEach(function (k) { if (Array.isArray(o[k])) { var m = {}; o[k].forEach(function (e) { m[e[0]] = e[1]; }); o[k] = m; } }); return o; }
  function puxarNuvem(d) {
    var c = clienteSb(d);
    if (!c) return Promise.resolve(null);
    return c.from('portal_sync').select('payload,updated_at').eq('module_id', MOD_ID).maybeSingle()
      .then(function (r) { return r && !r.error && r.data && r.data.payload && r.data.payload.versao ? deNuvem(r.data.payload) : null; }, function () { return null; });
  }
  function enviarNuvem(d, R) {
    var c = clienteSb(d);
    if (!c) return;
    c.from('portal_sync').upsert({ module_id: MOD_ID, payload: paraNuvem(R), updated_at: new Date().toISOString() }).then(function () { }, function () { });
  }
  function toast(d, msg, tipo) { var w = d.defaultView; if (typeof w.toast === 'function') try { w.toast(msg, tipo || 'g'); } catch (e) { } }

  /* ---------- cartões do Resumo Geral ---------- */
  function setTxt(d, id, t) { var e = d.getElementById(id); if (e && e.textContent !== t) e.textContent = t; }
  function setLbl(d, id, t) {
    var e = d.getElementById(id); if (!e) return;
    var card = e.closest('.hc,.kc'); var l = card && card.querySelector('.hl,.kl');
    if (l && l.textContent !== t) l.textContent = t;
    if (card && card.title !== t) card.title = t;
  }
  function aplicarCards(d) {
    var R = d.__saciRedeR; if (!R) return;
    var K = SR.conta(R), pos = ' · posição de ' + dataBase(R);
    setLbl(d, 'gTotalSaci', '🧦 Saci na Rede — aguardando par');
    setTxt(d, 'gTotalSaci', fInt(K.rede.q));
    setTxt(d, 'gTotalSaciBrk', 'Direito ' + fInt(R.D.q) + ' + Esquerdo ' + fInt(R.E.q) + ' + Enviados 2026 ' + fInt(R.ENV.q) + pos);
    setLbl(d, 'gTotalCasados', '✅ Pés Casados — Total');
    setTxt(d, 'gTotalCasados', fInt(K.casadosPes));
    setTxt(d, 'gTotalCasadosBrk', fInt(K.casadosPares) + ' pares já casados (aba Casados) · histórico, fora da conta' + pos);
    setLbl(d, 'gTotalRecebido', '📦 Total de Saci Recebido');
    setTxt(d, 'gTotalRecebido', fInt(K.recebido));
    setTxt(d, 'gTotalRecebidoBrk', 'Saci na Rede ' + fInt(K.rede.q) + ' + Pés Casados ' + fInt(K.casadosPes) + pos);
    // ordem: Saci na Rede → Casados → Total recebido
    var a = d.getElementById('gTotalSaci'), b = d.getElementById('gTotalCasados'), c = d.getElementById('gTotalRecebido');
    a = a && a.closest('.hc'); b = b && b.closest('.hc'); c = c && c.closest('.hc');
    if (a && b && c && a.parentNode === b.parentNode && b.parentNode === c.parentNode && (a.nextElementSibling !== b || b.nextElementSibling !== c)) {
      a.parentNode.insertBefore(a, a.parentNode.firstChild); a.parentNode.insertBefore(b, a.nextSibling); a.parentNode.insertBefore(c, b.nextSibling);
    }
    setLbl(d, 'd1kCusto', 'Custo Total Casado'); setTxt(d, 'd1kCusto', fMoney0(R.C.c));
    setLbl(d, 'd1kVenda', 'Venda Total Casado'); setTxt(d, 'd1kVenda', fMoney0(R.C.v));
    setLbl(d, 'd1kCustoSaci', 'Custo Total Saci na Rede'); setTxt(d, 'd1kCustoSaci', fMoney0(K.rede.c));
    setLbl(d, 'd1kVendaSaci', 'Venda Total Saci na Rede'); setTxt(d, 'd1kVendaSaci', fMoney0(K.rede.v));
    setLbl(d, 'd1kTaxa', 'Taxa de Casamento (pés casados ÷ total recebido)'); setTxt(d, 'd1kTaxa', fPct(K.taxa));
    setLbl(d, 'd1kDescarte', 'Descarte (fora da conta)'); setTxt(d, 'd1kDescarte', fInt(R.DESC.q));
    setTxt(d, 'd1kCustoDescarte', fMoney0(R.DESC.c));
    setTxt(d, 'd1kVendaDescarte', fMoney0(R.DESC.v));
  }

  /* ---------- tabelas ---------- */
  function linhasMarcas(R) {
    return Object.keys(R.marcas).map(function (m) {
      var x = R.marcas[m], rede = x.D + x.E + x.ENV;
      return { marca: m, D: x.D, E: x.E, ENV: x.ENV, rede: rede, C: x.C, cRede: x.cRede };
    }).sort(function (a, b) { return b.rede - a.rede || b.C - a.C; });
  }
  function linhasLojas(R) {
    return Object.keys(R.lojas).map(function (l) { var x = R.lojas[l]; return { loja: l, q: x.q, c: x.c, v: x.v, pct: R.ENV.q > 0 ? x.q / R.ENV.q * 100 : 0 }; })
      .sort(function (a, b) { return b.q - a.q; });
  }
  function nomeLoja(d, l) {
    var w = d.defaultView, reg = '';
    try { var m = w.REGIONAL_MAP; var k = typeof w.normCode === 'function' ? w.normCode(l) : l; if (m && m[k]) reg = m[k].regional || m[k].nome || (typeof m[k] === 'string' ? m[k] : ''); } catch (e) { }
    return 'Loja ' + l + (reg ? ' · ' + reg : '');
  }

  function render(d) {
    var R = d.__saciRedeR, sec = d.getElementById('saciRedeSec');
    if (!R || !sec) return;
    var K = SR.conta(R);
    function card(cls, lbl, o, un) {
      return '<div class="src ' + cls + '"><div class="l">' + lbl + '</div><div class="q">' + fInt(o.q) + '</div><div class="u">' + (un || 'pés') + '</div>' +
        '<div class="m">Custo ' + fMoney0(o.c) + '<br>Venda ' + fMoney0(o.v) + '</div></div>';
    }
    var tot = Math.max(K.rede.q, 1);
    function seg(q, cor, txt, base) { var p = q / (base || tot) * 100; return '<div style="width:' + p.toFixed(3) + '%;background:' + cor + '" title="' + esc(txt) + '">' + (p > 9 ? esc(txt) : '') + '</div>'; }
    var M = linhasMarcas(R), L = linhasLojas(R);
    var verTodas = !!d.__saciRedeTodas;
    var MV = verTodas ? M : M.slice(0, 15);
    var mHtml = MV.map(function (r) {
      return '<tr><td>' + esc(r.marca) + '</td><td>' + fInt(r.D) + '</td><td>' + fInt(r.E) + '</td><td>' + fInt(r.ENV) + '</td><td class="rd">' + fInt(r.rede) +
        '</td><td>' + fMoney(r.cRede) + '</td><td class="gr">' + fInt(r.C) + '</td></tr>';
    }).join('');
    var lHtml = L.map(function (r) {
      return '<tr><td>' + esc(nomeLoja(d, r.loja)) + '</td><td class="pu">' + fInt(r.q) + '</td><td>' + fMoney(r.c) + '</td><td>' + fPct(r.pct) + '</td></tr>';
    }).join('') + (R.envSemLoja.q ? '<tr><td>(Sem loja de origem)</td><td class="pu">' + fInt(R.envSemLoja.q) + '</td><td>' + fMoney(R.envSemLoja.c) + '</td><td>' + fPct(R.envSemLoja.q / Math.max(R.ENV.q, 1) * 100) + '</td></tr>' : '');
    var neg = R.cNeg && R.cNeg.linhas ? '<div class="srchip warn">⚠️ Casados: <b>' + fInt(R.cNeg.linhas) + '</b> linha(s) com valor negativo (custo ' + fMoney(R.cNeg.c) + ') — conferir estorno/devolução</div>' : '';

    sec.innerHTML =
      '<div class="sechd"><div><h2>🧮 Saci na Rede — Conta Oficial · posição de ' + esc(dataBase(R)) + '</h2>' +
      '<div class="shsub">Pé Direito + Pé Esquerdo + Enviados 2026 = <b>Saci na Rede</b> (pés reais que precisamos casar) · Casados é histórico, fica fora da conta</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap" class="no-print">' +
      '<button class="btn" data-sr="up">📤 Atualizar com novo D1.xlsx</button>' +
      '<button class="btn" data-sr="xls">📥 Excel da conta</button>' +
      '<input type="file" data-sr="file" accept=".xlsx,.xls" style="display:none"></div></div>' +
      '<div class="srflow">' +
      card('dir', '🟥 Pé Direito', R.D) + '<div class="srop">+</div>' +
      card('esq', '🟦 Pé Esquerdo', R.E) + '<div class="srop">+</div>' +
      card('env', '🚚 Enviados 2026', R.ENV) + '<div class="srop">=</div>' +
      card('sal', '🧦 Saci na Rede — a casar', K.rede) + '<div class="srop">|</div>' +
      card('cas', '✅ Já casados (histórico)', { q: K.casadosPes, c: R.C.c, v: R.C.v }, 'pés = ' + fInt(K.casadosPares) + ' pares') +
      '</div>' +
      '<div class="srbars"><div><div class="srbl">De onde vem o Saci na Rede (' + fInt(K.rede.q) + ' pés a casar)</div><div class="srbar">' +
      seg(R.D.q, '#db2777', 'Direito ' + fInt(R.D.q)) + seg(R.E.q, '#2563eb', 'Esquerdo ' + fInt(R.E.q)) + seg(R.ENV.q, '#d97706', 'Enviados 2026 ' + fInt(R.ENV.q)) + '</div></div>' +
      '<div><div class="srbl">Tudo que já entrou (' + fInt(K.recebido) + ' pés)</div><div class="srbar">' +
      seg(K.casadosPes, '#059669', 'Casados ' + fInt(K.casadosPes) + ' pés (' + fPct(K.taxa) + ')', K.recebido) + seg(K.rede.q, '#e11d48', 'Saci na Rede ' + fInt(K.rede.q) + ' (' + fPct(100 - K.taxa) + ')', K.recebido) + '</div></div></div>' +
      '<div class="srchips">' +
      '<div class="srchip">Taxa de casamento <b>' + fPct(K.taxa) + '</b> (pés casados ÷ total recebido)</div>' +
      '<div class="srchip">Descarte (fora da conta) <b>' + fInt(R.DESC.q) + '</b> pés · ' + fMoney(R.DESC.c) + '</div>' +
      '<div class="srchip">Código reaproveitado (fora da conta) <b>' + fInt(R.REAP.q) + '</b> pés · ' + fMoney(R.REAP.c) + '</div>' + neg +
      '</div>' +
      '<div class="srgrid">' +
      '<div class="srbox"><h3>🏷️ Saci na Rede por Marca</h3><div class="s">Ordenado pelo maior Saci na Rede · marca = primeira palavra da descrição</div><div class="srtw"><table>' +
      '<thead><tr><th>Marca</th><th>Direito</th><th>Esquerdo</th><th>Enviados</th><th>Saci na Rede</th><th>Custo</th><th>Casados (pares)</th></tr></thead><tbody>' + mHtml + '</tbody>' +
      '<tfoot><tr><td>Total (' + fInt(M.length) + ' marcas)</td><td>' + fInt(R.D.q) + '</td><td>' + fInt(R.E.q) + '</td><td>' + fInt(R.ENV.q) + '</td><td>' + fInt(K.rede.q) + '</td><td>' + fMoney(K.rede.c) + '</td><td>' + fInt(R.C.q) + '</td></tr></tfoot></table></div>' +
      (M.length > 15 ? '<button class="btn srmais" data-sr="todas">' + (verTodas ? '▲ Mostrar só as 15 maiores' : '▼ Ver todas as ' + M.length + ' marcas') + '</button>' : '') + '</div>' +
      '<div class="srbox"><h3>🚚 Enviados 2026 por Loja de Origem</h3><div class="s">Pés de saci enviados pelas lojas ao D1 em 2026</div><div class="srtw"><table>' +
      '<thead><tr><th>Loja</th><th>Pés</th><th>Custo</th><th>% enviados</th></tr></thead><tbody>' + (lHtml || '<tr><td colspan="4">Sem loja de origem na planilha</td></tr>') + '</tbody>' +
      '<tfoot><tr><td>Total (' + fInt(L.length) + ' lojas)</td><td>' + fInt(R.ENV.q) + '</td><td>' + fMoney(R.ENV.c) + '</td><td>100%</td></tr></tfoot></table></div></div>' +
      '</div>' +
      '<div class="srfonte">Fonte: ' + esc(R.arquivo || 'D1.xlsx') + ' · conta atualizada em ' + esc(quando(R.geradoEm)) +
      ' · Direito/Esquerdo: custo da linha e venda = Pdv unitário × qtd · Enviados: custo e venda unitários × qtde · Casados: Qtde = pares · linhas de "Total" do rodapé não entram.</div>';

    sec.querySelector('[data-sr="up"]').onclick = function () { sec.querySelector('[data-sr="file"]').click(); };
    sec.querySelector('[data-sr="file"]').onchange = function () { var f = this.files && this.files[0]; this.value = ''; if (f) lerArquivo(d, f, true); };
    sec.querySelector('[data-sr="xls"]').onclick = function () { exportarExcel(d); };
    var bt = sec.querySelector('[data-sr="todas"]');
    if (bt) bt.onclick = function () { d.__saciRedeTodas = !d.__saciRedeTodas; render(d); };
    aplicarCards(d);
  }

  function usar(d, R, origem) {
    var atual = d.__saciRedeR;
    if (atual && origem !== 'upload' && maisNovo(atual, R) === atual) return;
    d.__saciRedeR = R;
    render(d);
  }

  /* ---------- upload ---------- */
  function lerArquivo(d, file, avisarSeNaoFor) {
    var w = d.defaultView;
    if (!/\.xlsx?$/i.test(file.name) || !w.XLSX) return;
    var fr = new w.FileReader();
    fr.onload = function (ev) {
      try {
        var wb = w.XLSX.read(ev.target.result, { type: 'array' });
        var R = SR.resumirWorkbook(w.XLSX, wb, { arquivo: file.name });
        if (!R) { if (avisarSeNaoFor) toast(d, '⚠ "' + file.name + '" não tem as abas Direito/Esquerdo/Enviados 2026 e Casados', 'a'); return; }
        gravarLocal(w, R); enviarNuvem(d, R); usar(d, R, 'upload');
        var K = SR.conta(R);
        toast(d, '🧮 Saci na Rede atualizado: ' + fInt(K.rede.q) + ' pés a casar · ' + fInt(K.casadosPares) + ' pares já casados', 'g');
      } catch (e) { toast(d, 'Erro ao ler "' + file.name + '": ' + e.message, 'r'); }
    };
    fr.readAsArrayBuffer(file);
  }

  /* ---------- Excel ---------- */
  function exportarExcel(d) {
    var w = d.defaultView, R = d.__saciRedeR; if (!R || !w.XLSX) return;
    var K = SR.conta(R), X = w.XLSX, wb = X.utils.book_new();
    var conta = [['Saci na Rede — Conta Oficial', '', '', ''], ['Fonte: ' + (R.arquivo || 'D1.xlsx') + ' · ' + quando(R.geradoEm), '', '', ''], [],
      ['Item', 'Pés', 'Custo', 'Venda'],
      ['(+) Pé Direito', R.D.q, R.D.c, R.D.v], ['(+) Pé Esquerdo', R.E.q, R.E.c, R.E.v], ['(+) Enviados 2026', R.ENV.q, R.ENV.c, R.ENV.v],
      ['(=) Saci na Rede — pés a casar', K.rede.q, K.rede.c, K.rede.v], [],
      ['Já casados (histórico, fora da conta) — ' + K.casadosPares + ' pares', K.casadosPes, R.C.c, R.C.v],
      ['Total de saci recebido (Saci na Rede + pés casados)', K.recebido], ['Taxa de casamento (pés casados ÷ total recebido)', K.taxa / 100], [],
      ['Descarte (fora da conta)', R.DESC.q, R.DESC.c, R.DESC.v], ['Código reaproveitado (fora da conta)', R.REAP.q, R.REAP.c, R.REAP.v]];
    if (R.cNeg && R.cNeg.linhas) conta.push(['Casados com valor negativo (' + R.cNeg.linhas + ' linhas)', R.cNeg.q, R.cNeg.c, R.cNeg.v]);
    var s1 = X.utils.aoa_to_sheet(conta); s1['!cols'] = [{ wch: 42 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    X.utils.book_append_sheet(wb, s1, 'Conta');
    var m = [['Marca', 'Direito', 'Esquerdo', 'Enviados 2026', 'Saci na Rede (pés)', 'Custo Saci na Rede', 'Casados (pares)']].concat(linhasMarcas(R).map(function (r) { return [r.marca, r.D, r.E, r.ENV, r.rede, r.cRede, r.C]; }));
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(m), 'Por Marca');
    var l = [['Loja de origem', 'Pés enviados', 'Custo', 'Venda', '% dos enviados']].concat(linhasLojas(R).map(function (r) { return [r.loja, r.q, r.c, r.v, r.pct / 100]; }));
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(l), 'Enviados por Loja');
    X.writeFile(wb, 'Saci_na_Rede_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  /* ---------- instalação no módulo ---------- */
  function ehSaci(d) {
    return d.readyState !== 'loading' && d.getElementById('gTotalSaci') && d.getElementById('gTotalRecebido') && d.getElementById('finpUnified') && d.defaultView && d.defaultView.XLSX;
  }
  function instalar(d) {
    if (d.__saciRede || !ehSaci(d)) return;
    d.__saciRede = 1;
    var w = d.defaultView;
    var st = d.createElement('style'); st.setAttribute('data-saci-rede', '1'); st.textContent = CSS; d.head.appendChild(st);
    var hero = d.getElementById('gTotalSaci').closest('.section') || d.getElementById('gTotalSaci').parentNode;
    var sec = d.createElement('div'); sec.className = 'section'; sec.id = 'saciRedeSec';
    hero.parentNode.insertBefore(sec, hero);
    // recálculo do módulo → reaplica a conta oficial nos cartões
    if (typeof w.recomputeGrandTotals === 'function' && !w.recomputeGrandTotals.__sr) {
      var orig = w.recomputeGrandTotals;
      w.recomputeGrandTotals = function () { var r = orig.apply(this, arguments); try { aplicarCards(d); } catch (e) { } return r; };
      w.recomputeGrandTotals.__sr = 1;
    }
    // upload normal do módulo → também refaz a conta se o arquivo tiver as abas
    if (typeof w.handleFilesUnified === 'function' && !w.handleFilesUnified.__sr) {
      var origUp = w.handleFilesUnified;
      w.handleFilesUnified = function (fl) { try { Array.prototype.slice.call(fl || []).forEach(function (f) { lerArquivo(d, f, false); }); } catch (e) { } return origUp.apply(this, arguments); };
      w.handleFilesUnified.__sr = 1;
    }
    usar(d, maisNovo(BASE, lerLocal(w)), 'local');
    puxarNuvem(d).then(function (R) { if (R) { gravarLocal(w, maisNovo(lerLocal(w), R)); usar(d, R, 'nuvem'); } });
  }
  function docs(w, a, p) { if (p > 4) return a; try { if (w.document) a.push(w.document); } catch (e) { return a; } for (var i = 0; i < w.frames.length; i++) try { docs(w.frames[i], a, p + 1); } catch (e) { } return a; }
  function varrer() {
    docs(window, [], 0).forEach(function (d) {
      try { instalar(d); if (d.__saciRede) aplicarCards(d); } catch (e) { console.warn('[Portal] Saci na Rede:', e); }
    });
  }
  varrer(); setInterval(varrer, 1500);
})();
