// Roteador antigo do Cérebro Financeiro. 22/10/2026: respondia dados da auditoria a qualquer pessoa, sem chave.
// Agora repassa a credencial de quem chamou: o portal-financeiro-query só responde a usuário com fin_pode_auditar()
// ou ao próprio servidor. Perguntas não financeiras seguem para o portal-cerebro-integrado como antes.
const U = Deno.env.get('SUPABASE_URL')!;
const K = Deno.env.get('SUPABASE_ANON_KEY')!;
const C = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Content-Type': 'application/json'};
const S = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CFTV = /\b(cftv|cameras?|dvrs?|nvrs?|gravador(es)?|alarmes?|sensor(es)?|concertina|seguranca patrimonial|seguranca eletronica|cobertura d[eo]s? (estoque|cameras?)|avarias?|investimentos? em seguranca|investimos em seguranca|manutenc(ao|oes) recorrentes?|ampliar a cobertura|cobertura da rede|custo medio de equipamentos|equipamentos de seguranca|recebeu mais investimentos?)\b/;
const FIN = /despesa|gast(o|os|ei|amos|ou)|contas? a pagar|fornecedor|financeir|duplicidade|pagamento duplic|pagamento incorret|juros|multa|acrescimo|desconto.*fornecedor|credito.*fornecedor|devolucao.*fornecedor|prejuizo|perdendo dinheiro/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, {headers: C});
  try {
    const p = req.method === 'POST' ? await req.json().catch(() => ({})) : Object.fromEntries(new URL(req.url).searchParams.entries());
    const auth = req.headers.get('Authorization') || '';
    // 12/11/2026: Segurança Patrimonial e CFTV vai para o especialista, com a credencial de quem chamou
    if (CFTV.test(S(p.pergunta || p.pergunta_original || ''))) {
      const r = await fetch(`${U}/functions/v1/portal-cftv-query`, {method: 'POST', headers: {apikey: K, Authorization: auth, 'Content-Type': 'application/json'}, body: JSON.stringify(p)});
      const d = JSON.parse(await r.text() || '{}');
      return new Response(JSON.stringify({...d, roteamento_financeiro: {integrado: true, rota: 'SEGURANCA_CFTV', especialista: 'portal-cftv-query'}}), {status: r.status, headers: C});
    }
    const financeiro = FIN.test(S(p.pergunta || p.pergunta_original || ''));
    const r = await fetch(`${U}/functions/v1/${financeiro ? 'portal-financeiro-query' : 'portal-cerebro-integrado'}`, {method: 'POST',
      headers: {apikey: K, Authorization: financeiro ? auth : `Bearer ${K}`, 'Content-Type': 'application/json'}, body: JSON.stringify(p)});
    const t = await r.text();
    let d: any; try { d = JSON.parse(t); } catch { d = {raw: t}; }
    return new Response(JSON.stringify({...d, roteamento_financeiro: {integrado: true, rota: financeiro ? 'AUDITORIA_FINANCEIRA' : 'CEREBRO_GERAL',
      especialista: financeiro ? 'portal-financeiro-query' : 'portal-cerebro-integrado'}}), {status: r.status, headers: C});
  } catch (e) {
    return new Response(JSON.stringify({error: String(e), agente: 'Cérebro Executivo Esposende'}), {status: 500, headers: C});
  }
});
