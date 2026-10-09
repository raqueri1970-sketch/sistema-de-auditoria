// Comum às telas de Obras (Contas a Pagar, Presidente, Financeiro, Relatórios): login do Portal, formatação, PDF e utilidades.
const SB_URL = 'https://rdztzurfesnobfkazgpm.supabase.co';
const SB_KEY = 'sb_publishable_4LHSO4TrP7F4m4tpJyH44g_BGmfC92h';
// Dentro do Portal (mesmo endereço github.io) usa a MESMA sessão do Portal: não pede login de novo.
const NO_PORTAL = /github\.io$/.test(location.hostname);
const EMBUTIDO = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
if (EMBUTIDO) document.documentElement.classList.add('embutido');
const sb = supabase.createClient(SB_URL, SB_KEY, {auth: {persistSession: true, autoRefreshToken: true, ...(NO_PORTAL ? {} : {storageKey: 'obras-fluxo-auth'})}});
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const brl = v => Number(v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
const dBR = d => d ? String(d).substring(0, 10).split('-').reverse().slice(0, 2).join('/') : '';
const dBRano = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '';
const dtBR = iso => iso ? new Date(iso).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '—';
const num = t => { const s = String(t ?? '').trim().replace(/[R$\s]/g, ''); const n = Number(/,/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const hojeISO = () => new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
const CATS = {materiais_insumos: 'Materiais e insumos', alimentacao: 'Alimentação', transporte_combustivel: 'Transporte/combustível',
  estacionamento: 'Estacionamento', frete: 'Frete', mao_de_obra_prestador: 'Mão de obra/prestador', hospedagem: 'Hospedagem',
  equipamento_manutencao: 'Equipamentos/manutenção', taxas: 'Taxas', diversos: 'Diversos'};
// Situação de cada despesa (view obras_despesas_pagamento)
const SIT = {a_pagar: ['A pagar', 's-fechada'], parcial: ['Pago em parte', 's-aprovada'], com_financeiro: ['Com o Financeiro', 's-aberta'],
  pago: ['Pago', 's-auditada'], recusado: ['Recusada', 's-pendencia'], orcamento: ['Orçamento', 's-cinza'], duplicada: ['Duplicada', 's-cinza'],
  pendente_leitura: ['Sem leitura', 's-cinza']};
// Situação de cada pagamento (lote)
const PAG = {aprovado: ['Aprovado · com o Financeiro', 's-aberta'], pago: ['Pago · em auditoria', 's-paga'], auditado: ['Pago e auditado', 's-auditada'],
  pendencia: ['Pago · com pendência', 's-pendencia'], cancelado: ['Cancelado', 's-cinza']};
const RISCO = {normal: ['NORMAL', 'r-normal'], atencao: ['ATENÇÃO', 'r-atencao'], critico: ['CRÍTICO', 'r-critico']};
const FORMAS = {pix: 'PIX', transferencia: 'Transferência', dinheiro: 'Dinheiro', boleto: 'Boleto', cartao: 'Cartão'};
const chipDe = (mapa, k) => { const [t, c] = mapa[k] || [k, 's-cinza']; return `<span class="chip ${c}">${esc(t)}</span>`; };
const riscoChip = r => chipDe(RISCO, r || 'normal');
const sitChip = s => chipDe(SIT, s);
const pagChip = s => chipDe(PAG, s);
const msgErro = e => String(e && e.message || e).replace(/^.*?ERROR:\s*/, '');
const riscoDe = d => d.criticos > 0 ? 'critico' : d.atencoes > 0 ? 'atencao' : 'normal';

function toast(m, ms = 4000) { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', ms); }

// Menu entre as telas do módulo
function menu(ativo) {
  if (EMBUTIDO) return '';  // dentro do módulo Obras do Portal o menu é o do próprio módulo
  const itens = [['contas', '../obras-contas-pagar/', 'Contas a pagar'], ['presidente', '../obras-presidente/', 'Presidente'],
    ['financeiro', '../obras-financeiro/', 'Financeiro'], ['relatorios', '../obras-relatorios/', 'Relatórios e PDF']];
  return `<nav class="nav">${itens.map(([k, h, t]) => `<a href="${h}" class="${k === ativo ? 'on' : ''}">${t}</a>`).join('')}</nav>`;
}

// O Supabase devolve no máximo 1000 linhas por consulta: busca em páginas.
async function todos(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const {data, error} = await montar().range(de, de + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function abrirArquivo(path) {
  if (/^https?:\/\//.test(path)) return window.open(path, '_blank', 'noopener');
  const {data, error} = await sb.storage.from('obras-comprovantes').createSignedUrl(path, 300);
  if (error) return toast('Arquivo indisponível: ' + error.message, 5000);
  window.open(data.signedUrl, '_blank', 'noopener');
}
const ARQ = [];
const linkArquivo = (path, txt = 'ver') => path ? `<a href="#" onclick="abrirArquivo(ARQ[${ARQ.push(path) - 1}]);return false">${txt}</a>` : '';

// Janela (modal) simples
function abrirModal(html) {
  let m = $('modal');
  if (!m) { m = document.createElement('div'); m.id = 'modal'; m.className = 'modal'; document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) fecharModal(); }); }
  m.innerHTML = `<div class="mbox">${html}</div>`; m.style.display = 'flex';
  const f = m.querySelector('input,select,textarea'); if (f) setTimeout(() => f.focus(), 50);
}
function fecharModal() { const m = $('modal'); if (m) { m.style.display = 'none'; m.innerHTML = ''; } }

// Envia um comprovante de pagamento para a nuvem (bucket privado) e devolve o caminho
async function enviarComprovante(pagId, arq) {
  if (arq.size > 15 * 1024 * 1024) throw new Error('Arquivo muito grande (máx. 15 MB).');
  const nome = arq.name.normalize('NFD').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const path = `pagamentos/${pagId}/${Date.now()}_${nome}`;
  const up = await sb.storage.from('obras-comprovantes').upload(path, arq, {contentType: arq.type || 'application/octet-stream', upsert: false});
  if (up.error) throw new Error('Falha ao enviar o arquivo: ' + up.error.message);
  return path;
}

// Login com o mesmo usuário do Portal. onEntrar() roda quando há sessão.
function iniciarLogin(onEntrar) {
  const mostrarLogin = m => { $('vApp').classList.add('hidden'); $('vLogin').classList.remove('hidden'); $('lErr').textContent = m || ''; };
  window.sair = async () => { await sb.auth.signOut(); mostrarLogin(); };
  window.entrar = async () => {
    $('lErr').textContent = '';
    const r = await sb.auth.signInWithPassword({email: $('lEmail').value.trim(), password: $('lSenha').value});
    if (r.error) { $('lErr').textContent = 'Email ou senha incorretos.'; return; }
    $('vLogin').classList.add('hidden'); $('vApp').classList.remove('hidden'); onEntrar(r.data.user);
  };
  window.semPermissao = m => { mostrarLogin(m || 'Este usuário não tem acesso a esta tela.'); };
  const senha = $('lSenha'); if (senha) senha.addEventListener('keydown', e => { if (e.key === 'Enter') window.entrar(); });
  (async () => {
    const s = await sb.auth.getSession();
    if (s.data && s.data.session) { $('vLogin').classList.add('hidden'); $('vApp').classList.remove('hidden'); onEntrar(s.data.session.user); }
    else mostrarLogin();
  })();
}

async function papeis() {
  const q = p => sb.rpc('obras_tem_papel', {p_papel: p}).then(r => r.data === true, () => false);
  const [presidente, financeiro, admin] = await Promise.all([q('presidente'), q('financeiro'), q('__admin__')]);
  return {presidente, financeiro, admin};
}

// ---------- Dados ----------
const COLS_DESP = 'id,prestador,semana,semana_fim,data_despesa,hora_documento,fornecedor,categoria,descricao,tipo_doc,valor,status,situacao_pagamento,situacao,' +
  'valor_pago,valor_reservado,saldo,arquivo_path,obra,remetente,remetente_numero,confianca_ocr,criticos,atencoes,achados,pago_em,ultimo_pagamento_numero,recusado_motivo,recusado_por,recusado_em,pagamento_id,pagador';
const carregarDespesas = (filtro = q => q) => todos(() => filtro(sb.from('obras_despesas_pagamento').select(COLS_DESP)).order('data_despesa', {ascending: true}).order('id'));
const carregarSaldos = () => todos(() => sb.from('obras_saldo_prestador').select('*').order('prestador'));
const carregarPagamentos = () => todos(() => sb.from('obras_pagamentos').select('*').order('created_at', {ascending: false}));
const carregarItens = () => todos(() => sb.from('obras_pagamento_itens').select('pagamento_id,comprovante_id,valor').order('id'));
const carregarAdiantamentos = () => todos(() => sb.from('obras_adiantamentos').select('*').order('data', {ascending: false}));

// ---------- Exportação: PDF e planilha ----------
let _pdfLib = null;
function carregarScript(src) { return new Promise((ok, erro) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('Não carregou ' + src)); document.head.appendChild(s); }); }
async function pdfLib() {
  if (!_pdfLib) _pdfLib = (async () => {
    if (!window.jspdf) await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    return window.jspdf.jsPDF;
  })().catch(e => { _pdfLib = null; throw e; });
  return _pdfLib;
}
const pdfTxt = s => String(s ?? '').replace(/[^\x00-\xFF€]/g, '');  // a fonte padrão do PDF não tem emoji
const celTxt = c => c && typeof c === 'object' ? c.t : c;
const V = v => ({t: brl(v), n: Number(v || 0)});

// doc = {titulo, subtitulo, resumo: [[rótulo, valor]], secoes: [{titulo, cab, linhas, rodape, direita: [índices de colunas numéricas], nota}], assinaturas: [..], arquivo, paisagem}
async function gerarPDF(doc) {
  const JsPDF = await pdfLib();
  const pdf = new JsPDF({orientation: doc.paisagem ? 'landscape' : 'portrait', unit: 'pt', format: 'a4'});
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 36;
  pdf.setFillColor(11, 16, 32); pdf.rect(0, 0, W, 64, 'F');
  pdf.setTextColor(255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text(pdfTxt(doc.titulo), M, 30);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.text(pdfTxt(doc.subtitulo || 'Obras & Reformas - Esposende'), M, 47);
  pdf.text('Emitido em ' + new Date().toLocaleString('pt-BR'), W - M, 47, {align: 'right'});
  pdf.setTextColor(20); let y = 84;
  if (doc.resumo && doc.resumo.length) {
    const col = Math.min(4, doc.resumo.length), cw = (W - 2 * M) / col;
    doc.resumo.forEach(([l, v], i) => {
      const x = M + (i % col) * cw, yy = y + Math.floor(i / col) * 40;
      pdf.setDrawColor(210); pdf.roundedRect(x, yy - 12, cw - 8, 34, 4, 4);
      pdf.setFontSize(8); pdf.setTextColor(100); pdf.text(pdfTxt(l), x + 8, yy);
      pdf.setFontSize(11.5); pdf.setTextColor(20); pdf.setFont('helvetica', 'bold'); pdf.text(pdfTxt(v), x + 8, yy + 15); pdf.setFont('helvetica', 'normal');
    });
    y += Math.ceil(doc.resumo.length / col) * 40 + 8;
  }
  for (const s of doc.secoes || []) {
    if (y > H - 90) { pdf.addPage(); y = 50; }
    if (s.titulo) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(pdfTxt(s.titulo), M, y); pdf.setFont('helvetica', 'normal'); y += 6; }
    if (s.nota) { pdf.setFontSize(8.5); pdf.setTextColor(90); const ls = pdf.splitTextToSize(pdfTxt(s.nota), W - 2 * M); pdf.text(ls, M, y + 9); y += 9 + ls.length * 10; pdf.setTextColor(20); }
    const colStyles = {}; (s.direita || []).forEach(i => colStyles[i] = {halign: 'right'});
    pdf.autoTable({startY: y + 4, head: [s.cab.map(pdfTxt)], body: s.linhas.map(l => l.map(c => pdfTxt(celTxt(c)))), foot: s.rodape ? [s.rodape.map(c => pdfTxt(celTxt(c)))] : undefined,
      margin: {left: M, right: M}, styles: {fontSize: 8, cellPadding: 3.5, overflow: 'linebreak'}, columnStyles: colStyles,
      headStyles: {fillColor: [37, 99, 235], textColor: 255}, footStyles: {fillColor: [235, 238, 245], textColor: 20, fontStyle: 'bold'},
      alternateRowStyles: {fillColor: [247, 248, 252]}, showFoot: 'lastPage',
      didParseCell: c => { if (c.section !== 'body' && (s.direita || []).includes(c.column.index)) c.cell.styles.halign = 'right'; }});
    y = pdf.lastAutoTable.finalY + 22;
  }
  if (doc.assinaturas && doc.assinaturas.length) {
    if (y > H - 100) { pdf.addPage(); y = 80; }
    y += 30; const cw = (W - 2 * M) / doc.assinaturas.length;
    doc.assinaturas.forEach((a, i) => { const x = M + i * cw; pdf.setDrawColor(120); pdf.line(x + 10, y, x + cw - 10, y);
      pdf.setFontSize(8.5); pdf.text(pdfTxt(a), x + cw / 2, y + 12, {align: 'center'}); });
  }
  const n = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(120);
    pdf.text(`Pagina ${i} de ${n}`, W - M, H - 18, {align: 'right'}); pdf.text('Sistema de Auditoria Esposende - documento gerado automaticamente', M, H - 18); }
  pdf.save((doc.arquivo || doc.titulo).normalize('NFD').replace(/[^A-Za-z0-9._-]+/g, '_') + '.pdf');
}

function baixarCSV(nome, cab, linhas) {
  const c = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const txt = '﻿' + [cab, ...linhas].map(l => l.map(c).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], {type: 'text/csv;charset=utf-8'}));
  a.download = nome.normalize('NFD').replace(/[^A-Za-z0-9._-]+/g, '_') + '.csv'; document.body.appendChild(a); a.click(); a.remove();
}
const nCSV = v => Number(v || 0).toFixed(2).replace('.', ',');

