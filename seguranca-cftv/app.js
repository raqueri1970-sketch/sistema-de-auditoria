/* Segurança Patrimonial e CFTV — tela do Portal Executivo Esposende.
 * Dados no Supabase (tabelas cftv_*, acesso por perfil). Números do painel vêm de cftv_painel() — a mesma fonte do
 * Cérebro Executivo e do Sentinela. Notas e planilhas são lidas no navegador (leitor.js) e gravadas por
 * cftv_importar_documento / cftv_importar_planilha, que nunca duplicam despesa.
 */
'use strict';
const SB_URL = 'https://rdztzurfesnobfkazgpm.supabase.co';
const SB_KEY = 'sb_publishable_4LHSO4TrP7F4m4tpJyH44g_BGmfC92h';
const NO_PORTAL = /github\.io$/.test(location.hostname);
const sb = supabase.createClient(SB_URL, SB_KEY, {auth: {persistSession: true, autoRefreshToken: true, ...(NO_PORTAL ? {} : {storageKey: 'cftv-auth'})}});
const L = window.CFTV_LEITOR;
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ---------------- utilidades ----------------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const brl = v => v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
const nf = (v, d = 0) => v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});
const dBR = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '—';
const hoje = () => new Date().toISOString().slice(0, 10);
const soma = (a, f) => a.reduce((s, x) => s + Number(f(x) || 0), 0);
const chip = (t, c = '') => `<span class="chip ${c}">${esc(t)}</span>`;
const nLoja = c => c === 0 ? 'CD' : c >= 900 ? String(c - 900).padStart(2, '0') : String(c);
function toast(m, ms = 4500) { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', ms); }
function mostrar(v) { ['vLogin', 'vSem', 'vApp'].forEach(x => $(x).classList.toggle('hidden', x !== v)); }
const CAT = L.CATEGORIAS;
const NAT = {aquisicao: 'Aquisição de equipamentos', instalacao: 'Serviço de instalação', manutencao: 'Manutenção', monitoramento: 'Monitoramento', outro: 'Outro'};
const AREAS = {entrada: 'Entrada e saída', caixa: 'Caixa', vendas: 'Área de vendas', estoque: 'Estoque', recebimento: 'Recebimento', outra: 'Outras áreas críticas'};
const SIT_COB = {coberta: ['Coberta', 'ok'], parcial: ['Parcial', 'warn'], sem_cobertura: ['Sem cobertura', 'bad'], nao_se_aplica: ['Não se aplica', 'neu'], nao_avaliada: ['Não avaliada', 'neu']};
const SIT_EQ = {instalado: 'Instalado', em_estoque: 'Em estoque (não instalado)', defeito: 'Com defeito', fora_operacao: 'Fora de operação', retirado: 'Retirado', baixado: 'Baixado', substituido: 'Substituído'};
const CLASSE = {preventiva: '1. Manutenção preventiva', desgaste_natural: '2. Desgaste natural', defeito_tecnico: '3. Defeito técnico', substituicao_modernizacao: '4. Substituição ou modernização',
  dano_acidental: '5. Dano acidental', possivel_mau_uso: '6. Possível mau uso', causa_nao_identificada: '7. Causa não identificada'};
const EVITAVEIS = ['dano_acidental', 'possivel_mau_uso'];
const SIT_OC = {pendente: ['Pendente de análise', 'warn'], suspeita: ['Suspeita', 'bad'], confirmada: ['Confirmada', 'bad'], descartada: ['Descartada', 'neu'], corrigida: ['Corrigida', 'ok']};
const REGRAS = {nf_duplicada: 'Notas fiscais duplicadas', sem_loja: 'Documentos sem loja vinculada', comprado_nao_instalado: 'Comprados e não instalados',
  divergencia_compra_inventario: 'Divergência compra × inventário', substituicao_sem_baixa: 'Substituição sem baixa', manutencao_recorrente: 'Manutenções repetidas',
  valor_inconsistente: 'Valores inconsistentes', sem_documentacao: 'Gastos sem documentação', acima_capacidade: 'Acima da capacidade de gravação',
  cadastro_divergente: 'Cadastro divergente', loja_desativada: 'Gasto em loja desativada'};

const S = {papel: null, email: '', lojas: new Map(), ativas: new Map(), docs: [], itens: [], eq: [], cob: [], man: [], oc: [], plano: [], prem: [], painel: null, aba: 'painel', detalhe: false};
const podeEditar = () => ['admin', 'seguranca'].includes(S.papel);
const nomeLoja = c => c === null || c === undefined ? 'Sem loja definida' : c === 0 ? 'CD / Matriz' : `${nLoja(c)} · ${(S.lojas.get(c) || S.ativas.get(c) || {}).nome || 'Loja ' + c}`;

// Busca paginada (o Supabase devolve no máximo 1000 linhas por vez)
async function todos(tabela, sel = '*', ordem = 'id') {
  const out = [];
  for (let i = 0; ; i += 1000) {
    let q = sb.from(tabela).select(sel).range(i, i + 999);
    if (ordem) q = q.order(ordem);
    const {data, error} = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// ---------------- acesso ----------------
async function iniciar() {
  const u = (await sb.auth.getUser()).data.user;
  if (!u) return mostrar('vLogin');
  S.email = u.email;
  const {data: papel} = await sb.rpc('cftv_papel');
  S.papel = papel;
  if (!papel) return mostrar('vSem');
  const {data: det} = await sb.rpc('cftv_pode_detalhe'); S.detalhe = !!det;
  $('quem').textContent = `${u.email} · perfil: ${({admin: 'Administração', presidencia: 'Presidência', diretoria: 'Diretoria', seguranca: 'Segurança', consulta: 'Consulta'})[papel]}` +
    (podeEditar() ? '' : ' (somente leitura)');
  document.querySelectorAll('[data-ed]').forEach(b => b.classList.toggle('hidden', !podeEditar()));
  document.querySelectorAll('[data-admin]').forEach(b => b.classList.toggle('hidden', papel !== 'admin'));
  mostrar('vApp');
  sb.rpc('cftv_registrar', {p_acao: 'acesso', p_tabela: 'tela', p_registro: 'seguranca-cftv'}).then(() => {});
  await recarregar();
}
async function entrar() {
  $('lErr').textContent = '';
  const {error} = await sb.auth.signInWithPassword({email: $('lEmail').value.trim(), password: $('lSenha').value});
  if (error) { $('lErr').textContent = 'Email ou senha incorretos.'; return; }
  iniciar();
}
// Dentro do Portal (mesma sessão): "Sair" não pode deslogar o Portal inteiro — esconde o botão.
const EMBUTIDO = (() => { try { return window.top !== window; } catch (e) { return true; } })();
if (EMBUTIDO && NO_PORTAL) document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('[onclick="sair()"]').forEach(b => b.style.display = 'none'));
async function sair() { if (EMBUTIDO && NO_PORTAL) return; await sb.auth.signOut(); location.reload(); }

// ---------------- carga ----------------
async function recarregar() {
  $('conteudo').innerHTML = '<div class="card vazio">Carregando…</div>';
  try {
    const [lojas, ativas, docs, itens, eq, cob, man, oc, plano, prem] = await Promise.all([
      todos('cftv_lojas', '*', 'codigo'), sb.rpc('cftv_lojas_ativas').then(r => r.data || []),
      todos('cftv_documentos', 'id,tipo,chave,numero,serie,emissao,fornecedor,fornecedor_cnpj,destinatario,destinatario_cnpj,destinatario_municipio,loja_codigo,loja_confianca,loja_motivo,descricao,valor_produtos,frete,outras,desconto,valor_total,natureza,natureza_motivo,finalidade,orcamento_ref,ocr,status,conferir,duplicado_de,arquivo_nome,arquivo_path,conferido_por,conferido_em,criado_em'),
      todos('cftv_documento_itens'), todos('cftv_equipamentos'), todos('cftv_cobertura', '*', 'loja_codigo'), todos('cftv_manutencoes'),
      todos('cftv_ocorrencias'), todos('cftv_plano'), todos('cftv_premissas', '*', 'chave')]);
    S.lojas = new Map(lojas.map(l => [l.codigo, l]));
    S.ativas = new Map(ativas.filter(a => a.ativo).map(a => [a.codigo, a]));
    S.inativas = new Set(ativas.filter(a => !a.ativo).map(a => a.codigo));
    Object.assign(S, {docs, itens, eq, cob, man, oc, plano, prem});
    S.docPorId = new Map(docs.map(d => [d.id, d]));
    S.instPorItem = new Map();
    for (const e of eq) if (e.documento_item_id) S.instPorItem.set(e.documento_item_id, (S.instPorItem.get(e.documento_item_id) || 0) + e.quantidade);
    montarFiltros();
    await carregarPainel();
  } catch (e) {
    if (/permission|42501|JWT/i.test(e.message + e.code)) return mostrar('vSem');
    $('conteudo').innerHTML = `<div class="card vazio">Não foi possível carregar: ${esc(e.message)}</div>`; return;
  }
  const nConf = S.docs.filter(d => d.status === 'conferir').length;
  $('cConf').textContent = nConf || '';
  const nAud = S.oc.filter(o => o.ativo && ['pendente', 'suspeita'].includes(o.situacao)).length;
  $('cAud').textContent = nAud || '';
  render();
}
function montarFiltros() {
  const sel = (id, opts) => { const v = $(id).value; $(id).innerHTML = $(id).options[0].outerHTML + opts; $(id).value = v; };
  const cods = [...new Set([...S.ativas.keys(), ...S.docs.map(d => d.loja_codigo).filter(c => c !== null)])].sort((a, b) => a - b);
  sel('fLoja', cods.map(c => `<option value="${c}">${esc(nomeLoja(c))}</option>`).join(''));
  sel('fForn', [...new Set(S.docs.map(d => d.fornecedor).filter(Boolean))].sort().map(f => `<option>${esc(f)}</option>`).join(''));
  sel('fCat', Object.entries(CAT).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));
}
const F = () => ({de: $('fDe').value || '2026-01-01', ate: $('fAte').value || '2026-12-31', loja: $('fLoja').value === '' ? null : Number($('fLoja').value),
  forn: $('fForn').value || null, cat: $('fCat').value || null});
function descFiltros() {
  const f = F();
  return `Período ${dBR(f.de)} a ${dBR(f.ate)}` + (f.loja !== null ? ` · Loja ${nomeLoja(f.loja)}` : ' · Todas as lojas') + (f.forn ? ` · Fornecedor ${f.forn}` : '') + (f.cat ? ` · Categoria ${CAT[f.cat]}` : '');
}
async function carregarPainel() {
  const f = F();
  const {data, error} = await sb.rpc('cftv_painel', {p_de: f.de, p_ate: f.ate, p_loja: f.loja, p_fornecedor: f.forn, p_categoria: f.cat});
  if (error) throw error;
  S.painel = data;
  const pt = await sb.rpc('cftv_patrimonio', {p_loja: f.loja});
  S.pat = pt.error ? null : pt.data;
  S.patLoja = new Map(((S.pat || {}).por_loja || []).map(x => [x.loja_codigo, x]));
}
async function aplicarFiltros() { await carregarPainel(); render(); }
function limparFiltros() { $('fDe').value = '2026-01-01'; $('fAte').value = '2026-12-31'; ['fLoja', 'fForn', 'fCat'].forEach(i => $(i).value = ''); aplicarFiltros(); }

// filtros aplicados às listas (mesmos critérios do cftv_painel)
const itensDoc = id => S.itens.filter(i => i.documento_id === id);
function docsF(extra = () => true) {
  const f = F();
  return S.docs.filter(d => ['ok', 'conferir'].includes(d.status) && d.emissao >= f.de && d.emissao <= f.ate && (f.loja === null || d.loja_codigo === f.loja)
    && (!f.forn || (d.fornecedor || '').toLowerCase().includes(f.forn.toLowerCase())) && (!f.cat || S.itens.some(i => i.documento_id === d.id && i.categoria === f.cat)) && extra(d));
}
function manF(extra = () => true) {
  const f = F();
  return S.man.filter(m => m.status !== 'descartado' && m.data >= f.de && m.data <= f.ate && (f.loja === null || m.loja_codigo === f.loja)
    && (!f.forn || (m.fornecedor || '').toLowerCase().includes(f.forn.toLowerCase())) && (!f.cat || m.categoria === f.cat) && extra(m));
}
function eqF(extra = () => true) { const f = F(); return S.eq.filter(e => (f.loja === null || e.loja_codigo === f.loja) && (!f.cat || e.categoria === f.cat) && extra(e)); }
function pendentes() {
  const ids = new Set(docsF(d => d.natureza === 'aquisicao').map(d => d.id)), f = F();
  return S.itens.filter(i => ids.has(i.documento_id) && ['camera', 'dvr_nvr', 'hd', 'alarme_sensor', 'perimetro', 'incendio', 'rede_rack'].includes(i.categoria) && (!f.cat || i.categoria === f.cat))
    .map(i => ({...i, falta: Math.max(0, Number(i.quantidade) - (S.instPorItem.get(i.id) || 0))})).filter(i => i.falta > 0);
}

// ---------------- abas ----------------
document.getElementById('abas').addEventListener('click', e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  S.aba = b.dataset.a; document.querySelectorAll('#abas button').forEach(x => x.classList.toggle('on', x === b)); render();
});
function render() {
  const fn = {painel: rPainel, lojas: rLojas, importar: rImportar, conferir: rConferir, inventario: rInventario, cobertura: rCobertura, manutencao: rManutencao,
    auditoria: rAuditoria, plano: rPlano, relatorios: rRelatorios, acessos: rAcessos}[S.aba];
  $('filtros').classList.toggle('hidden', ['importar', 'acessos'].includes(S.aba));
  $('conteudo').innerHTML = ''; fn();
}

