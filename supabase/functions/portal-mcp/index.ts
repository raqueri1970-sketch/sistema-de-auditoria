// MCP do Portal Esposende (conector do Claude). 22/10/2026: o OAuth antigo entregava token para qualquer um e o
// tools/call nem olhava o token — qualquer pessoa com o endereço consultava o Portal inteiro, inclusive o financeiro.
// Agora: login do Portal (página mcp-login/ no Vercel) → código assinado com PKCE → access/refresh tokens assinados.
// Sem token válido o MCP responde 401. Perguntas financeiras só para administrador/controladoria/diretoria.
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Expose-Headers": "WWW-Authenticate"};
const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const BASE = `${PROJECT_URL}/functions/v1/portal-mcp`;
const API = `${PROJECT_URL}/functions/v1/portal-api`;
const SAFE = `${PROJECT_URL}/functions/v1/portal-conversa`;
const KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOGIN = "https://sistema-de-auditoria-omega.vercel.app/mcp-login/";
const CLIENT = "portal-esposende-client";
const TEMPO = {codigo: 5 * 60, acesso: 7 * 24 * 3600, renovacao: 90 * 24 * 3600};
// Só devolve código para o Claude (web/app) ou para o próprio computador (Claude Code). Evita entregar acesso a outro site.
const DESTINO_OK = (u: string) => { try { const h = new URL(u).hostname; return /(^|\.)claude\.(ai|com)$/.test(h) || /(^|\.)anthropic\.com$/.test(h) || h === "localhost" || h === "127.0.0.1"; } catch { return false; } };

const RULES = "FLUXO OBRIGATORIO: PERGUNTA -> CONTEXTO DA CONVERSA -> INTENCAO -> CAMPOS/FILTROS -> AGENTE ESPECIALISTA -> FONTE OFICIAL -> AUDITOR -> CEREBRO SEGURO -> RESPOSTA. Mantenha o mesmo session_id em perguntas seguidas. Nunca invente, estime ou complete valor ausente. Ausencia de dados nunca e zero. A saida textual desta ferramenta e a RESPOSTA OFICIAL e deve ser reproduzida sem recalculo.";
const P: any = {pergunta: {type: "string"}, modulo: {type: "string", enum: ["nf", "rem", "alm", "inv", "cml", "saci", "sgdf", "resc", "rh", "rl", "cmp", "orc", "desc", "cmpaud", "mei", "gren"]}, loja: {type: "string"}, mes: {type: "string"}, ano: {type: "string"}, funcionario: {type: "string"}, nome: {type: "string"}, vendedor: {type: "string"}, matricula: {type: "string"}, competencia: {type: "string"}, evento: {type: "string"}, rubrica: {type: "string"}, marca: {type: "string"}, codigo: {type: "string"}, fornecedor: {type: "string"}, departamento: {type: "string"}, grupo: {type: "string"}, subgrupo: {type: "string"}, metrica: {type: "string"}, placa: {type: "string"}, regional: {type: "string"}, status: {type: "string"}, pedido: {type: "string"}, cliente: {type: "string"}, autorizador: {type: "string"}, cargo: {type: "string"}, descricao: {type: "string"}, acumulado: {type: "boolean"}, pagina: {type: "integer", minimum: 1, default: 1}, limite: {type: "integer", minimum: 1, maximum: 500, default: 100}, session_id: {type: "string", description: "Identificador da conversa. Envie o mesmo valor em perguntas seguidas para manter loja, produto, assunto e periodo."}};
const TOOLS = [{name: "consultar_portal_esposende", description: "Consulta segura e conversacional o Portal Esposende. Entende continuacoes como 'e a fita?' e 'e na loja 50?'. " + RULES, inputSchema: {type: "object", required: ["pergunta"], properties: P}}, {name: "consultar_resumo_portal", description: "Consulta rapida do resumo sincronizado de um modulo. " + RULES, inputSchema: {type: "object", properties: {modulo: P.modulo}}}];

function jr(id: any, result: any) { return {jsonrpc: "2.0", id, result}; }
function je(id: any, code: number, message: string) { return {jsonrpc: "2.0", id, error: {code, message}}; }
function res(o: any, status = 200, h: any = {}) { return new Response(JSON.stringify(o), {status, headers: {...CORS, "Content-Type": "application/json", ...h}}); }
function b64(bytes: Uint8Array) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function deB64(s: string) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const x = atob(s), a = new Uint8Array(x.length); for (let i = 0; i < x.length; i++) a[i] = x.charCodeAt(i); return a; }
async function hash(v: string) { return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))); }

