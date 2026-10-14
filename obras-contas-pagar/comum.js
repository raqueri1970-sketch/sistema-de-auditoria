// Comum às telas de Obras (Contas a Pagar, Presidente, Relatórios): login do Portal, formatação, PDF e utilidades.
// 14/10/2026: o Financeiro saiu do fluxo — é direto despesa → pagamento ("Já paguei" do Presidente).
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
const SIT = {a_pagar: ['A pagar', 's-fechada'], parcial: ['Pago em parte', 's-aprovada'], com_financeiro: ['Aguardando pagamento', 's-aberta'],
  pago: ['Pago', 's-auditada'], recusado: ['Recusada', 's-pendencia'], orcamento: ['Orçamento', 's-cinza'], duplicada: ['Duplicada', 's-cinza'],
  pendente_leitura: ['Sem leitura', 's-cinza'], agrupado: ['Somado na nota', 's-cinza']};
// Situação de cada pagamento (lote)
const PAG = {aprovado: ['Aprovado · aguardando pagamento', 's-aberta'], pago: ['Pago · em auditoria', 's-paga'], auditado: ['Pago e auditado', 's-auditada'],
  pendencia: ['Pago · com pendência', 's-pendencia'], cancelado: ['Cancelado', 's-cinza']};
const RISCO = {normal: ['NORMAL', 'r-normal'], atencao: ['ATENÇÃO', 'r-atencao'], critico: ['CRÍTICO', 'r-critico']};
const FORMAS = {pix: 'PIX', transferencia: 'Transferência', dinheiro: 'Dinheiro', boleto: 'Boleto', cartao: 'Cartão'};
const chipDe = (mapa, k) => { const [t, c] = mapa[k] || [k, 's-cinza']; return `<span class="chip ${c}">${esc(t)}</span>`; };
const riscoChip = r => chipDe(RISCO, r || 'normal');
const sitChip = s => chipDe(SIT, s);
const pagChip = s => chipDe(PAG, s);
const msgErro = e => String(e && e.message || e).replace(/^.*?ERROR:\s*/, '');
const riscoDe = d => d.criticos > 0 ? 'critico' : d.atencoes > 0 ? 'atencao' : 'normal';

// Dentro do Portal o quadro (iframe) cresce com o conteúdo, sem rolagem própria (no celular a rolagem dupla "andava").
// Por isso janelas e avisos são colocados na parte do quadro que está visível na tela.
function areaVisivel() {
  try { const f = window.frameElement; if (!EMBUTIDO || !f) return null;
    const r = f.getBoundingClientRect(), h = f.ownerDocument.defaultView.innerHeight;
    const top = Math.max(0, -r.top), alt = Math.max(200, Math.min(h, r.bottom) - Math.max(0, r.top));
    return {top, alt};
  } catch (e) { return null; }
}
function topo() { const f = (() => { try { return EMBUTIDO && window.frameElement; } catch (e) { return null; } })();
  if (f && f.getBoundingClientRect().top < 0) f.scrollIntoView({block: 'start'}); else window.scrollTo(0, 0); }

