// Minerador Meta Ads - API do app (PWA) e do minerador no PC.
// Autenticacao: header "x-minerador-chave" (ou ?chave=), comparada com o hash em minerador.config.
//   GET  ?acao=painel                      -> status ao vivo + ultimas rodadas (para o app)
//   GET  ?acao=status                      -> so o andamento ao vivo (leve, para atualizar a cada poucos segundos)
//   POST {acao:"status", dados}            -> atualiza o andamento ao vivo (PC)
//   POST {acao:"rodada", versao, tipo, resumo, linhas, anunciantes} -> salva resultado (PC)
//   POST {acao:"foto", nome, base64}       -> salva foto do produto no bucket publico (PC)
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-minerador-chave",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const chave = req.headers.get("x-minerador-chave") ?? url.searchParams.get("chave") ?? "";
  const { data: ok, error: e0 } = await sb.rpc("minerador_chave_ok", { p_chave: chave });
  if (e0) return json({ erro: "falha ao validar" }, 500);
  if (!ok) return json({ erro: "chave invalida" }, 401);

  if (req.method === "GET") {
    const leve = url.searchParams.get("acao") === "status";
    const { data, error } = await sb.rpc(leve ? "minerador_status" : "minerador_painel");
    return error ? json({ erro: error.message }, 500) : json(data);
  }
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ erro: "json invalido" }, 400); }

  if (b.acao === "status") {
    const { error } = await sb.rpc("minerador_salvar_status", { p_dados: b.dados ?? {} });
    return error ? json({ erro: error.message }, 500) : json({ ok: true });
  }
  if (b.acao === "rodada") {
    const { data, error } = await sb.rpc("minerador_salvar_rodada", {
      p_versao: String(b.versao ?? Date.now()), p_tipo: String(b.tipo ?? ""),
      p_resumo: b.resumo ?? {}, p_linhas: b.linhas ?? [], p_anunciantes: b.anunciantes ?? [],
    });
    return error ? json({ erro: error.message }, 500) : json({ ok: true, id: data });
  }
  if (b.acao === "foto") {
    const nome = String(b.nome ?? "").replace(/[^0-9a-zA-Z_.-]/g, "");
    if (!nome || typeof b.base64 !== "string") return json({ erro: "foto invalida" }, 400);
    const bytes = Uint8Array.from(atob(b.base64), (c) => c.charCodeAt(0));
    if (bytes.length > 3_000_000) return json({ erro: "foto grande demais" }, 413);
    const { error } = await sb.storage.from("minerador-fotos")
      .upload(nome, bytes, { contentType: "image/jpeg", upsert: true });
    if (error) return json({ erro: error.message }, 500);
    const { data } = sb.storage.from("minerador-fotos").getPublicUrl(nome);
    return json({ ok: true, url: data.publicUrl });
  }
  return json({ erro: "acao desconhecida" }, 400);
});
