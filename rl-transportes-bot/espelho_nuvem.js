/**
 * PAINEL DA RL NO D90 EM DIA ENQUANTO A NUVEM GRAVA (19/10/2026).
 *
 * Problema: desde 17/10/2026 a nuvem (VPS) é a instância principal e o D90 fica em RESERVA (lider.js): o D90 não lança
 * nada da RL. Mas o painel que o pessoal abre (http://100.125.195.119:3456) é o do D90, que lê o SQLite do D90 — parado
 * em 16/10. As despesas novas estavam no Supabase (gravadas pela nuvem), só não apareciam no painel.
 *
 * O que faz: só quando esta instância está em reserva da RL, a cada 3 min copia rl_depositos, rl_despesas, rl_ajustes,
 * rl_saldo_inicial e rl_fornecedores do Supabase para o SQLite local (o Supabase é o espelho fiel da principal).
 * Depois baixa do WhatsApp (mesmo grupo, esta sessão também está nele) os comprovantes que a nuvem lançou e que ainda
 * não estão na pasta fotos/, para o botão PDF do painel abrir.
 * Bônus: se a nuvem cair e o D90 for reiniciado, o SQLite daqui já está igual ao dela (não colide numeração).
 *
 * Nunca grava no Supabase. Na instância principal não faz nada.
 * Trava de segurança: se o Supabase devolver bem menos linhas do que o SQLite tem (ex.: RLS sem login devolve lista
 * vazia), não apaga nada e só avisa.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const INTERVALO_MS = 3 * 60 * 1000;
const json = v => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));
// Supabase (timestamptz) devolve "2026-10-16T09:28:38+00:00"; o SQLite guarda "2026-10-16 09:28:38" (os mesmos dígitos:
// o sync_supabase.js manda o texto local e o Postgres o lê como UTC).
const dataLocal = v => (v == null ? null : String(v).replace('T', ' ').replace(/(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)$/, ''));

module.exports = function iniciarEspelhoNuvem({ db, sb, log = () => {}, lider, client = null, grupo = null, pastaFotos = null }) {
  if (!db || !sb || !lider) return null;
  let rodando = false, ultimoResumo = null, ultimaExecucao = null, ultimoErro = null;
  const tentouBaixar = new Set();

  async function lerTudo(tabela) {
    const out = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await sb.from(tabela).select('*').order('id').range(de, de + 999);
      if (error) throw new Error(`${tabela}: ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < 1000) return out;
    }
  }

  const colunas = tab => db.prepare(`PRAGMA table_info(${tab})`).all().map(c => c.name);
  function substituir(tab, linhas, converter) {
    const cols = colunas(tab);
    const ins = db.prepare(`INSERT INTO ${tab} (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`);
    db.prepare(`DELETE FROM ${tab}`).run();
    for (const r of linhas) {
      const c = converter(r), linha = {};
      for (const k of cols) linha[k] = c[k] === undefined ? null : c[k];
      ins.run(linha);
    }
  }

  const convDeposito = r => ({ ...r, data: dataLocal(r.data), created_at: dataLocal(r.created_at), ocr_json: json(r.ocr_json),
    valor: Number(r.valor) || 0, saldo_restante: Number(r.saldo_restante) || 0 });
  const convDespesa = r => ({ ...r, data: dataLocal(r.data), created_at: dataLocal(r.created_at), ocr_json: json(r.ocr_json),
    valor: r.valor == null ? null : Number(r.valor), confianca: r.confianca == null ? null : Number(r.confianca) });
  const convAjuste = r => ({ ...r, data: dataLocal(r.data), created_at: dataLocal(r.created_at), valor: Number(r.valor) || 0 });

  async function puxar(motivo = 'rotina') {
    if (!lider.rlBloqueada() || rodando) return null;
    rodando = true;
    try {
      const ses = await sb.auth.getSession();
      if (!ses || !ses.data || !ses.data.session) throw new Error('robo ainda sem login no Supabase');
      const [deps, desps, ajustes, saldo, forns] = await Promise.all(['rl_depositos', 'rl_despesas', 'rl_ajustes', 'rl_saldo_inicial', 'rl_fornecedores'].map(lerTudo));

      const nLocal = db.prepare('SELECT (SELECT count(*) FROM despesas) d, (SELECT count(*) FROM depositos) p').get();
      if (desps.length < nLocal.d * 0.9 || deps.length < nLocal.p * 0.9)
        throw new Error(`Supabase devolveu poucas linhas (despesas ${desps.length} x ${nLocal.d} local, depositos ${deps.length} x ${nLocal.p}) — nada alterado`);

      const antes = db.prepare('SELECT (SELECT count(*) FROM despesas) d, (SELECT max(id) FROM despesas) m, (SELECT round(sum(valor),2) FROM despesas) s, (SELECT round(sum(valor),2) FROM depositos) sp').get();
      db.pragma('foreign_keys = OFF');
      try {
        db.transaction(() => {
          substituir('despesas', desps, convDespesa);
          substituir('depositos', deps, convDeposito);
          substituir('ajustes', ajustes, convAjuste);
          const s = saldo.find(x => Number(x.id) === 1);
          if (s) {
            // saldo_inicial.data local é só a data (AAAA-MM-DD)
            db.prepare(`INSERT INTO saldo_inicial (id,valor,data,descricao,created_at) VALUES (1,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET valor=excluded.valor, data=excluded.data, descricao=excluded.descricao`)
              .run(Number(s.valor) || 0, String(dataLocal(s.data) || '').replace(/ 00:00:00$/, ''), s.descricao || null, dataLocal(s.created_at));
          }
          const upF = db.prepare(`INSERT INTO fornecedores (nome,aliases,servicos,total_gasto,total_ocorrencias,updated_at) VALUES (?,?,?,?,?,?)
            ON CONFLICT(nome) DO UPDATE SET aliases=excluded.aliases, servicos=excluded.servicos, total_gasto=excluded.total_gasto,
            total_ocorrencias=excluded.total_ocorrencias, updated_at=excluded.updated_at`);
          for (const f of forns) if (f.nome) upF.run(f.nome, json(f.aliases) || '[]', json(f.servicos) || '[]', Number(f.total_gasto) || 0, Number(f.total_ocorrencias) || 0, dataLocal(f.updated_at));
        })();
      } finally { db.pragma('foreign_keys = ON'); }
      const depois = db.prepare('SELECT (SELECT count(*) FROM despesas) d, (SELECT max(id) FROM despesas) m, (SELECT round(sum(valor),2) FROM despesas) s, (SELECT round(sum(valor),2) FROM depositos) sp').get();
      const mudou = JSON.stringify(antes) !== JSON.stringify(depois);
      ultimoResumo = { despesas: depois.d, ultima_despesa: depois.m, depositos: deps.length };
      ultimaExecucao = new Date().toISOString(); ultimoErro = null;
      if (mudou || motivo !== 'rotina')
        log(`Painel RL copiado da nuvem (${motivo}): ${depois.d} despesas (ultima #${depois.m}), ${deps.length} depositos${mudou ? ` — antes ${antes.d} despesas (ultima #${antes.m})` : ' — sem mudanca'}`);
      baixarArquivosFaltando().catch(e => log(`Painel RL: baixar comprovantes da nuvem falhou: ${e.message}`, 'warn'));
      return ultimoResumo;
    } catch (e) {
      if (ultimoErro !== e.message) log(`Painel RL: copia da nuvem falhou: ${e.message}`, 'warn');
      ultimoErro = e.message;
      return null;
    } finally { rodando = false; }
  }

  // Comprovantes lançados pela nuvem: o arquivo só existe lá. Esta sessão do WhatsApp está no mesmo grupo, então baixa
  // a mensagem original (nome WA_<timestamp>_<id da mensagem>_<remetente>.ext). Cada arquivo é tentado uma vez por execução do bot.
  let baixando = false;
  async function baixarArquivosFaltando() {
    if (!client || !grupo || !pastaFotos || baixando) return;
    const faltando = [...new Set([
      ...db.prepare("SELECT arquivo FROM despesas WHERE arquivo LIKE 'WA\\_%' ESCAPE '\\' AND status!='cancelado'").all(),
      ...db.prepare("SELECT arquivo FROM depositos WHERE arquivo LIKE 'WA\\_%' ESCAPE '\\'").all()
    ].map(r => r.arquivo))].filter(a => !tentouBaixar.has(a) && !fs.existsSync(path.join(pastaFotos, path.basename(a))));
    if (!faltando.length) return;
    baixando = true;
    try {
      const estado = await client.getState().catch(() => null);
      if (estado !== 'CONNECTED') return;
      const chat = (await client.getChats()).find(c => c.isGroup && c.name && c.name.includes(grupo));
      if (!chat) return;
      const maisAntigo = Math.min(...faltando.map(a => Number((a.match(/^WA_(\d+)_/) || [])[1]) || Infinity));
      const limite = Date.now() - maisAntigo > 7 * 24 * 3600e3 ? 1000 : 300;
      const msgs = (await chat.fetchMessages({ limit: limite })).filter(m => m.hasMedia);
      let ok = 0;
      for (const arquivo of faltando) {
        tentouBaixar.add(arquivo);
        const m = arquivo.match(/^WA_(\d+)_([A-Za-z0-9]+)_/);
        if (!m) continue;
        const msg = msgs.find(x => Math.round(x.timestamp * 1000) === Number(m[1]) && (x.id?.id || '').replace(/[^A-Za-z0-9]/g, '').startsWith(m[2]));
        if (!msg) continue;
        try {
          const media = await msg.downloadMedia();
          if (!media || !media.data) continue;
          fs.writeFileSync(path.join(pastaFotos, path.basename(arquivo)), Buffer.from(media.data, 'base64'));
          ok++;
        } catch (e) { /* fica sem o PDF no painel; o lançamento já está certo */ }
      }
      if (ok) log(`Painel RL: ${ok} comprovante(s) lancado(s) pela nuvem baixado(s) do WhatsApp para o painel`);
    } finally { baixando = false; }
  }

  // Primeira cópia assim que a trava de instância decidir que esta é reserva; depois a cada 3 min.
  setTimeout(() => puxar('inicio do bot'), 90 * 1000);
  setInterval(() => puxar(), INTERVALO_MS);
  return { puxar, estado: () => ({ ativo: lider.rlBloqueada(), ultimaExecucao, ultimoResumo, ultimoErro }) };
};