function toast(m, ms = 4000) { const t = $('toast'); t.textContent = m; t.style.display = 'block';
  const a = areaVisivel(); if (a) t.style.top = (a.top + a.alt - t.offsetHeight - 16) + 'px';
  clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', ms); }

// Quem não aparece mais nas visões de pagamento (pedido do Ricardo, 11/10/2026). Voltam a aparecer sozinhos
// se tiverem valor em aberto ou com o Financeiro — nunca some dinheiro devido da tela.
const PRESTADORES_OCULTOS = ['victor kleber', 'enildo', 'everton nunes luz', 'paulo almeida'];
const prestVisivel = s => !PRESTADORES_OCULTOS.includes(String(s.prestador || '').trim().toLowerCase())
  || Number(s.saldo_devedor) > 0 || Number(s.com_financeiro) > 0 || Number(s.em_aberto) > 0;

// Menu entre as telas do módulo
function menu(ativo) {
  if (EMBUTIDO) return '';  // dentro do módulo Obras do Portal o menu é o do próprio módulo
  const itens = [['contas', '../obras-contas-pagar/', 'Visão geral'], ['presidente', '../obras-presidente/', 'Pagamentos'],
    ['relatorios', '../obras-relatorios/', 'Relatórios e PDF']];
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

// Abre o comprovante numa janela dentro da própria tela. (Antes abria aba nova depois de esperar o link assinado —
// o celular bloqueia esse pop-up e a foto "não abria" na visão do Presidente.)
// 14/10/2026: o PDF num quadro (iframe) dentro do Portal era bloqueado pelo Chrome ("Esta página foi bloqueada").
// Agora o arquivo é baixado com a sessão do Portal e mostrado sem quadro: foto como imagem, PDF desenhado página a página.
let _pdfjs = null;
async function pdfjs() {
  if (!_pdfjs) _pdfjs = (async () => {
    await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return window.pdfjsLib;
  })().catch(e => { _pdfjs = null; throw e; });
  return _pdfjs;
}
// Mostra um arquivo (foto ou PDF) dentro de um elemento: baixa com a sessão do Portal, sem quadro (o Chrome bloqueava o PDF).
async function mostrarArquivoEm(v, path, larguraMax = 880) {
  if (!v) return;
  if (!path) { v.innerHTML = '<div class="crit">Sem arquivo do comprovante.</div>'; return; }
  v.innerHTML = '<div class="vazio">Carregando…</div>';
  let blob;
  try {
    if (/^https?:\/\//.test(path)) { const r = await fetch(path); if (!r.ok) throw new Error('HTTP ' + r.status); blob = await r.blob(); }
    else { const {data, error} = await sb.storage.from('obras-comprovantes').download(path); if (error) throw error; blob = data; }
  } catch (e) { v.innerHTML = `<div class="crit">Arquivo indisponível: ${esc(msgErro(e))}</div>`; return; }
  const pdf = /\.pdf($|\?)/i.test(path) || blob.type === 'application/pdf';
  const url = URL.createObjectURL(pdf ? new Blob([blob], {type: 'application/pdf'}) : blob);
  const nome = String(path).split('/').pop().split('?')[0] || 'comprovante';
  const baixar = `<div class="row" style="justify-content:center;margin-top:8px"><a class="btn b-pri" href="${url}" download="${esc(nome)}">Baixar arquivo</a></div>`;
  if (!pdf) { v.innerHTML = `<img src="${url}" alt="comprovante" onerror="this.outerHTML='<div class=crit>Não foi possível mostrar a imagem.</div>'">` + baixar; return; }
  v.innerHTML = '<div class="vazio">Abrindo o PDF…</div>';
  try {
    const lib = await pdfjs(), doc = await lib.getDocument({data: new Uint8Array(await blob.arrayBuffer())}).promise;
    v.innerHTML = '';
    const larg = Math.min(larguraMax, (v.clientWidth || 800));
    for (let n = 1; n <= Math.min(doc.numPages, 30); n++) {
      const pg = await doc.getPage(n), vp0 = pg.getViewport({scale: 1}), esc2 = larg / vp0.width * (window.devicePixelRatio || 1);
      const vp = pg.getViewport({scale: esc2}), c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height; c.style.width = '100%'; c.className = 'pdfpag';
      v.appendChild(c); await pg.render({canvasContext: c.getContext('2d'), viewport: vp}).promise;
    }
    if (doc.numPages > 30) v.insertAdjacentHTML('beforeend', `<div class="small mut">Mostrando 30 de ${doc.numPages} páginas — baixe o arquivo para ver todas.</div>`);
    v.insertAdjacentHTML('beforeend', baixar);
  } catch (e) { v.innerHTML = `<div class="crit">Não foi possível mostrar o PDF (${esc(msgErro(e))}).</div>` + baixar; }
}
async function abrirArquivo(path, titulo = 'Comprovante') {
  abrirModal(`<div class="row" style="justify-content:space-between"><h3 style="margin:0">${esc(titulo)}</h3><button class="btn" onclick="fecharModal()">Fechar ✕</button></div>
    <div class="visor" id="visor"><div class="vazio">Carregando…</div></div>`, 'larga');
  await mostrarArquivoEm($('visor'), path);
}

// ---------- Possível duplicidade: as fotos lado a lado (14/10/2026, pedido do Ricardo) ----------
const REGRAS_DUP = ['duplicidade_valor_data_fornecedor', 'duplicidade_autenticacao', 'arquivo_repetido'];
// Link "comparar as fotos" para um ponto do Auditor (a = {regra, relacionado_id, id}) da despesa d
function linkComparar(d, a) {
  if (!d || !a) return '';
  if (REGRAS_DUP.includes(a.regra) && a.relacionado_id) return `<a href="#" onclick="compararFotos(['${d.id}','${a.relacionado_id}'],['${a.id}']);return false">🔍 comparar as 2 fotos</a>`;
  if (a.regra === 'fornecedor_varias_vezes_dia') return `<a href="#" onclick="compararMesmoDia('${d.id}',['${a.id}']);return false">🔍 ver as fotos do dia</a>`;
  return '';
}
async function compararMesmoDia(id, achados) {
  const {data: d} = await sb.from('obras_despesas_pagamento').select('id,prestador,data_despesa,fornecedor').eq('id', id).single();
  if (!d) return toast('Despesa não encontrada.');
  const {data} = await sb.from('obras_despesas_pagamento').select('id,fornecedor').eq('prestador', d.prestador).eq('data_despesa', d.data_despesa).eq('status', 'lancado');
  const chave = s => normTxt(s).split(' ').slice(0, 2).join(' ');
  const ids = (data || []).filter(x => chave(x.fornecedor) === chave(d.fornecedor)).map(x => x.id);
  compararFotos(ids.length ? ids : [id], achados);
}
async function compararFotos(ids, achados = []) {
  ids = [...new Set(ids)].slice(0, 8);
  abrirModal(`<div class="row" style="justify-content:space-between"><h3 style="margin:0">Possível duplicidade · compare as fotos</h3><button class="btn" onclick="fecharModal()">Fechar ✕</button></div>
    <div id="cmp" class="vazio">Carregando…</div>`, 'larga');
  const {data, error} = await sb.from('obras_despesas_pagamento').select(COLS_DESP + ',wa_data').in('id', ids);
  if (error) { $('cmp').innerHTML = `<div class="crit">${esc(msgErro(error))}</div>`; return; }
  const l = (data || []).sort((a, b) => String(a.wa_data || a.data_despesa).localeCompare(String(b.wa_data || b.data_despesa)));
  window.CMP = {l, achados};
  const box = $('cmp'); box.className = '';
  box.innerHTML = `<div class="cmp-grid">${l.map((d, i) => `<div class="cmp-col"><div class="small"><b>${i === 0 ? 'Chegou primeiro' : 'Chegou depois'}</b> · ${dtBR(d.wa_data) !== '—' ? 'enviada ' + dtBR(d.wa_data) : ''}</div>
      <div style="font-weight:800;margin-top:4px">${esc(d.fornecedor || 'Fornecedor não lido')}</div>
      <div class="small">${dBRano(d.data_despesa)}${d.hora_documento ? ' ' + esc(String(d.hora_documento).slice(0, 5)) : ''} · <b>${brl(d.valor)}</b> · ${esc(d.prestador || '')} · ${(SIT[d.situacao] || [d.situacao])[0]}</div>
      <div class="small mut">${esc(String(d.descricao || '').slice(0, 140))}</div>
      <div class="visor" id="cmpv_${i}" style="margin-top:6px"></div></div>`).join('')}</div>
    ${PODE_DECIDIR() && l.length >= 2 ? `<div class="row" style="justify-content:flex-end;margin-top:12px">
      <button class="btn" onclick="naoEhDuplicada()">Não é duplicada (são gastos diferentes)</button>
      <button class="btn b-bad" onclick="ehDuplicada()">É duplicada: recusar a que chegou depois</button></div>` : ''}`;
  l.forEach((d, i) => mostrarArquivoEm($('cmpv_' + i), d.arquivo_path, 440));
}
const PODE_DECIDIR = () => typeof PAP === 'object' && PAP && (PAP.presidente || PAP.admin);
async function naoEhDuplicada() {
  const ids = (CMP.achados || []).filter(Boolean);
  // resolve os pontos de duplicidade das despesas comparadas
  const todos = CMP.l.flatMap(d => (d.achados || []).filter(a => REGRAS_DUP.includes(a.regra) || a.regra === 'fornecedor_varias_vezes_dia').map(a => a.id));
  const {error} = await sb.rpc('obras_resolver_achados', {p_ids: [...new Set([...ids, ...todos])], p_observacao: 'Fotos comparadas: não é duplicidade (gastos diferentes)'});
  if (error) return toast(msgErro(error), 6000);
  fecharModal(); toast('Registrado: não é duplicada.'); if (typeof carregar === 'function') carregar();
}
async function ehDuplicada() {
  const d = CMP.l[CMP.l.length - 1];
  if (Number(d.valor_pago) > 0) return toast('A que chegou depois já foi paga — cancele o pagamento antes.', 6000);
  if (!confirm(`Recusar "${d.fornecedor || ''}" de ${brl(d.valor)} (a que chegou depois)? Ela sai do total como duplicada.`)) return;
  const {error} = await sb.rpc('obras_despesa_recusar', {p_comp: d.id, p_motivo: 'Duplicidade confirmada na comparação das fotos (igual à que chegou primeiro)'});
  if (error) return toast(msgErro(error), 6000);
  fecharModal(); toast('Duplicada recusada: saiu do total.'); if (typeof carregar === 'function') carregar();
}
const ARQ = [];
const linkArquivo = (path, txt = 'ver') => path ? `<a href="#" onclick="abrirArquivo(ARQ[${ARQ.push(path) - 1}]);return false">${txt}</a>` : '';

// Orçamento: a descrição lida pela IA vem como "ITEM (2 UNID x 41,00 = 82,00), ITEM (...)". Vira lista item → valor.
function itensOrcamento(desc) {
  const out = [];
  for (const parte of String(desc || '').split(/\),\s*/)) {
    const m = /^(.*?)\s*\((.*?)=\s*([\d.]+,\d{2})\)?\s*$/.exec(parte.trim());
    if (m) out.push({item: m[1].trim(), qtd: m[2].replace(/\s*x\s*[\d.,]+\s*$/i, '').trim(), valor: num(m[3])});
  }
  return out;
}
const normTxt = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Janela (modal) simples
function abrirModal(html, classe = '') {
  let m = $('modal');
  if (!m) { m = document.createElement('div'); m.id = 'modal'; m.className = 'modal'; document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) fecharModal(); }); }
  m.innerHTML = `<div class="mbox ${classe}">${html}</div>`; m.style.display = 'flex';
  const a = areaVisivel();
  if (a) { m.style.top = a.top + 'px'; m.style.height = a.alt + 'px'; m.style.bottom = 'auto'; m.style.left = '0'; m.style.right = '0';
    m.style.paddingTop = '12px'; document.body.style.minHeight = (a.top + a.alt) + 'px'; }
  const f = m.querySelector('input:not([type=file]),select,textarea'); if (f && !a) setTimeout(() => f.focus(), 50);
}
function fecharModal() { const m = $('modal'); if (m) { m.style.display = 'none'; m.innerHTML = ''; } document.body.style.minHeight = ''; }

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
  const [presidente, admin] = await Promise.all([q('presidente'), q('__admin__')]);
  return {presidente, admin};
}