// ---------------- componentes ----------------
function kpi(l, v, n, cls, acao) { return `<div class="card kpi ${cls || ''}" tabindex="0" role="button" onclick="${acao}" onkeydown="if(event.key==='Enter'){${acao}}"><div class="l">${l}</div><div class="v">${v}</div><div class="n">${n || ''}</div></div>`; }
function barras(lista, rot, val, fmt = brl, acao = null, max = 15) {
  const l = lista.filter(x => Number(val(x)) > 0).slice(0, max), m = Math.max(1, ...l.map(x => Number(val(x))));
  if (!l.length) return '<div class="vazio">Sem dados no filtro.</div>';
  return `<div class="barras">${l.map((x, i) => `<div class="lin" ${acao ? `onclick="${acao(x, i)}"` : ''} title="Ver registros"><span class="rot">${esc(rot(x))}</span><span class="tr"><i style="width:${(Number(val(x)) / m * 100).toFixed(1)}%"></i></span><span class="val">${fmt(val(x))}</span></div>`).join('')}</div>`;
}
function colunas(meses, series) {
  const tot = m => soma(series, s => m[s.k]); const max = Math.max(1, ...meses.map(tot));
  if (!meses.length) return '<div class="vazio">Sem dados no filtro.</div>';
  return `<div class="colunas">${meses.map(m => `<div class="c" title="${m.mes}: ${brl(tot(m))}" onclick="listaDocs('Notas de ${m.mes}', d => d.emissao.startsWith('${m.mes}'))">${series.map(s => `<i style="height:${(Number(m[s.k] || 0) / max * 170).toFixed(1)}px;background:${s.cor}"></i>`).join('')}</div>`).join('')}</div>
    <div class="eixo">${meses.map(m => `<span>${m.mes.slice(5)}/${m.mes.slice(2, 4)}</span>`).join('')}</div>
    <div class="leg">${series.map(s => `<span><i style="background:${s.cor}"></i>${s.n}</span>`).join('')}</div>`;
}
function tabela(cols, linhas, opc = {}) {
  if (!linhas.length) return `<div class="card vazio">${opc.vazio || 'Nenhum registro.'}</div>`;
  return `<div class="tw"><table><thead><tr>${cols.map(c => `<th class="${c.n ? 'n' : ''}">${c.t}</th>`).join('')}</tr></thead><tbody>${linhas.map((r, i) =>
    `<tr class="${opc.clic ? 'clic' : ''}" ${opc.clic ? `onclick="${opc.clic(r, i)}"` : ''}>${cols.map(c => `<td class="${c.n ? 'n' : ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${opc.total ? `<tfoot><tr>${opc.total.map((t, i) => `<th class="${cols[i] && cols[i].n ? 'n' : ''}">${t}</th>`).join('')}</tr></tfoot>` : ''}</table></div>`;
}
// Modal com lista e exportação para Excel
let MODAL_XLS = null;
function abrirModal(tit, html, xls) {
  $('mTit').textContent = tit; $('mCorpo').innerHTML = html; MODAL_XLS = xls || null; $('mXls').classList.toggle('hidden', !xls);
  $('modal').classList.remove('hidden'); $('modal').scrollTop = 0;
}
function fecharModal() { $('modal').classList.add('hidden'); }
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') fecharModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });
$('mXls').onclick = () => { if (MODAL_XLS) exportarXls(MODAL_XLS.nome, MODAL_XLS.linhas); };
function exportarXls(nome, linhas) {
  const ws = XLSX.utils.json_to_sheet(linhas), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dados'); XLSX.writeFile(wb, nome.replace(/[^\w\- ]+/g, '').slice(0, 60) + '.xlsx');
  sb.rpc('cftv_registrar', {p_acao: 'exportacao', p_tabela: 'excel', p_registro: nome}).then(() => {});
}

// listas de detalhe (todo indicador abre os registros que o compõem)
const COL_DOC = [
  {t: 'Emissão', f: d => dBR(d.emissao)}, {t: 'Nota', f: d => `${esc(d.tipo)} ${esc(d.numero || '?')}`}, {t: 'Loja', f: d => esc(nomeLoja(d.loja_codigo))},
  {t: 'Fornecedor', f: d => esc(d.fornecedor || '—')}, {t: 'Natureza', f: d => esc(NAT[d.natureza])}, {t: 'Descrição', f: d => esc((d.descricao || '').slice(0, 90))},
  {t: 'Valor', n: 1, f: d => brl(d.valor_total)}, {t: 'Situação', f: d => d.status === 'ok' ? chip('Conferida', 'ok') : d.status === 'conferir' ? chip('A conferir', 'warn') : chip(d.status, 'neu')}];
const xlsDoc = d => ({Emissao: d.emissao, Tipo: d.tipo, Numero: d.numero, Chave: d.chave, Loja: nomeLoja(d.loja_codigo), Fornecedor: d.fornecedor, Natureza: NAT[d.natureza],
  Finalidade: d.finalidade, Descricao: d.descricao, Valor: Number(d.valor_total), Situacao: d.status, Arquivo: d.arquivo_nome});
function listaDocs(tit, filtro) {
  const l = docsF(filtro).sort((a, b) => (a.emissao || '').localeCompare(b.emissao || ''));
  abrirModal(tit, `<div class="info">${esc(descFiltros())} · ${l.length} documento(s) · total ${brl(soma(l, d => d.valor_total))}. Clique numa nota para ver itens e arquivo.</div>` +
    tabela(COL_DOC, l, {clic: d => `verDoc(${d.id})`, total: ['', '', '', '', '', 'Total', brl(soma(l, d => d.valor_total)), '']}), {nome: tit, linhas: l.map(xlsDoc)});
}
function listaItens(tit, filtro) {
  const ids = new Set(docsF(d => d.natureza === 'aquisicao').map(d => d.id));
  const l = S.itens.filter(i => ids.has(i.documento_id) && filtro(i));
  const cols = [{t: 'Nota', f: i => { const d = S.docPorId.get(i.documento_id); return `${esc(d.numero)} · ${dBR(d.emissao)}`; }}, {t: 'Loja', f: i => esc(nomeLoja(S.docPorId.get(i.documento_id).loja_codigo))},
    {t: 'Item', f: i => esc(i.descricao)}, {t: 'Categoria', f: i => esc(CAT[i.categoria])}, {t: 'Qtd', n: 1, f: i => nf(i.quantidade, 2)}, {t: 'Unitário', n: 1, f: i => brl(i.valor_unit)}, {t: 'Total', n: 1, f: i => brl(i.valor_total)}];
  abrirModal(tit, `<div class="info">${esc(descFiltros())} · ${l.length} item(ns) · total ${brl(soma(l, i => i.valor_total))}</div>` + tabela(cols, l, {clic: i => `verDoc(${i.documento_id})`}),
    {nome: tit, linhas: l.map(i => ({Nota: S.docPorId.get(i.documento_id).numero, Loja: nomeLoja(S.docPorId.get(i.documento_id).loja_codigo), Item: i.descricao, Categoria: CAT[i.categoria], Qtd: Number(i.quantidade), Unitario: Number(i.valor_unit), Total: Number(i.valor_total)}))});
}
const COL_EQ = [{t: 'Loja', f: e => esc(nomeLoja(e.loja_codigo))}, {t: 'Categoria', f: e => esc(CAT[e.categoria])}, {t: 'Descrição', f: e => esc(e.descricao || '—') + (e.estimado ? ' ' + chip('estimado', 'warn') : '')},
  {t: 'Marca / modelo', f: e => esc([e.marca, e.modelo].filter(Boolean).join(' ') || '—')}, {t: 'Qtd', n: 1, f: e => nf(e.quantidade)}, {t: 'Custo unit.', n: 1, f: e => e.custo_unit === null ? '<span class="sub">não cadastrado</span>' : brl(e.custo_unit)},
  {t: 'Origem', f: e => e.origem === 'anterior_2026' ? chip('Anterior a 2026', 'neu') : chip('Aquisição 2026')}, {t: 'Área', f: e => esc(AREAS[e.area] || '—')},
  {t: 'Situação', f: e => chip(SIT_EQ[e.situacao], {instalado: 'ok', defeito: 'bad', fora_operacao: 'bad', em_estoque: 'warn'}[e.situacao] || 'neu')}];
const xlsEq = e => ({Loja: nomeLoja(e.loja_codigo), Categoria: CAT[e.categoria], Descricao: e.descricao, Marca: e.marca, Modelo: e.modelo, Serie: e.numero_serie, Quantidade: e.quantidade,
  CustoUnit: e.custo_unit, Origem: e.origem, Estimado: e.estimado ? 'sim' : 'não', Area: AREAS[e.area] || '', Situacao: SIT_EQ[e.situacao], Fonte: e.fonte, Observacao: e.observacao});
function listaEq(tit, filtro) {
  const l = eqF(filtro);
  abrirModal(tit, `<div class="info">${l.length} registro(s) · ${nf(soma(l, e => e.quantidade))} unidade(s). Quantidades marcadas "estimado" vêm dos canais ocupados do gravador (planilha) e precisam de confirmação na loja.</div>` + tabela(COL_EQ, l),
    {nome: tit, linhas: l.map(xlsEq)});
}
const COL_MAN = [{t: 'Data', f: m => dBR(m.data)}, {t: 'Loja', f: m => esc(nomeLoja(m.loja_codigo))}, {t: 'Equipamento', f: m => esc(CAT[m.categoria] || 'Não informado')},
  {t: 'Descrição', f: m => esc((m.descricao || '').slice(0, 90))}, {t: 'Classificação', f: m => chip(CLASSE[m.classificacao], EVITAVEIS.includes(m.classificacao) ? 'bad' : m.classificacao === 'causa_nao_identificada' ? 'warn' : '')},
  {t: 'Peças', n: 1, f: m => brl(m.pecas)}, {t: 'Mão de obra', n: 1, f: m => brl(m.mao_obra)}, {t: 'Total', n: 1, f: m => brl(m.valor_total)}];
const xlsMan = m => ({Data: m.data, Loja: nomeLoja(m.loja_codigo), Equipamento: CAT[m.categoria] || '', Fornecedor: m.fornecedor, Descricao: m.descricao, Classificacao: CLASSE[m.classificacao],
  Evidencia: m.evidencia, EvidenciaSuficiente: m.evidencia_suficiente ? 'sim' : 'não', Pecas: Number(m.pecas), MaoObra: Number(m.mao_obra), Total: Number(m.valor_total)});
function listaMan(tit, filtro) {
  const l = manF(filtro);
  abrirModal(tit, `<div class="info">${esc(descFiltros())} · ${l.length} ocorrência(s) · ${brl(soma(l, m => m.valor_total))}</div>` + tabela(COL_MAN, l, {clic: m => m.documento_id ? `verDoc(${m.documento_id})` : ''}),
    {nome: tit, linhas: l.map(xlsMan)});
}
function listaPendentes() {
  const l = pendentes();
  const cols = [{t: 'Nota', f: i => esc(S.docPorId.get(i.documento_id).numero) + ' · ' + dBR(S.docPorId.get(i.documento_id).emissao)}, {t: 'Loja', f: i => esc(nomeLoja(S.docPorId.get(i.documento_id).loja_codigo))},
    {t: 'Item', f: i => esc(i.descricao)}, {t: 'Comprado', n: 1, f: i => nf(i.quantidade, 0)}, {t: 'Falta instalar', n: 1, f: i => nf(i.falta, 0)}, {t: 'Valor pendente', n: 1, f: i => brl(i.falta * i.valor_unit)},
    {t: '', f: i => podeEditar() ? `<button class="btn peq" onclick="event.stopPropagation();instalarItem(${i.id})">Registrar instalação</button>` : ''}];
  abrirModal('Investimentos pendentes de instalação', `<div class="info">Equipamento comprado em 2026 que ainda não tem instalação registrada no inventário. Comprado não é o mesmo que instalado.</div>` + tabela(cols, l),
    {nome: 'Pendentes de instalacao', linhas: l.map(i => ({Nota: S.docPorId.get(i.documento_id).numero, Loja: nomeLoja(S.docPorId.get(i.documento_id).loja_codigo), Item: i.descricao, Comprado: Number(i.quantidade), Falta: i.falta, ValorPendente: i.falta * i.valor_unit}))});
}
function listaCob(tit, filtro) {
  const l = S.cob.filter(filtro);
  const cols = [{t: 'Loja', f: c => esc(nomeLoja(c.loja_codigo))}, {t: 'Área', f: c => esc(AREAS[c.area])}, {t: 'Situação', f: c => chip(...SIT_COB[c.situacao])}, {t: 'Faltam câmeras', n: 1, f: c => nf(c.necessidade_cameras)},
    {t: 'Fonte', f: c => esc(c.fonte || '—')}, {t: 'Avaliado em', f: c => dBR(c.avaliado_em)}];
  abrirModal(tit, tabela(cols, l), {nome: tit, linhas: l.map(c => ({Loja: nomeLoja(c.loja_codigo), Area: AREAS[c.area], Situacao: SIT_COB[c.situacao][0], FaltamCameras: c.necessidade_cameras, Observacao: c.observacao}))});
}
function listaLojas() {
  const l = [...S.ativas.values()].sort((a, b) => a.codigo - b.codigo);
  abrirModal('Lojas ativas no cadastro oficial', `<div class="info">Fonte: cadastro oficial de lojas do Portal (portal_lojas, ativas). ${l.length} lojas.</div>` +
    tabela([{t: 'Loja', f: a => esc(nomeLoja(a.codigo))}, {t: 'Regional', f: a => esc(a.regional || '—')}, {t: 'Dados CFTV', f: a => (S.lojas.get(a.codigo) || {}).capacidade_canais ? chip('sim', 'ok') : chip('sem planilha', 'warn')}], l,
      {clic: a => `fichaLoja(${a.codigo})`}), {nome: 'Lojas', linhas: l.map(a => ({Loja: nomeLoja(a.codigo), Regional: a.regional}))});
}

// ---------------- patrimônio a preço de reposição ----------------
const BASE_PAT = {anterior_2026: 'Anterior a 2026', compras_2026: 'Compra 2026', estimativa: 'Estimativa'};
const COL_PAT = [{t: 'Loja', f: x => esc(nomeLoja(x.loja))}, {t: 'Equipamento', f: x => esc(CAT[x.categoria] || x.categoria)}, {t: 'Item', f: x => esc(x.item) + (x.estimado ? ' ' + chip('estimado', 'warn') : '')},
  {t: 'Origem', f: x => chip(BASE_PAT[x.base] || x.base, x.base === 'compras_2026' ? '' : 'neu')}, {t: 'Qtd', n: 1, f: x => nf(x.qtd)}, {t: 'Preço de hoje', n: 1, f: x => brl(x.preco)},
  {t: 'Valor', n: 1, f: x => brl(x.valor)}, {t: 'Fonte do preço', f: x => `<span class="sub">${esc(x.fonte)}</span>`}];
const xlsPat = x => ({Loja: nomeLoja(x.loja), Equipamento: CAT[x.categoria] || x.categoria, Item: x.item, Origem: BASE_PAT[x.base], Estimado: x.estimado ? 'sim' : 'não', Quantidade: Number(x.qtd), PrecoHoje: Number(x.preco), Valor: Number(x.valor), FontePreco: x.fonte});
function verPatrimonio(loja) {
  const P = S.pat; if (!P) return toast('Valorização indisponível.');
  const l = (P.linhas || []).filter(x => loja === undefined || x.loja === loja);
  const tot = soma(l, x => x.valor), est = soma(l.filter(x => x.estimado), x => x.valor);
  const porCat = Object.values(l.reduce((a, x) => { a[x.categoria] = a[x.categoria] || {c: x.categoria, q: 0, v: 0}; a[x.categoria].q += Number(x.qtd); a[x.categoria].v += Number(x.valor); return a; }, {})).sort((a, b) => b.v - a.v);
  const porBase = Object.keys(BASE_PAT).map(k => ({k, v: soma(l.filter(x => x.base === k), x => x.valor)})).filter(x => x.v);
  const precos = (P.precos || []).filter((x, i, arr) => arr.findIndex(y => y.categoria === x.categoria && y.preco === x.preco) === i);
  abrirModal('Patrimônio em equipamentos' + (loja !== undefined ? ' · ' + nomeLoja(loja) : ' · rede') + ' (preço de reposição de hoje)', `
    <div class="grid">${kpi('Valor total', brl(tot), `${nf(soma(l, x => x.qtd))} itens`, '', '')}${porBase.map(b => kpi(BASE_PAT[b.k], brl(b.v), b.k === 'estimativa' ? 'quantidade estimada (ver regra)' : '', b.k === 'estimativa' ? 'warn' : 'neu', '')).join('')}</div>
    <div class="info"><b>Como foi calculado:</b> ${esc(P.regra)} Câmera a ${brl((precos.find(x => x.categoria === 'camera') || {}).preco)}, gravador pelo número de canais (equivalentes de 16 canais do orçamento),
      HD de 2TB por gravador. Alarmes, sensores, switch/rack, fontes e incêndio pelo último preço pago. ${brl(est)} (${nf(tot ? est / tot * 100 : 0, 1)}%) vêm de quantidades estimadas:
      câmeras pela ocupação média de ${nf(P.ocupacao_media, 1)}% dos gravadores nas lojas sem canais informados e HD de gravadores antigos. Cabos e conectores não entram.</div>
    <div class="g2"><div class="card"><h3>Por equipamento</h3>${tabela([{t: 'Equipamento', f: x => esc(CAT[x.c] || x.c)}, {t: 'Qtd', n: 1, f: x => nf(x.q)}, {t: 'Valor', n: 1, f: x => brl(x.v)}], porCat)}</div>
    ${loja === undefined ? `<div class="card"><h3>Por loja</h3>${barras(P.por_loja || [], x => nomeLoja(x.loja_codigo), x => x.valor, brl, x => `verPatrimonio(${x.loja_codigo === null ? 'null' : x.loja_codigo})`, 70)}</div>` : ''}</div>
    <h2>Preços usados</h2>${tabela([{t: 'Equipamento', f: x => esc(CAT[x.categoria])}, {t: 'Preço', n: 1, f: x => brl(x.preco)}, {t: 'Fonte', f: x => esc(x.fonte)}], precos)}
    <h2>Itens</h2>${tabela(COL_PAT, l)}`, {nome: 'Patrimonio CFTV' + (loja !== undefined ? ' loja ' + nLoja(loja) : ''), linhas: l.map(xlsPat)});
}

// ---------------- detalhe de documento ----------------
async function urlArquivo(path) {
  const {data, error} = await sb.storage.from('cftv-documentos').createSignedUrl(path, 600);
  if (error) { toast('Arquivo indisponível: ' + error.message); return null; }
  return data.signedUrl;
}
async function abrirArquivo(path) { const u = await urlArquivo(path); if (u) window.open(u, '_blank', 'noopener'); }
function verDoc(id) {
  const d = S.docPorId.get(id); if (!d) return;
  const its = itensDoc(id), ocs = S.oc.filter(o => o.ativo && ((o.refs.documentos || []).includes(id)));
  const html = `<div class="g2"><div class="card ficha"><dl>
      <dt>Tipo / número</dt><dd>${esc(d.tipo)} ${esc(d.numero || '?')} ${d.serie ? '· série ' + esc(d.serie) : ''}</dd>
      <dt>Chave de acesso</dt><dd style="overflow-wrap:anywhere">${esc(d.chave || '—')}</dd>
      <dt>Emissão</dt><dd>${dBR(d.emissao)}</dd><dt>Fornecedor</dt><dd>${esc(d.fornecedor || '—')} ${d.fornecedor_cnpj ? '· ' + esc(d.fornecedor_cnpj) : ''}</dd>
      <dt>Destinatário</dt><dd>${esc(d.destinatario || '—')} ${d.destinatario_cnpj ? '· ' + esc(d.destinatario_cnpj) : ''} ${d.destinatario_municipio ? '· ' + esc(d.destinatario_municipio) : ''}</dd>
      <dt>Loja</dt><dd>${esc(nomeLoja(d.loja_codigo))} ${d.loja_confianca ? chip(d.loja_confianca === 'confirmada' ? 'confirmada' : 'confiança ' + d.loja_confianca, d.loja_confianca === 'media' ? 'warn' : 'ok') : ''}<div class="sub">${esc(d.loja_motivo || '')}</div></dd>
      <dt>Natureza</dt><dd>${esc(NAT[d.natureza])}<div class="sub">${esc(d.natureza_motivo || '')}</div></dd>
      <dt>Finalidade</dt><dd>${esc({ampliacao: 'Ampliação', substituicao: 'Substituição', nao_informada: 'Não informada'}[d.finalidade])}</dd>
      <dt>Orçamento / pedido</dt><dd>${esc(d.orcamento_ref || '—')}</dd>
      <dt>Produtos · frete · outras · desconto</dt><dd>${brl(d.valor_produtos)} · ${brl(d.frete)} · ${brl(d.outras)} · ${brl(d.desconto)}</dd>
      <dt>Valor total</dt><dd><b>${brl(d.valor_total)}</b></dd>
      <dt>Situação</dt><dd>${esc(d.status)} ${d.ocr ? chip('lido por OCR', 'warn') : ''} ${d.conferido_por ? `<div class="sub">conferido por ${esc(d.conferido_por)} em ${dBR(d.conferido_em)}</div>` : ''}</dd>
      <dt>Arquivo</dt><dd>${esc(d.arquivo_nome || '—')} ${d.arquivo_path ? `<button class="btn peq" onclick="abrirArquivo('${esc(d.arquivo_path)}')">Abrir PDF</button>` : ''}</dd>
    </dl></div><div>${(d.conferir || []).length ? `<div class="aviso"><b>Conferir:</b><br>${d.conferir.map(esc).join('<br>')}</div>` : ''}
    ${ocs.length ? `<div class="card"><h3>Ocorrências de auditoria</h3>${ocs.map(o => `<div style="margin:6px 0">${chip(SIT_OC[o.situacao][0], SIT_OC[o.situacao][1])} <b>${esc(o.titulo)}</b><div class="sub">${esc(o.detalhe || '')}</div></div>`).join('')}</div>` : ''}
    <div class="card" style="margin-top:10px"><b>Descrição</b><div class="sub">${esc(d.descricao || '—')}</div></div></div></div>
    <h2>Itens</h2>` + tabela([{t: 'Código', f: i => esc(i.codigo || '—')}, {t: 'Descrição', f: i => esc(i.descricao)}, {t: 'Categoria', f: i => esc(CAT[i.categoria])},
      {t: 'Qtd', n: 1, f: i => nf(i.quantidade, 2) + ' ' + esc(i.unidade || '')}, {t: 'Unitário', n: 1, f: i => brl(i.valor_unit)}, {t: 'Total', n: 1, f: i => brl(i.valor_total)},
      {t: 'Instalado', n: 1, f: i => L.FISICOS.includes(i.categoria) ? nf(S.instPorItem.get(i.id) || 0) : '—'}], its);
  abrirModal(`${d.tipo} ${d.numero || ''} · ${nomeLoja(d.loja_codigo)}`, html, {nome: 'Nota ' + d.numero, linhas: its.map(i => ({Codigo: i.codigo, Descricao: i.descricao, Categoria: CAT[i.categoria], Qtd: Number(i.quantidade), Unitario: Number(i.valor_unit), Total: Number(i.valor_total)}))});
}

// =====================================================================================================================
// PAINEL
// =====================================================================================================================
function rPainel() {
  const p = S.painel, fi = p.financeiro, op = p.operacional, me = p.medias, pl = p.plano || {}, P = S.pat || {}, pb = P.por_base || {};
  const r0 = v => v === null || v === undefined ? '—' : 'R$ ' + Math.round(Number(v)).toLocaleString('pt-BR');
  const pct = (a, b) => b ? a / b * 100 : null;
  const ult = S.docs.reduce((m, d) => d.emissao && d.emissao > m ? d.emissao : m, '');
  const baseNotas = `notas até ${dBR(ult)}` + (F().loja !== null ? ` · ${nomeLoja(F().loja)}` : '');
  const baseHoje = `posição de ${dBR(p.atualizado_em || hoje())}`;
  // mês a mês: último mês com gasto × média dos meses anteriores
  const tot = m => soma(['aquisicao', 'instalacao', 'manutencao', 'monitoramento'], k => m[k]);
  const meses = (p.mensal || []).filter(m => tot(m) > 0), mU = meses[meses.length - 1], ant = meses.slice(0, -1);
  const mediaAnt = ant.length ? soma(ant, tot) / ant.length : null;
  const manMes = meses.filter(m => Number(m.manutencao) > 0), manMed = manMes.length ? soma(manMes, m => m.manutencao) / manMes.length : null;
  const precoCam = Number(((P.precos || []).find(x => x.categoria === 'camera') || {}).preco) || null;
  const investido = Number(fi.investimento_total) || 0, previsto = investido + (Number(pl.total) || 0);
  const lojas = op.total_lojas || 0, cob = op.lojas_estoque_coberto || 0;
  const semLoja = soma((P.por_loja || []).filter(x => x.loja_codigo === null), x => x.valor), cd = soma((P.por_loja || []).filter(x => x.loja_codigo === 0), x => x.valor);
  const cmp = (txt, cls) => txt ? `<span class="pn-cmp ${cls || ''}">${txt}</span>` : '';
  const var_ = (a, b, inv) => { const v = pct(a - b, b); if (v === null || !isFinite(v)) return ''; const pior = inv ? v < 0 : v > 0; return cmp(`${v > 0 ? '▲' : '▼'} ${nf(Math.abs(v), 0)}%`, Math.abs(v) < 5 ? 'neu' : pior ? 'bad' : 'ok'); };
  const card = o => `<div class="pn-card ${o.cls || ''}" tabindex="0" role="button" onclick="${o.acao}" onkeydown="if(event.key==='Enter'){${o.acao}}">
      <div class="pn-t">${o.t}</div><div class="pn-v">${o.v}${o.c || ''}</div><div class="pn-e">${o.e}</div><div class="pn-b">${o.b}</div></div>`;
  const grupo = (t, s, cards) => `<section class="pn-g"><div class="pn-gt"><b>${t}</b><span>${s}</span></div><div class="pn-grid">${cards.join('')}</div></section>`;
  const alertas = [];
  if (fi.docs_conferir) alertas.push(`<b>${nf(fi.docs_conferir)} nota(s) · ${r0(fi.docs_conferir_valor)}</b> aguardam conferência — já estão somadas, mas loja ou natureza podem mudar. <a href="#" onclick="irPara('conferir');return false">Conferir agora ›</a>`);
  if (semLoja) alertas.push(`<b>${r0(semLoja)}</b> do patrimônio está em equipamentos <b>sem loja definida</b> — não aparecem no ranking por loja. <a href="#" onclick="verPatrimonio(null);return false">Ver itens ›</a>`);
  if (P.total_estimado) alertas.push(`<b>${r0(P.total_estimado)}</b> do patrimônio é <b>estimado</b> (câmeras de lojas sem canais informados e HD de gravadores antigos). <a href="#" onclick="verPatrimonio();return false">Ver regra ›</a>`);

  $('conteudo').innerHTML = `
  ${alertas.length ? `<div class="pn-alerta">${alertas.map(a => `<div>⚠ ${a}</div>`).join('')}</div>` : ''}
  ${grupo('O QUE A EMPRESA TEM HOJE', 'equipamentos instalados, valorizados pelo preço de reposição de hoje', [
    card({t: 'Patrimônio em segurança', v: r0(P.total), e: `Quanto custaria repor hoje todas as câmeras, gravadores, HDs e alarmes instalados. ${r0((pb.anterior_2026 || 0) + (pb.estimativa || 0))} anteriores a 2026 · ${r0(pb.compras_2026)} comprados em 2026.`, b: `${baseHoje} · CD ${r0(cd)} separado das lojas`, acao: 'verPatrimonio()'}),
    card({t: 'Câmeras em operação', v: nf(op.cameras_instaladas), c: lojas ? cmp(`${nf(op.cameras_instaladas / lojas, 1)} por loja`, 'neu') : '', e: `${nf(op.cameras_compradas)} compradas em 2026 (consideradas instaladas)${op.cameras_estimadas ? ` · ${nf(op.cameras_estimadas)} estimadas pelos canais ocupados` : ''}.`, b: `${nf(op.gravadores)} gravadores · ${nf(op.canais_livres)} canais livres · ${baseHoje}`, acao: "listaEq('Câmeras em operação', e => e.categoria === 'camera' && ['instalado','defeito','fora_operacao'].includes(e.situacao))"}),
    card({t: 'Lojas com câmera no estoque', v: `${nf(cob)} de ${nf(lojas)}`, c: cmp(`${nf(pct(cob, lojas) || 0, 0)}%`, cob < lojas / 2 ? 'bad' : cob < lojas ? 'neu' : 'ok'), cls: cob < lojas / 2 ? 'bad' : '', e: `O estoque é onde mais some mercadoria. ${nf(op.lojas_cobertura_incompleta)} lojas com cobertura incompleta em alguma área.`, b: `${nf(op.lojas_estoque_avaliado)} lojas avaliadas · ${baseHoje}`, acao: "listaCob('Lojas com o estoque coberto', c => c.area === 'estoque' && c.situacao === 'coberta')"}),
    card({t: 'Equipamentos parados', v: nf(op.equipamentos_defeito), cls: op.equipamentos_defeito ? 'bad' : 'ok', e: op.equipamentos_defeito ? 'Com defeito ou fora de operação: a loja está sem gravação nesses pontos.' : 'Nenhum equipamento registrado com defeito ou fora de operação.', b: baseHoje, acao: "listaEq('Equipamentos parados', e => ['defeito','fora_operacao'].includes(e.situacao))"})
  ])}
  ${grupo('QUANTO FOI GASTO', 'só notas lidas e conferidas; nenhuma despesa entra duas vezes', [
    card({t: 'Investido em 2026', v: r0(investido), c: previsto ? cmp(`${nf(pct(investido, previsto), 0)}% do previsto`, 'neu') : '', e: `Equipamentos ${r0(fi.aquisicao_equipamentos)} + instalação ${r0(fi.servicos_instalacao)}. Custo médio de ${r0(me.custo_medio_loja)} por loja que recebeu.`, b: baseNotas, acao: "listaDocs('Investido em 2026', d => ['aquisicao','instalacao'].includes(d.natureza))"}),
    card({t: 'Manutenção', v: r0(fi.manutencao_total), c: mU && manMed ? var_(Number(mU.manutencao) || 0, manMed) : '', cls: 'warn', e: `${fi.evitavel_pct === null ? 'Sem manutenção no período.' : `${r0(fi.evitavel)} (${nf(fi.evitavel_pct, 0)}%) potencialmente evitável`} · reincidência ${r0(fi.reincidencia)}.${manMed ? ` Média de ${r0(manMed)} por mês com manutenção.` : ''}`, b: `${mU ? `último mês ${mU.mes.slice(5)}/${mU.mes.slice(0, 4)} × média · ` : ''}${baseNotas}`, acao: "listaMan('Manutenção', () => true)"}),
    card({t: 'Monitoramento', v: r0(fi.monitoramento), e: 'Serviço mensal da central. Não é investimento nem manutenção — fica separado para não distorcer.', b: baseNotas, acao: "listaDocs('Monitoramento', d => d.natureza === 'monitoramento')", cls: 'neu'}),
    card({t: 'Preço pago por câmera', v: r0(me.custo_medio_camera), c: precoCam && me.custo_medio_camera ? var_(Number(me.custo_medio_camera), precoCam) : '', e: precoCam ? `Média das notas de compra × preço de hoje definido pela gestão (${r0(precoCam)}). Vermelho = pagamos acima.` : 'Média das notas de compra de câmeras.', b: baseNotas, acao: "listaItens('Câmeras compradas', i => i.categoria === 'camera')"})
  ])}
  ${grupo('O QUE FALTA INVESTIR', `orçamento de referência KGMlan · câmera a ${r0(precoCam)}`, [
    card({t: 'Novos investimentos previstos', v: r0(pl.total), cls: 'warn', e: `${nf(pl.cameras)} câmeras em ${nf(pl.lojas)} lojas para fechar as áreas descobertas. Equipamento ${r0(pl.equipamento_orcamento)}; o resto é cabo e mão de obra.`, b: `levantamento por loja · ${baseHoje}`, acao: "irPara('plano')"}),
    card({t: 'Total do programa (feito + previsto)', v: r0(previsto), c: previsto ? cmp(`${nf(pct(Number(pl.total) || 0, previsto), 0)}% ainda a fazer`, 'neu') : '', e: `Já investido ${r0(investido)} + previsto ${r0(pl.total)}. Serve para acompanhar o orçamento do ano.`, b: baseHoje, acao: "irPara('plano')"})
  ])}
  ${grupo('ONDE AGIR', 'o que precisa de decisão da Segurança ou da Diretoria', [
    card({t: 'Ocorrências suspeitas', v: nf(p.auditoria.suspeita), c: p.auditoria.valor_suspeito ? cmp(r0(p.auditoria.valor_suspeito) + ' envolvidos', 'bad') : '', cls: p.auditoria.suspeita ? 'bad' : 'ok', e: `${nf(p.auditoria.pendente)} pendentes de análise · ${nf(p.auditoria.confirmada)} confirmadas. Regras: nota duplicada, recorrência, preço fora do padrão, loja sem equipamento.`, b: `auditoria automática · ${baseHoje}`, acao: "irPara('auditoria')"}),
    card({t: 'Notas para conferir', v: nf(fi.docs_conferir), cls: fi.docs_conferir ? 'warn' : 'ok', e: fi.docs_conferir ? `${r0(fi.docs_conferir_valor)} em notas com loja ou natureza a confirmar manualmente.` : 'Todas as notas importadas já foram conferidas.', b: baseNotas, acao: "irPara('conferir')"})
  ])}
  <section class="pn-g"><div class="pn-gt"><b>EVOLUÇÃO E RANKING</b><span>clique numa barra para ver as notas</span></div>
  <div class="g2">
    <div class="card"><h3>Gasto mês a mês</h3>${colunas(p.mensal, [{k: 'aquisicao', n: 'Equipamentos', cor: 'var(--s1)'}, {k: 'instalacao', n: 'Instalação', cor: 'var(--s2)'}, {k: 'manutencao', n: 'Manutenção', cor: 'var(--s3)'}, {k: 'monitoramento', n: 'Monitoramento', cor: 'var(--s5)'}])}
      ${mU && mediaAnt ? `<div class="sub" style="margin-top:6px">${mU.mes.slice(5)}/${mU.mes.slice(0, 4)}: ${r0(tot(mU))} · média dos meses anteriores ${r0(mediaAnt)} ${var_(tot(mU), mediaAnt)}</div>` : ''}</div>
    <div class="card"><h3>Patrimônio por loja (top 10)</h3>${barras((P.por_loja || []).filter(x => x.loja_codigo !== null && x.loja_codigo !== 0), x => nomeLoja(x.loja_codigo), x => x.valor, r0, x => `verPatrimonio(${x.loja_codigo})`, 10)}
      <div class="sub" style="margin-top:6px">CD (${r0(cd)}) e itens sem loja (${r0(semLoja)}) ficam fora do ranking.</div></div>
    <div class="card"><h3>Investimento 2026 por loja (top 10)</h3>${barras(p.por_loja.filter(x => x.loja_codigo), x => nomeLoja(x.loja_codigo), x => x.investimento, r0, x => `listaDocs('Investimentos · ${esc(nomeLoja(x.loja_codigo)).replace(/'/g, '')}', d => ['aquisicao','instalacao'].includes(d.natureza) && d.loja_codigo === ${x.loja_codigo})`, 10)}</div>
    <div class="card"><h3>Lojas que mais gastam com manutenção</h3>${barras(p.ranking_manutencao, x => `${nomeLoja(x.loja_codigo)} · ${x.ocorrencias} ocorr.`, x => x.valor, r0, x => `listaMan('Manutenção · loja', m => m.loja_codigo === ${x.loja_codigo === null ? 'null' : x.loja_codigo})`, 10)}</div>
  </div></section>`;
}
function irPara(a) { fecharModal(); document.querySelector(`#abas button[data-a="${a}"]`).click(); }

// =====================================================================================================================
// POR LOJA
// =====================================================================================================================
function resumoLojas() {
  const f = F();
  const cods = [...new Set([...S.ativas.keys(), ...S.lojas.keys()])].filter(c => S.ativas.has(c) || S.docs.some(d => d.loja_codigo === c) || c === 0).sort((a, b) => a - b);
  return cods.map(c => {
    const l = S.lojas.get(c) || {}, ds = docsF(d => d.loja_codigo === c), ms = manF(m => m.loja_codigo === c);
    const cam = soma(S.eq.filter(e => e.loja_codigo === c && e.categoria === 'camera' && ['instalado', 'defeito', 'fora_operacao'].includes(e.situacao)), e => e.quantidade);
    const camEst = S.eq.some(e => e.loja_codigo === c && e.categoria === 'camera' && e.estimado);
    const est = S.cob.find(x => x.loja_codigo === c && x.area === 'estoque');
    const pl = S.plano.find(x => x.loja_codigo === c && ['planejado', 'aprovado'].includes(x.situacao));
    return {codigo: c, nome: nomeLoja(c), ativa: S.ativas.has(c), regional: (S.ativas.get(c) || {}).regional || l.regional, tipo: l.tipo, canais: l.capacidade_canais,
      livres: l.canais_analog_livres === null && l.canais_ip_livres === null ? null : (l.canais_analog_livres || 0) + (l.canais_ip_livres || 0), dias: l.dias_gravacao,
      cameras: cam, camEst, compras: soma(ds.filter(d => d.natureza === 'aquisicao'), d => d.valor_total), instalacao: soma(ds.filter(d => d.natureza === 'instalacao'), d => d.valor_total),
      manutencao: soma(ms, m => m.valor_total), nman: ms.length, necessidade: l.necessidade_cameras, plano: pl ? Number(pl.valor_estimado) : 0, estoque: est ? est.situacao : null,
      ocs: S.oc.filter(o => o.ativo && o.loja_codigo === c && ['pendente', 'suspeita'].includes(o.situacao)).length, situacao: l.situacao_cftv,
      patrimonio: Number((S.patLoja.get(c) || {}).valor || 0)};
  });
}
let ORD_LOJA = {k: 'codigo', d: 1};
function rLojas() {
  const r = resumoLojas().sort((a, b) => { const x = a[ORD_LOJA.k] ?? -1, y = b[ORD_LOJA.k] ?? -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * ORD_LOJA.d; });
  const cab = (k, t, n) => `<th class="${n ? 'n' : ''}" style="cursor:pointer" onclick="ordLoja('${k}')">${t}${ORD_LOJA.k === k ? (ORD_LOJA.d > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  $('conteudo').innerHTML = `<div class="info">Uma linha por loja do cadastro oficial (${S.ativas.size} ativas) mais CD e lojas que aparecem nas notas. Clique na loja para abrir a ficha completa.
    Valores de compras e manutenção seguem o filtro de período/fornecedor.</div>
    <div class="tw"><table><thead><tr>${cab('codigo', 'Loja')}${cab('regional', 'Regional')}${cab('canais', 'Canais', 1)}${cab('livres', 'Livres', 1)}${cab('cameras', 'Câmeras', 1)}
    ${cab('patrimonio', 'Patrimônio (preço hoje)', 1)}${cab('compras', 'Equip. 2026', 1)}${cab('instalacao', 'Instalação 2026', 1)}${cab('manutencao', 'Manutenção', 1)}${cab('necessidade', 'Faltam câm.', 1)}${cab('plano', 'Plano (orçamento)', 1)}
    ${cab('estoque', 'Estoque')}${cab('ocs', 'Auditoria', 1)}</tr></thead><tbody>${r.map(x => `<tr class="clic" onclick="fichaLoja(${x.codigo})">
      <td>${esc(x.nome)} ${x.ativa || x.codigo === 0 ? '' : chip('inativa', 'bad')} ${x.situacao ? chip(x.situacao, 'warn') : ''}</td><td>${esc(x.regional || '—')}</td>
      <td class="n">${nf(x.canais)}</td><td class="n">${nf(x.livres)}</td><td class="n">${nf(x.cameras)}${x.camEst ? '<span class="sub">*</span>' : ''}</td>
      <td class="n"><b>${x.patrimonio ? brl(x.patrimonio) : '—'}</b></td><td class="n">${x.compras ? brl(x.compras) : '—'}</td><td class="n">${x.instalacao ? brl(x.instalacao) : '—'}</td><td class="n">${x.manutencao ? brl(x.manutencao) + ` <span class="sub">(${x.nman})</span>` : '—'}</td>
      <td class="n">${nf(x.necessidade)}</td><td class="n">${x.plano ? brl(x.plano) : '—'}</td>
      <td>${x.estoque ? chip(...SIT_COB[x.estoque]) : chip('sem dados', 'neu')}</td><td class="n">${x.ocs ? chip(x.ocs, 'bad') : '—'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>Total</th><th></th><th class="n">${nf(soma(r, x => x.canais))}</th><th class="n">${nf(soma(r, x => x.livres))}</th><th class="n">${nf(soma(r, x => x.cameras))}</th>
      <th class="n">${brl(soma(r, x => x.patrimonio))}</th><th class="n">${brl(soma(r, x => x.compras))}</th><th class="n">${brl(soma(r, x => x.instalacao))}</th><th class="n">${brl(soma(r, x => x.manutencao))}</th>
      <th class="n">${nf(soma(r, x => x.necessidade))}</th><th class="n">${brl(soma(r, x => x.plano))}</th><th></th><th class="n">${nf(soma(r, x => x.ocs))}</th></tr></tfoot></table></div>
    ${S.pat && S.pat.sem_loja ? `<div class="aviso">Patrimônio de ${brl(S.pat.sem_loja)} está em notas ainda <b>sem loja definida</b> (Maceió, Petrolina, Boa Vista, Mangabeira, Manaíra…). Confirme a loja na aba Conferência e o valor vai para a loja.</div>` : ''}
    <div class="sub" style="margin-top:6px">* câmeras estimadas pelos canais ocupados do gravador (planilha CAMERAS POR LOJA): confirmar na loja.</div>
    <div class="noprint" style="margin-top:10px"><button class="btn" onclick='exportarXls("Resumo por loja", resumoLojas().map(x => ({Loja: x.nome, Regional: x.regional, Canais: x.canais, Livres: x.livres, Cameras: x.cameras, PatrimonioPrecoHoje: x.patrimonio, CamerasEstimadas: x.camEst ? "sim" : "não", Equipamentos2026: x.compras, Instalacao2026: x.instalacao, Manutencao: x.manutencao, FaltamCameras: x.necessidade, PlanoOrcamento: x.plano, Estoque: x.estoque, OcorrenciasAbertas: x.ocs})))'>Exportar Excel</button></div>`;
}
function ordLoja(k) { ORD_LOJA = {k, d: ORD_LOJA.k === k ? -ORD_LOJA.d : (['codigo', 'regional', 'estoque'].includes(k) ? 1 : -1)}; rLojas(); }

async function fichaLoja(c) {
  const l = S.lojas.get(c) || {}, a = S.ativas.get(c) || {};
  const ds = S.docs.filter(d => d.loja_codigo === c && d.status !== 'duplicado').sort((x, y) => (x.emissao || '').localeCompare(y.emissao || ''));
  const es = S.eq.filter(e => e.loja_codigo === c), ms = S.man.filter(m => m.loja_codigo === c && m.status !== 'descartado');
  const cb = Object.keys(AREAS).map(k => S.cob.find(x => x.loja_codigo === c && x.area === k) || {loja_codigo: c, area: k, situacao: 'nao_avaliada', necessidade_cameras: 0});
  const pl = S.plano.filter(p => p.loja_codigo === c), ocs = S.oc.filter(o => o.ativo && o.loja_codigo === c);
  let sens = '';
  if (S.detalhe) {
    const {data} = await sb.from('cftv_detalhes_sensiveis').select('*').eq('loja_codigo', c).order('id');
    sens = `<h2>Detalhes sensíveis <span class="tag-sens">acesso restrito</span></h2>${tabela([{t: 'Tipo', f: x => esc(x.tipo)}, {t: 'Descrição', f: x => esc(x.descricao)}, {t: 'Registrado por', f: x => esc(x.criado_por || '')}], data || [], {vazio: 'Nenhum detalhe sensível cadastrado.'})}
      ${podeEditar() ? `<div class="card noprint" style="margin-top:8px"><select id="sTipo"><option value="localizacao">Localização exata</option><option value="ponto_cego">Ponto cego</option><option value="configuracao">Configuração técnica</option><option value="acesso_remoto">Acesso remoto</option><option value="outro">Outro</option></select>
        <input id="sDesc" placeholder="Descrição (visível só para Segurança, Presidência e administração)" style="width:60%"> <button class="btn pri" onclick="salvarSensivel(${c})">Registrar</button></div>` : ''}`;
    sb.rpc('cftv_registrar', {p_acao: 'acesso', p_tabela: 'cftv_detalhes_sensiveis', p_registro: String(c)}).then(() => {});
  }
  const html = `<div class="g2"><div class="card ficha"><dl>
    <dt>Cadastro oficial</dt><dd>${S.ativas.has(c) ? chip('ativa', 'ok') : c === 0 ? 'CD / matriz (não conta como loja)' : chip('inativa ou fora do cadastro', 'bad')} ${esc(a.regional || l.regional || '')}</dd>
    <dt>Tipo</dt><dd>${esc(l.tipo || '—')}</dd><dt>Responsável (levantamento)</dt><dd>${esc(l.responsavel || '—')}</dd>
    <dt>Gravador</dt><dd>${l.capacidade_canais ? `${l.capacidade_canais} canais · ${nf(l.canais_analog_livres)} analógicos livres · ${nf(l.canais_ip_livres)} IP livres` : 'não informado'}</dd>
    <dt>Dias de gravação</dt><dd>${l.dias_gravacao ? l.dias_gravacao + ' dias' : '—'}</dd>
    <dt>Levantamento</dt><dd>${esc(l.necessidade_texto || '—')} ${l.necessidade_cameras ? `<b>(${l.necessidade_cameras} câmeras)</b>` : ''}</dd>
    <dt>CNPJs confirmados</dt><dd>${esc((l.cnpjs || []).join(', ') || '—')}</dd>
  </dl></div><div class="grid">
    ${kpi('Câmeras', nf(soma(es.filter(e => e.categoria === 'camera' && ['instalado', 'defeito', 'fora_operacao'].includes(e.situacao)), e => e.quantidade)), es.some(e => e.estimado) ? 'inclui estimativa da planilha' : '', '', '')}
    ${kpi('Investido 2026', brl(soma(ds.filter(d => ['aquisicao', 'instalacao'].includes(d.natureza) && ['ok', 'conferir'].includes(d.status)), d => d.valor_total)), `${ds.length} nota(s)`, '', '')}
    ${kpi('Manutenção', brl(soma(ms, m => m.valor_total)), `${ms.length} ocorrência(s)`, 'warn', '')}
    ${kpi('Patrimônio (preço de hoje)', brl((S.patLoja.get(c) || {}).valor), 'equipamentos a preço de reposição', '', `verPatrimonio(${c})`)}
    ${kpi('Plano (orçamento)', brl(soma(pl, p => p.valor_estimado)), pl[0] ? `${pl[0].cameras} câmeras · ${pl[0].gravadores} gravador(es)` : '', 'warn', '')}
  </div></div>
  <h2>Cobertura por área</h2>${tabela([{t: 'Área', f: x => esc(AREAS[x.area])}, {t: 'Situação', f: x => chip(...SIT_COB[x.situacao])}, {t: 'Faltam câmeras', n: 1, f: x => nf(x.necessidade_cameras)}, {t: 'Fonte', f: x => esc(x.fonte || '—')}], cb)}
  <h2>Notas fiscais</h2>${tabela(COL_DOC, ds, {clic: d => `verDoc(${d.id})`, vazio: 'Nenhuma nota desta loja.'})}
  <h2>Equipamentos</h2>${tabela(COL_EQ, es, {vazio: 'Nenhum equipamento cadastrado.'})}
  <h2>Manutenções</h2>${tabela(COL_MAN, ms, {vazio: 'Nenhuma manutenção.'})}
  <h2>Auditoria</h2>${tabela([{t: 'Situação', f: o => chip(...SIT_OC[o.situacao])}, {t: 'Ocorrência', f: o => esc(o.titulo)}, {t: 'Detalhe', f: o => esc(o.detalhe || '')}, {t: 'Valor', n: 1, f: o => brl(o.valor)}], ocs, {vazio: 'Sem ocorrências.'})}
  ${sens}`;
  abrirModal('Ficha da loja · ' + nomeLoja(c), html, {nome: 'Loja ' + nLoja(c), linhas: ds.map(xlsDoc)});
}
async function salvarSensivel(c) {
  const desc = $('sDesc').value.trim(); if (desc.length < 3) return toast('Descreva o detalhe.');
  const {error} = await sb.from('cftv_detalhes_sensiveis').insert({loja_codigo: c, tipo: $('sTipo').value, descricao: desc});
  if (error) return toast('Não foi possível salvar: ' + error.message);
  toast('Detalhe registrado.'); fichaLoja(c);
}

// =====================================================================================================================
// IMPORTAÇÃO
// =====================================================================================================================
let FILA = [];
function rImportar() {
  $('conteudo').innerHTML = `<div class="card">
    <h3>Central de importação</h3>
    <div class="sub">Aceita vários arquivos de uma vez: ZIP com notas, PDF (DANFE/DANFSe, inclusive escaneado — lido por OCR), XML de NF-e, Excel/CSV (cadastro CFTV por loja, levantamento de
      necessidades, inventário de equipamentos, movimentações) e fotos de comprovantes. A mesma nota nunca entra duas vezes (chave de acesso, conteúdo do arquivo ou emitente + número + valor).
      O que não for lido com segurança vai para a Conferência.</div>
    <div class="drop" id="drop" style="margin-top:12px">Arraste os arquivos aqui ou
      <button class="btn pri" onclick="$('fArq').click()">Selecionar arquivos</button>
      <input type="file" id="fArq" multiple class="hidden" accept=".zip,.pdf,.xml,.xlsx,.xls,.csv,.jpg,.jpeg,.png" onchange="adicionarFila(this.files)">
      <div id="filaTxt" class="sub" style="margin-top:8px">Nenhum arquivo selecionado.</div></div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn pri" id="bProc" onclick="processar()" disabled>Processar</button>
      <button class="btn" onclick="recarregar().then(()=>irPara('importar'))">Atualizar</button>
      <button class="btn" onclick="historico()">Consultar histórico</button>
      <button class="btn" onclick="baixarModelos()">Baixar modelos de planilha</button></div>
    <div class="prog hidden" id="prog"><i></i></div><div id="progTxt" class="sub"></div>
  </div><div id="resImp"></div>`;
  const dz = $('drop');
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('on'); };
  dz.ondragleave = () => dz.classList.remove('on');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('on'); adicionarFila(e.dataTransfer.files); };
}
function adicionarFila(files) {
  FILA.push(...files); $('fArq').value = '';
  $('filaTxt').textContent = `${FILA.length} arquivo(s): ` + FILA.map(f => f.name).slice(0, 8).join(', ') + (FILA.length > 8 ? '…' : '');
  $('bProc').disabled = !FILA.length;
}
async function sha256(buf) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join(''); }
const extDe = n => (n.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
function cnpjsMapa() { const m = {}; for (const l of S.lojas.values()) for (const c of (l.cnpjs || [])) m[c] = l.codigo; return m; }
function lojasLeitor() { return [...S.lojas.values()].map(l => ({codigo: l.codigo, nome: l.nome, cidade: l.cidade, apelidos: l.apelidos || [], chaves: l.chaves || []})); }

let TESS = null;
async function ocrWorker() {
  if (TESS) return TESS;
  await new Promise((ok, erro) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; s.onload = ok; s.onerror = erro; document.head.appendChild(s); });
  TESS = await Tesseract.createWorker('por', 1, {langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por@1.0.0/4.0.0_best_int'});
  return TESS;
}
async function ocrCanvas(canvas, pagina, escala) {
  const w = await ocrWorker();
  const {data} = await w.recognize(canvas, {}, {blocks: true});
  return L.frasesOcr(data.words || [], pagina, escala);
}
// PDF → peças de texto; sem texto → OCR página a página
async function lerPdf(buf) {
  const pdf = await pdfjsLib.getDocument({data: new Uint8Array(buf)}).promise;
  let itens = [];
  for (let p = 1; p <= pdf.numPages; p++) { const pg = await pdf.getPage(p); const vp = pg.getViewport({scale: 1}); itens = itens.concat(L.itensPdfjs(await pg.getTextContent(), vp.height, p)); }
  if (itens.length) return {itens, ocr: false};
  const ESC = 200 / 72;
  for (let p = 1; p <= Math.min(pdf.numPages, 4); p++) {
    const pg = await pdf.getPage(p), vp = pg.getViewport({scale: ESC}), cv = document.createElement('canvas');
    cv.width = vp.width; cv.height = vp.height; await pg.render({canvasContext: cv.getContext('2d'), viewport: vp}).promise;
    itens = itens.concat(await ocrCanvas(cv, p, 1 / ESC));
  }
  return {itens, ocr: true};
}
async function lerImagem(blob) {
  const img = await createImageBitmap(blob), cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; cv.getContext('2d').drawImage(img, 0, 0);
  const esc = 595 / img.width; // escala para a largura de uma página A4 em pontos
  return {itens: await ocrCanvas(cv, 1, esc), ocr: true};
}
// XML de NF-e (procNFe/NFe)
function lerXml(txt, nome) {
  const x = new DOMParser().parseFromString(txt, 'text/xml'), g = (el, t) => el ? (el.getElementsByTagName(t)[0] || {}).textContent || null : null;
  const inf = x.getElementsByTagName('infNFe')[0];
  if (!inf) return null;
  const ide = inf.getElementsByTagName('ide')[0], emit = inf.getElementsByTagName('emit')[0], dest = inf.getElementsByTagName('dest')[0], tot = inf.getElementsByTagName('ICMSTot')[0];
  const end = dest ? dest.getElementsByTagName('enderDest')[0] : null;
  const d = {tipo: 'NF-e', chave: (inf.getAttribute('Id') || '').replace(/^NFe/, '') || null, numero: g(ide, 'nNF'), serie: g(ide, 'serie'), emissao: (g(ide, 'dhEmi') || g(ide, 'dEmi') || '').slice(0, 10) || null,
    fornecedor: g(emit, 'xNome'), fornecedor_cnpj: L.cnpjFmt(g(emit, 'CNPJ')), destinatario: g(dest, 'xNome'), destinatario_cnpj: L.cnpjFmt(g(dest, 'CNPJ')),
    destinatario_endereco: end ? [g(end, 'xLgr'), g(end, 'nro')].filter(Boolean).join(', ') : null, destinatario_bairro: g(end, 'xBairro'), destinatario_municipio: g(end, 'xMun'),
    valor_produtos: Number(g(tot, 'vProd') || 0), frete: Number(g(tot, 'vFrete') || 0), seguro: Number(g(tot, 'vSeg') || 0), outras: Number(g(tot, 'vOutro') || 0),
    ipi: Number(g(tot, 'vIPI') || 0), desconto: Number(g(tot, 'vDesc') || 0), valor_total: Number(g(tot, 'vNF') || 0), itens: [], avisos: []};
  const ped = (g(inf, 'infCpl') || '').match(/Pedido:\s*(\d+)/i); d.pedido = ped ? ped[1] : null;
  for (const det of inf.getElementsByTagName('det')) {
    const pr = det.getElementsByTagName('prod')[0], desc = g(pr, 'xProd');
    d.itens.push({codigo: g(pr, 'cProd'), descricao: desc, ncm: g(pr, 'NCM'), unidade: g(pr, 'uCom'), quantidade: Number(g(pr, 'qCom')), valor_unit: Number(g(pr, 'vUnCom')),
      valor_total: Number(g(pr, 'vProd')), categoria: L.categoria(desc)});
  }
  d.descricao = d.itens.map(i => `${i.quantidade} ${i.unidade || ''} ${i.descricao}`).join('; ').slice(0, 1000);
  return L.finalizar(d, nome, {lojas: lojasLeitor(), cnpjs: cnpjsMapa()});
}
// Expande ZIPs (inclusive ZIP dentro de ZIP)
async function expandir(files) {
  const out = [];
  for (const f of files) {
    if (extDe(f.name) === 'zip') {
      const z = await JSZip.loadAsync(f);
      for (const e of Object.values(z.files)) {
        if (e.dir || /(^|\/)(__MACOSX|\.)/.test(e.name)) continue;
        const nome = e.name.split('/').pop().replace(/#U00([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
        const blob = await e.async('blob');
        if (extDe(nome) === 'zip') out.push(...await expandir([new File([blob], nome)])); else out.push(new File([blob], nome));
      }
    } else out.push(f);
  }
  return out;
}
async function processar() {
  if (!podeEditar()) return toast('Seu perfil é somente leitura.');
  $('bProc').disabled = true; $('prog').classList.remove('hidden');
  const prog = (i, n, t) => { $('prog').firstElementChild.style.width = (i / n * 100).toFixed(1) + '%'; $('progTxt').textContent = t; };
  let arqs;
  try { prog(0, 1, 'Abrindo arquivos…'); arqs = await expandir(FILA); } catch (e) { toast('Não foi possível abrir: ' + e.message); $('bProc').disabled = false; return; }
  FILA = [];
  const {data: imp, error: eImp} = await sb.from('cftv_importacoes').insert({origem: 'tela', arquivos: arqs.length}).select().single();
  if (eImp) { toast('Não foi possível iniciar a importação: ' + eImp.message); return; }
  const res = [], cont = {};
  for (let i = 0; i < arqs.length; i++) {
    const f = arqs[i], ext = extDe(f.name);
    prog(i, arqs.length, `${i + 1}/${arqs.length} · ${f.name}`);
    let r = {nome: f.name, tipo: ext, resultado: 'ignorado', mensagem: 'Tipo de arquivo não suportado.'};
    try {
      const buf = await f.arrayBuffer(), hash = await sha256(buf);
      r.hash = hash; r.tamanho = f.size;
      if (['xlsx', 'xls', 'csv'].includes(ext)) {
        const wb = XLSX.read(buf, {cellDates: true});
        const msgs = [];
        for (const sh of wb.SheetNames) {
          const m = XLSX.utils.sheet_to_json(wb.Sheets[sh], {header: 1, raw: true, defval: ''});
          const pl = L.lerPlanilha(m, f.name);
          if (!pl.tipo) { msgs.push(`${sh}: ${pl.aviso}`); continue; }
          const {data, error} = await sb.rpc('cftv_importar_planilha', {p_tipo: pl.tipo, p_linhas: pl.linhas, p_arquivo: f.name, p_importacao: imp.id});
          if (error) throw error;
          msgs.push(`${sh}: ${pl.tipo} · ${data.linhas} linha(s), ${data.ignoradas} ignorada(s)`);
        }
        r = {...r, resultado: 'planilha', mensagem: msgs.join(' | ')};
      } else if (['pdf', 'xml', 'jpg', 'jpeg', 'png'].includes(ext)) {
        let d;
        if (ext === 'xml') { d = lerXml(new TextDecoder().decode(buf), f.name); if (!d) throw new Error('XML sem infNFe (não é NF-e).'); }
        else {
          const lido = ext === 'pdf' ? await lerPdf(buf) : await lerImagem(f);
          d = L.lerDocumento(lido.itens, f.name, {lojas: lojasLeitor(), cnpjs: cnpjsMapa(), ocr: lido.ocr});
        }
        const caminho = `${hash}.${ext}`;
        const up = await sb.storage.from('cftv-documentos').upload(caminho, f, {contentType: f.type || (ext === 'pdf' ? 'application/pdf' : undefined), upsert: false});
        const temArq = !up.error || /exist|duplicate/i.test(up.error.message);
        const {loja_candidatos, avisos, ...doc} = d;
        const {data, error} = await sb.rpc('cftv_importar_documento', {p: {...doc, arquivo_nome: f.name, arquivo_hash: hash, arquivo_path: temArq ? caminho : null}, p_importacao: imp.id});
        if (error) throw error;
        r = {...r, resultado: data.resultado, documento_id: data.documento_id, mensagem: data.mensagem || (data.conferir || []).join(' | ') || 'Importada sem pendências.',
          resumo: `${d.tipo} ${d.numero || '?'} · ${dBR(d.emissao)} · ${brl(d.valor_total)} · ${nomeLoja(d.loja_codigo)}`};
      }
    } catch (e) { r = {...r, resultado: 'erro', mensagem: e.message}; }
    cont[r.resultado] = (cont[r.resultado] || 0) + 1; res.push(r);
  }
  prog(1, 1, 'Gravando o registro da importação e rodando a auditoria…');
  await sb.from('cftv_importacao_arquivos').insert(res.map(r => ({importacao_id: imp.id, nome: r.nome, hash: r.hash, tamanho: r.tamanho, tipo: r.tipo, resultado: r.resultado, documento_id: r.documento_id || null, mensagem: r.mensagem})));
  await sb.from('cftv_importacoes').update({resumo: cont}).eq('id', imp.id);
  await sb.rpc('cftv_reconciliar');
  await sb.rpc('cftv_auditar');
  await recarregar(); irPara('importar');
  $('resImp').innerHTML = `<h2>Resultado da importação nº ${imp.id}</h2><div class="info">${Object.entries(cont).map(([k, v]) => `${v} ${k}`).join(' · ')}. Notas "conferir" já entram nos totais; confirme loja e natureza na aba Conferência.</div>` +
    tabela([{t: 'Arquivo', f: r => esc(r.nome)}, {t: 'Resultado', f: r => chip(r.resultado, {inserido: 'ok', planilha: 'ok', anexado: 'ok', conferir: 'warn', duplicado: 'neu', erro: 'bad', ignorado: 'neu'}[r.resultado])},
      {t: 'Lido', f: r => esc(r.resumo || '')}, {t: 'Mensagem', f: r => esc(r.mensagem || '')}], res, {clic: r => r.documento_id ? `verDoc(${r.documento_id})` : ''});
}
async function historico() {
  const {data: imps} = await sb.from('cftv_importacoes').select('*').order('id', {ascending: false}).limit(50);
  const {data: arqs} = await sb.from('cftv_importacao_arquivos').select('importacao_id,nome,resultado,mensagem,documento_id').order('id', {ascending: false}).limit(2000);
  abrirModal('Histórico de importações', tabela([{t: 'Nº', f: i => i.id}, {t: 'Quando', f: i => new Date(i.em).toLocaleString('pt-BR')}, {t: 'Usuário', f: i => esc(i.usuario)}, {t: 'Origem', f: i => esc(i.origem)},
    {t: 'Arquivos', n: 1, f: i => i.arquivos}, {t: 'Resumo', f: i => esc(Object.entries(i.resumo || {}).map(([k, v]) => `${k}: ${v}`).join(' · '))}], imps || []) +
    '<h2>Arquivos (mais recentes)</h2>' + tabela([{t: 'Imp.', f: a => a.importacao_id}, {t: 'Arquivo', f: a => esc(a.nome)}, {t: 'Resultado', f: a => esc(a.resultado)}, {t: 'Mensagem', f: a => esc(a.mensagem || '')}], arqs || [],
      {clic: a => a.documento_id ? `verDoc(${a.documento_id})` : ''}), {nome: 'Historico de importacoes', linhas: arqs || []});
}
function baixarModelos() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['LOJA', 'CATEGORIA', 'MARCA', 'MODELO', 'SERIE', 'QUANTIDADE', 'CUSTO', 'DATA AQUISICAO', 'AREA', 'SITUACAO', 'OBSERVACAO'],
    ['50 - SHOPPING MANAIRA', 'Câmera bullet', 'Intelbras', 'VHL 1120 B', '', 4, 130, '2025-06-10', 'Estoque', 'Instalado', '']]), 'Inventario');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['LOJA', 'DATA', 'MOVIMENTO', 'CATEGORIA', 'QUANTIDADE', 'OBSERVACAO'],
    ['50 - SHOPPING MANAIRA', '2026-11-12', 'Substituição', 'Câmera', 1, 'Câmera do caixa trocada']]), 'Movimentacoes');
  XLSX.writeFile(wb, 'modelos-cftv.xlsx');
}