// ---------- tokens assinados (HMAC-SHA256, chave derivada da chave de serviço; nada fica guardado) ----------
let chave: CryptoKey | null = null;
async function hmac() {
  if (!chave) {
    const bruta = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("portal-mcp-v2:" + SERVICO));
    chave = await crypto.subtle.importKey("raw", bruta, {name: "HMAC", hash: "SHA-256"}, false, ["sign", "verify"]);
  }
  return chave;
}
async function assinar(o: Record<string, unknown>) {
  const corpo = b64(new TextEncoder().encode(JSON.stringify(o)));
  return corpo + "." + b64(new Uint8Array(await crypto.subtle.sign("HMAC", await hmac(), new TextEncoder().encode(corpo))));
}
async function abrir(t: string, typ: string): Promise<any | null> {
  const [corpo, sig] = String(t || "").split(".");
  if (!corpo || !sig) return null;
  try {
    if (!await crypto.subtle.verify("HMAC", await hmac(), deB64(sig), new TextEncoder().encode(corpo))) return null;
    const o = JSON.parse(new TextDecoder().decode(deB64(corpo)));
    return o.typ === typ && o.exp > Date.now() / 1000 ? o : null;
  } catch { return null; }
}

// ---------- quem é o usuário ----------
async function perfilFinanceiro(userId: string) {
  const r = await fetch(`${PROJECT_URL}/rest/v1/orc_perfis?user_id=eq.${userId}&ativo=is.true&perfil=in.(administrador,controladoria,diretoria)&select=perfil`,
    {headers: {apikey: SERVICO, Authorization: `Bearer ${SERVICO}`}});
  return r.ok && (await r.json()).length > 0;
}
async function usuarioAtivo(userId: string) {
  const r = await fetch(`${PROJECT_URL}/auth/v1/admin/users/${userId}`, {headers: {apikey: SERVICO, Authorization: `Bearer ${SERVICO}`}});
  if (!r.ok) return null;
  const u = await r.json();
  return u?.banned_until && new Date(u.banned_until) > new Date() ? null : u;
}
async function emitirTokens(sub: string, email: string, fin: boolean) {
  const agora = Math.floor(Date.now() / 1000);
  return {access_token: await assinar({typ: "acesso", sub, email, fin, exp: agora + TEMPO.acesso}),
    refresh_token: await assinar({typ: "renovacao", sub, email, exp: agora + TEMPO.renovacao}),
    token_type: "Bearer", expires_in: TEMPO.acesso};
}