// ---------- Dados ----------
const COLS_DESP = 'id,prestador,semana,semana_fim,data_despesa,hora_documento,fornecedor,categoria,descricao,tipo_doc,valor,status,situacao_pagamento,situacao,' +
  'valor_pago,valor_reservado,saldo,arquivo_path,obra_id,obra,legenda,remetente,remetente_numero,confianca_ocr,criticos,atencoes,achados,pago_em,ultimo_pagamento_numero,recusado_motivo,recusado_por,recusado_em,pagamento_id,pagador';
const carregarDespesas = (filtro = q => q) => todos(() => filtro(sb.from('obras_despesas_pagamento').select(COLS_DESP)).order('data_despesa', {ascending: true}).order('id'));
const carregarSaldos = () => todos(() => sb.from('obras_saldo_prestador').select('*').order('prestador'));
const carregarPagamentos = () => todos(() => sb.from('obras_pagamentos').select('*').order('created_at', {ascending: false}));
const carregarItens = () => todos(() => sb.from('obras_pagamento_itens').select('pagamento_id,comprovante_id,valor').order('id'));
const carregarAdiantamentos = () => todos(() => sb.from('obras_adiantamentos').select('*').order('data', {ascending: false}));
const carregarObras = () => todos(() => sb.from('obras').select('id,codigo,nome,status,palavras').order('nome'));
const carregarPrestacoes = () => todos(() => sb.from('obras_prestacoes').select('id,numero,responsavel,periodo_inicio,periodo_fim,valor_declarado,quitada_em').order('periodo_inicio', {ascending: false, nullsFirst: false}));
const nomeObra = n => String(n || '').replace(/^Obras\/Reformas — /, '').replace(/^Loja /, '') || 'Sem obra';
const semPrestador = p => !p || /^a definir/i.test(p) || p === 'Desconhecido';