// =====================================================================================================================
// CONFERÊNCIA
// =====================================================================================================================
function rConferir() {
  const l = S.docs.filter(d => d.status === 'conferir').sort((a, b) => (a.emissao || '').localeCompare(b.emissao || ''));
  const optsLoja = c => `<option value="">— sem loja —</option><option value="0" ${c === 0 ? 'selected' : ''}>CD / Matriz</option>` +
    [...new Set([...S.ativas.keys(), ...S.lojas.keys()])].filter(x => x > 0).sort((a, b) => a - b).map(x => `<option value="${x}" ${x === c ? 'selected' : ''}>${esc(nomeLoja(x))}${S.inativas.has(x) ? ' (inativa)' : ''}</option>`).join('');
  const ro = !podeEditar();
  $('conteudo').innerHTML = `<div class="info">${l.length} documento(s) aguardando conferência (${brl(soma(l, d => d.valor_total))}). Eles já entram nos totais com a loja e a natureza sugeridas;
    ao confirmar, a loja fica gravada e o CNPJ da filial passa a identificar a loja nas próximas notas.</div>
    ${ro ? '<div class="aviso">Seu perfil é somente leitura.</div>' : ''}
    ${tabela([{t: 'Nota', f: d => `<a href="#" onclick="verDoc(${d.id});return false">${esc(d.tipo)} ${esc(d.numero || '?')}</a><div class="sub">${dBR(d.emissao)} · ${esc((d.arquivo_nome || '').slice(0, 40))}</div>`},
      {t: 'Valor', n: 1, f: d => brl(d.valor_total)},
      {t: 'Motivos', f: d => (d.conferir || []).map(m => `<div class="sub">• ${esc(m)}</div>`).join('')},
      {t: 'Loja', f: d => `<select id="cl${d.id}" ${ro ? 'disabled' : ''}>${optsLoja(d.loja_codigo)}</select>`},
      {t: 'Natureza', f: d => `<select id="cn${d.id}" ${ro ? 'disabled' : ''}>${Object.entries(NAT).map(([k, v]) => `<option value="${k}" ${k === d.natureza ? 'selected' : ''}>${v}</option>`).join('')}</select>`},
      {t: 'Finalidade', f: d => `<select id="cf${d.id}" ${ro ? 'disabled' : ''}>${[['nao_informada', 'Não informada'], ['ampliacao', 'Ampliação'], ['substituicao', 'Substituição']].map(([k, v]) => `<option value="${k}" ${k === d.finalidade ? 'selected' : ''}>${v}</option>`).join('')}</select>`},
      {t: '', f: d => ro ? '' : `<button class="btn pri peq" onclick="conferir(${d.id},'ok')">Confirmar</button> <button class="btn perigo peq" onclick="conferir(${d.id},'descartado')">Descartar</button>`}], l,
      {vazio: 'Nada para conferir. 👍'})}`;
}
async function conferir(id, st) {
  if (st === 'descartado' && !confirm('Descartar esta nota? Ela deixa de ser somada (fica registrada no histórico).')) return;
  const loja = $('cl' + id).value;
  const {error} = await sb.rpc('cftv_conferir_documento', {p_id: id, p_loja: loja === '' ? null : Number(loja), p_natureza: $('cn' + id).value, p_finalidade: $('cf' + id).value, p_status: st});
  if (error) return toast('Não foi possível salvar: ' + error.message);
  const d = S.docPorId.get(id); Object.assign(d, {status: st, loja_codigo: loja === '' ? null : Number(loja), natureza: $('cn' + id).value, finalidade: $('cf' + id).value});
  toast(st === 'ok' ? 'Nota conferida.' : 'Nota descartada.');
  $('cConf').textContent = S.docs.filter(x => x.status === 'conferir').length || '';
  await sb.rpc('cftv_reconciliar');  // compra vai para a loja confirmada (ou sai do inventário se descartada)
  rConferir(); carregarPainel();
}