function metadata() {
  return res({issuer: BASE, authorization_endpoint: BASE + "/authorize", token_endpoint: BASE + "/token", registration_endpoint: BASE + "/register",
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"]});
}

async function oauth(req: Request, url: URL) {
  const p = url.pathname;
  if (p.includes("oauth-protected-resource")) return res({resource: BASE, authorization_servers: [BASE]});
  if (p.includes("oauth-authorization-server") || p.includes(".well-known")) return metadata();
  if (p.endsWith("/register")) {
    let b: any = {}; try { b = await req.json(); } catch { /* corpo vazio */ }
    return res({client_id: CLIENT, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      redirect_uris: b.redirect_uris || []}, 201);
  }
  if (p.endsWith("/authorize") && req.method === "GET") {
    const ru = url.searchParams.get("redirect_uri") || "";
    if (!DESTINO_OK(ru)) return new Response("redirect_uri não permitido", {status: 400, headers: CORS});
    if (url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("code_challenge"))
      return new Response("PKCE (S256) obrigatório", {status: 400, headers: CORS});
    return new Response(null, {status: 302, headers: {...CORS, Location: LOGIN + "?" + url.searchParams.toString()}});
  }
  if (p.endsWith("/authorize") && req.method === "POST") {
    // vem da página mcp-login/ com o token da sessão do Portal recém-aberta
    const b: any = await req.json().catch(() => ({}));
    if (!DESTINO_OK(b.redirect_uri)) return res({error: "Endereço de retorno não permitido."}, 400);
    if (b.code_challenge_method !== "S256" || !b.code_challenge) return res({error: "PKCE obrigatório."}, 400);
    const u = await fetch(`${PROJECT_URL}/auth/v1/user`, {headers: {apikey: KEY, Authorization: `Bearer ${b.access_token}`}});
    if (!u.ok) return res({error: "Sessão do Portal inválida. Entre de novo."}, 401);
    const user = await u.json();
    const fin = await perfilFinanceiro(user.id);
    const code = await assinar({typ: "codigo", sub: user.id, email: user.email, fin, cc: b.code_challenge, ru: b.redirect_uri,
      exp: Math.floor(Date.now() / 1000) + TEMPO.codigo});
    const d = new URL(b.redirect_uri); d.searchParams.set("code", code); if (b.state) d.searchParams.set("state", b.state);
    return res({redirect: d.toString()});
  }
  if (p.endsWith("/token")) {
    const ct = req.headers.get("content-type") || "", x: any = ct.includes("json") ? await req.json() : Object.fromEntries(new URLSearchParams(await req.text()));
    if (x.grant_type === "refresh_token") {
      const r = await abrir(x.refresh_token, "renovacao");
      if (!r) return res({error: "invalid_grant", error_description: "refresh_token inválido ou vencido"}, 400);
      const user = await usuarioAtivo(r.sub);   // usuário excluído/bloqueado no Portal perde o acesso na renovação
      if (!user) return res({error: "invalid_grant", error_description: "usuário sem acesso ao Portal"}, 400);
      return res(await emitirTokens(r.sub, user.email, await perfilFinanceiro(r.sub)));
    }
    const c = await abrir(x.code, "codigo");
    if (!c) return res({error: "invalid_grant", error_description: "código inválido ou vencido"}, 400);
    if (x.redirect_uri && x.redirect_uri !== c.ru) return res({error: "invalid_grant", error_description: "redirect_uri não confere"}, 400);
    if (!x.code_verifier || (await hash(x.code_verifier)) !== c.cc) return res({error: "invalid_grant", error_description: "code_verifier não confere"}, 400);
    return res(await emitirTokens(c.sub, c.email, c.fin));
  }
  return null;
}

function official(raw: string) {
  try {
    const d = JSON.parse(raw);
    const c = [d?.resposta_falada, d?.fala, d?.resultados?.executivo?.resposta_falada, d?.resultados?.atual?.resposta_falada, d?.resposta, d?.resultados?.executivo?.resposta, d?.resultados?.atual?.resposta];
    const v = c.find((x: any) => typeof x === "string" && x.trim());
    return v ? String(v).trim() : raw;
  } catch { return raw; }
}

async function callTool(name: string, args: any, quem: any) {
  let url: string; const opts: any = {headers: {apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json"}};
  if (name === "consultar_resumo_portal") { url = API + (args.modulo ? `?modulo=${encodeURIComponent(args.modulo)}` : ""); opts.method = "GET"; }
  else {
    // chave de serviço + permissão financeira do usuário logado (o portal-conversa só responde financeiro com fin_autorizado)
    url = SAFE; opts.method = "POST"; opts.headers = {apikey: SERVICO, Authorization: `Bearer ${SERVICO}`, "Content-Type": "application/json"};
    opts.body = JSON.stringify({session_id: "siri-portal-esposende", ...args, destino: "safe", fin_autorizado: quem.fin === true, usuario: quem.email});
  }
  const r = await fetch(url, opts), t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return name === "consultar_portal_esposende" ? official(t) : t;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, {headers: CORS});
  const url = new URL(req.url), o = await oauth(req, url);
  if (o) return o;
  if (req.method !== "POST") return new Response("MCP Portal Esposende ativo · acesso com login do Portal", {headers: CORS});
  const quem = await abrir((req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), "acesso");
  if (!quem) return res(je(null, -32001, "Login do Portal necessário"), 401,
    {"WWW-Authenticate": `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`});
  let b: any;
  try { b = await req.json(); } catch { return res(je(null, -32700, "Parse error"), 400); }
  if (b.id === undefined) return new Response(null, {status: 202, headers: CORS});
  if (b.method === "initialize") return res(jr(b.id, {protocolVersion: "2025-03-26", capabilities: {tools: {}}, serverInfo: {name: "portal-esposende-mcp", version: "9.0.0-login"}}));
  if (b.method === "tools/list") return res(jr(b.id, {tools: TOOLS}));
  if (b.method === "tools/call") {
    const name = b.params?.name, args = b.params?.arguments || {};
    if (!TOOLS.some(t => t.name === name)) return res(je(b.id, -32602, "Ferramenta desconhecida"), 400);
    try { return res(jr(b.id, {content: [{type: "text", text: await callTool(name, args, quem)}]})); }
    catch (e) { return res(jr(b.id, {content: [{type: "text", text: "Erro ao consultar o portal: " + String(e)}], isError: true})); }
  }
  return res(je(b.id, -32601, "Metodo nao encontrado"), 400);
});