// ---------- Período e semana (fechamento é semanal: segunda a domingo) ----------
const somaDias = (iso, n) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const segundaDe = iso => { const x = new Date((iso || hojeISO()) + 'T12:00:00'); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x.toISOString().slice(0, 10); };
const PERIODOS = [['7', '7 dias'], ['15', '15 dias'], ['30', '30 dias'], ['sem', 'Por semana'], ['tudo', 'Tudo']];
// filtro = {p: '7'|'15'|'30'|'sem'|'tudo', sem: 'YYYY-MM-DD' (segunda)} → {de, ate, rotulo}
function intervalo(f) {
  const hoje = hojeISO();
  if (f.p === 'sem') { const de = f.sem || segundaDe(hoje); return {de, ate: somaDias(de, 6), rotulo: `semana ${dBR(de)} a ${dBR(somaDias(de, 6))}`}; }
  if (f.p === 'tudo') return {de: null, ate: null, rotulo: 'todo o período'};
  const n = Number(f.p) || 30; return {de: somaDias(hoje, -(n - 1)), ate: hoje, rotulo: `últimos ${n} dias`};
}
const noIntervalo = (iso, i) => !!iso && (!i.de || iso.slice(0, 10) >= i.de) && (!i.ate || iso.slice(0, 10) <= i.ate);
function lerFiltro(chave) { try { return JSON.parse(localStorage.getItem(chave) || 'null') || {p: '30'}; } catch (e) { return {p: '30'}; } }
function salvarFiltro(chave, f) { try { localStorage.setItem(chave, JSON.stringify(f)); } catch (e) {} }
// Barra de período: botões 7/15/30 dias, por semana (com escolha da semana) e tudo
function barraPeriodo(f, semanas, onMuda) {
  window.__mudaPeriodo = (p, sem) => onMuda({...f, p, sem: sem || f.sem || semanas[0]});
  return `<div class="periodo"><div class="tabs">${PERIODOS.map(([k, t]) => `<button class="${f.p === k ? 'on' : ''}" onclick="__mudaPeriodo('${k}')">${t}</button>`).join('')}</div>
    ${f.p === 'sem' ? `<select onchange="__mudaPeriodo('sem', this.value)" aria-label="Semana">${semanas.map(s => `<option value="${s}" ${s === f.sem ? 'selected' : ''}>Semana ${dBR(s)} a ${dBR(somaDias(s, 6))}${s === segundaDe() ? ' (atual)' : ''}</option>`).join('')}</select>` : ''}</div>`;
}

