// Porta de entrada das perguntas do Portal (MCP / Siri). Perguntas financeiras (despesas, fornecedores, contas a pagar,
// duplicidade, juros, perdas…) vão para o Cérebro Executivo Financeiro (portal-financeiro-query); o resto segue para o
// portal-maestro como antes. 22/10/2026: antes "prejuízo com duplicidade" caía em NF-e canceladas e "gastos com energia"
// não era reconhecido.
// 22/10/2026 (2): o financeiro só responde com autorização — chamada do portal-mcp (chave de serviço + fin_autorizado do
// usuário logado) ou token de usuário do Portal com fin_pode_auditar. Chamada direta sem login não recebe dado financeiro.
const U = Deno.env.get('SUPABASE_URL')!;
const A = Deno.env.get('SUPABASE_ANON_KEY')!;
const S = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const C = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json'};
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const FINANCEIRO = /\b(despesas?|gast(o|os|ei|amos|ou|aram|ando)|contas? a pagar|conta contabil|centro de custo|sallamo|financeir\w*|fornecedor(es)?|titulos?|boletos?|duplicidade|em dobro|duas vezes|juros|multas?|encargos?|credito nao aproveitado|desconto nao aproveitado|devolucao nao|pagamento incorreto|pago a mais|pagamos a mais|prejuizo|perdendo dinheiro|perda financeira|dinheiro (esta|vai) indo|para onde (vai|esta indo) o dinheiro|vencid\w*|a pagar|a vencer|alugue(l|is)|energia|agua e esgoto|internet|fretes?|manutencao predial|caixa de revisao)\b/;
const OUTRO_MODULO = /\b(almoxarifado|inventario|comiss\w*|meias|grendene|nf-?e|notas? fisca\w* cancelad\w*|cancelamentos?|remanejo|saci|sgdf|defeitos?|rescis\w*|folha|funcionari\w*|vendedor\w*|rl transportes|placa|motorista|orcamento|cotac\w*|pedidos? de compra|obras?|loja \d+ vend\w*)\b/;

async function podeFinanceiro(req: Request, p: any) {
  const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (tok === S) return p.fin_autorizado === true;
  if (!tok || tok === A) return false;
  const r = await fetch(`${U}/rest/v1/rpc/fin_pode_auditar`, {method: 'POST',
    headers: {apikey: A, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json'}, body: '{}'});
  return r.ok && (await r.json()) === true;
}

async function contexto(sessao: string) {
  const r = await fetch(`${U}/rest/v1/fin_conversa?session_id=eq.${encodeURIComponent(sessao)}&em=gte.${new Date(Date.now() - 30 * 60e3).toISOString()}&select=contexto`,
    {headers: {apikey: S, Authorization: `Bearer ${S}`}});
  const d = r.ok ? await r.json() : [];
  return d[0]?.contexto || null;
}

async function guardar(sessao: string, ctx: unknown, pergunta: string, ativo = true) {
  await fetch(`${U}/rest/v1/fin_conversa?on_conflict=session_id`, {method: 'POST',
    headers: {apikey: S, Authorization: `Bearer ${S}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal'},
    body: JSON.stringify({session_id: sessao, contexto: ctx ?? {}, pergunta, em: ativo ? new Date().toISOString() : '1970-01-01T00:00:00Z'})}).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, {headers: C});
  try {
    const p = await req.json().catch(() => ({}));
    const pergunta = String(p.pergunta_original || p.pergunta || '').trim();
    if (!pergunta) return new Response(JSON.stringify({error: 'Informe a pergunta.'}), {status: 400, headers: C});
    const session_id = String(p.session_id || p.sessao || p.sessionId || 'siri-portal-esposende').trim();
    const body = {...p, session_id, pergunta};
    delete body.destino; delete body.pergunta_original; delete body.fin_autorizado; delete body.usuario;

    const q = norm(pergunta);
    const modulo = String(p.modulo || '');
    let financeira = modulo === 'fin' || (!modulo && FINANCEIRO.test(q) && !OUTRO_MODULO.test(q));
    let ctx = null;
    if (!modulo) {
      ctx = await contexto(session_id);
      // continuação curta da conversa financeira: "e em agosto?", "e da loja 50?", "e o mês passado?"
      if (!financeira && ctx && /^\s*(e|agora|tambem|so|somente|apenas)\b/.test(q) && q.split(/\s+/).length <= 8 && !OUTRO_MODULO.test(q)) financeira = true;
    }

    if (financeira && !(await podeFinanceiro(req, p))) {
      return new Response(JSON.stringify({agente: 'Portal Esposende', modulo: 'fin', status_dados: 'ACESSO_RESTRITO',
        resposta: 'Pergunta financeira: acesso restrito a administrador, controladoria e diretoria. Entre com um usuário autorizado do Portal.'}),
        {status: 200, headers: C});
    }
    if (financeira) {
      const r = await fetch(`${U}/functions/v1/portal-financeiro-query`, {method: 'POST',
        headers: {apikey: S, Authorization: `Bearer ${S}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({...body, contexto: ctx})});
      const t = await r.text();
      if (r.ok) { try { await guardar(session_id, JSON.parse(t).contexto, pergunta); } catch { /* resposta sem contexto */ } }
      return new Response(t, {status: r.status, headers: C});
    }

    if (ctx) await guardar(session_id, {}, pergunta, false); // mudou de assunto: a próxima continuação não é financeira
    const r = await fetch(`${U}/functions/v1/portal-maestro`, {method: 'POST',
      headers: {apikey: A, Authorization: `Bearer ${A}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    return new Response(await r.text(), {status: r.status, headers: C});
  } catch (e) {
    return new Response(JSON.stringify({error: String(e)}), {status: 500, headers: C});
  }
});
