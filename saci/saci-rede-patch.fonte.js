/* Casamento de Saci — "Saci na Rede" (conta oficial) — __VER__
 *
 *   Pé Direito + Pé Esquerdo + Enviados 2026 = Saci na Rede
 *   Saci na Rede − Casados = Saldo (pés ainda aguardando par)
 *
 * O módulo Casamento de Saci (iframe ifr-saci, arquivo do Portal no Supabase Storage) ganha:
 *  - bloco "Saci na Rede — Conta Oficial" no topo (Direito + Esquerdo + Enviados = Rede − Casados = Saldo,
 *    em pés, custo e venda), por marca e por loja de origem dos Enviados;
 *  - os cartões do Resumo Geral passam a mostrar essa conta (Saci na Rede, Casados, Saldo, custos, taxa);
 *  - botão "Apresentação" (3 páginas, pronta para a diretoria / PDF) e exportação Excel da conta;
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
  function fPct(v) { return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function quando(iso) { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso || ''; } }
  function maisNovo(a, b) { if (!a) return b; if (!b) return a; return new Date(b.geradoEm) > new Date(a.geradoEm) ? b : a; }

  var CSS = [
    '#saciRedeSec{margin-bottom:28px}',
    '#saciRedeSec .srflow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr auto 1.15fr auto 1fr auto 1.15fr;gap:8px;align-items:stretch}',
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
  function puxarNuvem(d) {
    var c = clienteSb(d);
    if (!c) return Promise.resolve(null);
    return c.from('portal_sync').select('payload,updated_at').eq('module_id', MOD_ID).maybeSingle()
      .then(function (r) { return r && !r.error && r.data && r.data.payload && r.data.payload.versao ? r.data.payload : null; }, function () { return null; });
  }
  function enviarNuvem(d, R) {
    var c = clienteSb(d);
    if (!c) return;
    c.from('portal_sync').upsert({ module_id: MOD_ID, payload: R, updated_at: new Date().toISOString() }).then(function () { }, function () { });
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
    var K = SR.conta(R);
    setLbl(d, 'gTotalRecebido', '📦 Saci na Rede');
    setTxt(d, 'gTotalRecebido', fInt(K.rede.q));
    setTxt(d, 'gTotalRecebidoBrk', 'Direito ' + fInt(R.D.q) + ' + Esquerdo ' + fInt(R.E.q) + ' + Enviados 2026 ' + fInt(R.ENV.q));
    setLbl(d, 'gTotalCasados', '✅ Pés Casados — Total');
    setTxt(d, 'gTotalCasados', fInt(R.C.q));
    setTxt(d, 'gTotalCasadosBrk', 'Fonte: aba Casados do D1.xlsx · ' + fPct(K.taxa) + ' da rede');
    setLbl(d, 'gTotalSaci', '🧦 Saldo de Saci — aguardando par');
    setTxt(d, 'gTotalSaci', fInt(K.saldo.q));
    setTxt(d, 'gTotalSaciBrk', 'Saci na Rede ' + fInt(K.rede.q) + ' − Casados ' + fInt(R.C.q));
    // ordem lógica: Rede → Casados → Saldo
    var a = d.getElementById('gTotalRecebido'), b = d.getElementById('gTotalCasados'), c = d.getElementById('gTotalSaci');
    a = a && a.closest('.hc'); b = b && b.closest('.hc'); c = c && c.closest('.hc');
    if (a && b && c && a.parentNode === b.parentNode && b.parentNode === c.parentNode && (a.nextElementSibling !== b || b.nextElementSibling !== c)) {
      a.parentNode.insertBefore(a, a.parentNode.firstChild); a.parentNode.insertBefore(b, a.nextSibling); a.parentNode.insertBefore(c, b.nextSibling);
    }
    setLbl(d, 'd1kCusto', 'Custo Total Casado'); setTxt(d, 'd1kCusto', fMoney(R.C.c));
    setLbl(d, 'd1kVenda', 'Venda Total Casado'); setTxt(d, 'd1kVenda', fMoney(R.C.v));
    setLbl(d, 'd1kCustoSaci', 'Custo do Saldo de Saci'); setTxt(d, 'd1kCustoSaci', fMoney(K.saldo.c));
    setLbl(d, 'd1kVendaSaci', 'Venda do Saldo de Saci'); setTxt(d, 'd1kVendaSaci', fMoney(K.saldo.v));
    setLbl(d, 'd1kTaxa', 'Taxa de Casamento (Casados ÷ Rede)'); setTxt(d, 'd1kTaxa', fPct(K.taxa));
    setLbl(d, 'd1kDescarte', 'Descarte (fora da conta)'); setTxt(d, 'd1kDescarte', fInt(R.DESC.q));
    setTxt(d, 'd1kCustoDescarte', fMoney(R.DESC.c));
    setTxt(d, 'd1kVendaDescarte', fMoney(R.DESC.v));
  }

  /* ---------- tabelas ---------- */
  function linhasMarcas(R) {
    return Object.keys(R.marcas).map(function (m) {
      var x = R.marcas[m], rede = x.D + x.E + x.ENV;
      return { marca: m, D: x.D, E: x.E, ENV: x.ENV, rede: rede, C: x.C, saldo: rede - x.C, taxa: rede > 0 ? x.C / rede * 100 : 0 };
    }).sort(function (a, b) { return b.saldo - a.saldo || b.rede - a.rede; });
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
    function card(cls, lbl, o, extra) {
      return '<div class="src ' + cls + '"><div class="l">' + lbl + '</div><div class="q">' + fInt(o.q) + '</div><div class="u">pés</div>' +
        '<div class="m">Custo ' + fMoney(o.c) + '<br>Venda ' + fMoney(o.v) + '</div>' + (extra || '') + '</div>';
    }
    var tot = Math.max(K.rede.q, 1);
    function seg(q, cor, txt) { var p = q / tot * 100; return '<div style="width:' + p.toFixed(3) + '%;background:' + cor + '" title="' + esc(txt) + '">' + (p > 9 ? esc(txt) : '') + '</div>'; }
    var M = linhasMarcas(R), L = linhasLojas(R);
    var verTodas = !!d.__saciRedeTodas;
    var MV = verTodas ? M : M.slice(0, 15);
    var mHtml = MV.map(function (r) {
      return '<tr><td>' + esc(r.marca) + '</td><td>' + fInt(r.D) + '</td><td>' + fInt(r.E) + '</td><td>' + fInt(r.ENV) + '</td><td class="pu">' + fInt(r.rede) +
        '</td><td class="gr">' + fInt(r.C) + '</td><td class="rd">' + fInt(r.saldo) + '</td><td>' + fPct(r.taxa) + '</td></tr>';
    }).join('');
    var lHtml = L.map(function (r) {
      return '<tr><td>' + esc(nomeLoja(d, r.loja)) + '</td><td class="pu">' + fInt(r.q) + '</td><td>' + fMoney(r.c) + '</td><td>' + fPct(r.pct) + '</td></tr>';
    }).join('') + (R.envSemLoja.q ? '<tr><td>(Sem loja de origem)</td><td class="pu">' + fInt(R.envSemLoja.q) + '</td><td>' + fMoney(R.envSemLoja.c) + '</td><td>' + fPct(R.envSemLoja.q / Math.max(R.ENV.q, 1) * 100) + '</td></tr>' : '');
    var neg = R.cNeg && R.cNeg.linhas ? '<div class="srchip warn">⚠️ Casados: <b>' + fInt(R.cNeg.linhas) + '</b> linha(s) com valor negativo (' + fInt(R.cNeg.q) + ' pés · custo ' + fMoney(R.cNeg.c) + ') — entram na conta como vieram na planilha; conferir estorno/devolução</div>' : '';

    sec.innerHTML =
      '<div class="sechd"><div><h2>🧮 Saci na Rede — Conta Oficial</h2>' +
      '<div class="shsub">Pé Direito + Pé Esquerdo + Enviados 2026 = <b>Saci na Rede</b> · Saci na Rede − Casados = <b>Saldo</b> (pés aguardando par)</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap" class="no-print">' +
      '<button class="btn" data-sr="up">📤 Atualizar com novo D1.xlsx</button>' +
      '<button class="btn" data-sr="xls">📥 Excel da conta</button>' +
      '<button class="btn primary" data-sr="apr" style="background:var(--pbg);border-color:var(--pbdr);color:var(--pur)">🎯 Apresentação</button>' +
      '<input type="file" data-sr="file" accept=".xlsx,.xls" style="display:none"></div></div>' +
      '<div class="srflow">' +
      card('dir', '🟥 Pé Direito', R.D) + '<div class="srop">+</div>' +
      card('esq', '🟦 Pé Esquerdo', R.E) + '<div class="srop">+</div>' +
      card('env', '🚚 Enviados 2026', R.ENV) + '<div class="srop">=</div>' +
      card('rede', '📦 Saci na Rede', K.rede) + '<div class="srop">−</div>' +
      card('cas', '✅ Casados', R.C) + '<div class="srop">=</div>' +
      card('sal', '🧦 Saldo de Saci', K.saldo) +
      '</div>' +
      '<div class="srbars"><div><div class="srbl">De onde vem o Saci na Rede (' + fInt(K.rede.q) + ' pés)</div><div class="srbar">' +
      seg(R.D.q, '#db2777', 'Direito ' + fInt(R.D.q)) + seg(R.E.q, '#2563eb', 'Esquerdo ' + fInt(R.E.q)) + seg(R.ENV.q, '#d97706', 'Enviados 2026 ' + fInt(R.ENV.q)) + '</div></div>' +
      '<div><div class="srbl">O que já foi resolvido</div><div class="srbar">' +
      seg(R.C.q, '#059669', 'Casados ' + fInt(R.C.q) + ' (' + fPct(K.taxa) + ')') + seg(Math.max(K.saldo.q, 0), '#e11d48', 'Saldo ' + fInt(K.saldo.q) + ' (' + fPct(100 - K.taxa) + ')') + '</div></div></div>' +
      '<div class="srchips">' +
      '<div class="srchip">Taxa de casamento <b>' + fPct(K.taxa) + '</b></div>' +
      '<div class="srchip">Descarte (fora da conta) <b>' + fInt(R.DESC.q) + '</b> pés · ' + fMoney(R.DESC.c) + '</div>' +
      '<div class="srchip">Código reaproveitado (fora da conta) <b>' + fInt(R.REAP.q) + '</b> pés · ' + fMoney(R.REAP.c) + '</div>' + neg +
      '</div>' +
      '<div class="srgrid">' +
      '<div class="srbox"><h3>🏷️ Conta por Marca</h3><div class="s">Ordenado pelo maior saldo · marca = primeira palavra da descrição</div><div class="srtw"><table>' +
      '<thead><tr><th>Marca</th><th>Direito</th><th>Esquerdo</th><th>Enviados</th><th>Rede</th><th>Casados</th><th>Saldo</th><th>% casado</th></tr></thead><tbody>' + mHtml + '</tbody>' +
      '<tfoot><tr><td>Total (' + fInt(M.length) + ' marcas)</td><td>' + fInt(R.D.q) + '</td><td>' + fInt(R.E.q) + '</td><td>' + fInt(R.ENV.q) + '</td><td>' + fInt(K.rede.q) + '</td><td>' + fInt(R.C.q) + '</td><td>' + fInt(K.saldo.q) + '</td><td>' + fPct(K.taxa) + '</td></tr></tfoot></table></div>' +
      (M.length > 15 ? '<button class="btn srmais" data-sr="todas">' + (verTodas ? '▲ Mostrar só as 15 maiores' : '▼ Ver todas as ' + M.length + ' marcas') + '</button>' : '') + '</div>' +
      '<div class="srbox"><h3>🚚 Enviados 2026 por Loja de Origem</h3><div class="s">Pés de saci enviados pelas lojas ao D1 em 2026</div><div class="srtw"><table>' +
      '<thead><tr><th>Loja</th><th>Pés</th><th>Custo</th><th>% enviados</th></tr></thead><tbody>' + (lHtml || '<tr><td colspan="4">Sem loja de origem na planilha</td></tr>') + '</tbody>' +
      '<tfoot><tr><td>Total (' + fInt(L.length) + ' lojas)</td><td>' + fInt(R.ENV.q) + '</td><td>' + fMoney(R.ENV.c) + '</td><td>100%</td></tr></tfoot></table></div></div>' +
      '</div>' +
      '<div class="srfonte">Fonte: ' + esc(R.arquivo || 'D1.xlsx') + ' · conta atualizada em ' + esc(quando(R.geradoEm)) +
      ' · Direito/Esquerdo: custo da linha e venda = Pdv unitário × qtd · Enviados: custo e venda unitários × qtde · linhas de "Total" do rodapé não entram.</div>';

    sec.querySelector('[data-sr="up"]').onclick = function () { sec.querySelector('[data-sr="file"]').click(); };
    sec.querySelector('[data-sr="file"]').onchange = function () { var f = this.files && this.files[0]; this.value = ''; if (f) lerArquivo(d, f, true); };
    sec.querySelector('[data-sr="xls"]').onclick = function () { exportarExcel(d); };
    sec.querySelector('[data-sr="apr"]').onclick = function () { apresentacao(d); };
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
        toast(d, '🧮 Saci na Rede atualizado: ' + fInt(K.rede.q) + ' pés − ' + fInt(R.C.q) + ' casados = saldo ' + fInt(K.saldo.q), 'g');
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
      ['(=) Saci na Rede', K.rede.q, K.rede.c, K.rede.v], ['(−) Casados', R.C.q, R.C.c, R.C.v], ['(=) Saldo de Saci (aguardando par)', K.saldo.q, K.saldo.c, K.saldo.v], [],
      ['Taxa de casamento (Casados ÷ Rede)', K.taxa / 100], ['Descarte (fora da conta)', R.DESC.q, R.DESC.c, R.DESC.v], ['Código reaproveitado (fora da conta)', R.REAP.q, R.REAP.c, R.REAP.v]];
    if (R.cNeg && R.cNeg.linhas) conta.push(['Casados com valor negativo (' + R.cNeg.linhas + ' linhas)', R.cNeg.q, R.cNeg.c, R.cNeg.v]);
    var s1 = X.utils.aoa_to_sheet(conta); s1['!cols'] = [{ wch: 42 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    X.utils.book_append_sheet(wb, s1, 'Conta');
    var m = [['Marca', 'Direito', 'Esquerdo', 'Enviados 2026', 'Saci na Rede', 'Casados', 'Saldo', '% casado']].concat(linhasMarcas(R).map(function (r) { return [r.marca, r.D, r.E, r.ENV, r.rede, r.C, r.saldo, r.taxa / 100]; }));
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(m), 'Por Marca');
    var l = [['Loja de origem', 'Pés enviados', 'Custo', 'Venda', '% dos enviados']].concat(linhasLojas(R).map(function (r) { return [r.loja, r.q, r.c, r.v, r.pct / 100]; }));
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(l), 'Enviados por Loja');
    X.writeFile(wb, 'Saci_na_Rede_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  /* ---------- Apresentação (diretoria) ---------- */
  function apresentacao(d) {
    var w = d.defaultView, R = d.__saciRedeR; if (!R) return;
    var win = w.open('', '_blank');
    if (!win) { toast(d, '⚠ Pop-up bloqueado — permita pop-ups para abrir a apresentação', 'a'); return; }
    var K = SR.conta(R), M = linhasMarcas(R), L = linhasLojas(R);
    var logo = '';
    try { if (w.LOGO_B64) logo = '<img src="' + w.LOGO_B64 + '" alt="Esposende">'; } catch (e) { }
    var hoje = new Date().toLocaleDateString('pt-BR');
    function head(t, n) { return '<div class="ph">' + logo + '<div><div class="kick">Casamento de Saci · Esposende Calçados</div><h1>' + t + '</h1></div><div class="pn">' + n + '/3</div></div>'; }
    function box(cls, lbl, o) { return '<div class="bx ' + cls + '"><div class="bl">' + lbl + '</div><div class="bq">' + fInt(o.q) + '</div><div class="bu">pés</div><div class="bm">Custo ' + fMoney(o.c) + '<br>Venda ' + fMoney(o.v) + '</div></div>'; }
    var tot = Math.max(K.rede.q, 1);
    function seg(q, cor, txt) { var p = q / tot * 100; return '<div style="width:' + p.toFixed(3) + '%;background:' + cor + '">' + (p > 8 ? esc(txt) : '') + '</div>'; }
    function hbar(rows, key, cor, max) {
      return rows.map(function (r) {
        var p = Math.max(0, r[key]) / Math.max(max, 1) * 100;
        return '<div class="hb"><span class="hn">' + esc(r.lbl) + '</span><span class="ht"><span style="width:' + p.toFixed(2) + '%;background:' + cor + '"></span></span><span class="hv">' + fInt(r[key]) + '</span></div>';
      }).join('');
    }
    var top = M.slice(0, 10).map(function (r) { return { lbl: r.marca, saldo: r.saldo }; });
    var topL = L.slice(0, 12).map(function (r) { return { lbl: 'Loja ' + r.loja, q: r.q }; });
    var tabM = M.slice(0, 15).map(function (r) { return '<tr><td>' + esc(r.marca) + '</td><td>' + fInt(r.D) + '</td><td>' + fInt(r.E) + '</td><td>' + fInt(r.ENV) + '</td><td><b>' + fInt(r.rede) + '</b></td><td>' + fInt(r.C) + '</td><td class="r"><b>' + fInt(r.saldo) + '</b></td><td>' + fPct(r.taxa) + '</td></tr>'; }).join('');
    var lojaTop3 = L.slice(0, 3).reduce(function (s, r) { return s + r.q; }, 0);
    var marcaTop5 = M.slice(0, 5).reduce(function (s, r) { return s + Math.max(r.saldo, 0); }, 0);

    var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Saci na Rede — Apresentação</title><style>' +
      '@page{size:A4 landscape;margin:0}*{box-sizing:border-box}body{margin:0;background:#e5e7eb;font-family:Arial,Helvetica,sans-serif;color:#0f172a}' +
      '.bar{position:sticky;top:0;z-index:2;background:#0f172a;color:#fff;padding:10px 16px;display:flex;gap:10px;align-items:center;font-size:13px}.bar button{background:#7c3aed;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-weight:700;cursor:pointer}' +
      '.pg{width:297mm;height:210mm;margin:12px auto;background:#fff;padding:14mm 16mm;position:relative;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.15);page-break-after:always;break-after:page}' +
      '.ph{display:flex;align-items:center;gap:14px;border-bottom:3px solid #7c3aed;padding-bottom:10px;margin-bottom:16px}.ph img{height:42px}.kick{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:700}' +
      'h1{font-size:25px;margin:2px 0 0}.pn{margin-left:auto;font-size:11px;color:#94a3b8;font-weight:700}' +
      '.flow{display:grid;grid-template-columns:1fr 26px 1fr 26px 1fr 26px 1.15fr 26px 1fr 26px 1.15fr;align-items:stretch;gap:4px;margin:6px 0 16px}' +
      '.op{display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#94a3b8}' +
      '.bx{border:2px solid #e2e8f0;border-radius:12px;padding:12px 8px;text-align:center}.bl{font-size:11px;font-weight:800;text-transform:uppercase;color:#475569}' +
      '.bq{font-size:34px;font-weight:900;line-height:1.1;margin-top:6px}.bu{font-size:10px;color:#64748b}.bm{font-size:10.5px;color:#334155;margin-top:8px;line-height:1.5}' +
      '.dir .bq{color:#db2777}.esq .bq{color:#2563eb}.env .bq{color:#d97706}.cas .bq{color:#059669}' +
      '.rede{border-color:#7c3aed;background:#f5f3ff}.rede .bq{color:#7c3aed;font-size:40px}.sal{border-color:#e11d48;background:#fff1f2}.sal .bq{color:#e11d48;font-size:40px}' +
      '.sb{display:flex;height:30px;border-radius:8px;overflow:hidden;margin:4px 0 12px}.sb div{display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden}' +
      '.lbl{font-size:12px;color:#475569;font-weight:700}' +
      '.msg{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:6px}.mc{background:#f8fafc;border-left:4px solid #7c3aed;border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.45}.mc b{font-size:20px;display:block;color:#0f172a}' +
      '.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px}.card h2{font-size:14px;margin:0 0 10px}' +
      '.hb{display:grid;grid-template-columns:120px 1fr 54px;align-items:center;gap:8px;margin:5px 0;font-size:12px}.hn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}' +
      '.ht{height:16px;background:#f1f5f9;border-radius:4px;overflow:hidden}.ht span{display:block;height:100%;border-radius:4px}.hv{text-align:right;font-weight:800}' +
      'table{width:100%;border-collapse:collapse;font-size:11.5px}th{background:#f1f5f9;text-align:right;padding:6px 7px;font-size:10px;text-transform:uppercase;color:#475569}td{padding:5px 7px;border-bottom:1px solid #eef2f7;text-align:right}' +
      'th:first-child,td:first-child{text-align:left}td.r{color:#e11d48}tfoot td{font-weight:800;border-top:2px solid #cbd5e1}' +
      '.ft{position:absolute;bottom:9mm;left:16mm;right:16mm;font-size:9.5px;color:#94a3b8;display:flex;justify-content:space-between}' +
      '.how{font-size:12px;color:#334155;line-height:1.6;margin:0;padding-left:18px}' +
      '@media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.bar{display:none}.pg{margin:0;box-shadow:none}}' +
      '</style></head><body>' +
      '<div class="bar"><b>Saci na Rede — Apresentação</b><span style="opacity:.7">3 páginas · A4 deitado</span><button onclick="print()">🖨 Imprimir / Salvar PDF</button></div>' +
      // página 1 — a conta
      '<div class="pg">' + head('A conta do Saci na Rede', 1) +
      '<div class="flow">' + box('dir', 'Pé Direito', R.D) + '<div class="op">+</div>' + box('esq', 'Pé Esquerdo', R.E) + '<div class="op">+</div>' + box('env', 'Enviados 2026', R.ENV) +
      '<div class="op">=</div>' + box('rede', 'Saci na Rede', K.rede) + '<div class="op">−</div>' + box('cas', 'Casados', R.C) + '<div class="op">=</div>' + box('sal', 'Saldo de Saci', K.saldo) + '</div>' +
      '<div class="lbl">De onde vem o Saci na Rede</div><div class="sb">' + seg(R.D.q, '#db2777', 'Direito ' + fInt(R.D.q)) + seg(R.E.q, '#2563eb', 'Esquerdo ' + fInt(R.E.q)) + seg(R.ENV.q, '#d97706', 'Enviados 2026 ' + fInt(R.ENV.q)) + '</div>' +
      '<div class="lbl">Quanto já foi resolvido</div><div class="sb">' + seg(R.C.q, '#059669', 'Casados ' + fInt(R.C.q) + ' · ' + fPct(K.taxa)) + seg(Math.max(K.saldo.q, 0), '#e11d48', 'Saldo ' + fInt(K.saldo.q) + ' · ' + fPct(100 - K.taxa)) + '</div>' +
      '<div class="msg"><div class="mc"><b>' + fInt(K.rede.q) + ' pés</b>de saci na rede: Direito + Esquerdo no D1 e o que as lojas enviaram em 2026.</div>' +
      '<div class="mc" style="border-color:#059669"><b>' + fPct(K.taxa) + ' casados</b>' + fInt(R.C.q) + ' pés já viraram par · ' + fMoney(R.C.c) + ' de custo recuperado para venda.</div>' +
      '<div class="mc" style="border-color:#e11d48"><b>' + fInt(K.saldo.q) + ' pés no saldo</b>ainda aguardando par · ' + fMoney(K.saldo.c) + ' de custo parado.</div></div>' +
      '<div class="ft"><span>Fonte: ' + esc(R.arquivo || 'D1.xlsx') + ' · conta de ' + esc(quando(R.geradoEm)) + '</span><span>Gerado em ' + hoje + '</span></div></div>' +
      // página 2 — marcas
      '<div class="pg">' + head('Onde está o saldo — por marca', 2) +
      '<div class="two"><div class="card"><h2>Top 10 marcas com maior saldo (pés aguardando par)</h2>' + hbar(top, 'saldo', '#e11d48', top.length ? top[0].saldo : 1) +
      '<p class="how" style="margin-top:10px;padding:0">As 5 primeiras marcas somam <b>' + fInt(marcaTop5) + '</b> pés (' + fPct(marcaTop5 / Math.max(K.saldo.q, 1) * 100) + ' do saldo).</p></div>' +
      '<div class="card"><h2>Conta por marca (15 maiores saldos)</h2><table><thead><tr><th>Marca</th><th>Dir.</th><th>Esq.</th><th>Envi.</th><th>Rede</th><th>Casad.</th><th>Saldo</th><th>%</th></tr></thead><tbody>' + tabM + '</tbody>' +
      '<tfoot><tr><td>Total rede</td><td>' + fInt(R.D.q) + '</td><td>' + fInt(R.E.q) + '</td><td>' + fInt(R.ENV.q) + '</td><td>' + fInt(K.rede.q) + '</td><td>' + fInt(R.C.q) + '</td><td>' + fInt(K.saldo.q) + '</td><td>' + fPct(K.taxa) + '</td></tr></tfoot></table></div></div>' +
      '<div class="ft"><span>Marca = primeira palavra da descrição do produto</span><span>Saci na Rede · Esposende</span></div></div>' +
      // página 3 — lojas e regra
      '<div class="pg">' + head('Quem envia e como a conta é feita', 3) +
      '<div class="two"><div class="card"><h2>Enviados 2026 por loja de origem (12 maiores)</h2>' + hbar(topL, 'q', '#d97706', topL.length ? topL[0].q : 1) +
      '<p class="how" style="margin-top:10px;padding:0">' + fInt(L.length) + ' lojas enviaram saci em 2026; as 3 maiores respondem por <b>' + fPct(lojaTop3 / Math.max(R.ENV.q, 1) * 100) + '</b> dos ' + fInt(R.ENV.q) + ' pés.</p></div>' +
      '<div class="card"><h2>Como a conta é feita</h2><ol class="how">' +
      '<li><b>Saci na Rede</b> = Pé Direito (' + fInt(R.D.q) + ') + Pé Esquerdo (' + fInt(R.E.q) + ') + Enviados 2026 (' + fInt(R.ENV.q) + ') = <b>' + fInt(K.rede.q) + '</b> pés.</li>' +
      '<li><b>Saldo</b> = Saci na Rede (' + fInt(K.rede.q) + ') − Casados (' + fInt(R.C.q) + ') = <b>' + fInt(K.saldo.q) + '</b> pés aguardando par.</li>' +
      '<li><b>Taxa de casamento</b> = Casados ÷ Saci na Rede = <b>' + fPct(K.taxa) + '</b>.</li>' +
      '<li>Cada aba do D1.xlsx é somada pela coluna de quantidade; a linha de "Total" do rodapé não entra (senão dobraria).</li>' +
      '<li>Custo/venda: Direito e Esquerdo pelo custo da linha e preço unitário × qtd; Enviados 2026 pelo custo e venda unitários × qtde; Casados pelo valor da linha.</li>' +
      '<li><b>Fora da conta</b>, só informativo: Descarte ' + fInt(R.DESC.q) + ' pés (' + fMoney(R.DESC.c) + ') e Código Reaproveitado ' + fInt(R.REAP.q) + ' pés.</li>' +
      (R.cNeg && R.cNeg.linhas ? '<li>Atenção: ' + fInt(R.cNeg.linhas) + ' linhas da aba Casados vieram com valor negativo (' + fMoney(R.cNeg.c) + ' de custo) — conferir estorno/devolução.</li>' : '') +
      '</ol></div></div>' +
      '<div class="ft"><span>Fonte: ' + esc(R.arquivo || 'D1.xlsx') + '</span><span>Gerado em ' + hoje + '</span></div></div>' +
      '</body></html>';
    win.document.open(); win.document.write(html); win.document.close();
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
    // botão no topo do módulo
    var acts = d.querySelector('.hd .actions');
    if (acts && !acts.querySelector('[data-sr-top]')) {
      var b = d.createElement('button'); b.className = 'btn primary'; b.setAttribute('data-sr-top', '1');
      b.style.cssText = 'background:var(--pbg);border-color:var(--pbdr);color:var(--pur)';
      b.textContent = '🎯 Apresentação Saci na Rede'; b.onclick = function () { apresentacao(d); };
      acts.insertBefore(b, acts.firstChild);
    }
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