// ---------- Conta do prestador (14/10/2026, pedido do Ricardo) ----------
// Adiantamento recebido − despesas das fotos (na ordem em que chegaram) = saldo que ainda está com o prestador
// (ou, se ficar negativo, quanto a empresa tem de reembolsar). Cada foto com dúvida/possível fraude vem marcada.
function contaPrestador(s, desp, adis, pags) {
  const disp = Number(s.adiantamento_disponivel || 0);
  const abertas = desp.filter(d => d.prestador === s.prestador && Number(d.saldo) > 0)
    .sort((a, b) => String(a.data_despesa).localeCompare(String(b.data_despesa)) || String(a.hora_documento || '').localeCompare(String(b.hora_documento || '')));
  const gasto = abertas.reduce((t, d) => t + Number(d.saldo), 0), saldo = disp - gasto;
  // adiantamentos recebidos depois do último pagamento que descontou adiantamento = os que ainda compõem o saldo
  const ultAbate = pags.filter(p => p.prestador === s.prestador && Number(p.valor_abatido) > 0 && p.status !== 'cancelado').map(p => (p.pago_em || p.created_at || '').slice(0, 10)).sort().pop() || '';
  const recebidos = adis.filter(a => a.prestador === s.prestador && !a.cancelado && (a.data || '') >= ultAbate.slice(0, 10)).sort((a, b) => a.data.localeCompare(b.data));
  return {disp, gasto, saldo, abertas, recebidos};
}
function contaResumoHTML(c) {
  return `<div class="mini"><div><b>${brl(c.disp)}</b><span>adiantamento recebido</span></div><div><b>− ${brl(c.gasto)}</b><span>${c.abertas.length} despesa(s) das fotos</span></div>
    <div><b style="color:${c.saldo >= 0 ? '#86efac' : '#fcd34d'}">${brl(Math.abs(c.saldo))}</b><span>${c.saldo >= 0 ? 'saldo ainda com o prestador' : 'a reembolsar ao prestador'}</span></div></div>`;
}
function contaExtratoHTML(c) {
  let corr = c.disp;
  const lin = c.abertas.map(d => { corr -= Number(d.saldo);
    const ach = (d.achados || []), crit = ach.some(a => a.nivel === 'critico');
    return `<tr><td>${dBR(d.data_despesa)}${d.hora_documento ? ' ' + esc(String(d.hora_documento).slice(0, 5)) : ''}</td>
      <td>${esc(d.fornecedor || 'Fornecedor não lido')}<div class="mut small">${esc(CATS[d.categoria] || d.categoria || '')} · ${esc(nomeObra(d.obra))}${d.legenda ? ' · ' + esc(String(d.legenda).slice(0, 60)) : ''}</div>
        ${ach.length ? `<div class="${crit ? 'crit' : 'warn'}" style="margin:2px 0 0">${ach.map(a => `⚠ ${esc(a.mensagem)} ${linkComparar(d, a)}`).join('<br>')}</div>` : ''}
        <div class="small">${linkArquivo(d.arquivo_path, 'ver foto')}</div></td>
      <td class="r">− ${brl(d.saldo)}</td><td class="r"><b style="color:${corr >= 0 ? 'inherit' : '#fcd34d'}">${brl(corr)}</b></td></tr>`; }).join('');
  return `<div class="tw"><table><tr><th>Data</th><th>Lançamento</th><th class="r">Valor</th><th class="r">Saldo</th></tr>
    <tr><td>${c.recebidos.length ? c.recebidos.map(a => dBR(a.data)).join(', ') : '—'}</td><td><b>Adiantamento recebido</b>${c.recebidos.map(a => `<div class="mut small">${brl(a.valor)} · ${esc(String(a.observacao || '').slice(0, 90))}</div>`).join('')}</td>
      <td class="r">+ ${brl(c.disp)}</td><td class="r"><b>${brl(c.disp)}</b></td></tr>${lin}
    <tfoot><tr><td colspan="2">${c.saldo >= 0 ? 'Saldo do adiantamento ainda com o prestador' : 'A reembolsar ao prestador'}</td><td></td><td class="r">${brl(Math.abs(c.saldo))}</td></tr></tfoot></table></div>`;
}

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
const pdfTxt = s => String(s ?? '').replace(/[–—−]/g, '-').replace(/[^\x00-\xFF€]/g, '');  // a fonte padrão do PDF não tem emoji nem travessão
let _logo;
function logoPDF() {
  if (_logo === undefined) _logo = fetch(new URL('../obras-contas-pagar/logo-esposende.jpg', location.href)).then(r => r.ok ? r.blob() : null)
    .then(b => b && new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => ok(null); f.readAsDataURL(b); })).catch(() => null);
  return _logo;
}
// "raqueri1970@gmail.com" → "raqueri1970" (cabe na caixa do PDF)
const quemCurto = q => String(q || '').split('@')[0];
const celTxt = c => c && typeof c === 'object' ? c.t : c;
const V = v => ({t: brl(v), n: Number(v || 0)});

