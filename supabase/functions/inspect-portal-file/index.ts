// Leitura/patch do portal de produção (PORTAL_ESPOSENDE_V4_AUTH.html no bucket portal-file).
// Fica DESLIGADA por padrão: só responde se o segredo PORTAL_PATCH_SECRET estiver cadastrado no
// Supabase (Edge Functions → Secrets). Para usar: cadastrar o segredo, fazer o trabalho e apagar o segredo.
// Nada de senha no código — a versão anterior tinha a senha embutida e ficava aberta na internet.
import { createClient } from "npm:@supabase/supabase-js@2";
const PATH = "PORTAL_ESPOSENDE_V4_AUTH.html";

async function gunzipB64(b64: string): Promise<string> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream("gzip");
  const out = new Response(new Blob([bin]).stream().pipeThrough(ds));
  return await out.text();
}

async function gzipB64(txt: string): Promise<string> {
  const cs = new CompressionStream("gzip");
  const buf = new Uint8Array(await new Response(new Blob([new TextEncoder().encode(txt)]).stream().pipeThrough(cs)).arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function sha256(txt: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)));
  return Array.from(h).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function moduloRange(html: string, modulo: string) {
  const key = '"' + modulo + '":"H4sI';
  const i = html.indexOf(key);
  if (i < 0) return null;
  const st = i + key.length - 4;
  const en = html.indexOf('"', st);
  return { st, en };
}

function snippets(src: string, terms: string[], before: number, after: number, max: number) {
  const out: any[] = [];
  for (const t of terms) {
    let i = -1, n = 0;
    while ((i = src.indexOf(t, i + 1)) >= 0 && n < max) {
      out.push({ t, pos: i, s: src.slice(Math.max(0, i - before), i + after) });
      n++;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const SECRET = Deno.env.get("PORTAL_PATCH_SECRET") || "";
  if (SECRET.length < 24) return new Response("desativada", { status: 410 });
  const b = await req.json().catch(() => ({}));
  if (typeof b.secret !== "string" || !iguais(b.secret, SECRET)) return new Response("forbidden", { status: 403 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const dl = await sb.storage.from("portal-file").download(b.path || PATH);
  if (dl.error) return Response.json({ erro: String(dl.error.message) });
  let html = await dl.data.text();

  // patchModulos: { modulo: [[antes, depois, ocorrencias], ...] } + sha: { modulo: sha256 esperado do modulo final }.
  // Tudo ou nada: qualquer contagem ou checksum diferente aborta sem gravar. Backup antes de gravar.
  if (b.patchModulos) {
    const res: any = {};
    let novo = html;
    for (const modulo of Object.keys(b.patchModulos)) {
      const r = moduloRange(novo, modulo);
      if (!r) return Response.json({ erro: "modulo nao achado: " + modulo });
      let src = await gunzipB64(novo.slice(r.st, r.en));
      const cont: any[] = [];
      for (const [a, c, n] of b.patchModulos[modulo]) {
        const achou = src.split(a).length - 1;
        cont.push(achou);
        if (achou !== n) return Response.json({ erro: "contagem divergente", modulo, esperado: n, achou, trecho: String(a).slice(0, 120) });
        src = src.split(a).join(c);
      }
      const h = await sha256(src);
      if (!b.sha || b.sha[modulo] !== h) return Response.json({ erro: "checksum divergente", modulo, obtido: h });
      const z = await gzipB64(src);
      if ((await gunzipB64(z)) !== src) return Response.json({ erro: "falha ao recompactar", modulo });
      novo = novo.slice(0, r.st) + z + novo.slice(r.en);
      res[modulo] = { trocas: cont, len: src.length, sha: h };
    }
    if (b.dry) return Response.json({ dry: true, res, len: novo.length });
    const bk = "_backup_" + Date.now() + "_antes_patch_modulos_" + PATH;
    const u1 = await sb.storage.from("portal-file").upload(bk, new Blob([html], { type: "text/html" }), { contentType: "text/html; charset=utf-8" });
    if (u1.error) return Response.json({ erro: u1.error.message });
    const u2 = await sb.storage.from("portal-file").upload(PATH, new Blob([novo], { type: "text/html" }), { upsert: true, contentType: "text/html; charset=utf-8" });
    if (u2.error) return Response.json({ erro: u2.error.message, backup: bk });
    return Response.json({ ok: true, backup: bk, res, len: novo.length });
  }

  if (b.modulo) {
    const r = moduloRange(html, b.modulo);
    if (!r) return Response.json({ erro: "modulo nao achado" });
    let src = "";
    try { src = await gunzipB64(html.slice(r.st, r.en)); } catch (e) { return Response.json({ erro: "gunzip " + e }); }
    const res: any = { len: src.length };
    if (b.terms) res.out = snippets(src, b.terms, b.before || 300, b.after || 300, b.max || 5);
    if (b.from != null) res.range = src.slice(b.from, b.from + (b.len || 3000));
    return Response.json(res);
  }

  if (b.replace) {
    const ini = html.indexOf("<!--CSA-INI-->"), fim = html.indexOf("<!--CSA-FIM-->");
    if (ini < 0 || fim < 0) return Response.json({ erro: "bloco CSA nao encontrado" });
    let bloco = html.slice(ini, fim);
    const res: any[] = [];
    for (const [a, c] of b.replace) {
      const n = bloco.split(a).length - 1;
      res.push({ a, n });
      bloco = bloco.split(a).join(c);
    }
    if (b.dry) return Response.json({ dry: true, res });
    const bk = "_backup_" + Date.now() + "_" + PATH;
    const u1 = await sb.storage.from("portal-file").upload(bk, new Blob([html], { type: "text/html" }), { contentType: "text/html; charset=utf-8" });
    if (u1.error) return Response.json({ erro: u1.error.message });
    html = html.slice(0, ini) + bloco + html.slice(fim);
    const u2 = await sb.storage.from("portal-file").upload(PATH, new Blob([html], { type: "text/html" }), { upsert: true, contentType: "text/html; charset=utf-8" });
    if (u2.error) return Response.json({ erro: u2.error.message });
    return Response.json({ ok: true, backup: bk, res, len: html.length });
  }

  const out = snippets(html, b.terms || [], b.before || 300, b.after || 300, b.max || 5);
  if (b.from != null) out.push({ t: "range", pos: b.from, s: html.slice(b.from, b.from + (b.len || 3000)) });
  return Response.json({ len: html.length, out });
});
