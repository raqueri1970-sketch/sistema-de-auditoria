// Recebe a foto da página do PDF do banco (S:\ do D90) que prova cada pagamento de uma duplicidade e liga ao caso.
// Só aceita: código de uso único válido (fin_envio_token, guardado só o hash e com validade) + um pagamento que já
// existe em fin_duplicidade_comprovantes (caso, lado e página conferidos) + imagem JPEG de até 4 MB.
// Grava em fin-comprovantes/banco/DUP-<id>/<lado>_p<página>.jpg e registra em fin_evidencias (lado A/B).
const U = Deno.env.get('SUPABASE_URL')!;
const S = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H = {apikey: S, Authorization: `Bearer ${S}`};
const out = (x: unknown, s = 200) => new Response(JSON.stringify(x), {status: s, headers: {'Content-Type': 'application/json'}});
const hex = async (t: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))))
  .map(b => b.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req) => {
  if (req.method !== 'POST') return out({erro: 'use POST'}, 405);
  try {
    const b = await req.json();
    const tk = await (await fetch(`${U}/rest/v1/fin_envio_token?hash=eq.${await hex(String(b.token || ''))}&expira_em=gt.${new Date().toISOString()}&select=id,usos`, {headers: H})).json();
    if (!tk.length) return out({erro: 'código inválido ou vencido'}, 403);

    if (b.acao === 'pendentes') { // páginas de duplicidade do banco ainda sem foto: [dup, lado, arquivo, página, id do pagamento, valor]
      const oc = await (await fetch(`${U}/rest/v1/fin_ocorrencias?regra=eq.DUP_BANCO&ativo=is.true&select=origem_ref,evidencias`, {headers: H})).json();
      const lista = oc.flatMap((o: any) => (o.evidencias || [])
        .filter((e: any) => e.tipo === 'pagamento' && !e.comprovante?.path && e.arquivo_banco)
        .map((e: any) => [Number(String(o.origem_ref).slice(4)), e.lado, e.arquivo_banco, Number(e.pagina), e.id_pagamento || '', e.valor ?? '']));
      return out({lista});
    }

    const dup = Number(b.dup), lado = String(b.lado || ''), pag = Number(b.pagina);
    if (!Number.isInteger(dup) || !/^[A-Z]$/.test(lado) || !Number.isInteger(pag)) return out({erro: 'dados inválidos'}, 400);
    const d = (await (await fetch(`${U}/rest/v1/fin_duplicidade_comprovantes?id=eq.${dup}&select=pagamentos`, {headers: H})).json())[0];
    const p = d?.pagamentos?.[lado.charCodeAt(0) - 65];
    if (!p || !p.arquivo || Math.abs(Number(p.pagina) - pag) > 1) return out({erro: 'pagamento não confere com o caso'}, 400);

    const bin = Uint8Array.from(atob(String(b.imagem || '')), c => c.charCodeAt(0));
    if (bin.length < 1000 || bin.length > 4e6 || bin[0] !== 0xFF || bin[1] !== 0xD8) return out({erro: 'imagem JPEG inválida'}, 400);

    const path = `banco/DUP-${dup}/${lado}_p${pag}.jpg`;
    const up = await fetch(`${U}/storage/v1/object/fin-comprovantes/${path}`, {method: 'POST',
      headers: {...H, 'Content-Type': 'image/jpeg', 'x-upsert': 'true'}, body: bin});
    if (!up.ok) return out({erro: 'falha no envio: ' + await up.text()}, 500);

    const ja = await (await fetch(`${U}/rest/v1/fin_evidencias?ocorrencia_id=eq.DUP-${dup}&arquivo_path=eq.${encodeURIComponent(path)}&select=id`, {headers: H})).json();
    if (!ja.length) {
      const nome = String(p.arquivo).split('\\').pop();
      const ins = await fetch(`${U}/rest/v1/fin_evidencias`, {method: 'POST', headers: {...H, 'Content-Type': 'application/json', Prefer: 'return=minimal'},
        body: JSON.stringify({ocorrencia_id: `DUP-${dup}`, regra: 'FIN_DUPLICIDADE', tipo: 'comprovante', lado, storage_bucket: 'fin-comprovantes',
          arquivo_path: path, arquivo_nome: `${nome} pág. ${pag}`,
          referencia: {origem: 'PDF do banco (S:)', arquivo_banco: p.arquivo, pagina: pag, data: p.data, valor: p.valor,
            id_pagamento: p.id_pix || p.autenticacoes?.[0] || null, codigo_barras: p.codigo_barras || null}})});
      if (!ins.ok) return out({erro: 'falha ao registrar: ' + await ins.text()}, 500);
    }
    await fetch(`${U}/rest/v1/fin_envio_token?id=eq.${tk[0].id}`, {method: 'PATCH', headers: {...H, 'Content-Type': 'application/json'},
      body: JSON.stringify({usos: tk[0].usos + 1})});
    return out({ok: true, path});
  } catch (e) {
    return out({erro: String(e)}, 500);
  }
});
