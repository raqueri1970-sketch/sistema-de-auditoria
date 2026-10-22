// Cérebro Executivo Financeiro — responde perguntas sobre despesas (Inteligência) e sobre erros/perdas (Auditoria)
// usando só os dados reais de fin_lancamentos (Sallamo) e fin_ocorrencias. Revisão de 22/10/2026.
//
// REGRA FUNDAMENTAL
//   • Pergunta de GASTOS/DESPESAS → toda a base (operações normais incluídas): fin_consulta / fin_comparar.
//   • Pergunta de ERROS/PERDAS/AUDITORIA → ocorrências: suspeita (SOB_ANALISE) nunca é somada como prejuízo.
//   • Nunca inventa número, nunca troca "não encontrei" por zero e nunca cai para o total geral quando o filtro não acha nada.
//   • Sempre diz a origem dos números e o período coberto pela base.
//
// Quem pode chamar: usuário logado com fin_pode_auditar() (token do Portal), ou o próprio servidor (chave de serviço,
// usada pelo portal-conversa / MCP). A versão anterior respondia a qualquer um que tivesse a chave pública.

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELA = 'https://sistema-de-auditoria-omega.vercel.app/financeiro/';
const CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json'};
const out = (x: unknown, s = 200) => new Response(JSON.stringify(x), {status: s, headers: CORS});

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const brl = (n: unknown) => n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
const dBR = (d: string) => d ? d.slice(0, 10).split('-').reverse().join('/') : '—';
const pct = (n: unknown) => n === null || n === undefined ? '—' : `${Number(n).toLocaleString('pt-BR')}%`;

