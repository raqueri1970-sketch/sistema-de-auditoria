// Cérebro Executivo · Segurança Patrimonial e CFTV (12/11/2026).
// Responde perguntas sobre câmeras, gravadores, alarmes, cobertura, investimentos, manutenção e plano usando só os registros
// reais do módulo (cftv_painel + tabelas cftv_*). Sempre informa período, fonte e critério; nunca troca "não sei" por zero.
//
// Quem pode chamar: usuário do Portal com acesso ao módulo (cftv_pode_ver), ou o portal-conversa (chave de serviço + assinatura
// interna x-cftv-interno + cftv_autorizado), que confere o usuário (token do Portal ou MCP com fin_autorizado) antes.
const URL_SB = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELA = 'seguranca-cftv/';
const CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json'};
const out = (x: unknown, s = 200) => new Response(JSON.stringify(x), {status: s, headers: CORS});
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const brl = (n: unknown) => n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
const num = (n: unknown, d = 0) => Number(n ?? 0).toLocaleString('pt-BR', {maximumFractionDigits: d});
const dBR = (d: string) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—';
const nLoja = (c: number | null) => c === null ? 'sem loja definida' : c === 0 ? 'CD / matriz' : `loja ${String(c - 900).padStart(2, '0')}`;

const assinatura = async () => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SERVICO + ':cftv-interno'))))
  .map(b => b.toString(16).padStart(2, '0')).join('');