// Recibo de um pagamento (lote) em PDF — usado pelo Presidente, Financeiro e Relatórios
async function pdfPagamento(pagId) {
  const [{data: p, error: e1}, itens] = await Promise.all([
    sb.from('obras_pagamentos').select('*').eq('id', pagId).single(),
    todos(() => sb.from('obras_pagamento_itens').select('comprovante_id,valor').eq('pagamento_id', pagId).order('id'))]);
  if (e1) throw e1;
  const desp = itens.length ? await carregarDespesas(q => q.in('id', itens.map(i => i.comprovante_id))) : [];
  const ev = await todos(() => sb.from('obras_pagamento_eventos').select('evento,usuario,detalhes,created_at').eq('pagamento_id', pagId).order('created_at'));
  const linhas = itens.map(i => { const d = desp.find(x => x.id === i.comprovante_id) || {};
    return [dBRano(d.data_despesa), d.fornecedor || '', CATS[d.categoria] || d.categoria || '', brl(d.valor), brl(i.valor), Number(i.valor) < Number(d.valor) - 0.005 ? 'Parcial' : 'Total']; })
    .sort((a, b) => a[0].split('/').reverse().join().localeCompare(b[0].split('/').reverse().join()));
  await gerarPDF({titulo: `Pagamento nº ${p.numero} - ${p.prestador}`, subtitulo: 'Obras & Reformas - Esposende - comprovante de pagamento ao prestador',
    resumo: [['Despesas pagas', brl(p.valor_itens)], ['Adiantamento descontado', brl(p.valor_abatido)], ['Valor do pagamento', brl(p.valor_aprovado)],
      ['Situação', (PAG[p.status] || [p.status])[0]], ['Aprovado por', `${p.aprovado_por || '-'} ${dtBR(p.aprovado_em)}`], ['Pago por', p.pago_por ? `${p.pago_por} ${dtBR(p.pago_em)}` : '-'],
      ['Favorecido', p.favorecido || p.prestador], ['Forma / chave', `${FORMAS[p.forma_pagamento] || p.forma_pagamento || '-'} ${p.pix_chave || ''}`]],
    secoes: [{titulo: `Despesas incluídas (${linhas.length})`, cab: ['Data', 'Fornecedor', 'Categoria', 'Valor do recibo', 'Pago aqui', ''], linhas, direita: [3, 4],
        rodape: ['', '', 'Total', brl(desp.reduce((a, d) => a + Number(d.valor), 0)), brl(p.valor_itens), '']},
      {titulo: 'Histórico', cab: ['Quando', 'O quê', 'Quem', 'Detalhe'], linhas: ev.map(e => [dtBR(e.created_at), e.evento.replace(/_/g, ' '), e.usuario || '',
        Object.entries(e.detalhes || {}).filter(([k]) => !['arquivo'].includes(k)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' | ')])},
      ...(p.auditoria_resultado ? [{titulo: 'Agente Auditor', cab: ['Resultado'], linhas: [[p.auditoria_resultado]]}] : [])],
    assinaturas: ['Presidente', 'Financeiro', `Prestador: ${p.prestador}`], arquivo: `pagamento_${p.numero}_${p.prestador}`});
}

