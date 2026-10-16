// Proxy do Contas a Pagar do Sallamo para a Auditoria Financeira do Portal.
// - A API do Sallamo não libera CORS e exige Bearer token: o navegador não pode chamá-la direto e o token
//   não pode ficar no HTML (o Portal é público no GitHub Pages). O token fica aqui, no segredo SALLAMO_TOKEN.
// - Só responde para usuário logado no Portal com perfil administrador, controladoria ou diretoria (fin_pode_auditar).
// GET ?dataInicio=YYYY-MM-DD&dataFim=YYYY-MM-DD  (período de VENCIMENTO, como a API do Sallamo)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SALLAMO = "https://sallamos-backend.vercel.app/api/bi/contas-a-pagar/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const DATA = /^\d{4}-\d{2}-\d{2}$/;

async function podeAuditar(auth: string) {
  const r = await fetch(Deno.env.get("SUPABASE_URL") + "/rest/v1/rpc/fin_pode_auditar", {
    method: "POST",
    headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")!, Authorization: auth, "Content-Type": "application/json" },
    body: "{}",
  });
  return r.ok && (await r.json()) === true;
}

// Token guardado no Supabase Vault (criptografado). Só o service_role executa fin_sallamo_token().
let tokenCache: string | null = null;
async function tokenDoVault() {
  if (tokenCache) return tokenCache;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r = await fetch(Deno.env.get("SUPABASE_URL") + "/rest/v1/rpc/fin_sallamo_token", {
    method: "POST",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return null;
  tokenCache = (await r.json()) || null;
  return tokenCache;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ erro: "Método não permitido." }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || !(await podeAuditar(auth))) return json({ erro: "Acesso não autorizado à Auditoria Financeira." }, 403);

  const token = Deno.env.get("SALLAMO_TOKEN") || (await tokenDoVault());
  const empresa = Deno.env.get("SALLAMO_EMPRESA") || "6835c03f0ffe7df22945d191";
  if (!token) return json({ erro: "Token do Sallamo não configurado (segredo SALLAMO_TOKEN ou Vault 'sallamo_token')." }, 500);

  const u = new URL(req.url);
  const de = u.searchParams.get("dataInicio") || "", ate = u.searchParams.get("dataFim") || "";
  if (!DATA.test(de) || !DATA.test(ate) || de > ate) return json({ erro: "Período inválido (use dataInicio e dataFim no formato AAAA-MM-DD)." }, 400);
  if ((Date.parse(ate) - Date.parse(de)) / 86400000 > 1100) return json({ erro: "Período máximo de 3 anos." }, 400);

  const r = await fetch(`${SALLAMO}${encodeURIComponent(empresa)}?dataInicio=${de}&dataFim=${ate}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!r.ok) return json({ erro: `Sallamo respondeu ${r.status}.`, detalhe: (await r.text()).slice(0, 300) }, 502);
  return new Response(r.body, { headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
});