async function autorizar(req: Request, p: Record<string, unknown>): Promise<string | null> {
  const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tok) return null;
  // Chave de serviço só vale com a assinatura interna do portal-conversa: o portal-sentinel-agent-proxy (aberto) também usa a
  // chave de serviço e repassa o corpo da requisição, então o campo cftv_autorizado sozinho não prova nada.
  if (tok === SERVICO) return (p.cftv_autorizado === true || p.fin_autorizado === true) && req.headers.get('x-cftv-interno') === await assinatura() ? SERVICO : null;
  if (tok === ANON) return null;
  const r = await fetch(`${URL_SB}/rest/v1/rpc/cftv_pode_ver`, {method: 'POST', headers: {apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json'}, body: '{}'});
  return r.ok && (await r.json()) === true ? tok : null;
}
const hdr = (tok: string) => ({apikey: tok === SERVICO ? SERVICO : ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json'});
async function rpc(tok: string, fn: string, args: unknown) {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${fn}`, {method: 'POST', headers: hdr(tok), body: JSON.stringify(args)});
  const t = await r.text(); if (!r.ok) throw new Error(`${fn}: ${t}`); return JSON.parse(t);
}
async function tabela(tok: string, caminho: string) {
  const r = await fetch(`${URL_SB}/rest/v1/${caminho}`, {headers: hdr(tok)});
  if (!r.ok) throw new Error(await r.text()); return await r.json();
}

// ---------- entendimento da pergunta ----------
const MESES: Record<string, number> = {janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12};
export function periodo(q: string) {
  const ano = Number(q.match(/\b(20\d\d)\b/)?.[1] || 2026);
  const m = q.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
  if (m) { const mm = MESES[m[1]]; const fim = new Date(Date.UTC(ano, mm, 0)).toISOString().slice(0, 10); return {de: `${ano}-${String(mm).padStart(2, '0')}-01`, ate: fim, rotulo: `${String(mm).padStart(2, '0')}/${ano}`}; }
  return {de: `${ano}-01-01`, ate: `${ano}-12-31`, rotulo: String(ano)};
}
// "loja 50", "loja 05", "filial 950" → 950
export function loja(q: string): number | null {
  const m = q.match(/\b(?:loja|filial|unidade)\s*(?:n[ºo°.]?\s*)?(\d{1,3})\b/);
  if (!m) return null;
  const n = Number(m[1]); return n >= 900 ? n : 900 + n;
}
export function categoria(q: string): string | null {
  if (/sensor|alarme|sirene|central de alarme/.test(q)) return 'alarme_sensor';
  if (/camera/.test(q)) return 'camera';
  if (/dvr|nvr|gravador/.test(q)) return 'dvr_nvr';
  if (/\bhds?\b|disco/.test(q)) return 'hd';
  if (/cabo|cabeamento/.test(q)) return 'cabeamento';
  if (/concertina|cerca/.test(q)) return 'perimetro';
  if (/incendio|extintor/.test(q)) return 'incendio';
  return null;
}
const CAT: Record<string, string> = {camera: 'câmeras', dvr_nvr: 'DVR/NVR', hd: 'HDs', alarme_sensor: 'alarmes e sensores', perimetro: 'proteção perimetral', incendio: 'incêndio',
  fonte_energia: 'fontes', rede_rack: 'switch/rack', cabeamento: 'cabeamento', conector_acessorio: 'conectores e acessórios', outro: 'outros', nao_informada: 'não informado'};

// ---------- respostas ----------
async function responder(tok: string, pergunta: string) {
  const q = norm(pergunta), per = periodo(q), lj = loja(q), cat = categoria(q);
  const base = {agente: 'Cérebro Executivo · Segurança Patrimonial e CFTV', modulo: 'cftv', pergunta, periodo: {de: per.de, ate: per.ate, rotulo: per.rotulo}, tela: TELA};
  const pnl = (args: Record<string, unknown> = {}) => rpc(tok, 'cftv_painel', {p_de: per.de, p_ate: per.ate, ...args});
  const FONTE = 'Notas fiscais importadas no módulo Segurança e CFTV (cftv_documentos / cftv_documento_itens), inventário, cobertura, manutenções e cadastro oficial de lojas (portal_lojas).';
  const pend = (p: any) => p.financeiro.docs_conferir ? ` Atenção: ${p.financeiro.docs_conferir} nota(s) (${brl(p.financeiro.docs_conferir_valor)}) ainda aguardam conferência manual de loja/natureza.` : '';

  // Quanto falta investir / plano / orçamento
  if (/falta investir|ampliar a cobertura|completar a cobertura|plano de invest|novos investimentos|orcamento|quanto (vou|vamos|irei|iremos) gastar|futur/.test(q)) {
    const p = await pnl(lj ? {p_loja: lj} : {}); const pl = p.plano;
    return {...base, status_dados: 'OK', fonte: 'Plano de investimentos (cftv_plano) valorizado pela proposta KGMlan nº 1011040400 de 26/10/2026 e pelas premissas do módulo.',
      criterio: 'Câmeras = levantamento de necessidades por loja; gravador novo quando a necessidade passa dos canais livres; cabeamento = metros por câmera (premissa a validar) × preço do orçamento; mão de obra = R$/ponto das NFS-e de 2026.',
      kpi_principal: {rotulo: 'Investimento previsto para completar a cobertura', valor: Number(pl.total), unidade: 'R$'},
      resposta: `Para completar a cobertura${lj ? ' da ' + nLoja(lj) : ' da rede'} faltam ${num(pl.cameras)} câmeras em ${num(pl.lojas)} loja(s): ${brl(pl.total)} pelo orçamento vigente. ` +
        `Equipamento ${brl(pl.equipamento_orcamento)} (câmeras ${brl(pl.cameras_valor)}, ${num(pl.gravadores)} gravador(es) com HD e power balun ${brl(pl.gravadores_valor)}, conectores ${brl(pl.conectores_valor)}), ` +
        `cabeamento ${brl(pl.cabeamento)} e mão de obra ${brl(pl.mao_obra)}.` + (pl.lojas_sem_canais_informados ? ` ${pl.lojas_sem_canais_informados} loja(s) sem canais livres informados foram calculadas com gravador novo.` : ''),
      dados: pl};
  }
  // Economia com redução de avarias / evitáveis
  if (/economiz|evitav|avaria|mau uso|reduzindo|prevenc/.test(q)) {
    const p = await pnl(); const f = p.financeiro;
    const semClass = (p.manutencao_classificacao || []).find((x: any) => x.classificacao === 'causa_nao_identificada');
    return {...base, status_dados: 'OK', fonte: 'Manutenções do módulo (cftv_manutencoes).', criterio: 'Evitável = classificadas como dano acidental ou possível mau uso (este só com evidência suficiente). Nenhuma culpa é atribuída automaticamente.',
      kpi_principal: {rotulo: 'Custos potencialmente evitáveis', valor: Number(f.evitavel), unidade: 'R$'},
      resposta: `Em ${per.rotulo}, as manutenções somam ${brl(f.manutencao_total)}; ${brl(f.evitavel)} estão classificadas como potencialmente evitáveis (${f.evitavel_pct === null ? '—' : num(f.evitavel_pct, 1) + '%'}). ` +
        (semClass ? `${brl(semClass.valor)} (${semClass.qtd} ocorrência(s)) ainda estão sem causa identificada — a economia possível só pode ser medida depois que a Segurança classificar essas ocorrências com evidência. ` : '') +
        `Reincidências (mesmo equipamento na mesma loja, 2+ vezes) custaram ${brl(f.reincidencia)}: é o primeiro alvo de prevenção.`, dados: {financeiro: f, classificacao: p.manutencao_classificacao}};
  }
  // Manutenção recorrente
  if (/recorrent|reincid|repetid/.test(q)) {
    const oc = await tabela(tok, 'cftv_ocorrencias?select=titulo,detalhe,loja_codigo,valor,situacao&regra=eq.manutencao_recorrente&ativo=eq.true');
    const man = await tabela(tok, `cftv_manutencoes?select=loja_codigo,categoria,valor_total&status=neq.descartado&data=gte.${per.de}&data=lte.${per.ate}`);
    const g: Record<string, {loja: number | null; cat: string; n: number; v: number}> = {};
    for (const m of man) { const k = `${m.loja_codigo}|${m.categoria || 'nao_informada'}`; g[k] = g[k] || {loja: m.loja_codigo, cat: m.categoria || 'nao_informada', n: 0, v: 0}; g[k].n++; g[k].v += Number(m.valor_total); }
    const rec = Object.values(g).filter(x => x.n >= 2).sort((a, b) => b.n - a.n || b.v - a.v);
    return {...base, status_dados: rec.length ? 'OK' : 'SEM_CASOS', fonte: 'cftv_manutencoes e regra de auditoria "manutenção recorrente" (3+ ocorrências semelhantes = alerta).', criterio: 'Recorrente = 2 ou mais ocorrências do mesmo tipo de equipamento na mesma loja no período; alerta para a Segurança a partir de 3.',
      kpi_principal: {rotulo: 'Lojas/equipamentos com manutenção recorrente', valor: rec.length, unidade: 'casos'},
      resposta: rec.length ? `Manutenção recorrente em ${per.rotulo}: ` + rec.slice(0, 10).map(x => `${nLoja(x.loja)} — ${x.n}× ${CAT[x.cat] || x.cat} (${brl(x.v)})`).join('; ') + '.' +
        (oc.length ? ` Alertas ativos para a Segurança (3+ ocorrências): ${oc.map((o: any) => nLoja(o.loja_codigo)).join(', ')}.` : ' Nenhuma loja chegou a 3 ocorrências semelhantes (limite do alerta).') : `Não há manutenção recorrente registrada em ${per.rotulo}.`,
      dados: {recorrentes: rec, alertas: oc}};
  }
  // Lojas sem câmera no estoque
  if (/estoque/.test(q) && /(sem|nao possu|faltam|ainda nao|quais)/.test(q)) {
    const cob = await tabela(tok, 'cftv_cobertura?select=loja_codigo,situacao,necessidade_cameras&area=eq.estoque');
    const ativas = new Set((await rpc(tok, 'cftv_lojas_ativas', {})).filter((x: any) => x.ativo).map((x: any) => x.codigo));
    const sem = cob.filter((c: any) => ativas.has(c.loja_codigo) && c.situacao === 'sem_cobertura'), parc = cob.filter((c: any) => ativas.has(c.loja_codigo) && c.situacao === 'parcial');
    const semDado = [...ativas].filter(c => !cob.some((x: any) => x.loja_codigo === c));
    return {...base, status_dados: 'OK', fonte: 'cftv_cobertura (levantamento de necessidades por loja + avaliações da Segurança) e cadastro oficial de lojas.',
      criterio: '"Sem cobertura" = levantamento informa nenhuma câmera nas ruas do estoque; "parcial" = há ruas do estoque sem câmera. Ter câmera instalada não basta para considerar a área protegida.',
      kpi_principal: {rotulo: 'Lojas sem câmera no estoque', valor: sem.length, unidade: 'lojas'},
      resposta: `Sem nenhuma câmera no estoque: ${sem.length ? sem.map((c: any) => `${nLoja(c.loja_codigo)} (faltam ${c.necessidade_cameras})`).join(', ') : 'nenhuma loja'}. ` +
        `Com cobertura parcial do estoque: ${parc.length} loja(s)${parc.length ? ' — ' + parc.map((c: any) => nLoja(c.loja_codigo)).join(', ') : ''}.` + (semDado.length ? ` Sem avaliação: ${semDado.map(nLoja).join(', ')}.` : ''),
      dados: {sem_cobertura: sem, parcial: parc, sem_avaliacao: semDado}};
  }
  // Quantas câmeras (na loja X / na rede)
  if (/quantas|quantidade|numero de/.test(q) && /camera|dvr|gravador|sensor|alarme/.test(q)) {
    const c = cat || 'camera';
    const eq = await tabela(tok, `cftv_equipamentos?select=quantidade,estimado,situacao,origem${lj ? '&loja_codigo=eq.' + lj : ''}&categoria=eq.${c}`);
    const inst = eq.filter((e: any) => ['instalado', 'defeito', 'fora_operacao'].includes(e.situacao)), est = inst.filter((e: any) => e.estimado);
    const tot = inst.reduce((s: number, e: any) => s + e.quantidade, 0), totEst = est.reduce((s: number, e: any) => s + e.quantidade, 0);
    const def = inst.filter((e: any) => e.situacao !== 'instalado').reduce((s: number, e: any) => s + e.quantidade, 0);
    const p = await pnl({...(lj ? {p_loja: lj} : {}), p_categoria: c});
    const comprados = (p.por_categoria || []).find((x: any) => x.categoria === c);
    const loj = lj ? (await tabela(tok, `cftv_lojas?select=nome,capacidade_canais,canais_analog_livres,canais_ip_livres,necessidade_cameras,necessidade_texto&codigo=eq.${lj}`))[0] : null;
    return {...base, status_dados: tot || comprados ? 'OK' : 'SEM_DADOS', fonte: 'Inventário do módulo (cftv_equipamentos) e notas de 2026.',
      criterio: 'Instaladas = situação instalado, com defeito ou fora de operação. Câmeras anteriores a 2026 vêm da planilha por loja (canais ocupados do gravador) e são estimativa. Compradas ≠ instaladas.',
      kpi_principal: {rotulo: `${CAT[c]} instaladas${lj ? ' · ' + nLoja(lj) : ''}`, valor: tot, unidade: 'un.'},
      resposta: `${lj ? `Na ${nLoja(lj)}${loj ? ' (' + loj.nome + ')' : ''}` : 'Na rede'} há ${num(tot)} ${CAT[c]} registradas como instaladas` + (totEst ? `, das quais ${num(totEst)} são estimativa pelos canais ocupados do gravador (confirmar na loja)` : '') +
        (def ? `; ${num(def)} com defeito ou fora de operação` : '') + `. Em ${per.rotulo} foram compradas ${num(comprados?.quantidade || 0)} (${brl(comprados?.valor || 0)}), ainda sem instalação registrada no inventário.` +
        (loj && loj.capacidade_canais ? ` Gravador de ${loj.capacidade_canais} canais (${num(loj.canais_analog_livres)} analógicos e ${num(loj.canais_ip_livres)} IP livres).` : '') +
        (loj && loj.necessidade_cameras ? ` O levantamento pede mais ${loj.necessidade_cameras} câmeras (${loj.necessidade_texto}).` : ''),
      dados: {instaladas: tot, estimadas: totEst, defeito: def, compradas: comprados || null, loja: loj}};
  }
  // Manutenção (de sensores / por categoria / por loja)
  if (/manutencao|conserto|reparo|visita tecnica/.test(q)) {
    const p = await pnl({...(lj ? {p_loja: lj} : {}), ...(cat ? {p_categoria: cat} : {})}); const f = p.financeiro;
    return {...base, status_dados: 'OK', fonte: 'Manutenções do módulo (cftv_manutencoes), geradas das notas classificadas como manutenção e de registros manuais.',
      criterio: 'Manutenção = notas de serviço de visita técnica/reparo e notas só com material de reparo (conferidas na Conferência), mais ocorrências registradas sem nota. A categoria é a do equipamento envolvido.',
      kpi_principal: {rotulo: `Manutenção${cat ? ' de ' + CAT[cat] : ''}${lj ? ' · ' + nLoja(lj) : ''}`, valor: Number(f.manutencao_total), unidade: 'R$'},
      resposta: `Em ${per.rotulo}, a manutenção${cat ? ' de ' + CAT[cat] : ''}${lj ? ' na ' + nLoja(lj) : ''} custou ${brl(f.manutencao_total)}. ` +
        (cat ? '' : `Por equipamento: ${(p.manutencao_categoria || []).map((x: any) => `${CAT[x.categoria] || x.categoria} ${brl(x.valor)} (${x.qtd})`).join('; ')}. `) +
        `Maiores custos por loja: ${(p.ranking_manutencao || []).slice(0, 5).map((x: any) => `${nLoja(x.loja_codigo)} ${brl(x.valor)}`).join('; ') || '—'}.` +
        (cat === 'alarme_sensor' && Number(f.manutencao_total) === 0 ? ' Nenhuma manutenção registrada com o equipamento "alarme/sensor" — ocorrências sem equipamento informado não entram neste número.' : '') + pend(p),
      dados: {financeiro: f, por_categoria: p.manutencao_categoria, ranking: p.ranking_manutencao}};
  }
  // Loja que mais recebeu investimento
  if (/(qual|quais).*(loja|lojas).*(mais|maior)|ranking.*invest|recebeu mais/.test(q)) {
    const p = await pnl(); const l = (p.por_loja || []).filter((x: any) => x.loja_codigo !== null && x.loja_codigo > 0);
    const semLoja = (p.por_loja || []).find((x: any) => x.loja_codigo === null), cd = (p.por_loja || []).find((x: any) => x.loja_codigo === 0);
    return {...base, status_dados: l.length ? 'OK' : 'SEM_DADOS', fonte: FONTE, criterio: 'Investimento = notas de aquisição de equipamentos + serviços de instalação, pela loja de destino da nota.',
      kpi_principal: l[0] ? {rotulo: `Maior investimento: ${nLoja(l[0].loja_codigo)} (${l[0].nome})`, valor: Number(l[0].investimento), unidade: 'R$'} : null,
      resposta: l.length ? `A loja que mais recebeu investimento em ${per.rotulo} foi a ${nLoja(l[0].loja_codigo)} (${l[0].nome}): ${brl(l[0].investimento)} em ${l[0].notas} nota(s). Em seguida: ` +
        l.slice(1, 5).map((x: any) => `${nLoja(x.loja_codigo)} ${brl(x.investimento)}`).join('; ') + '.' +
        (semLoja ? ` ${brl(semLoja.investimento)} ainda estão em notas sem loja definida (faturadas na matriz, aguardando conferência) e podem mudar o ranking.` : '') + (cd ? ` ${brl(cd.investimento)} foram entregues no CD.` : '') + pend(p) : 'Sem investimentos por loja no período.',
      dados: {ranking: p.por_loja}};
  }
  // Custo médio
  if (/custo medio|media/.test(q)) {
    const p = await pnl(); const m = p.medias;
    return {...base, status_dados: 'OK', fonte: FONTE, criterio: 'Custo médio por loja = investimento (equipamentos + instalação) das lojas ÷ lojas que receberam investimento (sem CD e sem notas sem loja). Custo médio por câmera = valor dos itens de câmera ÷ quantidade comprada.',
      kpi_principal: {rotulo: 'Custo médio por loja', valor: Number(m.custo_medio_loja), unidade: 'R$'},
      resposta: `Em ${per.rotulo}, o custo médio de equipamentos e instalação por loja foi ${brl(m.custo_medio_loja)} (${m.lojas_com_investimento} lojas receberam investimento). O custo médio por câmera comprada foi ${brl(m.custo_medio_camera)}.` + pend(p),
      dados: m};
  }
  // Investimento total (padrão)
  if (/invest|gast|compr|quanto|valor|total|seguranca|cftv/.test(q)) {
    const p = await pnl({...(lj ? {p_loja: lj} : {}), ...(cat ? {p_categoria: cat} : {})}); const f = p.financeiro;
    return {...base, status_dados: 'OK', fonte: FONTE, criterio: 'Investimento = aquisição de equipamentos + serviços de instalação. Manutenção e monitoramento são informados à parte. Notas duplicadas ou descartadas não somam.',
      kpi_principal: {rotulo: `Investimento em segurança${lj ? ' · ' + nLoja(lj) : ''}${cat ? ' · ' + CAT[cat] : ''} ${per.rotulo}`, valor: Number(f.investimento_total), unidade: 'R$'},
      resposta: `Em ${per.rotulo}, o investimento em segurança${lj ? ' na ' + nLoja(lj) : ''}${cat ? ' com ' + CAT[cat] : ''} foi ${brl(f.investimento_total)}: ${brl(f.aquisicao_equipamentos)} em equipamentos e ${brl(f.servicos_instalacao)} em serviços de instalação. ` +
        `À parte: manutenção ${brl(f.manutencao_total)} e monitoramento ${brl(f.monitoramento)}. Comprados e ainda sem instalação registrada: ${brl(f.pendente_instalacao_valor)}.` + pend(p),
      dados: {financeiro: f, mensal: p.mensal, por_categoria: p.por_categoria}};
  }
  return {...base, status_dados: 'NAO_ENTENDIDO', resposta: 'Não identifiquei a pergunta de segurança/CFTV. Exemplos: "Quanto investimos em segurança em 2026?", "Quantas câmeras existem na loja 50?", "Quais lojas ainda não possuem câmera no estoque?", "Quanto falta investir para ampliar a cobertura?".'};
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, {headers: CORS});
  try {
    const p = req.method === 'POST' ? await req.json().catch(() => ({})) : Object.fromEntries(new URL(req.url).searchParams.entries());
    const pergunta = String(p.pergunta_original || p.pergunta || '').trim();
    if (!pergunta) return out({error: 'Informe a pergunta.'}, 400);
    const tok = await autorizar(req, p);
    if (!tok) return out({agente: 'Cérebro Executivo · Segurança Patrimonial e CFTV', modulo: 'cftv', status_dados: 'ACESSO_RESTRITO',
      resposta: 'Segurança Patrimonial e CFTV: acesso restrito a Presidência, Diretoria, Segurança e usuários autorizados do Portal.'});
    return out(await responder(tok, pergunta));
  } catch (e) {
    return out({agente: 'Cérebro Executivo · Segurança Patrimonial e CFTV', status_dados: 'ERRO', error: String(e)}, 500);
  }
});
