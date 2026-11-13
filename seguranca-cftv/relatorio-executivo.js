// =====================================================================================================================
// Relatório executivo (PDF / impressão) — montado na hora com os dados e filtros da tela
// Padrão de relatório do Portal: logo oficial, cards, tabelas com cabeçalho azul-marinho e linhas zebradas,
// total destacado e rodapé "Esposende · Central de Auditoria & Controle" com a data de geração.
// =====================================================================================================================
(function () {
  const R0 = v => v === null || v === undefined || !isFinite(v) ? '—' : 'R$ ' + Math.round(Number(v)).toLocaleString('pt-BR');
  const N0 = v => Math.round(Number(v) || 0).toLocaleString('pt-BR');
  const PC = (v, d = 0) => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d}) + '%';
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MAX_OC = 10; // mantém o relatório em 2 páginas
  const NOME_CAT = c => (CAT && CAT[c]) || ({instalacao: 'Instalação (serviços)'})[c] || 'Outros';

  function dados() {
    const p = S.painel, fi = p.financeiro, op = p.operacional, me = p.medias, pl = p.plano || {}, P = S.pat || {}, pb = P.por_base || {};
    const ult = S.docs.reduce((m, d) => d.emissao && d.emissao > m ? d.emissao : m, '');
    const precoRef = Number(((P.precos || []).find(x => x.categoria === 'camera') || {}).preco) || null;
    const abertas = S.oc.filter(o => o.ativo && ['pendente', 'suspeita'].includes(o.situacao))
      .sort((a, b) => ({alta: 0, media: 1, baixa: 2}[a.gravidade] - {alta: 0, media: 1, baixa: 2}[b.gravidade]) || (Number(b.valor) || 0) - (Number(a.valor) || 0));
    const fechadas = (P.por_loja || []).filter(x => x.loja_codigo && Number(x.valor) > 0 &&
      (S.inativas.has(x.loja_codigo) || /fechad|desativ/i.test((S.lojas.get(x.loja_codigo) || {}).nome || '')));
    return {p, fi, op, me, pl, P, pb, ult, precoRef, abertas, fechadas, anterior: Number(pb.anterior_2026 || 0) + Number(pb.estimativa || 0)};
  }

  // ---------------- gráfico mês a mês (SVG) ----------------
  function grafico(mensal, w, h) {
    const ser = [['aquisicao', 'Equipamentos', '#1f5fbf'], ['instalacao', 'Instalação', '#7fa7e0'], ['manutencao', 'Manutenção', '#d99a00'], ['monitoramento', 'Monitoramento', '#8a94a6']];
    const ms = (mensal || []).filter(m => ser.some(([k]) => Number(m[k]) > 0));
    if (!ms.length) return '<div class="nota">Sem gasto no período.</div>';
    const tot = ms.map(m => soma(ser, ([k]) => m[k])), mx = Math.max(...tot) * 1.12, pl = 46, pr = 8, pt = 12, pb = 22, ih = h - pt - pb, bw = (w - pl - pr) / ms.length;
    const passo = [5e3, 1e4, 25e3, 5e4, 1e5, 2.5e5, 5e5].find(s => mx / s <= 6) || 1e6;
    const corr = new Date().toISOString().slice(0, 7);
    let o = `<svg viewBox="0 0 ${w} ${h + 20}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Arial" font-size="10">`;
    for (let t = 0; t <= mx; t += passo) { const y = pt + ih - t / mx * ih; o += `<line x1="${pl}" x2="${w - pr}" y1="${y}" y2="${y}" stroke="#e3e7ee"/><text x="${pl - 6}" y="${y + 3}" text-anchor="end" fill="#6b7587">${N0(t / 1000)} mil</text>`; }
    ms.forEach((m, i) => {
      const x = pl + i * bw + bw * .18; let y = pt + ih;
      for (const [k, , c] of ser) { const hh = (Number(m[k]) || 0) / mx * ih; if (hh > 0) { y -= hh; o += `<rect x="${x}" y="${y}" width="${bw * .64}" height="${hh}" fill="${c}"/>`; } }
      o += `<text x="${x + bw * .32}" y="${y - 4}" text-anchor="middle" font-weight="700" font-size="9" fill="#1b2433">${N0(tot[i] / 1000)}</text>`;
      o += `<text x="${x + bw * .32}" y="${pt + ih + 14}" text-anchor="middle" fill="#3b4558">${MES[Number(m.mes.slice(5)) - 1]}${m.mes === corr ? '*' : ''}</text>`;
    });
    let lx = pl; for (const [, n, c] of ser) { o += `<rect x="${lx}" y="${h + 6}" width="10" height="10" fill="${c}"/><text x="${lx + 14}" y="${h + 15}" fill="#3b4558">${n}</text>`; lx += 24 + n.length * 6; }
    return o + `<text x="${w - pr}" y="${h + 15}" text-anchor="end" fill="#6b7587">valores em R$ mil${ms.some(m => m.mes === corr) ? ' · * mês em andamento' : ''}</text></svg>`;
  }

  const CSS = pais => `@page{size:A4 ${pais ? 'landscape' : 'portrait'};margin:11mm 11mm 15mm}
*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,Helvetica,sans-serif;color:#1b2433;font-size:10.5px;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff}
.pg{position:relative;min-height:${pais ? 181 : 268}mm;padding-bottom:9mm}.pg+.pg{break-before:page}
.cab{display:flex;align-items:center;gap:14px;border-bottom:3px solid #14284a;padding-bottom:8px;margin-bottom:12px}.cab img{height:38px}.cab .tt{flex:1}
.cab h1{margin:0;font-size:17px;color:#14284a}.cab .st{color:#5b6576;font-size:10.5px;margin-top:2px}
.selo{background:#14284a;color:#fff;border-radius:6px;padding:5px 10px;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-align:center;line-height:1.35}
h2{font-size:11.5px;letter-spacing:.07em;color:#14284a;margin:14px 0 7px;padding-bottom:3px;border-bottom:1px solid #d6dce6;text-transform:uppercase}
.grid{display:grid;gap:8px}.g4{grid-template-columns:repeat(4,1fr)}.g2{grid-template-columns:1fr 1fr}
.k{border:1px solid #d6dce6;border-left:4px solid #1f5fbf;border-radius:7px;padding:8px 10px 7px;background:#fbfcfe;break-inside:avoid}
.k.ok{border-left-color:#1e9e57}.k.warn{border-left-color:#d99a00}.k.bad{border-left-color:#c8312b}.k.neu{border-left-color:#8a94a6}
.k .t{font-size:9.5px;color:#4a5466;font-weight:600}.k .v{font-size:19px;font-weight:800;color:#14284a;margin:3px 0 2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.k.ok .v{color:#167a43}.k.warn .v{color:#a87400}.k.bad .v{color:#b0261f}.k .s{font-size:9px;color:#4a5466}
.k .b{font-size:8.5px;color:#6b7587;border-top:1px dashed #d6dce6;margin-top:4px;padding-top:3px}
.cmp{font-size:9px;font-weight:700;border-radius:99px;padding:1px 7px;background:#eef0f4;color:#4a5466}.cmp.bad{background:#fbe3e1;color:#b0261f}.cmp.ok{background:#dff3e7;color:#167a43}
.box{border:1px solid #d6dce6;border-radius:7px;padding:9px 11px;break-inside:avoid}.box h3{margin:0 0 6px;font-size:10.5px;color:#14284a}
table{width:100%;border-collapse:collapse;font-size:9.6px}th{background:#14284a;color:#fff;text-align:left;padding:5px 6px}
td{padding:4px 6px;border-bottom:1px solid #e3e7ee}tr:nth-child(even) td{background:#f4f6fa}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
tr.tot td{background:#dfe6f2!important;font-weight:800;color:#14284a;border-top:2px solid #14284a}
.chip{display:inline-block;font-size:8.5px;font-weight:700;border-radius:4px;padding:1px 6px;background:#fbe3e1;color:#b0261f}.chip.media{background:#fdf0d2;color:#8a5d00}.chip.baixa{background:#eef0f4;color:#4a5466}
.lst{margin:0;padding-left:16px}.lst li{margin:0 0 5px;line-height:1.45}.lst b{color:#14284a}
.dec{list-style:none;padding:0;margin:0;counter-reset:d}.dec li{counter-increment:d;position:relative;padding:6px 8px 6px 34px;border:1px solid #d6dce6;border-radius:6px;margin-bottom:5px;line-height:1.42;break-inside:avoid}
.dec li::before{content:counter(d);position:absolute;left:8px;top:6px;width:18px;height:18px;border-radius:50%;background:#14284a;color:#fff;font-weight:800;font-size:10px;text-align:center;line-height:18px}
.res{background:#14284a;color:#fff;border-radius:8px;padding:10px 13px;font-size:11px;line-height:1.5}.res b{color:#ffd166}
.alerta{background:#fff4e0;border:1px solid #f0c36d;color:#7a3f04;border-radius:7px;padding:7px 10px;margin-bottom:10px;font-size:10px}
.nota{font-size:8.5px;color:#6b7587;margin-top:4px}
.rod{position:absolute;bottom:0;left:0;right:0;font-size:8px;color:#6b7587;display:flex;justify-content:space-between;border-top:1px solid #d6dce6;padding-top:3px}
@media screen{body{background:#e9edf3}.pg{width:${pais ? 297 : 210}mm;margin:10px auto;background:#fff;padding:11mm 11mm 20mm;box-shadow:0 2px 10px rgba(0,0,0,.15)}.rod{left:11mm;right:11mm;bottom:8mm}}`;

  function barras(lista, cor, w = 520, rot = 220) {
    if (!lista.length) return '<div class="nota">Sem dados no período.</div>';
    const mx = Math.max(...lista.map(x => x.v)) || 1, lh = 21;
    let o = `<svg viewBox="0 0 ${w} ${lista.length * lh + 4}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Arial" font-size="10.5">`;
    lista.forEach((x, i) => { const y = i * lh + 3; o += `<text x="0" y="${y + 12}" fill="#1b2433">${esc(x.n.length > 34 ? x.n.slice(0, 33) + '…' : x.n)}</text><rect x="${rot}" y="${y + 2}" width="${(w - rot - 78) * x.v / mx}" height="13" rx="2" fill="${cor}"/><text x="${w}" y="${y + 12}" text-anchor="end" font-weight="700" fill="#1b2433">${R0(x.v)}</text>`; });
    return o + '</svg>';
  }

  function html(logo, tipo = 'executivo') {
    const PAINEL = tipo === 'painel', TIT = PAINEL ? 'Painel · Segurança Patrimonial e CFTV' : 'Relatório Executivo · Segurança Patrimonial e CFTV';
    const d = dados(), {p, fi, op, me, pl, P, pb, ult, precoRef, abertas, fechadas, anterior} = d;
    const gerado = new Date().toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'});
    const pos = `posição de ${dBR(p.atualizado_em || hoje())}`, notas = `notas até ${dBR(ult)}`, filtros = descFiltros();
    const lojas = op.total_lojas || 0, cob = op.lojas_estoque_coberto || 0, inv = Number(fi.investimento_total) || 0;
    const camPreco = Number(me.custo_medio_camera) || null, camVar = camPreco && precoRef ? (camPreco - precoRef) / precoRef * 100 : null;
    const meses = (p.mensal || []).filter(m => Number(m.manutencao) > 0), manMed = meses.length ? soma(meses, m => m.manutencao) / meses.length : null;
    const manUlt = meses.length ? Number(meses[meses.length - 1].manutencao) : null, manVar = manMed ? (manUlt - manMed) / manMed * 100 : null;
    const invLoja = (p.por_loja || []).filter(x => x.loja_codigo !== null).sort((a, b) => b.investimento - a.investimento), top5 = invLoja.slice(0, 5), top5v = soma(top5, x => x.investimento);
    const cap = abertas.filter(o => o.regra === 'acima_capacidade'), rec = abertas.filter(o => o.regra === 'manutencao_recorrente');
    const valorAb = soma(abertas, o => o.valor), nomeCurto = c => nomeLoja(c).replace(/^\d+ · /, '');
    const k = (t, v, b, cls = '', c = '', s = '') => `<div class="k ${cls}"><div class="t">${t}</div><div class="v">${v}${c}</div>${s ? `<div class="s">${s}</div>` : ''}<div class="b">${b}</div></div>`;
    const cmp = (t, c = '') => `<span class="cmp ${c}">${t}</span>`;
    const cab = sub => `<div class="cab"><img src="${logo}" alt="Esposende"><div class="tt"><h1>${TIT}</h1><div class="st">${esc(sub)}</div></div><div class="selo">AUDITORIA<br>&amp; CONTROLE</div></div>`;
    const rod = n => `<div class="rod"><span>Esposende · Central de Auditoria &amp; Controle</span><span>Segurança Patrimonial e CFTV · gerado em ${gerado} por ${esc(S.email)} · página ${n} de 2</span></div>`;

    // alertas de base (regra 7: nunca mostrar número errado em silêncio)
    const alertas = [];
    if (fi.docs_conferir) alertas.push(`${N0(fi.docs_conferir)} nota(s) (${R0(fi.docs_conferir_valor)}) aguardam conferência: loja ou natureza podem mudar.`);
    if (Number(P.sem_loja)) alertas.push(`${R0(P.sem_loja)} do patrimônio estão em notas sem loja definida.`);
    if (Number(P.total_estimado)) alertas.push(`${R0(P.total_estimado)} do patrimônio são estimados (câmeras pela ocupação dos gravadores e HDs de gravadores antigos).`);

    const cards1 = [
      k('Patrimônio em segurança', R0(P.total), pos, '', '', `${R0(pb.compras_2026)} investidos em 2026 + ${R0(anterior)} do parque anterior`),
      k('Câmeras em operação', N0(op.cameras_instaladas), pos, '', lojas ? cmp(`${nf(op.cameras_instaladas / lojas, 1)} por loja`) : '', `${N0(op.cameras_compradas)} compradas em 2026 · ${N0(op.gravadores)} gravadores · ${N0(op.canais_livres)} canais livres`),
      k('Lojas com câmera no estoque', `${N0(cob)} de ${N0(lojas)}`, pos, cob < lojas / 2 ? 'bad' : 'warn', cmp(PC(lojas ? cob / lojas * 100 : 0), cob < lojas / 2 ? 'bad' : ''), `${N0(op.lojas_cobertura_incompleta)} lojas com cobertura incompleta`),
      k('Equipamentos parados', N0(op.equipamentos_defeito), pos, op.equipamentos_defeito ? 'bad' : 'ok', '', op.equipamentos_defeito ? 'com defeito ou fora de operação' : 'nenhum com defeito ou fora de operação')];
    const cards2 = [
      k('Investido em 2026 (notas fiscais)', R0(inv), notas, '', '', `equipamentos ${R0(fi.aquisicao_equipamentos)} + instalação ${R0(fi.servicos_instalacao)}`),
      k('Manutenção', R0(fi.manutencao_total), notas, 'warn', manVar === null ? '' : cmp(`${manVar > 0 ? '▲' : '▼'} ${PC(Math.abs(manVar))}`, manVar > 0 ? 'bad' : 'ok'), `${N0(soma(p.manutencao_mensal || [], m => m.qtd))} ocorrências · último mês × média`),
      k('Monitoramento', R0(fi.monitoramento), notas, 'neu', '', 'serviço mensal da central (fora do investimento)'),
      k('Preço pago por câmera', R0(camPreco), notas, '', camVar === null ? '' : cmp(`${camVar > 0 ? '▲' : '▼'} ${PC(Math.abs(camVar))}`, camVar > 0 ? 'bad' : 'ok'), precoRef ? `referência da gestão: ${R0(precoRef)}` : 'média das notas de compra')];

    const fatos = [];
    if (top5.length && inv) fatos.push(`<b>Investimento concentrado.</b> As ${top5.length} maiores destinações (${top5.map(x => esc(nomeCurto(x.loja_codigo))).join(', ')}) somam ${R0(top5v)}, ${PC(top5v / inv * 100)} do investido. ${N0(me.lojas_com_investimento)} lojas receberam investimento; custo médio de ${R0(me.custo_medio_loja)} por loja.`);
    if (lojas) fatos.push(`<b>Estoque ${cob < lojas / 2 ? 'descoberto' : 'parcialmente coberto'}.</b> ${N0(cob)} de ${N0(lojas)} lojas filmam o estoque; ${N0(op.lojas_cobertura_incompleta)} das ${N0(op.lojas_estoque_avaliado)} lojas avaliadas têm alguma área sem câmera. ${op.lojas_cobertura_completa ? `${N0(op.lojas_cobertura_completa)} com cobertura completa.` : 'Nenhuma loja está com cobertura completa.'}`);
    if (cap.length) fatos.push(`<b>Câmeras sem gravação garantida.</b> ${cap.length} loja(s) com mais câmeras do que canais de gravação (${cap.slice(0, 2).map(o => esc(o.detalhe.replace(/\.$/, ''))).join('; ')}). A rede tem ${N0(op.canais_livres)} canais livres em outras lojas.`);
    if (camVar !== null) fatos.push(`<b>Preço da câmera ${camVar > 0 ? 'acima' : 'dentro'} da referência.</b> Média de ${R0(camPreco)} por câmera nas notas, ${PC(Math.abs(camVar))} ${camVar > 0 ? 'acima' : 'abaixo'} dos ${R0(precoRef)} definidos pela gestão.`);
    if (Number(fi.manutencao_total)) { const r1 = (p.ranking_manutencao || [])[0];
      fatos.push(`<b>Manutenção.</b> ${R0(fi.manutencao_total)} no período (${inv ? PC(fi.manutencao_total / inv * 100, 1) : '—'} do investido), reincidência de ${R0(fi.reincidencia)}${r1 ? `; maior custo em ${esc(r1.nome)} (${R0(r1.valor)} em ${N0(r1.ocorrencias)} ocorrências)` : ''}.`); }
    if (fechadas.length) fatos.push(`<b>Lojas fechadas ou desativadas com patrimônio.</b> ${fechadas.map(x => `${esc(nomeCurto(x.loja_codigo))} (${R0(x.valor)})`).join('; ')}: confirmar destino dos equipamentos.`);
    fatos.push(`<b>Base.</b> ${fi.docs_conferir ? `${N0(fi.docs_conferir)} nota(s) ainda em conferência.` : 'Todas as notas importadas estão conferidas.'} Nenhuma despesa entra duas vezes; monitoramento (${R0(fi.monitoramento)}) fica separado do investimento.`);

    const dec = [];
    if (Number(pl.total)) dec.push(`<b>Aprovar o projeto de câmeras do estoque</b> (${R0(pl.total)}: ${N0(pl.cameras)} câmeras e ${N0(pl.gravadores)} gravadores em ${N0(pl.lojas)} lojas), começando pelas lojas de maior perda.`);
    if (camVar > 0 && Number(pl.cameras)) dec.push(`<b>Renegociar o preço da câmera</b> antes do projeto: a ${R0(precoRef)} em vez de ${R0(camPreco)}, as ${N0(pl.cameras)} câmeras custam ${R0((camPreco - precoRef) * pl.cameras)} a menos.`);
    if (cap.length) dec.push(`<b>Ajustar a gravação nas ${cap.length} loja(s) acima da capacidade</b> (${cap.map(o => esc(nomeCurto(o.loja_codigo))).join(', ')}): gravador adicional ou remanejamento de canais livres.`);
    if (rec.length) dec.push(`<b>Tratar a causa das manutenções recorrentes</b> em ${rec.map(o => esc(nomeCurto(o.loja_codigo))).join(', ')} com a equipe de Segurança.`);
    if (fechadas.length || abertas.some(o => o.regra === 'loja_desativada')) dec.push(`<b>Confirmar o destino dos equipamentos</b> de lojas fechadas ou desativadas${fechadas.length ? `: ${fechadas.map(x => esc(nomeCurto(x.loja_codigo))).join(', ')}` : ''}.`);
    if (!dec.length) dec.push('Nenhuma decisão pendente no período.');

    const planoL = [['Câmeras', `${N0(pl.cameras)} un.`, pl.cameras_valor], ['Gravadores 16 canais', `${N0(pl.gravadores)} un.`, pl.gravadores_valor], ['Conectores', '—', pl.conectores_valor], ['Cabeamento', '—', pl.cabeamento], ['Mão de obra', '—', pl.mao_obra]].filter(x => Number(x[2]));
    const tPlano = Number(pl.total) ? `<table><tr><th>Item</th><th class="n">Qtd</th><th class="n">Valor</th></tr>${planoL.map(x => `<tr><td>${x[0]}</td><td class="n">${x[1]}</td><td class="n">${R0(x[2])}</td></tr>`).join('')}<tr class="tot"><td>Total do projeto</td><td class="n">${N0(pl.lojas)} lojas</td><td class="n">${R0(pl.total)}</td></tr></table>` : '<div class="nota">Nenhum projeto em aberto.</div>';
    const cats = [...(P.por_categoria || [])].sort((a, b) => b.valor - a.valor), tc = soma(cats, c => c.valor);
    const tCat = `<table><tr><th>Categoria</th><th class="n">Qtd</th><th class="n">Valor</th><th class="n">%</th></tr>${cats.map(c => `<tr><td>${esc(NOME_CAT(c.categoria))}</td><td class="n">${N0(c.quantidade)}</td><td class="n">${R0(c.valor)}</td><td class="n">${tc ? PC(c.valor / tc * 100, 1) : '—'}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td></td><td class="n">${R0(tc)}</td><td class="n">100%</td></tr></table>`;
    const tOc = abertas.length ? `<table><tr><th>Gravidade</th><th>Ocorrência</th><th>Loja</th><th>Detalhe</th><th class="n">Valor</th></tr>${abertas.slice(0, MAX_OC).map(o => `<tr><td><span class="chip ${o.gravidade}">${esc(o.gravidade[0].toUpperCase() + o.gravidade.slice(1))}</span></td><td>${esc(o.titulo)}</td><td>${esc(nomeLoja(o.loja_codigo))}</td><td>${esc(o.detalhe || '')}</td><td class="n">${o.valor ? R0(o.valor) : '—'}</td></tr>`).join('')}<tr class="tot"><td colspan="4">Total · ${N0(abertas.length)} ocorrência(s) em aberto${abertas.length > MAX_OC ? ` (${MAX_OC} primeiras listadas)` : ''}</td><td class="n">${R0(valorAb)}</td></tr></table>` : '<div class="nota">Nenhuma ocorrência em aberto.</div>';

    if (PAINEL) {
      const cards3 = [
        k('Projeto em aberto: câmeras do estoque', R0(pl.total), pos, 'warn', '', Number(pl.total) ? `${N0(pl.cameras)} câmeras em ${N0(pl.lojas)} lojas` : 'nenhum projeto em aberto'),
        k('Ocorrências suspeitas', N0(p.auditoria.suspeita), pos, p.auditoria.suspeita ? 'bad' : 'ok', Number(p.auditoria.valor_suspeito) ? cmp(`${R0(p.auditoria.valor_suspeito)} envolvidos`, 'bad') : '', `${N0(p.auditoria.pendente)} pendentes · ${N0(p.auditoria.confirmada)} confirmada(s)`),
        k('Notas para conferir', N0(fi.docs_conferir), notas, fi.docs_conferir ? 'warn' : 'ok', '', fi.docs_conferir ? `${R0(fi.docs_conferir_valor)} com loja ou natureza a confirmar` : 'todas as notas importadas conferidas')];
      const patL = (P.por_loja || []).filter(x => x.loja_codigo && Number(x.valor) > 0).sort((a, b) => b.valor - a.valor).slice(0, 10).map(x => ({n: nomeLoja(x.loja_codigo), v: Number(x.valor)}));
      const invL = invLoja.filter(x => x.loja_codigo && Number(x.investimento) > 0).slice(0, 10).map(x => ({n: nomeLoja(x.loja_codigo), v: Number(x.investimento)}));
      const rk = (p.ranking_manutencao || []).slice(0, 8);
      const tMan = rk.length ? `<table><tr><th>Loja</th><th class="n">Ocorr.</th><th class="n">Valor</th></tr>${rk.map(x => `<tr><td>${esc(nomeLoja(x.loja_codigo))}</td><td class="n">${N0(x.ocorrencias)}</td><td class="n">${R0(x.valor)}</td></tr>`).join('')}<tr class="tot"><td>Total da rede (${N0((p.ranking_manutencao || []).length)} lojas)</td><td class="n">${N0(soma(p.ranking_manutencao || [], x => x.ocorrencias))}</td><td class="n">${R0(fi.manutencao_total)}</td></tr></table>` : '<div class="nota">Sem manutenção no período.</div>';
      const MAXP = 8, tOcP = abertas.length ? `<table><tr><th>Gravidade</th><th>Ocorrência</th><th>Loja</th><th class="n">Valor</th></tr>${abertas.slice(0, MAXP).map(o => `<tr><td><span class="chip ${o.gravidade}">${esc(o.gravidade[0].toUpperCase() + o.gravidade.slice(1))}</span></td><td>${esc(o.titulo)}</td><td>${esc(nomeLoja(o.loja_codigo))}</td><td class="n">${o.valor ? R0(o.valor) : '—'}</td></tr>`).join('')}<tr class="tot"><td colspan="3">Total · ${N0(abertas.length)} em aberto${abertas.length > MAXP ? ` (${MAXP} primeiras listadas)` : ''}</td><td class="n">${R0(valorAb)}</td></tr></table>` : '<div class="nota">Nenhuma ocorrência em aberto.</div>';
      const q1 = `<div class="pg">${cab(`Rede Esposende · ${filtros} · ${pos}`)}
        ${alertas.length ? `<div class="alerta">⚠ ${alertas.join('<br>⚠ ')}</div>` : ''}
        <h2>O que a empresa tem hoje</h2><div class="grid g4">${cards1.join('')}</div>
        <h2>Quanto foi gasto</h2><div class="grid g4">${cards2.join('')}</div>
        <div class="grid" style="grid-template-columns:1fr 2fr"><div><h2>O que falta investir</h2>${cards3[0]}</div><div><h2>Onde agir</h2><div class="grid g2">${cards3[1]}${cards3[2]}</div></div></div>
        <h2>Gasto mês a mês</h2><div class="box">${grafico(p.mensal, 1100, 150)}</div>${rod(1)}</div>`;
      const q2 = `<div class="pg">${cab(`Evolução e ranking · ${pos}`)}
        <div class="grid g2"><div class="box"><h3>Patrimônio por loja (top 10)</h3>${barras(patL, '#1f5fbf')}</div><div class="box"><h3>Investimento ${filtros.includes('2026') ? '2026 ' : ''}por loja (top 10)</h3>${barras(invL, '#7fa7e0')}</div></div>
        <div class="grid g2" style="margin-top:8px"><div class="box"><h3>Lojas que mais gastam com manutenção</h3>${tMan}</div><div class="box"><h3>Ocorrências de auditoria em aberto</h3>${tOcP}</div></div>
        <div class="nota">Fonte: módulo Segurança e CFTV · ${notas} · CD / Matriz fora dos rankings por loja.</div>${rod(2)}</div>`;
      return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Painel CFTV ${dBR(hoje())}</title><style>${CSS(true)}</style></head><body>${q1}${q2}</body></html>`;
    }
    const pg1 = `<div class="pg">${cab(`Rede Esposende · ${filtros} · ${pos}`)}
      ${alertas.length ? `<div class="alerta">⚠ ${alertas.join('<br>⚠ ')}</div>` : ''}
      <div class="res">A rede tem <b>${R0(P.total)}</b> em equipamentos de segurança, dos quais <b>${R0(pb.compras_2026)}</b> (${P.total ? PC(pb.compras_2026 / P.total * 100) : '—'}) foram investidos em 2026.
      ${lojas ? `Só <b>${N0(cob)} de ${N0(lojas)} lojas (${PC(cob / lojas * 100)})</b> têm câmera no estoque, onde mais some mercadoria.` : ''} ${Number(pl.total) ? `O projeto em aberto para fechar essa lacuna custa <b>${R0(pl.total)}</b>.` : ''}</div>
      <h2>Números principais</h2><div class="grid g4">${cards1.join('')}</div><div class="grid g4" style="margin-top:8px">${cards2.join('')}</div>
      <h2>O que os números mostram</h2><ul class="lst">${fatos.map(f => `<li>${f}</li>`).join('')}</ul>
      <h2>Gasto mês a mês (notas fiscais)</h2><div class="box">${grafico(p.mensal, 760, 150)}</div>${rod(1)}</div>`;
    const pg2 = `<div class="pg">${cab(`Decisões, projeto em aberto e pontos de auditoria · ${pos}`)}
      <h2>Decisões para a Diretoria</h2><ol class="dec">${dec.map(x => `<li>${x}</li>`).join('')}</ol>
      <div class="grid g2"><div><h2>Projeto em aberto · câmeras do estoque</h2>${tPlano}<div class="nota">Orçamento por loja do Plano e orçamento · câmera a ${R0(precoRef)} (gestão).</div></div><div><h2>Patrimônio por categoria</h2>${tCat}</div></div>
      <h2>Ocorrências de auditoria em aberto</h2>${tOc}
      <div class="nota">Fonte: módulo Segurança e CFTV · notas fiscais, inventário, manutenções, cobertura e cadastro oficial de lojas · ${notas}.</div>${rod(2)}</div>`;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório Executivo CFTV ${dBR(hoje())}</title><style>${CSS(false)}</style></head><body>${pg1}${pg2}</body></html>`;
  }

  // logo oficial em base64 (funciona na impressão e no "Salvar como PDF" sem depender de rede)
  let LOGO = null;
  async function logo() {
    if (LOGO) return LOGO;
    try { const b = await (await fetch('logo-esposende.jpg')).blob(); LOGO = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); }
    catch (e) { LOGO = ''; }
    return LOGO;
  }

  async function imprimir(tipo, nome) {
    if (!S.painel) { toast('Aguarde o painel carregar.'); return; }
    let fr = document.getElementById('relExecFrame');
    if (!fr) { fr = document.createElement('iframe'); fr.id = 'relExecFrame'; fr.title = 'Relatório'; fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'; document.body.appendChild(fr); }
    const doc = fr.contentWindow.document; doc.open(); doc.write(html(await logo(), tipo)); doc.close();
    await new Promise(r => { const im = doc.querySelector('img'); if (!im || im.complete) r(); else { im.onload = im.onerror = r; setTimeout(r, 2000); } });
    fr.contentWindow.focus(); fr.contentWindow.print();
    sb.rpc('cftv_registrar', {p_acao: 'exportacao', p_tabela: 'relatorio', p_registro: nome}).then(() => {});
  }
  window.relatorioExecutivo = () => imprimir('executivo', 'Relatório executivo');
  window.relatorioPainel = () => imprimir('painel', 'Painel em PDF');
  window.__relExecHtml = html; // usado só para conferência
})();
