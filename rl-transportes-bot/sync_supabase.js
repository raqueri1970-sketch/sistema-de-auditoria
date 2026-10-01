/**
 * RL TRANSPORTES — Sincronizacao completa SQLite -> Supabase (espelho).
 * node sync_supabase.js            -> so compara (nao grava nada)
 * node sync_supabase.js aplicar    -> upsert de tudo + remove do Supabase o que nao existe mais no SQLite
 * O SQLite e a fonte da verdade. Le o .db em modo leitura (nao interfere no bot).
 */
'use strict';
require('dotenv').config();
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const APLICAR = process.argv[2] === 'aplicar';
const db = new Database(path.join(__dirname, 'rl_transportes.db'), { readonly: true });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const json = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

async function lerTudo(tabela, campos) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from(tabela).select(campos).order('id').range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
const soma = arr => Math.round(arr.reduce((s, r) => s + (Number(r.valor) || 0), 0) * 100) / 100;
async function resumo(rotulo) {
  const r = {};
  for (const [tab, loc] of [['rl_depositos', 'depositos'], ['rl_despesas', 'despesas']]) {
    const remoto = await lerTudo(tab, 'id,valor');
    const local = db.prepare(`SELECT id,valor FROM ${loc}`).all();
    const idsL = new Set(local.map(x => x.id)), idsR = new Set(remoto.map(x => x.id));
    r[tab] = { local: local.length, supabase: remoto.length, soma_local: soma(local), soma_supabase: soma(remoto),
      faltando_no_supabase: [...idsL].filter(i => !idsR.has(i)).length, sobrando_no_supabase: [...idsR].filter(i => !idsL.has(i)) };
    const mapR = new Map(remoto.map(x => [x.id, Number(x.valor) || 0]));
    r[tab].valor_divergente = local.filter(x => mapR.has(x.id) && Math.abs(mapR.get(x.id) - (x.valor || 0)) > 0.004).map(x => x.id);
  }
  console.log(`\n== ${rotulo} ==\n` + JSON.stringify(r, null, 1));
  return r;
}

async function run() {
  const { error: eLogin } = await sb.auth.signInWithPassword({ email: process.env.SUPABASE_ROBO_EMAIL, password: process.env.SUPABASE_ROBO_SENHA });
  if (eLogin) throw new Error('Login do robo falhou: ' + eLogin.message);
  const antes = await resumo('ANTES');
  if (!APLICAR) return;

  const depositos = db.prepare('SELECT * FROM depositos').all().map(d => ({ ...d, ocr_json: json(d.ocr_json) }));
  const despesas  = db.prepare('SELECT * FROM despesas').all().map(d => ({ ...d, ocr_json: json(d.ocr_json) }));
  const fornecedores = db.prepare('SELECT * FROM fornecedores').all()
    .map(({ id, ...r }) => ({ ...r, aliases: json(r.aliases) || [], servicos: json(r.servicos) || [] }));
  const ajustes = db.prepare('SELECT * FROM ajustes').all();
  const saldoInicial = db.prepare('SELECT * FROM saldo_inicial WHERE id=1').get();

  // 1) Remove do Supabase despesas/depositos excluidos localmente (despesas primeiro por causa da FK deposito_id)
  for (const tab of ['rl_despesas', 'rl_depositos']) {
    const ids = antes[tab].sobrando_no_supabase;
    if (ids.length) { const { error } = await sb.from(tab).delete().in('id', ids); console.log(error ? `ERRO delete ${tab}: ${error.message}` : `Removidos de ${tab}: ${ids.join(', ')}`); }
  }
  // 2) Upsert em lotes (depositos antes das despesas, por causa da FK)
  for (const [tab, linhas, opt] of [['rl_depositos', depositos], ['rl_despesas', despesas], ['rl_fornecedores', fornecedores, { onConflict: 'nome' }], ['rl_ajustes', ajustes]]) {
    let ok = 0;
    for (let i = 0; i < linhas.length; i += 200) {
      const { error } = await sb.from(tab).upsert(linhas.slice(i, i + 200), opt);
      if (error) { console.log(`ERRO upsert ${tab} lote ${i}: ${error.message}`); break; }
      ok += Math.min(200, linhas.length - i);
    }
    console.log(`Upsert ${tab}: ${ok}/${linhas.length}`);
  }
  if (saldoInicial) { const { error } = await sb.from('rl_saldo_inicial').upsert(saldoInicial); console.log(error ? 'ERRO rl_saldo_inicial: ' + error.message : 'Upsert rl_saldo_inicial: ok'); }
  await resumo('DEPOIS');
}
run().catch(e => { console.error('Falha:', e.message); process.exit(1); });
