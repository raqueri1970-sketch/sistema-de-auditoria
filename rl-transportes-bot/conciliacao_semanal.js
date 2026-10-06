/**
 * RL TRANSPORTES — Conciliacao semanal: sistema x fechamento manuscrito da Bruna.
 * node conciliacao_semanal.js                 -> tabela por semana (somente leitura)
 * node conciliacao_semanal.js 2026-08-10      -> idem + depositos e despesas da semana que comeca nessa data
 * Para cada folha semanal da Bruna, informe em FOLHAS: MAR ABERTO (Paulo), recebidos, despesas,
 * reembolsos/extras e saldo final. null = folha nao localizada (compara so o saldo).
 * Mesma regra de saldo do /api/dashboard: saldo inicial + depositos + ajustes - despesas reais
 * (PIX/TED/boleto) a partir da data do saldo inicial.
 */
'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'rl_transportes.db'), { readonly: true });

// [de, ate, MAR ABERTO, recebidos, despesas, extras(reembolsos), saldo final]
const FOLHAS = [
  ['2026-07-06', '2026-07-12', 20000, 495.74, 21539.53, 0, 1373.29],
  ['2026-07-13', '2026-07-19', 10000, 6051.10, 12818.71, 86.95, 4692.63],
  ['2026-07-20', '2026-07-26', 20000, 1060, 24620.99, 14.74, 1146.38],
  ['2026-07-27', '2026-08-02', 40000, 1945, 34670.65, 47.77, 8468.50],
  ['2026-08-03', '2026-08-09', null, null, null, null, 5861.80],
  ['2026-08-10', '2026-08-16', 10000, 10659.20, 18477.38, 18.46, 8062.08],
  ['2026-08-17', '2026-08-23', 20000, 350, 18186.99, 0, 10225.09],
  ['2026-08-24', '2026-08-31', 20000, 2704, 25851.08, 0, 7078.01],
  ['2026-09-01', '2026-09-07', 10000, 250, 13394.50, 0, 3933.51],
  ['2026-09-08', '2026-09-13', null, null, null, null, 5493.16],
  ['2026-09-14', '2026-09-20', 20000, 1992, 24258.15, 68.47, 3295.48],
  ['2026-09-21', '2026-09-27', 20000, 3576, 26604.79, 0, 266.21],
  ['2026-09-28', '2026-10-04', 30000, 510, 26623.32, 0, 4152.89],
];

const r2 = v => Math.round(v * 100) / 100;
const REAIS = `tipo_doc IN ('comprovante_pix','comprovante_ted','comprovante_boleto') AND status!='cancelado'`;
const D = `COALESCE(data_documento,substr(data,1,10))`;
const soma = (sql, ...p) => db.prepare(sql).get(...p).v;
const detalhe = process.argv[2];

let saldo = db.prepare('SELECT valor FROM saldo_inicial WHERE id=1').get().valor;
for (const [de, ate, bP, bR, bD, bX, bS] of FOLHAS) {
  const P = soma(`SELECT COALESCE(SUM(valor),0) v FROM depositos WHERE ${D} BETWEEN ? AND ? AND remetente='Paulo'`, de, ate);
  const R = soma(`SELECT COALESCE(SUM(valor),0) v FROM depositos WHERE ${D} BETWEEN ? AND ? AND remetente!='Paulo'`, de, ate);
  const A = soma(`SELECT COALESCE(SUM(valor),0) v FROM ajustes WHERE substr(data,1,10) BETWEEN ? AND ?`, de, ate);
  const X = soma(`SELECT COALESCE(SUM(valor),0) v FROM despesas WHERE ${REAIS} AND ${D} BETWEEN ? AND ?`, de, ate);
  saldo = r2(saldo + P + R + A - X);
  const f = (s, b) => b == null ? `${r2(s)}` : `${r2(s)} (Bruna ${b} | dif ${r2(s - b)})`;
  console.log(`${de}..${ate}  PAULO ${f(P, bP)}  RECEB ${f(R + A, bR == null ? null : r2(bR + bX))}  DESP ${f(X, bD)}  SALDO ${f(saldo, bS)}`);
  if (detalhe === de) {
    db.prepare(`SELECT id,valor,remetente,${D} d,hora_documento h,arquivo FROM depositos WHERE ${D} BETWEEN ? AND ? ORDER BY d`)
      .all(de, ate).forEach(x => console.log('  DEP ', JSON.stringify(x)));
    db.prepare(`SELECT id,valor,fornecedor,${D} d,hora_documento h,placa FROM despesas WHERE ${REAIS} AND ${D} BETWEEN ? AND ? ORDER BY valor DESC`)
      .all(de, ate).forEach(x => console.log('  DESP', JSON.stringify(x)));
  }
}
