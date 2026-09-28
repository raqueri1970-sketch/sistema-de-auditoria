// Controle remoto do Robo Ajuste Expresso (app do celular) - edge function "robo" (verify_jwt = false).
// So entrega a pagina e o icone: toda acao exige login de administrador (orc_is_admin) nas funcoes do banco.
// A pagina (robo.html) e o icone (icon.svg) ficam em private.app_paginas (lidos por public.app_pagina):
// o Supabase nao publica arquivos .html junto com a funcao. Para atualizar o app: grave o novo robo.html na tabela.
const BASE = "https://rdztzurfesnobfkazgpm.supabase.co/functions/v1/robo";
const URL_DB = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const cache: Record<string, { t: number; v: string }> = {};
async function pagina(nome: string): Promise<string> {
  const c = cache[nome];
  if (c && Date.now() - c.t < 60_000) return c.v;
  const r = await fetch(URL_DB + "/rest/v1/rpc/app_pagina", {
    method: "POST", headers: { apikey: ANON, authorization: "Bearer " + ANON, "content-type": "application/json" },
    body: JSON.stringify({ p_nome: nome }),
  });
  if (!r.ok) throw new Error("app_pagina " + r.status);
  const v = ((await r.json()) as string) || "";
  cache[nome] = { t: Date.now(), v };
  return v;
}
const MANIFEST = JSON.stringify({
  name: "Robô Ajuste Expresso", short_name: "Robô Ajuste", start_url: BASE, scope: BASE, display: "standalone",
  background_color: "#0b1020", theme_color: "#0b1020",
  icons: [{ src: BASE + "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
});
Deno.serve(async (req) => {
  const p = new URL(req.url).pathname;
  try {
    if (p.endsWith("/icon.svg")) return new Response(await pagina("icon.svg"), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
    if (p.endsWith("/manifest.webmanifest")) return new Response(MANIFEST, { headers: { "content-type": "application/manifest+json" } });
    const html = (await pagina("robo.html")).replaceAll("__BASE__", BASE);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "x-frame-options": "DENY", "referrer-policy": "no-referrer" } });
  } catch (e) {
    return new Response("App temporariamente indisponivel. Tente de novo em instantes.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
});