// Extrato completo de um prestador (despesas, pagamentos, adiantamentos e saldo). periodo = {de, ate} opcional.
function modeloExtrato(prestador, desp, pags, adis, saldo, periodo = {}) {
  const noPer = d => (!periodo.de || d >= periodo.de) && (!periodo.ate || d <= periodo.ate);
  const lanc = desp.filter(d => d.status === 'lancado' && noPer(d.data_despesa || ''));
  const abertos = desp.filter(d => Number(d.saldo) > 0);
  const linhaD = d => [dBRano(d.data_despesa), d.fornecedor || '', CATS[d.categoria] || d.categoria || '', V(d.valor), V(d.valor_pago), V(d.saldo), (SIT[d.situacao] || [d.situacao])[0]];
  const soma = (a, f) => a.reduce((t, x) => t + Number(x[f] || 0), 0);
  const pg = pags.filter(p => p.status !== 'cancelado' && noPer((p.pago_em || p.created_at || '').slice(0, 10)));
  const ad = adis.filter(a => !a.cancelado && noPer(a.data));
  const per = periodo.de || periodo.ate ? `Período ${periodo.de ? dBRano(periodo.de) : 'início'} a ${periodo.ate ? dBRano(periodo.ate) : 'hoje'}` : 'Todo o período';
  return {titulo: `Extrato do prestador - ${prestador}`, subtitulo: `Obras & Reformas - Esposende - ${per}`,
    resumo: [['Despesas no período', brl(soma(lanc.filter(d => d.situacao !== 'recusado'), 'valor'))], ['Pago no período', brl(soma(lanc, 'valor_pago'))],
      ['Em aberto (hoje)', brl(saldo.em_aberto)], ['Adiantamento a descontar', brl(saldo.adiantamento_disponivel)],
      ['TOTAL A PAGAR (hoje)', brl(saldo.saldo_devedor)], ['Com o Financeiro', brl(saldo.com_financeiro)],
      ['PIX / conta', saldo.pix_chave ? `${saldo.pix_tipo || ''} ${saldo.pix_chave}` : (saldo.banco ? `${saldo.banco} ${saldo.agencia || ''} ${saldo.conta || ''}` : 'nao cadastrado')]],
    secoes: [
      {titulo: `Contas a pagar em aberto (${abertos.length})`, nota: 'Saldo acumulado de todas as semanas ainda não pagas.', cab: ['Data', 'Fornecedor', 'Categoria', 'Recibo', 'Já pago', 'Em aberto', 'Situação'],
        linhas: abertos.map(linhaD), direita: [3, 4, 5], rodape: ['', '', 'Total', V(soma(abertos, 'valor')), V(soma(abertos, 'valor_pago')), V(soma(abertos, 'saldo')), '']},
      {titulo: `Pagamentos (${pg.length})`, cab: ['Nº', 'Data', 'Despesas', 'Adiant. desc.', 'Valor pago', 'Situação', 'Aprovado / pago por'],
        linhas: pg.map(p => [p.numero, dBRano((p.pago_em || p.created_at).slice(0, 10)), V(p.valor_itens), V(p.valor_abatido), V(p.valor_pago ?? p.valor_aprovado),
          (PAG[p.status] || [p.status])[0], `${p.aprovado_por || ''}${p.pago_por ? ' / ' + p.pago_por : ''}`]), direita: [2, 3, 4],
        rodape: ['', '', V(soma(pg, 'valor_itens')), V(soma(pg, 'valor_abatido')), V(pg.reduce((t, p) => t + Number(p.valor_pago ?? p.valor_aprovado), 0)), '', '']},
      ...(ad.length ? [{titulo: `Adiantamentos (${ad.length})`, cab: ['Data', 'Valor', 'Observação', 'Registrado por'],
        linhas: ad.map(a => [dBRano(a.data), V(a.valor), a.observacao || '', a.registrado_por || '']), direita: [1], rodape: ['Total', V(soma(ad, 'valor')), '', '']}] : []),
      {titulo: `Todas as despesas do período (${lanc.length})`, cab: ['Data', 'Fornecedor', 'Categoria', 'Recibo', 'Pago', 'Em aberto', 'Situação'],
        linhas: lanc.map(linhaD), direita: [3, 4, 5], rodape: ['', '', 'Total (sem recusadas)', V(soma(lanc.filter(d => d.situacao !== 'recusado'), 'valor')), V(soma(lanc, 'valor_pago')), V(soma(lanc, 'saldo')), '']}],
    assinaturas: ['Presidente', 'Financeiro', `Prestador: ${prestador}`], arquivo: `extrato_${prestador}_${hojeISO()}`, paisagem: false};
}
const pdfExtrato = (...a) => gerarPDF(modeloExtrato(...a));