// =====================================================================================================================
// INVENTÁRIO
// =====================================================================================================================
function rInventario() {
  const ativo = e => !['retirado', 'baixado', 'substituido'].includes(e.situacao);
  const ant = eqF(e => e.origem === 'anterior_2026' && ativo(e)), aq = eqF(e => e.origem === 'aquisicao_2026' && ativo(e)), atual = eqF(ativo);
  const pb = (S.pat || {}).por_base || {};
  const porCat = l => Object.keys(CAT).map(k => [k, soma(l.filter(e => e.categoria === k), e => e.quantidade)]).filter(x => x[1]);
  const pend = pendentes();
  $('conteudo').innerHTML = `
  <div class="g2">
    <div class="card"><h3>Patrimônio anterior a 2026 · ${brl(Number(pb.anterior_2026 || 0) + Number(pb.estimativa || 0))}</h3>${porCat(ant).map(([k, q]) => `<div>${esc(CAT[k])}: <b>${nf(q)}</b></div>`).join('') || '<div class="sub">Nada cadastrado.</div>'}
      <div class="sub" style="margin-top:6px">Gravadores e câmeras vindos da planilha por loja (câmeras = canais ocupados, estimativa). Custo de aquisição não informado.</div>
      <button class="btn peq" style="margin-top:6px" onclick="listaEq('Patrimônio anterior a 2026', e => e.origem === 'anterior_2026')">Ver registros</button></div>
    <div class="card"><h3>Aquisições de 2026 instaladas · ${brl(pb.compras_2026)}</h3>${porCat(aq).map(([k, q]) => `<div>${esc(CAT[k])}: <b>${nf(q)}</b></div>`).join('') || '<div class="sub">Nenhuma instalação registrada ainda.</div>'}
      <div class="sub" style="margin-top:6px">Regra da gestão: toda compra de equipamento de 2026 está instalada na loja da nota${pendentes().length ? ` (${nf(soma(pendentes(), x => x.falta))} unidade(s) ainda sem registro)` : ''}. A planilha mostra a situação de hoje, então as compras são descontadas dela para não contar duas vezes.</div>
      <button class="btn peq" style="margin-top:6px" onclick="listaPendentes()">Pendentes de instalação</button></div>
    <div class="card"><h3>Patrimônio atualizado · ${brl((S.pat || {}).total)}</h3>${porCat(atual).map(([k, q]) => `<div>${esc(CAT[k])}: <b>${nf(q)}</b></div>`).join('') || '<div class="sub">—</div>'}
      <div class="sub" style="margin-top:6px">Desconta retirados, baixados e substituídos. Valor a preço de reposição de hoje.</div>
      <button class="btn peq" style="margin-top:6px" onclick="verPatrimonio()">Ver valorização</button></div>
  </div>
  ${podeEditar() ? `<h2>Cadastrar equipamento</h2><div class="card filtros noprint">
    <div><label>Loja</label><select id="nLoja">${[...S.ativas.keys()].sort((a, b) => a - b).map(c => `<option value="${c}">${esc(nomeLoja(c))}</option>`).join('')}</select></div>
    <div><label>Categoria</label><select id="nCat">${Object.entries(CAT).filter(([k]) => k !== 'servico').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div><label>Descrição</label><input id="nDesc"></div><div><label>Marca</label><input id="nMarca" size="10"></div><div><label>Modelo</label><input id="nMod" size="10"></div>
    <div><label>Nº de série</label><input id="nSerie" size="12"></div><div><label>Qtd</label><input id="nQtd" type="number" min="1" value="1" style="width:70px"></div>
    <div><label>Custo unit.</label><input id="nCusto" type="number" step="0.01" style="width:100px"></div><div><label>Aquisição</label><input id="nData" type="date"></div>
    <div><label>Área</label><select id="nArea">${Object.entries(AREAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div><label>Situação</label><select id="nSit">${Object.entries(SIT_EQ).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="fbtn"><button class="btn pri" onclick="novoEquip()">Cadastrar</button></div></div>` : ''}
  <h2>Equipamentos</h2>
  ${tabela([...COL_EQ, {t: '', f: e => podeEditar() ? `<select onchange="mudarSituacao(${e.id}, this.value)" title="Alterar situação"><option value="">Alterar…</option>${Object.entries(SIT_EQ).filter(([k]) => k !== e.situacao).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>` : ''}], eqF())}
  <div class="noprint" style="margin-top:8px"><button class="btn" onclick='exportarXls("Inventario", eqF().map(xlsEq))'>Exportar Excel</button></div>`;
}
async function novoEquip() {
  const data = $('nData').value || null;
  const linha = {loja_codigo: Number($('nLoja').value), categoria: $('nCat').value, descricao: $('nDesc').value || null, marca: $('nMarca').value || null, modelo: $('nMod').value || null,
    numero_serie: $('nSerie').value || null, quantidade: Number($('nQtd').value || 1), custo_unit: $('nCusto').value ? Number($('nCusto').value) : null, data_aquisicao: data,
    origem: data && data >= '2026-01-01' ? 'aquisicao_2026' : 'anterior_2026', area: $('nArea').value, situacao: $('nSit').value, fonte: 'cadastro manual'};
  const {error} = await sb.from('cftv_equipamentos').insert(linha);
  if (error) return toast('Não foi possível cadastrar: ' + error.message);
  toast('Equipamento cadastrado.' + (linha.origem === 'aquisicao_2026' ? ' Aquisição 2026 sem nota vinculada aparece na auditoria até ser ligada à nota.' : '')); await recarregar(); irPara('inventario');
}
async function mudarSituacao(id, sit) {
  if (!sit) return;
  const e = S.eq.find(x => x.id === id);
  const obs = prompt(`Alterar para "${SIT_EQ[sit]}". Observação (motivo, laudo, nº da OS):`, '');
  if (obs === null) return rInventario();
  const {error} = await sb.from('cftv_equipamentos').update({situacao: sit, observacao: [e.observacao, obs].filter(Boolean).join(' · '), atualizado_em: new Date().toISOString()}).eq('id', id);
  if (error) return toast('Não foi possível salvar: ' + error.message);
  const tipo = {retirado: 'retirada', baixado: 'baixa'}[sit];
  if (tipo) await sb.from('cftv_movimentos').insert({loja_codigo: e.loja_codigo, tipo, data: hoje(), equipamento_id: id, categoria: e.categoria, quantidade: e.quantidade, observacao: obs});
  toast('Situação atualizada.'); await recarregar(); irPara('inventario');
}
async function instalarItem(itemId) {
  const i = S.itens.find(x => x.id === itemId), d = S.docPorId.get(i.documento_id), falta = Number(i.quantidade) - (S.instPorItem.get(itemId) || 0);
  const qtd = Number(prompt(`${i.descricao}\nNota ${d.numero} · ${nomeLoja(d.loja_codigo)}\nQuantas unidades foram instaladas? (faltam ${falta})`, String(Math.ceil(falta))));
  if (!qtd) return;
  const area = prompt('Área: entrada, caixa, vendas, estoque, recebimento ou outra', 'estoque');
  if (!area || !AREAS[area]) return toast('Área inválida.');
  const subs = S.eq.filter(e => e.loja_codigo === d.loja_codigo && e.categoria === i.categoria && ['instalado', 'defeito', 'fora_operacao'].includes(e.situacao));
  let substitui = null;
  if (subs.length && confirm('É SUBSTITUIÇÃO de um equipamento existente? (OK = sim, Cancelar = ampliação)')) {
    const id = prompt('Informe o nº do equipamento substituído:\n' + subs.map(e => `${e.id} · ${e.descricao || CAT[e.categoria]} · ${e.quantidade} un. · ${SIT_EQ[e.situacao]}`).join('\n'));
    substitui = id ? Number(id) : null;
  }
  const {error} = await sb.rpc('cftv_instalar_item', {p_item: itemId, p_qtd: qtd, p_area: area, p_data: hoje(), p_substitui: substitui, p_obs: null});
  if (error) return toast('Não foi possível registrar: ' + error.message);
  toast('Instalação registrada no inventário.'); fecharModal(); await recarregar();
}

// =====================================================================================================================
// COBERTURA
// =====================================================================================================================
function rCobertura() {
  const lojas = [...S.ativas.keys()].sort((a, b) => a - b), op = S.painel.operacional;
  const est = c => (S.cob.find(x => x.loja_codigo === c && x.area === 'estoque') || {}).situacao;
  const defeito = c => S.eq.some(e => e.loja_codigo === c && ['defeito', 'fora_operacao'].includes(e.situacao));
  const ro = !podeEditar();
  $('conteudo').innerHTML = `
  <div class="grid">
    ${kpi('Lojas com câmera no estoque', `${op.lojas_estoque_coberto} de ${op.total_lojas}`, `${nf(op.lojas_estoque_coberto / Math.max(1, op.total_lojas) * 100, 0)}% · ${op.lojas_estoque_avaliado} avaliadas`, 'warn', "listaCob('Estoque coberto', c => c.area==='estoque' && c.situacao==='coberta')")}
    ${kpi('Lojas com cobertura incompleta', nf(op.lojas_cobertura_incompleta), 'alguma área parcial ou sem cobertura', 'bad', "listaCob('Áreas incompletas', c => ['parcial','sem_cobertura'].includes(c.situacao))")}
    ${kpi('Cobertura completa', nf(op.lojas_cobertura_completa), 'as 5 áreas cobertas e sem equipamento com defeito', 'ok', "listaCob('Áreas cobertas', c => c.situacao==='coberta')")}
    ${kpi('Capacidade disponível nos gravadores', nf(op.canais_livres) + ' canais', `de ${nf(op.capacidade_canais)} canais`, 'neu', "listaLojas()")}
    ${kpi('Investimento para completar a cobertura', brl(S.painel.plano.total), `${nf(S.painel.plano.cameras)} câmeras · valores do orçamento`, 'warn', "irPara('plano')")}
  </div>
  <div class="info">Uma loja só é "protegida" com as áreas avaliadas como cobertas <b>e</b> equipamentos operando — ter câmera instalada não basta.
    A situação vem do levantamento de necessidades (estoque = ruas/corredores) e pode ser ajustada aqui pela Segurança; o ajuste manual não é sobrescrito por nova planilha.</div>
  <div class="tw mat"><table><thead><tr><th>Loja</th>${Object.values(AREAS).map(a => `<th>${a}</th>`).join('')}<th class="n">Faltam câm.</th><th>Equip. com defeito</th></tr></thead><tbody>
  ${lojas.map(c => `<tr><td><a href="#" onclick="fichaLoja(${c});return false">${esc(nomeLoja(c))}</a></td>${Object.keys(AREAS).map(a => {
    const x = S.cob.find(y => y.loja_codigo === c && y.area === a) || {situacao: 'nao_avaliada', necessidade_cameras: 0};
    return `<td class="cel">${ro ? chip(...SIT_COB[x.situacao]) : `<select onchange="salvarCob(${c},'${a}',this.value)" title="${esc(x.observacao || '')}">${Object.entries(SIT_COB).map(([k, v]) => `<option value="${k}" ${k === x.situacao ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>`}${x.necessidade_cameras ? `<div class="sub">faltam ${x.necessidade_cameras}</div>` : ''}</td>`;
  }).join('')}<td class="n">${nf((S.lojas.get(c) || {}).necessidade_cameras)}</td><td>${defeito(c) ? chip('sim', 'bad') : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}
async function salvarCob(loja, area, sit) {
  const ant = S.cob.find(x => x.loja_codigo === loja && x.area === area);
  const {error} = await sb.from('cftv_cobertura').upsert({loja_codigo: loja, area, situacao: sit, necessidade_cameras: ant ? ant.necessidade_cameras : 0, fonte: 'manual', avaliado_em: hoje(),
    avaliado_por: S.email, observacao: ant ? ant.observacao : null, atualizado_em: new Date().toISOString()}, {onConflict: 'loja_codigo,area'});
  if (error) return toast('Não foi possível salvar: ' + error.message);
  if (ant) Object.assign(ant, {situacao: sit, fonte: 'manual'}); else S.cob.push({loja_codigo: loja, area, situacao: sit, necessidade_cameras: 0, fonte: 'manual'});
  toast(`${nomeLoja(loja)} · ${AREAS[area]}: ${SIT_COB[sit][0]}`); carregarPainel();
}

// =====================================================================================================================
// MANUTENÇÃO E CUSTOS EVITÁVEIS
// =====================================================================================================================
function rManutencao() {
  const ms = manF(), tot = soma(ms, m => m.valor_total), ev = soma(ms.filter(m => EVITAVEIS.includes(m.classificacao)), m => m.valor_total);
  // reincidência = mesmo tipo de equipamento na mesma loja (sem equipamento informado não conta: mesmo critério do cftv_painel)
  const grupos = {}; for (const m of ms) { if (!m.categoria) continue; const k = m.loja_codigo + '|' + m.categoria; (grupos[k] = grupos[k] || []).push(m); }
  const reinc = Object.values(grupos).filter(g => g.length >= 2), alertas = Object.values(grupos).filter(g => g.length >= 3);
  const porLoja = Object.values(ms.reduce((a, m) => { const k = m.loja_codigo; a[k] = a[k] || {loja: k, valor: 0, n: 0}; a[k].valor += Number(m.valor_total); a[k].n++; return a; }, {}))
    .map(x => ({...x, equip: soma(S.eq.filter(e => e.loja_codigo === x.loja && ['instalado', 'defeito', 'fora_operacao'].includes(e.situacao) && ['camera', 'dvr_nvr', 'hd', 'alarme_sensor'].includes(e.categoria)), e => e.quantidade)}))
    .map(x => ({...x, porEquip: x.equip ? x.valor / x.equip : null})).sort((a, b) => b.valor - a.valor);
  const ro = !podeEditar();
  $('conteudo').innerHTML = `
  <div class="grid">
    ${kpi('Custo total de manutenção', brl(tot), `${ms.length} ocorrência(s)`, 'warn', "listaMan('Manutenções', () => true)")}
    ${kpi('Custo de reincidências', brl(soma(reinc.flat(), m => m.valor_total)), `${reinc.length} loja/equipamento com 2+ ocorrências`, 'warn', "listaMan('Reincidências', m => " + JSON.stringify(reinc.flat().map(m => m.id)) + ".includes(m.id))")}
    ${kpi('Despesas potencialmente evitáveis', brl(ev), tot ? nf(ev / tot * 100, 1) + '% da manutenção' : '—', 'bad', "listaMan('Evitáveis', m => ['dano_acidental','possivel_mau_uso'].includes(m.classificacao))")}
    ${kpi('Sem classificação', nf(ms.filter(m => m.classificacao === 'causa_nao_identificada').length), 'classificar para medir o evitável', 'neu', "listaMan('Causa não identificada', m => m.classificacao === 'causa_nao_identificada')")}
    ${kpi('Alertas para a Segurança', nf(alertas.length), '3 ou mais ocorrências semelhantes na mesma loja', alertas.length ? 'bad' : 'ok', "irPara('auditoria')")}
  </div>
  <div class="info"><b>Regra:</b> "possível mau uso" só pode ser gravado com evidência descrita (mínimo 10 caracteres) e marcada como suficiente — o banco recusa sem isso.
    O sistema nunca atribui culpa a funcionários ou gerentes; dano acidental e mau uso entram como custos potencialmente evitáveis (ex.: sensor danificado por impacto ou obstruído por caixas).</div>
  ${alertas.length ? `<div class="aviso"><b>Alertas:</b> ${alertas.map(g => `${esc(nomeLoja(g[0].loja_codigo))} — ${g.length}× ${esc(CAT[g[0].categoria] || 'equipamento não informado')} (${brl(soma(g, m => m.valor_total))})`).join(' · ')}</div>` : ''}
  <div class="g2">
    <div class="card"><h3>Ranking de lojas (contextualizado pelos equipamentos instalados)</h3>
      ${tabela([{t: 'Loja', f: x => esc(nomeLoja(x.loja))}, {t: 'Ocorr.', n: 1, f: x => x.n}, {t: 'Custo', n: 1, f: x => brl(x.valor)}, {t: 'Equip.', n: 1, f: x => nf(x.equip)}, {t: 'Custo/equip.', n: 1, f: x => x.porEquip === null ? '—' : brl(x.porEquip)}], porLoja.slice(0, 20),
        {clic: x => `listaMan('Manutenção da loja', m => m.loja_codigo === ${x.loja === null ? 'null' : x.loja})`})}</div>
    <div class="card"><h3>Frequência por equipamento</h3>${barras(Object.entries(CAT).map(([k, v]) => ({k, v, n: ms.filter(m => (m.categoria || 'nao_informada') === k).length, val: soma(ms.filter(m => m.categoria === k), m => m.valor_total)})).concat([{k: 'nao_informada', v: 'Não informado', n: ms.filter(m => !m.categoria).length, val: soma(ms.filter(m => !m.categoria), m => m.valor_total)}]).filter(x => x.n).sort((a, b) => b.n - a.n),
      x => `${x.v} · ${brl(x.val)}`, x => x.n, v => v + '×', x => `listaMan('${x.v}', m => (m.categoria||'nao_informada') === '${x.k}')`)}</div>
  </div>
  ${ro ? '' : `<h2>Registrar ocorrência sem nota</h2><div class="card filtros noprint">
    <div><label>Loja</label><select id="mLoja">${[...S.ativas.keys()].sort((a, b) => a - b).map(c => `<option value="${c}">${esc(nomeLoja(c))}</option>`).join('')}</select></div>
    <div><label>Data</label><input type="date" id="mData" value="${hoje()}"></div>
    <div><label>Equipamento</label><select id="mCat">${Object.entries(CAT).filter(([k]) => k !== 'servico').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div><label>Fornecedor</label><input id="mForn"></div><div style="flex:1 1 260px"><label>Descrição</label><input id="mDesc" style="width:100%"></div>
    <div><label>Peças</label><input id="mPec" type="number" step="0.01" style="width:90px"></div><div><label>Mão de obra</label><input id="mMo" type="number" step="0.01" style="width:90px"></div>
    <div><label>Classificação</label><select id="mCla">${Object.entries(CLASSE).map(([k, v]) => `<option value="${k}" ${k === 'causa_nao_identificada' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div style="flex:1 1 260px"><label>Evidências (fotos, laudo, relato)</label><input id="mEvi" style="width:100%"></div>
    <div><label><input type="checkbox" id="mSuf"> evidência suficiente</label></div>
    <div class="fbtn"><button class="btn pri" onclick="novaMan()">Registrar</button></div></div>`}
  <h2>Ocorrências de manutenção</h2>
  ${tabela([...COL_MAN.slice(0, 4), {t: 'Classificação', f: m => ro ? chip(CLASSE[m.classificacao]) : `<select id="mc${m.id}">${Object.entries(CLASSE).map(([k, v]) => `<option value="${k}" ${k === m.classificacao ? 'selected' : ''}>${v}</option>`).join('')}</select>`},
    {t: 'Evidência', f: m => ro ? esc(m.evidencia || '—') : `<input id="me${m.id}" value="${esc(m.evidencia || '')}" placeholder="laudo, fotos, relato" style="width:180px"><label class="sub"><input type="checkbox" id="ms${m.id}" ${m.evidencia_suficiente ? 'checked' : ''}> suficiente</label>`},
    {t: 'Total', n: 1, f: m => brl(m.valor_total)}, {t: '', f: m => ro ? '' : `<button class="btn peq" onclick="classificar(${m.id})">Salvar</button>` + (m.documento_id ? ` <button class="btn peq" onclick="verDoc(${m.documento_id})">Nota</button>` : '')}], ms)}
  <div class="noprint" style="margin-top:8px"><button class="btn" onclick='exportarXls("Manutencoes", manF().map(xlsMan))'>Exportar Excel</button></div>`;
}
async function classificar(id) {
  const cla = $('mc' + id).value, evi = $('me' + id).value.trim(), suf = $('ms' + id).checked;
  if (cla === 'possivel_mau_uso' && (!suf || evi.length < 10)) return toast('"Possível mau uso" exige evidência descrita (10+ caracteres) e marcada como suficiente.', 7000);
  const {error} = await sb.from('cftv_manutencoes').update({classificacao: cla, evidencia: evi || null, evidencia_suficiente: suf, status: 'ok', classificado_por: S.email, classificado_em: new Date().toISOString(), atualizado_em: new Date().toISOString()}).eq('id', id);
  if (error) return toast('Não foi possível salvar: ' + error.message, 7000);
  Object.assign(S.man.find(m => m.id === id), {classificacao: cla, evidencia: evi, evidencia_suficiente: suf, status: 'ok'});
  toast('Classificação salva.'); carregarPainel();
}
async function novaMan() {
  const pec = Number($('mPec').value || 0), mo = Number($('mMo').value || 0), cla = $('mCla').value, evi = $('mEvi').value.trim(), suf = $('mSuf').checked;
  if (cla === 'possivel_mau_uso' && (!suf || evi.length < 10)) return toast('"Possível mau uso" exige evidência descrita e marcada como suficiente.', 7000);
  const {error} = await sb.from('cftv_manutencoes').insert({loja_codigo: Number($('mLoja').value), data: $('mData').value, categoria: $('mCat').value, fornecedor: $('mForn').value || null,
    descricao: $('mDesc').value || null, pecas: pec, mao_obra: mo, valor_total: pec + mo, classificacao: cla, evidencia: evi || null, evidencia_suficiente: suf, status: 'ok', classificado_por: S.email, classificado_em: new Date().toISOString()});
  if (error) return toast('Não foi possível registrar: ' + error.message, 7000);
  toast('Ocorrência registrada. Sem nota anexada, ela aparece na auditoria como gasto sem documentação até receber evidência.');
  await sb.rpc('cftv_auditar'); await recarregar(); irPara('manutencao');
}

// =====================================================================================================================
// AUDITORIA
// =====================================================================================================================
let FILTRO_OC = {sit: 'abertas', regra: ''};
function rAuditoria() {
  const f = F();
  const base = S.oc.filter(o => o.ativo && (f.loja === null || o.loja_codigo === f.loja));
  const l = base.filter(o => (FILTRO_OC.sit === 'abertas' ? ['pendente', 'suspeita'].includes(o.situacao) : FILTRO_OC.sit === 'todas' || o.situacao === FILTRO_OC.sit) && (!FILTRO_OC.regra || o.regra === FILTRO_OC.regra))
    .sort((a, b) => ({alta: 0, media: 1, baixa: 2}[a.gravidade] - {alta: 0, media: 1, baixa: 2}[b.gravidade]) || Number(b.valor || 0) - Number(a.valor || 0));
  const por = Object.keys(REGRAS).map(r => ({r, n: base.filter(o => o.regra === r && ['pendente', 'suspeita'].includes(o.situacao)).length, c: base.filter(o => o.regra === r && o.situacao === 'confirmada').length,
    v: soma(base.filter(o => o.regra === r && ['pendente', 'suspeita'].includes(o.situacao)), o => o.valor)}));
  const ro = !podeEditar();
  $('conteudo').innerHTML = `
  <div class="grid">${['pendente', 'suspeita', 'confirmada', 'corrigida', 'descartada'].map(s => kpi(SIT_OC[s][0], nf(base.filter(o => o.situacao === s).length), '', {pendente: 'warn', suspeita: 'bad', confirmada: 'bad', corrigida: 'ok', descartada: 'neu'}[s], `filtrarOc('${s}','')`)).join('')}</div>
  <div class="info">As regras rodam a cada importação (e pelo botão abaixo). Situações: <b>pendente</b> = falta informação para analisar; <b>suspeita</b> = indício que precisa de verificação;
    <b>confirmada</b> = fato verificado. Toda decisão exige observação e fica no histórico com responsável e data. Valores de "preço acima do menor pago" comparam o mesmo código de produto do mesmo fornecedor.</div>
  <div class="card"><h3>Por regra (abertas)</h3>${tabela([{t: 'Regra', f: x => esc(REGRAS[x.r])}, {t: 'Abertas', n: 1, f: x => x.n}, {t: 'Confirmadas', n: 1, f: x => x.c}, {t: 'Valor envolvido', n: 1, f: x => brl(x.v)}], por.filter(x => x.n || x.c), {clic: x => `filtrarOc('abertas','${x.r}')`})}</div>
  <div class="filtros noprint" style="margin-top:10px">
    <div><label>Situação</label><select onchange="filtrarOc(this.value, FILTRO_OC.regra)">${[['abertas', 'Abertas (pendentes + suspeitas)'], ['todas', 'Todas'], ...Object.entries(SIT_OC).map(([k, v]) => [k, v[0]])].map(([k, v]) => `<option value="${k}" ${k === FILTRO_OC.sit ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div><label>Regra</label><select onchange="filtrarOc(FILTRO_OC.sit, this.value)"><option value="">Todas</option>${Object.entries(REGRAS).map(([k, v]) => `<option value="${k}" ${k === FILTRO_OC.regra ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    ${ro ? '' : '<div class="fbtn"><button class="btn pri" onclick="executarAuditoria()">Executar auditoria agora</button></div>'}</div>
  ${tabela([{t: 'Gravidade', f: o => chip(o.gravidade, {alta: 'bad', media: 'warn', baixa: 'neu'}[o.gravidade])}, {t: 'Situação', f: o => chip(...SIT_OC[o.situacao]) + (o.decidida ? '<div class="sub">decidida</div>' : '')},
    {t: 'Regra', f: o => esc(REGRAS[o.regra] || o.regra)}, {t: 'Ocorrência', f: o => `<b>${esc(o.titulo)}</b><div class="sub">${esc(o.detalhe || '')}</div>`}, {t: 'Loja', f: o => esc(nomeLoja(o.loja_codigo))},
    {t: 'Valor', n: 1, f: o => brl(o.valor)}, {t: '', f: o => `${(o.refs.documentos || []).filter(Boolean).slice(0, 2).map(id => `<button class="btn peq" onclick="verDoc(${id})">Nota</button>`).join(' ')} <button class="btn peq" onclick="decidirOc(${o.id})">${ro ? 'Histórico' : 'Decidir'}</button>`}], l.slice(0, 400),
    {vazio: 'Nenhuma ocorrência neste filtro.'})}
  ${l.length > 400 ? `<div class="sub">Mostrando 400 de ${l.length}. Use os filtros ou exporte.</div>` : ''}
  <div class="noprint" style="margin-top:8px"><button class="btn" onclick='exportarXls("Auditoria CFTV", S.oc.filter(o => o.ativo).map(o => ({Regra: REGRAS[o.regra], Situacao: SIT_OC[o.situacao][0], Gravidade: o.gravidade, Titulo: o.titulo, Detalhe: o.detalhe, Loja: nomeLoja(o.loja_codigo), Valor: Number(o.valor || 0)})))'>Exportar Excel</button></div>`;
}
function filtrarOc(sit, regra) { FILTRO_OC = {sit, regra}; if (S.aba !== 'auditoria') irPara('auditoria'); else rAuditoria(); }
async function executarAuditoria() {
  const {data, error} = await sb.rpc('cftv_auditar');
  if (error) return toast('Falhou: ' + error.message);
  toast(`Auditoria concluída: ${data.casos} caso(s), ${data.novas} novo(s).`); await recarregar(); irPara('auditoria');
}
async function decidirOc(id) {
  const o = S.oc.find(x => x.id === id);
  const {data: hist} = await sb.from('cftv_ocorrencias_hist').select('*').eq('ocorrencia_id', id).order('em');
  abrirModal('Ocorrência · ' + o.titulo, `<div class="card"><b>${esc(o.titulo)}</b><div class="sub">${esc(o.detalhe || '')}</div><div style="margin-top:6px">${chip(...SIT_OC[o.situacao])} · ${esc(nomeLoja(o.loja_codigo))} · ${brl(o.valor)}</div></div>
    ${podeEditar() ? `<div class="card" style="margin-top:10px"><label>Nova situação</label> <select id="dSit">${Object.entries(SIT_OC).map(([k, v]) => `<option value="${k}" ${k === o.situacao ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
      <label style="display:block;margin-top:8px">Observação (obrigatória: o que foi verificado, documento, responsável)</label><textarea id="dObs"></textarea>
      <button class="btn pri" style="margin-top:8px" onclick="salvarDecisao(${id})">Gravar decisão</button></div>` : ''}
    <h2>Histórico de correções</h2>${tabela([{t: 'Quando', f: h => new Date(h.em).toLocaleString('pt-BR')}, {t: 'Responsável', f: h => esc(h.usuario)}, {t: 'De → para', f: h => `${esc(h.de || '')} → ${esc(h.para)}`}, {t: 'Observação', f: h => esc(h.observacao || '')}], hist || [], {vazio: 'Sem decisões ainda.'})}`);
}
async function salvarDecisao(id) {
  const {error} = await sb.rpc('cftv_decidir', {p_id: id, p_situacao: $('dSit').value, p_obs: $('dObs').value});
  if (error) return toast(error.message, 7000);
  const o = S.oc.find(x => x.id === id); o.situacao = $('dSit').value; o.decidida = true;
  toast('Decisão gravada no histórico.'); fecharModal(); rAuditoria(); $('cAud').textContent = S.oc.filter(x => x.ativo && ['pendente', 'suspeita'].includes(x.situacao)).length || '';
}

// =====================================================================================================================
// PLANO E ORÇAMENTO
// =====================================================================================================================
function rPlano() {
  const f = F(), pl = S.plano.filter(p => (f.loja === null || p.loja_codigo === f.loja) && S.ativas.has(p.loja_codigo)).sort((a, b) => Number(b.valor_estimado) - Number(a.valor_estimado));
  const ativos = pl.filter(p => ['planejado', 'aprovado'].includes(p.situacao)), mc = p => p.memoria_calculo || {};
  const t = k => soma(ativos, p => mc(p)[k]);
  const ehAdmin = S.papel === 'admin';
  $('conteudo').innerHTML = `
  <div class="grid">
    ${kpi('Total previsto para novos investimentos', brl(soma(ativos, p => p.valor_estimado)), `${nf(soma(ativos, p => p.cameras))} câmeras · ${ativos.length} lojas`, 'warn', '')}
    ${kpi('Equipamento pelo orçamento', brl(t('equipamento_orcamento')), `câmeras ${brl(t('cameras_valor'))} · gravadores ${brl(t('gravadores_valor'))} · conectores ${brl(t('conectores_valor'))}`, '', '')}
    ${kpi('Cabeamento', brl(t('cabeamento')), 'metragem por câmera = premissa a validar', 'neu', '')}
    ${kpi('Mão de obra', brl(t('mao_obra')), 'valor por ponto pago nas NFS-e de 2026', 'neu', '')}
    ${kpi('Gravadores novos', nf(soma(ativos, p => p.gravadores)), `${ativos.filter(p => !mc(p).canais_livres_informados).length} lojas sem canais livres informados (considerado gravador novo)`, 'neu', '')}
  </div>
  <div class="info">Valores pelo <b>orçamento KGMlan nº 1011040400 de 26/10/2026</b>. Quantidade de câmeras = levantamento de necessidades por loja.
    Gravador novo (16 canais + HD 2TB + power balun) só quando a necessidade passa dos canais livres do gravador atual. Mude uma premissa e o plano é recalculado.</div>
  <h2>Premissas e preços</h2>
  ${tabela([{t: 'Item', f: p => esc(p.descricao)}, {t: 'Valor', n: 1, f: p => ehAdmin ? `<span class="premissa"><input type="number" step="0.01" id="pr_${p.chave}" value="${p.valor}"></span>` : nf(p.valor, 2)},
    {t: 'Unidade', f: p => esc(p.unidade || '')}, {t: 'Fonte', f: p => esc(p.fonte) + (p.validada ? '' : ' ' + chip('a validar', 'warn'))}], S.prem)}
  ${ehAdmin ? '<div class="noprint" style="margin-top:8px"><button class="btn pri" onclick="salvarPremissas()">Salvar premissas e recalcular o plano</button></div>' : ''}
  <h2>Plano por loja</h2>
  ${tabela([{t: 'Loja', f: p => `<a href="#" onclick="fichaLoja(${p.loja_codigo});return false">${esc(nomeLoja(p.loja_codigo))}</a>`}, {t: 'Levantamento', f: p => esc((p.descricao || '').replace('Completar cobertura conforme levantamento: ', '').slice(0, 80))},
    {t: 'Câmeras', n: 1, f: p => p.cameras}, {t: 'Canais livres', n: 1, f: p => mc(p).canais_livres_informados ? nf(mc(p).canais_livres) : '<span class="sub">não inf.</span>'}, {t: 'Grav.', n: 1, f: p => p.gravadores},
    {t: 'Equipamento', n: 1, f: p => brl(mc(p).equipamento_orcamento)}, {t: 'Cabeamento', n: 1, f: p => brl(mc(p).cabeamento)}, {t: 'Mão de obra', n: 1, f: p => brl(mc(p).mao_obra)}, {t: 'Total', n: 1, f: p => `<b>${brl(p.valor_estimado)}</b>`},
    {t: 'Situação', f: p => podeEditar() ? `<select onchange="situacaoPlano(${p.id}, this.value)">${['planejado', 'aprovado', 'comprado', 'instalado', 'cancelado'].map(s => `<option ${s === p.situacao ? 'selected' : ''}>${s}</option>`).join('')}</select>` : esc(p.situacao)}], pl,
    {total: ['Total (planejado + aprovado)', '', nf(soma(ativos, p => p.cameras)), '', nf(soma(ativos, p => p.gravadores)), brl(t('equipamento_orcamento')), brl(t('cabeamento')), brl(t('mao_obra')), brl(soma(ativos, p => p.valor_estimado)), '']})}
  <div class="noprint" style="margin-top:8px"><button class="btn" onclick='exportarXls("Plano de investimentos CFTV", S.plano.map(p => ({Loja: nomeLoja(p.loja_codigo), Cameras: p.cameras, Gravadores: p.gravadores, CanaisLivres: (p.memoria_calculo||{}).canais_livres, Equipamento: (p.memoria_calculo||{}).equipamento_orcamento, Cabeamento: (p.memoria_calculo||{}).cabeamento, MaoObra: (p.memoria_calculo||{}).mao_obra, Total: Number(p.valor_estimado), Situacao: p.situacao, Levantamento: p.descricao})))'>Exportar Excel</button></div>`;
}
async function salvarPremissas() {
  for (const p of S.prem) {
    const v = Number($('pr_' + p.chave).value);
    if (v !== Number(p.valor)) { const {error} = await sb.from('cftv_premissas').update({valor: v, atualizado_em: new Date().toISOString(), atualizado_por: S.email}).eq('chave', p.chave); if (error) return toast(error.message); }
  }
  const {error} = await sb.rpc('cftv_estimar_plano'); if (error) return toast(error.message);
  toast('Premissas salvas e plano recalculado.'); await recarregar(); irPara('plano');
}
async function situacaoPlano(id, s) { const {error} = await sb.from('cftv_plano').update({situacao: s, atualizado_em: new Date().toISOString()}).eq('id', id); if (error) return toast(error.message); S.plano.find(p => p.id === id).situacao = s; toast('Situação do plano atualizada.'); carregarPainel(); }

// =====================================================================================================================
// RELATÓRIOS (PDF pela impressão, Excel e versão para impressão)
// =====================================================================================================================
const RELATORIOS = {
  inventario: ['Inventário completo por loja', () => ({cols: COL_EQ, linhas: eqF().sort((a, b) => a.loja_codigo - b.loja_codigo), xls: eqF().map(xlsEq), fonte: 'cftv_equipamentos (planilhas por loja, cadastro manual e instalações de notas)'})],
  patrimonio: ['Patrimônio total da rede (preço de reposição de hoje)', () => { const l = (S.pat || {}).linhas || [];
    return {cols: COL_PAT, linhas: l, xls: l.map(xlsPat), fonte: 'Inventário (planilha por loja + compras de 2026 consideradas instaladas) valorizado pelos preços de hoje (cftv_patrimonio)',
      total: brl((S.pat || {}).total), obs: `Itens marcados "estimado" vêm da ocupação dos gravadores (planilha) ou de 1 HD por gravador. ${brl((S.pat || {}).sem_loja)} estão em notas sem loja definida.`}; }],
  investimentos: ['Investimentos de 2026', () => { const l = docsF(d => ['aquisicao', 'instalacao'].includes(d.natureza)); return {cols: COL_DOC, linhas: l, xls: l.map(xlsDoc), fonte: 'Notas fiscais importadas (cftv_documentos)', total: brl(soma(l, d => d.valor_total))}; }],
  manutencao_mensal: ['Despesas mensais de manutenção', () => { const l = S.painel.manutencao_mensal; return {cols: [{t: 'Mês', f: x => esc(x.mes)}, {t: 'Ocorrências', n: 1, f: x => x.qtd}, {t: 'Valor', n: 1, f: x => brl(x.valor)}], linhas: l, xls: l, fonte: 'cftv_manutencoes', total: brl(soma(l, x => x.valor))}; }],
  ranking: ['Ranking de custos por loja', () => { const l = resumoLojas().filter(x => x.compras + x.instalacao + x.manutencao > 0).sort((a, b) => (b.compras + b.instalacao + b.manutencao) - (a.compras + a.instalacao + a.manutencao));
    return {cols: [{t: 'Loja', f: x => esc(x.nome)}, {t: 'Equipamentos', n: 1, f: x => brl(x.compras)}, {t: 'Instalação', n: 1, f: x => brl(x.instalacao)}, {t: 'Manutenção', n: 1, f: x => brl(x.manutencao)}, {t: 'Total', n: 1, f: x => brl(x.compras + x.instalacao + x.manutencao)}, {t: 'Câmeras', n: 1, f: x => nf(x.cameras)}],
      linhas: l, xls: l.map(x => ({Loja: x.nome, Equipamentos: x.compras, Instalacao: x.instalacao, Manutencao: x.manutencao, Total: x.compras + x.instalacao + x.manutencao, Cameras: x.cameras})), fonte: 'cftv_documentos e cftv_manutencoes'}; }],
  defeitos: ['Equipamentos com maior frequência de defeitos', () => { const g = {}; for (const m of manF()) { const k = (m.categoria || 'nao_informada'); g[k] = g[k] || {k, n: 0, v: 0, lojas: new Set()}; g[k].n++; g[k].v += Number(m.valor_total); g[k].lojas.add(m.loja_codigo); }
    const l = Object.values(g).sort((a, b) => b.n - a.n); return {cols: [{t: 'Equipamento', f: x => esc(CAT[x.k] || 'Não informado')}, {t: 'Ocorrências', n: 1, f: x => x.n}, {t: 'Lojas', n: 1, f: x => x.lojas.size}, {t: 'Custo', n: 1, f: x => brl(x.v)}], linhas: l,
      xls: l.map(x => ({Equipamento: CAT[x.k] || 'Não informado', Ocorrencias: x.n, Lojas: x.lojas.size, Custo: x.v})), fonte: 'cftv_manutencoes'}; }],
  estoque: ['Cobertura de câmeras nos estoques', () => { const l = [...S.ativas.keys()].sort((a, b) => a - b).map(c => ({c, x: S.cob.find(y => y.loja_codigo === c && y.area === 'estoque')}));
    return {cols: [{t: 'Loja', f: r => esc(nomeLoja(r.c))}, {t: 'Estoque', f: r => r.x ? chip(...SIT_COB[r.x.situacao]) : chip('sem dados', 'neu')}, {t: 'Faltam câmeras', n: 1, f: r => nf(r.x ? r.x.necessidade_cameras : null)}, {t: 'Levantamento', f: r => esc(((S.lojas.get(r.c) || {}).necessidade_texto) || '—')}],
      linhas: l, xls: l.map(r => ({Loja: nomeLoja(r.c), Estoque: r.x ? SIT_COB[r.x.situacao][0] : 'sem dados', FaltamCameras: r.x ? r.x.necessidade_cameras : null, Levantamento: (S.lojas.get(r.c) || {}).necessidade_texto})), fonte: 'cftv_cobertura (levantamento de necessidades e avaliações da Segurança)'}; }],
  evitaveis: ['Custos potencialmente evitáveis', () => { const l = manF(m => EVITAVEIS.includes(m.classificacao)); return {cols: COL_MAN, linhas: l, xls: l.map(xlsMan), fonte: 'cftv_manutencoes', total: brl(soma(l, m => m.valor_total)),
    obs: 'Só entram ocorrências classificadas como dano acidental ou possível mau uso (este último somente com evidência suficiente).'}; }],
  plano: ['Plano de investimentos futuros', () => { const l = S.plano.filter(p => ['planejado', 'aprovado'].includes(p.situacao) && S.ativas.has(p.loja_codigo)).sort((a, b) => b.valor_estimado - a.valor_estimado), mc = p => p.memoria_calculo || {};
    return {cols: [{t: 'Loja', f: p => esc(nomeLoja(p.loja_codigo))}, {t: 'Câmeras', n: 1, f: p => p.cameras}, {t: 'Gravadores', n: 1, f: p => p.gravadores}, {t: 'Equipamento', n: 1, f: p => brl(mc(p).equipamento_orcamento)}, {t: 'Cabeamento', n: 1, f: p => brl(mc(p).cabeamento)}, {t: 'Mão de obra', n: 1, f: p => brl(mc(p).mao_obra)}, {t: 'Total', n: 1, f: p => brl(p.valor_estimado)}],
      linhas: l, xls: l.map(p => ({Loja: nomeLoja(p.loja_codigo), Cameras: p.cameras, Gravadores: p.gravadores, Equipamento: mc(p).equipamento_orcamento, Cabeamento: mc(p).cabeamento, MaoObra: mc(p).mao_obra, Total: Number(p.valor_estimado)})),
      fonte: 'cftv_plano · preços da proposta KGMlan 1011040400 (26/10/2026) e premissas', total: brl(soma(l, p => p.valor_estimado))}; }],
};
function rRelatorios() {
  $('conteudo').innerHTML = `<div class="info">Cada relatório traz período, filtros, fonte dos dados e data de atualização. "PDF" abre a impressão — escolha "Salvar como PDF".</div>
  <div class="grid">${Object.entries(RELATORIOS).map(([k, [t]]) => `<div class="card"><h3>${t}</h3><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn pri peq" onclick="abrirRel('${k}')">Ver</button><button class="btn peq" onclick="abrirRel('${k}',true)">PDF / imprimir</button><button class="btn peq" onclick="xlsRel('${k}')">Excel</button></div></div>`).join('')}</div>`;
}
function abrirRel(k, imprimir) {
  const [tit, fn] = RELATORIOS[k], r = fn();
  abrirModal(tit, `<div class="rel"><div class="relcab"><div class="t">${esc(tit)} · Rede Esposende</div>
    <div class="m">${esc(descFiltros())} · Fonte: ${esc(r.fonte)} · Dados atualizados em ${dBR(S.painel.atualizado_em)} · Emitido em ${new Date().toLocaleString('pt-BR')} por ${esc(S.email)}</div>
    ${r.obs ? `<div class="m">${esc(r.obs)}</div>` : ''}${r.total ? `<div class="m"><b>Total: ${r.total}</b></div>` : ''}</div>${tabela(r.cols, r.linhas)}</div>`, {nome: tit, linhas: r.xls});
  sb.rpc('cftv_registrar', {p_acao: 'exportacao', p_tabela: 'relatorio', p_registro: tit}).then(() => {});
  if (imprimir) setTimeout(() => window.print(), 300);
}
function xlsRel(k) { const [tit, fn] = RELATORIOS[k], r = fn(); exportarXls(tit, r.xls); }

// =====================================================================================================================
// ACESSOS (administração)
// =====================================================================================================================
async function rAcessos() {
  const [{data: ac, error}, {data: log}] = await Promise.all([sb.rpc('cftv_listar_acessos'), sb.from('cftv_log').select('*').order('id', {ascending: false}).limit(150)]);
  if (error) { $('conteudo').innerHTML = `<div class="card vazio">${esc(error.message)}</div>`; return; }
  $('conteudo').innerHTML = `<div class="info">Administrador e controladoria (perfil do Portal) administram o módulo; diretoria do Portal tem leitura. Aqui você libera Presidência, Diretoria, Segurança ou Consulta para outros usuários do Portal.
    Localização exata de câmeras, pontos cegos e configurações técnicas: só Segurança, Presidência e administração.</div>
  <div class="card filtros"><div style="flex:1 1 240px"><label>Email do usuário (já cadastrado no Portal)</label><input id="aEmail" type="email" style="width:100%"></div>
    <div><label>Perfil</label><select id="aPapel"><option value="presidencia">Presidência (leitura + detalhes sensíveis)</option><option value="diretoria">Diretoria (leitura)</option><option value="seguranca">Segurança (edição + detalhes sensíveis)</option><option value="consulta">Consulta (leitura)</option></select></div>
    <div><label><input type="checkbox" id="aAtivo" checked> ativo</label></div><div class="fbtn"><button class="btn pri" onclick="concederAcesso()">Salvar acesso</button></div></div>
  <h2>Quem acessa</h2>${tabela([{t: 'Email', f: a => esc(a.email)}, {t: 'Perfil', f: a => esc(a.papel)}, {t: 'Origem', f: a => esc(a.origem)}, {t: 'Ativo', f: a => a.ativo ? chip('sim', 'ok') : chip('não', 'neu')}], ac || [])}
  <h2>Registro de acessos e alterações (últimos 150)</h2>${tabela([{t: 'Quando', f: x => new Date(x.em).toLocaleString('pt-BR')}, {t: 'Usuário', f: x => esc(x.usuario)}, {t: 'Ação', f: x => esc(x.acao)}, {t: 'Onde', f: x => esc([x.tabela, x.registro].filter(Boolean).join(' · '))},
    {t: 'Detalhe', f: x => `<span class="sub">${esc(JSON.stringify(x.dados || '').slice(0, 160))}</span>`}], log || [])}`;
}
async function concederAcesso() {
  const {error} = await sb.rpc('cftv_conceder_acesso', {p_email: $('aEmail').value, p_papel: $('aPapel').value, p_ativo: $('aAtivo').checked});
  if (error) return toast(error.message, 7000);
  toast('Acesso salvo.'); rAcessos();
}

iniciar();