// doc = {titulo, subtitulo, resumo: [[rótulo, valor]], secoes: [{titulo, cab, linhas, rodape, direita: [índices de colunas numéricas], nota}], assinaturas: [..], arquivo, paisagem}
async function gerarPDF(doc) {
  const JsPDF = await pdfLib();
  const pdf = new JsPDF({orientation: doc.paisagem ? 'landscape' : 'portrait', unit: 'pt', format: 'a4'});
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 36;
  // Cabeçalho branco com a logo da Esposende (regra dos relatórios: logo + fundo branco para imprimir)
  const logo = await logoPDF();
  if (logo) pdf.addImage(logo, 'JPEG', M, 16, 44, 44);
  const tx = logo ? M + 54 : M;
  pdf.setTextColor(15, 30, 60); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text(pdfTxt(doc.titulo), tx, 34);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(70); pdf.text(pdfTxt(doc.subtitulo || 'Obras & Reformas - Esposende'), tx, 50);
  pdf.text('Emitido em ' + new Date().toLocaleString('pt-BR'), W - M, 50, {align: 'right'});
  pdf.setDrawColor(14, 74, 107); pdf.setLineWidth(1.5); pdf.line(M, 68, W - M, 68); pdf.setLineWidth(.5);
  pdf.setTextColor(20); let y = 92;
  if (doc.resumo && doc.resumo.length) {
    // Caixas do mesmo tamanho, texto centralizado; o valor diminui ou quebra em 2 linhas para nunca sair da caixa
    const col = Math.min(4, doc.resumo.length), cw = (W - 2 * M) / col, bw = cw - 8, BH = 44;
    doc.resumo.forEach(([l, v], i) => {
      const x = M + (i % col) * cw, yy = y + Math.floor(i / col) * (BH + 8), cx = x + bw / 2;
      pdf.setDrawColor(200); pdf.roundedRect(x, yy - 12, bw, BH, 4, 4);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90); pdf.text(pdfTxt(l), cx, yy, {align: 'center'});
      pdf.setFont('helvetica', 'bold'); pdf.setTextColor(20);
      let fs = 11.5; const val = pdfTxt(v);
      pdf.setFontSize(fs); while (fs > 8 && pdf.getTextWidth(val) > bw - 10) pdf.setFontSize(fs -= .5);
      if (pdf.getTextWidth(val) > bw - 10) { const ls = pdf.splitTextToSize(val, bw - 10).slice(0, 2); pdf.text(ls, cx, yy + 13, {align: 'center'}); }
      else pdf.text(val, cx, yy + 17, {align: 'center'});
    });
    pdf.setFont('helvetica', 'normal');
    y += Math.ceil(doc.resumo.length / col) * (BH + 8) + 6;
  }
  for (const s of doc.secoes || []) {
    if (y > H - 90) { pdf.addPage(); y = 50; }
    if (s.titulo) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(pdfTxt(s.titulo), M, y); pdf.setFont('helvetica', 'normal'); y += 6; }
    if (s.nota) { pdf.setFontSize(8.5); pdf.setTextColor(90); const ls = pdf.splitTextToSize(pdfTxt(s.nota), W - 2 * M); pdf.text(ls, M, y + 9); y += 9 + ls.length * 10; pdf.setTextColor(20); }
    const colStyles = {}; (s.direita || []).forEach(i => colStyles[i] = {halign: 'right'});
    // colunas de valor: alinhadas à direita e sem quebra (as casas decimais ficam uma embaixo da outra)
    (s.direita || []).forEach(i => colStyles[i] = {halign: 'right', overflow: 'visible', cellWidth: 72});
    pdf.autoTable({startY: y + 4, head: [s.cab.map(pdfTxt)], body: s.linhas.map(l => l.map(c => pdfTxt(celTxt(c)))), foot: s.rodape ? [s.rodape.map(c => pdfTxt(celTxt(c)))] : undefined,
      margin: {left: M, right: M}, styles: {fontSize: 8, cellPadding: 3.5, overflow: 'linebreak', valign: 'middle'}, columnStyles: colStyles,
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
  if (doc.depois) await doc.depois(pdf, {W, H, M});  // páginas extras (ex.: as fotos de cada duplicidade)
  const n = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(120);
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
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

// Recibo de um pagamento (lote) em PDF — usado pelo Presidente e Relatórios
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
      ['Situação', (PAG[p.status] || [p.status])[0]], ['Aprovado por', `${quemCurto(p.aprovado_por) || '-'} · ${dtBR(p.aprovado_em)}`], ['Pago por', p.pago_por ? `${quemCurto(p.pago_por)} · ${dtBR(p.pago_em)}` : '-'],
      ['Favorecido', p.favorecido || p.prestador], ['Forma / chave', `${FORMAS[p.forma_pagamento] || p.forma_pagamento || '-'} ${p.pix_chave || ''}`]],
    secoes: [{titulo: `Despesas incluídas (${linhas.length})`, cab: ['Data', 'Fornecedor', 'Categoria', 'Valor do recibo', 'Pago aqui', ''], linhas, direita: [3, 4],
        rodape: ['', '', 'Total', brl(desp.reduce((a, d) => a + Number(d.valor), 0)), brl(p.valor_itens), '']},
      {titulo: 'Histórico', cab: ['Quando', 'O quê', 'Quem', 'Detalhe'], linhas: ev.map(e => [dtBR(e.created_at), e.evento.replace(/_/g, ' '), e.usuario || '',
        Object.entries(e.detalhes || {}).filter(([k]) => !['arquivo'].includes(k)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' | ')])},
      ...(p.auditoria_resultado ? [{titulo: 'Agente Auditor', cab: ['Resultado'], linhas: [[p.auditoria_resultado]]}] : [])],
    assinaturas: ['Presidente', `Prestador: ${p.prestador}`], arquivo: `pagamento_${p.numero}_${p.prestador}`});
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
      ['TOTAL A PAGAR (hoje)', brl(saldo.saldo_devedor)],
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
    assinaturas: ['Presidente', `Prestador: ${prestador}`], arquivo: `extrato_${prestador}_${hojeISO()}`, paisagem: false};
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