function baixarCSVModelo(m) {
  const linhas = [];
  for (const s of m.secoes) {
    linhas.push([s.titulo || '']); linhas.push(s.cab);
    for (const l of s.linhas) linhas.push(l.map(c => c && typeof c === 'object' ? nCSV(c.n) : c));
    if (s.rodape) linhas.push(s.rodape.map(c => c && typeof c === 'object' ? nCSV(c.n) : c));
    linhas.push([]);
  }
  baixarCSV(m.arquivo || m.titulo, [m.titulo], linhas);
}
// Mostra o mesmo modelo do PDF na tela
function htmlModelo(m) {
  const cel = (c, i, s) => `<td class="${(s.direita || []).includes(i) ? 'r' : ''}">${esc(celTxt(c))}</td>`;
  return `${m.resumo ? `<div class="grid" style="margin:10px 0">${m.resumo.map(([l, v]) => `<div class="card kpi"><div class="l">${esc(l)}</div><div class="v" style="font-size:19px">${esc(v)}</div></div>`).join('')}</div>` : ''}
    ${m.secoes.map(s => `<div class="card" style="margin-top:12px"><b>${esc(s.titulo || '')}</b>${s.nota ? `<div class="small mut">${esc(s.nota)}</div>` : ''}
      ${s.linhas.length ? `<div class="tw"><table><thead><tr>${s.cab.map((h, i) => `<th class="${(s.direita || []).includes(i) ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${s.linhas.slice(0, 400).map(l => `<tr>${l.map((c, i) => cel(c, i, s)).join('')}</tr>`).join('')}</tbody>
      ${s.rodape ? `<tfoot><tr>${s.rodape.map((c, i) => cel(c, i, s)).join('')}</tr></tfoot>` : ''}</table></div>
      ${s.linhas.length > 400 ? `<div class="small mut">Mostrando 400 de ${s.linhas.length} linhas na tela — o PDF e a planilha trazem todas.</div>` : ''}` : '<div class="small mut">Nada no filtro.</div>'}</div>`).join('')}`;
}

// ---------- Gráficos (SVG próprio, com dica ao passar o mouse/tocar) ----------
const COR = {s1: '#3987e5', s2: '#d95926'};
const brlCurto = v => { v = Number(v || 0); const a = Math.abs(v);
  return a >= 1e6 ? 'R$ ' + (v / 1e6).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + ' mi'
    : a >= 1e3 ? 'R$ ' + (v / 1e3).toLocaleString('pt-BR', {maximumFractionDigits: a >= 1e4 ? 0 : 1}) + ' mil' : brl(v); };
function dica() { let t = $('tt'); if (!t) { t = document.createElement('div'); t.id = 'tt'; t.className = 'tt'; document.body.appendChild(t); } return t; }
function ligarDicas(el, conteudo) {
  const t = dica();
  el.querySelectorAll('[data-i]').forEach(h => {
    const mostrar = e => { const p = e.touches ? e.touches[0] : e; t.innerHTML = conteudo(Number(h.dataset.i)); t.style.display = 'block';
      const w = t.offsetWidth; t.style.left = Math.min(window.innerWidth - w - 8, p.clientX + 14) + 'px'; t.style.top = (p.clientY + 14) + 'px';
      el.querySelectorAll('[data-g="' + h.dataset.i + '"]').forEach(m => m.style.opacity = 1);
      el.querySelectorAll('[data-g]:not([data-g="' + h.dataset.i + '"])').forEach(m => m.style.opacity = .45); };
    const esconder = () => { t.style.display = 'none'; el.querySelectorAll('[data-g]').forEach(m => m.style.opacity = 1); };
    h.addEventListener('mousemove', mostrar); h.addEventListener('mouseleave', esconder);
    h.addEventListener('touchstart', mostrar, {passive: true}); h.addEventListener('touchend', () => setTimeout(esconder, 1500));
  });
}
function escala(max) { const p = Math.pow(10, Math.floor(Math.log10(max || 1))), m = (max || 1) / p, passo = (m <= 2 ? .5 : m <= 5 ? 1 : 2) * p;
  return {topo: Math.ceil((max || 1) / passo) * passo, passo}; }

// Barras horizontais: um valor por item (ex.: total a pagar por prestador). itens = [{rotulo, valor, det}]
function graficoBarrasH(el, itens, {vazio = 'Nada em aberto.'} = {}) {
  if (!itens.length) { el.innerHTML = `<div class="vazio">${esc(vazio)}</div>`; return; }
  const W = 600, LBL = 150, VAL = 86, H = 34, max = Math.max(...itens.map(i => i.valor)) || 1, larg = W - LBL - VAL;
  const linhas = itens.map((it, i) => { const y = i * H, w = Math.max(2, it.valor / max * larg);
    return `<g data-g="${i}"><text x="0" y="${y + 21}" style="fill:var(--txt2);font-size:12.5px;font-weight:600">${esc(it.rotulo.length > 20 ? it.rotulo.slice(0, 19) + '…' : it.rotulo)}</text>
      <rect x="${LBL}" y="${y + 8}" width="${w}" height="18" rx="4" fill="${COR.s1}"/>
      <text class="vl" x="${LBL + w + 8}" y="${y + 21}">${esc(brlCurto(it.valor))}</text></g>
      <rect class="hit" data-i="${i}" x="0" y="${y}" width="${W}" height="${H}"/>`; }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${itens.length * H}" role="img" aria-label="Total a pagar por prestador">${linhas}</svg>`;
  ligarDicas(el, i => `<b>${esc(itens[i].rotulo)}</b><div><span><i style="background:${COR.s1}"></i>A pagar</span><span>${brl(itens[i].valor)}</span></div>${itens[i].det || ''}`);
}