// ---------- acesso ----------
async function autorizar(req: Request): Promise<string | null> {
  const a = req.headers.get('Authorization') || '';
  const tok = a.replace(/^Bearer\s+/i, '');
  if (!tok) return null;
  if (tok === SERVICO) return SERVICO;
  const r = await fetch(`${URL_SB}/rest/v1/rpc/fin_pode_auditar`, {method: 'POST',
    headers: {apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json'}, body: '{}'});
  return r.ok && (await r.json()) === true ? tok : null;
}

async function rpc(tok: string, fn: string, args: unknown) {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${fn}`, {method: 'POST',
    headers: {apikey: tok === SERVICO ? SERVICO : ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(args)});
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${t}`);
  return JSON.parse(t);
}

async function tabela(tok: string, caminho: string) {
  const r = await fetch(`${URL_SB}/rest/v1/${caminho}`, {headers: {apikey: tok === SERVICO ? SERVICO : ANON, Authorization: `Bearer ${tok}`}});
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

// ---------- entendimento da pergunta ----------
const MESES: Record<string, number> = {janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8,
  setembro: 9, outubro: 10, novembro: 11, dezembro: 12, jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const hoje = () => new Date(new Date().toLocaleString('en-US', {timeZone: 'America/Sao_Paulo'}));
const fimMes = (a: number, m: number) => iso(new Date(Date.UTC(a, m, 0)));
const iniMes = (a: number, m: number) => iso(new Date(Date.UTC(a, m - 1, 1)));

// Meses citados por extenso, na ordem em que aparecem na pergunta
export const mesesCitados = (q: string) => [...q.matchAll(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/g)].map(x => MESES[x[1]]);

export function periodo(q: string, p: Record<string, unknown>): {de?: string; ate?: string; rotulo?: string} {
  const h = hoje(), ano = h.getFullYear(), mes = h.getMonth() + 1;
  const anoP = Number(String(p.ano || '').match(/\d{4}/)?.[0] || q.match(/\b(20\d\d)\b/)?.[1] || 0) || 0;
  const mesP = String(p.mes || p.competencia || '');
  let m = mesP.match(/^(\d{4})-(\d{1,2})/);
  if (m) return {de: iniMes(+m[1], +m[2]), ate: fimMes(+m[1], +m[2]), rotulo: `${m[2].padStart(2, '0')}/${m[1]}`};
  const mn = norm(mesP).match(/[a-z]+/)?.[0] || '';
  if (MESES[mn] || /^\d{1,2}$/.test(mesP)) { const mm = MESES[mn] || +mesP, a = anoP || ano; return {de: iniMes(a, mm), ate: fimMes(a, mm), rotulo: `${String(mm).padStart(2, '0')}/${a}`}; }
  const datas = [...q.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g)].map(x => `${x[3].length === 2 ? '20' + x[3] : x[3]}-${x[2].padStart(2, '0')}-${x[1].padStart(2, '0')}`);
  if (datas.length >= 2) return {de: datas[0], ate: datas[1], rotulo: `${dBR(datas[0])} a ${dBR(datas[1])}`};
  if (datas.length === 1) return {de: datas[0], ate: datas[0], rotulo: dBR(datas[0])};
  if (/\bhoje\b/.test(q)) return {de: iso(h), ate: iso(h), rotulo: 'hoje'};
  if (/\bontem\b/.test(q)) { const o = new Date(h); o.setDate(o.getDate() - 1); return {de: iso(o), ate: iso(o), rotulo: 'ontem'}; }
  m = q.match(/ultim[oa]s?\s+(\d+)\s+(dia|semana|mes|meses)/);
  if (m) { const n = +m[1], d = new Date(h); if (m[2].startsWith('dia')) d.setDate(d.getDate() - n + 1); else if (m[2].startsWith('semana')) d.setDate(d.getDate() - 7 * n + 1); else d.setMonth(d.getMonth() - n); return {de: iso(d), ate: iso(h), rotulo: `últimos ${n} ${m[2]}`}; }
  if (/(este|esse|neste|nesse|deste|desse)\s+mes|mes atual/.test(q)) return {de: iniMes(ano, mes), ate: iso(h), rotulo: 'este mês'};
  if (/mes passado|ultimo mes|mes anterior/.test(q)) { const a = mes === 1 ? ano - 1 : ano, mm = mes === 1 ? 12 : mes - 1; return {de: iniMes(a, mm), ate: fimMes(a, mm), rotulo: `${String(mm).padStart(2, '0')}/${a}`}; }
  if (/(esta|essa|nesta|nessa)\s+semana|semana atual/.test(q)) { const d = new Date(h); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return {de: iso(d), ate: iso(h), rotulo: 'esta semana'}; }
  // "setembro" → o mês; "de julho a setembro" → do primeiro ao último mês citado
  const ms = mesesCitados(q);
  if (ms.length) {
    const a = anoP || ano, ini = Math.min(...ms), fim = Math.max(...ms);
    return {de: iniMes(a, ini), ate: fimMes(a, fim), rotulo: ini === fim ? `${String(ini).padStart(2, '0')}/${a}` : `${String(ini).padStart(2, '0')} a ${String(fim).padStart(2, '0')}/${a}`};
  }
  if (anoP) return {de: `${anoP}-01-01`, ate: `${anoP}-12-31`, rotulo: String(anoP)};
  if (/(este|esse|neste|nesse)\s+ano/.test(q)) return {de: `${ano}-01-01`, ate: iso(h), rotulo: String(ano)};
  return {};
}

const PALAVRAS_VAZIAS = new Set(('quanto quantos quantas qual quais quem onde como quando porque por que o a os as um uma de da do das dos em no na nos nas ' +
  'com para pra pro sobre e ou ao aos foi foram e eh sao esta estao este esse essa isso total totais gastei gastamos gastou gasto gastos gastaram ' +
  'despesa despesas pagamos pagou pago pagos paga pagas pagamento pagamentos valor valores empresa esposende nos nosso nossa mes meses ano anos ' +
  'semana dia dias hoje ontem ultimo ultimos ultima ultimas passado atual periodo mostrar mostre listar liste lista me diga diz ver veja detalhe ' +
  'detalhar lancamento lancamentos titulo titulos fornecedor fornecedores conta contas contabil centro custo custos situacao situacoes ' +
  'vencimento vencimentos competencia aberto abertos vencido vencidos vencer previsto previstos maior maiores menor menores top principais ' +
  'agrupado agrupar cada tem temos teve tivemos ja ate desde entre sallamo financeiro financeira financeiras gastando dinheiro indo vai ' +
  'compare comparar comparacao contra versus x cresceu cresceram aumento aumentou subiu variacao padrao fora anormal concentracao ' +
  'janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro geral tudo todo todos toda todas favor ' +
  'loja lojas pagar receber temos estamos estao perdendo perder perdemos perda perdas onde aonde gastando custando custou sai saindo saiu ' +
  'existe existem algum alguma algo houve teria tenho voce pode podem preciso quero queria saber ' +
  'confirmado confirmada confirmados confirmadas caso casos analise sob comprovado comprovada identificado identificados achado achados').split(' '));

export function entender(pergunta: string, p: Record<string, unknown>) {
  const q = norm(pergunta);
  const auditoria = /\b(erro|erros|perd|prejuiz|auditor|duplic|em dobro|duas vezes|pago a mais|pagamos a mais|irregular|suspeit|juros|multa|acrescimo|encargo|credito nao|desconto nao|devoluc|nao aproveitad|inconsisten|pagamento incorreto|incorret|caixa de revisao|revisao|sentinela|risco|fraude|desvio|alerta|ocorrenc)/.test(q);
  const comparar = /\b(compar|cresc|aument|subiu|subir|variac|fora do padrao|anormal|concentrac|versus|\bx\b mes|mes a mes|evoluc|tendenc)/.test(q);
  const base = /\b(vencimento|vence|vencem|vencid|a vencer|a pagar|em aberto|aberto|devendo|previst)/.test(q) ? 'vencimento'
    : /\bcompetencia\b/.test(q) ? 'competencia' : 'pagamento';
  const situacao = /\bvencid/.test(q) ? 'Vencido' : /\ba vencer\b/.test(q) ? 'A vencer' : /\bprevist/.test(q) ? 'Previsto' : String(p.status || '') || undefined;
  const agrupar = /por (conta|categoria|plano)/.test(q) ? 'conta' : /por (centro|loja|filial|departamento|area)/.test(q) ? 'centro'
    : /por (mes|meses)|mes a mes|mensal|evoluc/.test(q) ? 'mes' : /por (dia|dias)|diari/.test(q) ? 'dia' : /por situac|por status/.test(q) ? 'situacao'
    : /por fornecedor|fornecedores|maiores|top|ranking|concentrac/.test(q) ? 'fornecedor' : undefined;
  const listar = /\b(lancamentos|quais|liste|listar|mostre|mostrar|detalh|abrir|abre|titulos)\b/.test(q);
  const per = periodo(q, p);
  // termos que sobram viram busca (fornecedor, conta ou centro de custo)
  const loja = q.match(/\bloja\s*(\d{1,3})\b/)?.[1];
  const termos = q.replace(/\bloja\s*\d{1,3}\b/g, ' ').replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ').replace(/\b20\d\d\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !PALAVRAS_VAZIAS.has(w) && !/^\d+$/.test(w)
      && !/^(erro|perd|prejuiz|auditor|duplic|irregular|suspeit|juros|multa|acresc|encargo|credito|desconto|devoluc|aproveit|inconsist|incorret|revisao|sentinela|risco|fraude|desvio|alerta|ocorrenc|dobro|vezes|mais|menos)/.test(w));
  const grupo = /duplic|em dobro|duas vezes/.test(q) ? 'FIN_DUPLICIDADE' : /juros|multa|acresc|encargo|atraso/.test(q) ? 'FIN_JUROS_MULTA'
    : /credito|desconto|devoluc|aproveit/.test(q) ? 'FIN_CREDITO_DESCONTO' : /incorret|pago a mais|pagamos a mais/.test(q) ? 'FIN_PAGAMENTO_INCORRETO'
    : /inconsist|cadastro|centro de custo vazio/.test(q) ? 'FIN_INCONSISTENCIA_DADOS' : undefined;
  const filtros: Record<string, unknown> = {base};
  if (per.de) filtros.de = per.de; if (per.ate) filtros.ate = per.ate;
  if (situacao) filtros.situacao = situacao;
  if (p.fornecedor) filtros.fornecedor = p.fornecedor;
  if (p.descricao || p.grupo || p.subgrupo) filtros.conta = p.descricao || p.grupo || p.subgrupo;
  if (p.departamento || p.loja || loja) filtros.centro = p.departamento || (/^\d{1,3}$/.test(String(p.loja || loja || '')) ? String(p.loja || loja).padStart(3, '0') : p.loja);
  if (p.codigo) filtros.codigo = p.codigo;
  if (termos.length && !p.fornecedor && !p.descricao) filtros.busca = termos.join(' ');
  return {modo: auditoria ? 'auditoria' : comparar ? 'comparacao' : 'inteligencia', filtros, agrupar, listar, grupo, periodo: per, termos, texto: q};
}

// ---------- respostas ----------
const NOMES_GRUPO: Record<string, string> = {FIN_DUPLICIDADE: 'Duplicidade de pagamento', FIN_PAGAMENTO_INCORRETO: 'Pagamento incorreto',
  FIN_JUROS_MULTA: 'Juros e multas', FIN_CREDITO_DESCONTO: 'Crédito/desconto/devolução não aproveitados', FIN_INCONSISTENCIA_DADOS: 'Inconsistência de dados'};
const NOMES_CLASSE: Record<string, string> = {NORMAL: 'Normal', SOB_ANALISE: 'Sob análise', IRREGULARIDADE_CONFIRMADA: 'Irregularidade confirmada',
  PREJUIZO_CONFIRMADO: 'Prejuízo confirmado'};

function descreverFiltro(f: Record<string, unknown>, per: {rotulo?: string}) {
  const partes: string[] = [];
  if (f.busca) partes.push(`“${f.busca}”`);
  if (f.fornecedor) partes.push(`fornecedor “${f.fornecedor}”`);
  if (f.conta) partes.push(`conta “${f.conta}”`);
  if (f.centro) partes.push(`centro de custo “${f.centro}”`);
  if (f.situacao) partes.push(`situação ${f.situacao}`);
  partes.push(per.rotulo ? `período ${per.rotulo}` : 'toda a base');
  return partes.join(', ');
}

async function inteligencia(tok: string, e: ReturnType<typeof entender>) {
  const agrupar = e.agrupar || (e.filtros.busca || e.filtros.fornecedor ? 'conta' : 'fornecedor');
  const d = await rpc(tok, 'fin_consulta', {p: {...e.filtros, agrupar, limite: 10, limite_lancamentos: e.listar ? 20 : 5}});
  const t = d.totais, cob = d.cobertura, base = e.filtros.base;
  const filtroTxt = descreverFiltro(e.filtros, e.periodo);
  if (!t.lancamentos) {
    return {resposta: `Não encontrei lançamentos no Sallamo para ${filtroTxt}. Isso não quer dizer gasto zero: ` +
      `${cob.aviso} Confira o nome usado (fornecedor, conta ou centro de custo) ou o período.`, dados: d, status_dados: 'SEM_DADOS'};
  }
  const linhas: string[] = [];
  if (base === 'pagamento') linhas.push(`Gasto pago (${filtroTxt}): ${brl(t.valor_pago)} em ${t.lancamentos} lançamento(s) de ${t.fornecedores} fornecedor(es).`);
  else linhas.push(`Por ${base} (${filtroTxt}): ${brl(t.valor_parcela)} em ${t.lancamentos} parcela(s) — ${brl(t.valor_pago)} já pago, ` +
    `${brl(t.saldo_em_aberto)} em aberto${Number(t.vencido_em_aberto) > 0 ? `, dos quais ${brl(t.vencido_em_aberto)} vencido` : ''}.`);
  const nomeDim: Record<string, string> = {fornecedor: 'fornecedores', conta: 'contas', centro: 'centros de custo', mes: 'meses', dia: 'dias', situacao: 'situações'};
  if (d.grupos.length > 1) linhas.push(`Por ${nomeDim[agrupar] || agrupar}: ` +
    d.grupos.slice(0, agrupar === 'mes' ? 12 : 5).map((g: any) => `${g.grupo} ${brl(g.valor)}${g.pct != null ? ` (${pct(g.pct)})` : ''}`).join('; ') + '.');
  if (e.listar || t.lancamentos <= 5) linhas.push('Lançamentos: ' + d.lancamentos.slice(0, e.listar ? 10 : 5).map((l: any) =>
    `título ${l.codigo} · ${l.fornecedor} · ${l.conta} · venc. ${dBR(l.vencimento)}${l.data_pagamento ? ` · pago ${dBR(l.data_pagamento)}` : ''} · ` +
    `${brl(base === 'pagamento' ? l.valor_pago : l.valor_parcela)}${l.auditoria !== 'NORMAL' ? ` · ⚠ ${NOMES_CLASSE[l.auditoria]}` : ''}`).join(' | ') + '.');
  const marcados = d.lancamentos.filter((l: any) => l.auditoria !== 'NORMAL').length;
  if (marcados && !e.listar) linhas.push(`${marcados} dos maiores lançamentos têm ocorrência de auditoria (veja na tela).`);
  if (e.periodo.de && cob.pagamento_de && base === 'pagamento' && e.periodo.de < cob.pagamento_de) linhas.push(`Atenção: ${cob.aviso}`);
  linhas.push(`Definição: ${d.definicao} Origem: ${d.origem}.`);
  return {resposta: linhas.join('\n'), dados: d, status_dados: 'VALIDADO'};
}

async function comparacao(tok: string, e: ReturnType<typeof entender>) {
  const p: Record<string, unknown> = {...e.filtros, agrupar: e.agrupar && ['fornecedor', 'conta', 'centro'].includes(e.agrupar) ? e.agrupar : 'fornecedor'};
  delete p.de; delete p.ate;
  const ms = mesesCitados(e.texto), ano = Number(e.periodo.de?.slice(0, 4)) || hoje().getFullYear();
  if (ms.length >= 2) { // "compare setembro com agosto": o mês mais antigo é A, o mais recente é B
    const a = Math.min(ms[0], ms[1]), b = Math.max(ms[0], ms[1]);
    Object.assign(p, {a_de: iniMes(ano, a), a_ate: fimMes(ano, a), b_de: iniMes(ano, b), b_ate: fimMes(ano, b)});
  } else if (e.periodo.de && e.periodo.ate) { // período citado = B; A = mesmo tamanho imediatamente antes
    const de = new Date(e.periodo.de), ate = new Date(e.periodo.ate), dias = Math.round((+ate - +de) / 864e5);
    const aAte = new Date(de); aAte.setUTCDate(aAte.getUTCDate() - 1);
    const aDe = new Date(aAte); aDe.setUTCDate(aDe.getUTCDate() - dias);
    Object.assign(p, {b_de: e.periodo.de, b_ate: e.periodo.ate, a_de: iso(aDe), a_ate: iso(aAte)});
    if (e.periodo.de.endsWith('-01') && e.periodo.ate === fimMes(+e.periodo.de.slice(0, 4), +e.periodo.de.slice(5, 7))) {
      const a = new Date(e.periodo.de); a.setUTCMonth(a.getUTCMonth() - 1);
      Object.assign(p, {a_de: iso(a), a_ate: fimMes(a.getUTCFullYear(), a.getUTCMonth() + 1)});
    }
  }
  const d = await rpc(tok, 'fin_comparar', {p});
  const A = d.periodo_a, B = d.periodo_b;
  const linhas = [`Comparação (${descreverFiltro(e.filtros, {})}; ${dBR(A.de)}–${dBR(A.ate)} × ${dBR(B.de)}–${dBR(B.ate)}): ` +
    `${brl(A.total)} → ${brl(B.total)} (${d.variacao_pct != null ? (d.variacao_pct > 0 ? '+' : '') + pct(d.variacao_pct) : 'sem base de comparação'}).`];
  const nomes: Record<string, string> = {AUMENTO_ANORMAL: 'aumento anormal', NOVO: 'novo', SUMIU: 'zerou', QUEDA_FORTE: 'queda forte'};
  if (d.alertas.length) linhas.push('Fora do padrão: ' + d.alertas.slice(0, 8).map((x: any) =>
    `${x.grupo} ${brl(x.a)} → ${brl(x.b)} (${nomes[x.alerta]}${x.pct != null ? `, ${x.pct > 0 ? '+' : ''}${pct(x.pct)}` : ''})`).join('; ') + '.');
  else linhas.push('Nenhuma variação fora do padrão (critério: +50% e +R$ 10 mil, novo ou zerado acima de R$ 10 mil).');
  if (d.concentracao_top5_pct != null) linhas.push(`Concentração: os 5 maiores respondem por ${pct(d.concentracao_top5_pct)} do período mais recente.`);
  if (d.cobertura?.pagamento_de && A.de < d.cobertura.pagamento_de) linhas.push(`Atenção: ${d.cobertura.aviso}`);
  linhas.push(`Origem: ${d.origem}.`);
  return {resposta: linhas.join('\n'), dados: d, status_dados: 'VALIDADO'};
}

async function auditoria(tok: string, e: ReturnType<typeof entender>) {
  const r = await rpc(tok, 'fin_resumo', {});
  const a = r.auditoria;
  let q = 'fin_ocorrencias?select=id,grupo,regra,titulo,motivo,classificacao,prioridade,forca,fornecedor,codigo_titulo,valor_envolvido,impacto_estimado,impacto_comprovado,data_ref,status_revisao' +
    '&ativo=eq.true&classificacao=neq.NORMAL&order=pontos.desc,impacto_estimado.desc.nullslast&limit=8';
  if (e.grupo) q += `&grupo=eq.${e.grupo}`;
  if (e.periodo.de) q += `&data_ref=gte.${e.periodo.de}`;
  if (e.periodo.ate) q += `&data_ref=lte.${e.periodo.ate}`;
  if (e.filtros.busca) q += `&fornecedor=ilike.*${encodeURIComponent(String(e.filtros.busca).split(' ')[0])}*`;
  const casos = await tabela(tok, q);
  const linhas: string[] = [];
  if (e.grupo) {
    const g = a.por_grupo?.[e.grupo];
    if (!g) linhas.push(`${NOMES_GRUPO[e.grupo]}: nenhuma ocorrência encontrada pela auditoria. Isso indica ausência de achados nos dados cruzados, não prova de que o problema não exista.`);
    else linhas.push(`${NOMES_GRUPO[e.grupo]}: prejuízo confirmado ${brl(g.prejuizo)} (${g.PREJUIZO_CONFIRMADO} caso(s)); ` +
      `irregularidade confirmada ${g.IRREGULARIDADE_CONFIRMADA} caso(s) com ${brl(g.impacto_comprovado - g.prejuizo)} comprovado; ` +
      `sob análise ${g.SOB_ANALISE} caso(s) com ${brl(g.valor_em_risco)} em risco — suspeita, ainda não é prejuízo.`);
  } else {
    linhas.push(`Auditoria Financeira: prejuízo confirmado ${brl(a.prejuizo_confirmado)} (${a.prejuizo_confirmado_qtd} caso(s), decididos na Caixa de Revisão). ` +
      `Irregularidade confirmada: ${a.irregularidade_confirmada_qtd} caso(s), ${brl(a.irregularidade_confirmada_impacto)} comprovado por documento. ` +
      `Sob análise: ${a.sob_analise_qtd} caso(s) com ${brl(a.sob_analise_valor_em_risco)} em risco — suspeita, não é prejuízo. ` +
      `${a.caixa_revisao} aguardam decisão na Caixa de Revisão.`);
    const pg = a.por_grupo || {};
    linhas.push('Por grupo: ' + Object.keys(NOMES_GRUPO).filter(k => pg[k]).map(k =>
      `${NOMES_GRUPO[k]} — ${pg[k].SOB_ANALISE} sob análise (${brl(pg[k].valor_em_risco)}), ${pg[k].IRREGULARIDADE_CONFIRMADA + pg[k].PREJUIZO_CONFIRMADO} confirmado(s)`).join('; ') + '.');
  }
  if (casos.length) linhas.push((e.periodo.rotulo ? `Casos em ${e.periodo.rotulo}` : 'Prioridades da Sentinela') + ': ' + casos.map((c: any) =>
    `#${c.id} ${c.titulo} · ${c.fornecedor || '—'}${c.codigo_titulo ? ` · título ${c.codigo_titulo}` : ''} · ` +
    `${brl(c.impacto_comprovado ?? c.impacto_estimado ?? c.valor_envolvido)} · ${NOMES_CLASSE[c.classificacao]} (${c.prioridade.toLowerCase()})`).join(' | ') + '.');
  else if (e.periodo.rotulo || e.filtros.busca) linhas.push(`Nenhuma ocorrência ativa para ${descreverFiltro(e.filtros, e.periodo)}.`);
  linhas.push(`Origem: fin_ocorrencias (cruzamento Sallamo × comprovantes × banco/OCR). ${r.regras} Para ver as evidências e decidir: ${TELA}#revisao`);
  return {resposta: linhas.join('\n'), dados: {resumo: r, casos}, status_dados: 'VALIDADO'};
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, {headers: CORS});
  if (req.method !== 'POST') return out({error: 'Use POST'}, 405);
  try {
    const tok = await autorizar(req);
    if (!tok) return out({error: 'Acesso não autorizado à Auditoria Financeira'}, 403);
    const p = await req.json().catch(() => ({}));
    const pergunta = String(p.pergunta || p.pergunta_original || '').trim();
    if (!pergunta) return out({error: 'Informe a pergunta.'}, 400);
    const e = entender(pergunta, p);
    if (p.contexto && typeof p.contexto === 'object') { // continuação ("e em agosto?") herda o que não foi dito de novo
      const c = p.contexto as any;
      for (const k of ['busca', 'fornecedor', 'conta', 'centro', 'situacao']) if (!(k in e.filtros) && c.filtros?.[k]) e.filtros[k] = c.filtros[k];
      if (!e.periodo.de && c.periodo?.de) { e.periodo = c.periodo; e.filtros.de = c.periodo.de; e.filtros.ate = c.periodo.ate; }
      if (e.modo === 'inteligencia' && c.modo && /^\s*e\b/.test(norm(pergunta))) e.modo = c.modo;
      if (!e.grupo && c.grupo) e.grupo = c.grupo;
      if (e.filtros.base === 'pagamento' && c.filtros?.base) e.filtros.base = c.filtros.base;
    }
    const r = e.modo === 'auditoria' ? await auditoria(tok, e) : e.modo === 'comparacao' ? await comparacao(tok, e) : await inteligencia(tok, e);
    return out({agente: e.modo === 'auditoria' ? 'Cérebro Executivo · Auditoria Financeira' : 'Cérebro Executivo · Inteligência Financeira',
      modulo: 'fin', modo: e.modo, status_dados: r.status_dados, resposta: r.resposta, entendimento: e, dados: r.dados,
      tela: TELA, contexto: {modo: e.modo, filtros: e.filtros, periodo: e.periodo, grupo: e.grupo},
      padrao: {suspeita_nao_e_prejuizo: true, ausencia_nao_e_zero: true, origem_sempre_informada: true}});
  } catch (err) {
    return out({error: String(err), agente: 'Cérebro Executivo Financeiro'}, 500);
  }
});