// Rosca: participação de cada item no total (ex.: total a pagar por prestador). Fatia e legenda clicáveis (aoClicar(i)).
const PALETA = ['#3987e5', '#f5b301', '#22c55e', '#d95926', '#a78bfa', '#2dd4bf', '#f472b6', '#94a3b8'];
function graficoRosca(el, itens, {vazio = 'Nada em aberto.', aoClicar = null, centro = 'Total'} = {}) {
  itens = itens.filter(i => i.valor > 0);
  if (!itens.length) { el.innerHTML = `<div class="vazio">${esc(vazio)}</div>`; return; }
  const tot = itens.reduce((a, i) => a + i.valor, 0), R = 70, r = 46, C = 80;
  let ang = -Math.PI / 2;
  const pt = (a, rr) => `${(C + rr * Math.cos(a)).toFixed(2)},${(C + rr * Math.sin(a)).toFixed(2)}`;
  const fatias = itens.map((it, i) => {
    const cor = PALETA[i % PALETA.length], frac = it.valor / tot;
    if (frac >= .9999) return `<g data-g="${i}"><circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${cor}" stroke-width="${R - r}" data-i="${i}" class="hit2" style="cursor:pointer"/></g>`;
    const a0 = ang, a1 = ang + frac * 2 * Math.PI, g = frac > .5 ? 1 : 0; ang = a1;
    return `<g data-g="${i}"><path data-i="${i}" fill="${cor}" d="M${pt(a0, R)} A${R},${R} 0 ${g} 1 ${pt(a1, R)} L${pt(a1, r)} A${r},${r} 0 ${g} 0 ${pt(a0, r)} Z"/></g>`;
  }).join('');
  el.innerHTML = `<div class="rosca"><svg viewBox="0 0 160 160" role="img" aria-label="${esc(centro)}">${fatias}
      <text x="80" y="76" text-anchor="middle" style="font-size:10px;fill:var(--txt2)">${esc(centro)}</text>
      <text x="80" y="93" text-anchor="middle" style="font-size:13px;font-weight:800;fill:var(--txt)">${esc(brlCurto(tot))}</text></svg>
    <div class="lg">${itens.map((it, i) => `<div data-i="${i}"><span><i style="background:${PALETA[i % PALETA.length]}"></i>${esc(it.rotulo)}</span>
      <b>${brl(it.valor)} <span class="mut" style="font-weight:500">${(it.valor / tot * 100).toLocaleString('pt-BR', {maximumFractionDigits: 1})}%</span></b></div>`).join('')}</div></div>`;
  ligarDicas(el, i => `<b>${esc(itens[i].rotulo)}</b><div><span><i style="background:${PALETA[i % PALETA.length]}"></i>Valor</span><span>${brl(itens[i].valor)}</span></div>
    <div><span>Participação</span><span>${(itens[i].valor / tot * 100).toLocaleString('pt-BR', {maximumFractionDigits: 1})}%</span></div>${itens[i].det || ''}`);
  if (aoClicar) el.querySelectorAll('[data-i]').forEach(h => h.addEventListener('click', () => aoClicar(Number(h.dataset.i))));
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