// Colunas agrupadas por semana: duas séries no mesmo eixo de R$. pontos = [{rotulo, a, b, det}], nomes = ['Despesas', 'Pago']
function graficoColunas(el, pontos, nomes) {
  if (!pontos.length) { el.innerHTML = '<div class="vazio">Sem movimento no período.</div>'; return; }
  const W = 600, H = 230, ESQ = 58, BASE = H - 26, TOPO = 12, {topo, passo} = escala(Math.max(...pontos.flatMap(p => [p.a, p.b])));
  const y = v => BASE - v / topo * (BASE - TOPO), g = (W - ESQ) / pontos.length, bw = Math.max(8, Math.min(22, (g - 10) / 2));
  let grade = ''; for (let v = 0; v <= topo + 1e-9; v += passo) grade += `<line class="${v ? 'grade' : 'base'}" x1="${ESQ}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${ESQ - 8}" y="${y(v) + 4}" text-anchor="end">${esc(brlCurto(v).replace('R$ ', ''))}</text>`;
  const cada = Math.ceil(pontos.length / 8);
  const cols = pontos.map((p, i) => { const cx = ESQ + g * i + g / 2, x1 = cx - bw - 1, x2 = cx + 1;
    const barra = (x, v, c) => v > 0 ? `<path d="M${x},${BASE} V${y(v) + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${BASE} Z" fill="${c}"/>` : '';
    return `<g data-g="${i}">${barra(x1, p.a, COR.s1)}${barra(x2, p.b, COR.s2)}</g>
      ${i % cada === 0 ? `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(p.rotulo)}</text>` : ''}
      <rect class="hit" data-i="${i}" x="${ESQ + g * i}" y="0" width="${g}" height="${BASE}"/>`; }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(nomes.join(' e '))} por semana">${grade}${cols}</svg>`;
  ligarDicas(el, i => `<b>${esc(pontos[i].titulo || pontos[i].rotulo)}</b>
    <div><span><i style="background:${COR.s1}"></i>${esc(nomes[0])}</span><span>${brl(pontos[i].a)}</span></div>
    <div><span><i style="background:${COR.s2}"></i>${esc(nomes[1])}</span><span>${brl(pontos[i].b)}</span></div>${pontos[i].det || ''}`);
}
const legenda = nomes => `<span class="leg">${nomes.map((n, i) => `<span><i style="background:${i ? COR.s2 : COR.s1}"></i>${esc(n)}</span>`).join('')}</span>`;

// Semanas do fluxo de caixa (todas as obras somadas), últimas n semanas
function semanasFluxo(fluxo, n = 10, prest = null) {
  const m = {};
  for (const f of fluxo) { if (prest && f.prestador !== prest) continue;
    const s = m[f.semana] = m[f.semana] || {semana: f.semana, fim: f.semana_fim, a: 0, b: 0};
    s.a += Number(f.despesas || 0); s.b += Number(f.pago_legado || 0) + Number(f.pagamentos || 0) + Number(f.adiantamentos || 0); }
  return Object.values(m).sort((x, y) => x.semana.localeCompare(y.semana)).slice(-n)
    .map(s => ({rotulo: dBR(s.semana), titulo: `Semana ${dBR(s.semana)} a ${dBR(s.fim)}`, a: s.a, b: s.b}));
}
