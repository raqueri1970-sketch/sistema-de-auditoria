// Teste da Auditoria de midias (auditoria_midias.js) com o bot_v3.js inteiro e WhatsApp/IA simulados.
// Reproduz o bug de 13/07/2026: Pix de R$ 10.000 para a RL que ficou SO na pasta (sem lancamento) e midia do grupo que
// nunca chegou como evento. Tambem a guia GNRE (deposito falso #32) e os casos que tem de ficar para revisao humana.
// Uso: node teste_auditoria_midias.js  -> banco temporario (DADOS_DIR), porta 34562; sai com codigo 0 se passar.
const assert = require('assert'); const Module = require('module'); const fs = require('fs'); const os = require('os'); const path = require('path');
const BOT = process.argv[2] || path.join(__dirname, 'bot_v3.js');
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'rlaud'));
process.env.DADOS_DIR = dados; process.env.PORT = '34562'; process.env.GEMINI_API_KEY = 'x';
delete process.env.SUPABASE_URL; delete process.env.ANTHROPIC_API_KEY; delete process.env.AUDITORIA_ALERTA_WA;
const { EventEmitter } = require('events');
class GeminiFalso { getGenerativeModel() { return { generateContent: async ([inl]) => ({ response: { text: () => Buffer.from(inl.inlineData.data, 'base64').toString().split('|')[1] } }) }; } }
let mensagensDoGrupo = [];
const grupoFalso = { isGroup: true, name: 'RL TRANSPORTES', fetchMessages: async () => mensagensDoGrupo, syncHistory: async () => false };
class ClientFalso extends EventEmitter { constructor() { super(); this.pupPage = null; ClientFalso.ultimo = this; } initialize() { return new Promise(() => {}); }
  getState() { return Promise.resolve('CONNECTED'); } getChats() { return Promise.resolve([grupoFalso]); } }
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'whatsapp-web.js') return { Client: ClientFalso, LocalAuth: class {}, MessageMedia: class {} };
  if (req === '@google/generative-ai') return { GoogleGenerativeAI: GeminiFalso };
  if (req === 'puppeteer' || req === 'qrcode-terminal' || req === '@anthropic-ai/sdk') return {};
  if (req === '@supabase/supabase-js') return { createClient: () => null };
  return orig.call(this, req, ...r);
};
const iv = global.setInterval; global.setInterval = (f, ms) => iv(f, Math.max(ms, 1e9));
const st = global.setTimeout; global.setTimeout = (f, ms, ...a) => st(f, ms >= 60000 ? 1e9 : ms, ...a); // sem rotinas automaticas no teste
process.chdir(path.dirname(BOT));
require(BOT);
const http = (m, u) => new Promise((ok, ko) => { const r = require('http').request({ host: '127.0.0.1', port: 34562, path: u, method: m }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => ok(JSON.parse(b))); }); r.on('error', ko); r.end(); });
const espera = ms => new Promise(r => setTimeout(r, ms));
const conteudo = (id, json) => Buffer.from(`${id}|${JSON.stringify(json)}`).toString('base64');
function msg(nome, ts, json, id) {
  const c = conteudo(id, json);
  return { timestamp: ts, id: { id: 'ID' + id + 'XXXXXXXXXX' }, hasMedia: true, body: '', fromMe: false, type: 'image',
    getChat: async () => grupoFalso, getContact: async () => ({ pushname: nome }), downloadMedia: async () => ({ data: c, mimetype: 'image/jpeg' }) };
}
const pix = (aut, valor, forn, data, extra = {}) => ({ valor, data, hora: null, fornecedor: forn, tipo_doc: 'comprovante_pix', confianca: 0.95, autenticacao: aut, ...extra });
const fotos = path.join(dados, 'fotos');

(async () => {
  await espera(800);
  const cli = ClientFalso.ultimo;
  cli.emit('ready'); await espera(200);
  const ts = d => Math.floor(new Date(d + 'T10:00:00-03:00').getTime() / 1000);

  // 1) normal: Bruna paga posto (chega pelo evento)
  const mA = msg('Bruna', ts('2026-07-08'), pix('AUT-POSTO-0001', 297.84, 'ALTO POSTO', '2026-07-08'), 'A');
  cli.emit('message', mA); await espera(400);
  // 2) GNRE: a GUIA (boleto a pagar) com a RL como contribuinte NAO pode virar deposito (bug do deposito #32)
  const mG = msg('Bruna', ts('2026-07-09'), { valor: 12, data: '2026-07-09', fornecedor: 'RL NORDESTE LTDA', cnpj: '52.323.556/0001-12', tipo_doc: 'comprovante_boleto', confianca: 0.9 }, 'G');
  cli.emit('message', mG); await espera(400);
  let deps = await http('GET', '/api/depositos');
  assert.equal(deps.length, 0, 'guia GNRE nao e deposito: ' + JSON.stringify(deps));
  let dash = await http('GET', '/api/dashboard');
  assert.equal(dash.total_despesas, 297.84, 'guia nao soma como gasto: ' + dash.total_despesas);

  // 3) midia que ficou SO no grupo (o capturador estava fora e o evento nunca veio): Pix de 10 mil para a RL
  const mB = msg('Bruna', ts('2026-07-13'), pix(null, 10000, 'RL NORDESTE LTDA', '2026-07-13'), 'B');
  // 4) arquivo que ficou SO na pasta (baixado em 20/07 e nunca lancado) — o caso real
  const orfao = 'WA_1784555473000_3AE14552264A_Bruna_(recuperado).jpeg';
  fs.writeFileSync(path.join(fotos, orfao), Buffer.from(conteudo('O', pix(null, 5000, 'RL NORDESTE LTDA', '2026-07-14')), 'base64'));
  // 5) copia identica do comprovante 1 com outro nome (reenvio recuperado): so "copia", nada novo
  const copia = 'WA_1784555474000_3A00000000AA_Bruna_(recuperado).jpeg';
  fs.copyFileSync(path.join(fotos, fs.readdirSync(fotos).find(n => n.includes('IDAXXX'))), path.join(fotos, copia));
  // 6) fechamento manuscrito na pasta: nao e comprovante -> revisar
  const manuscrito = 'WA_1784555472000_3A7F5994004E_Bruna_(recuperado).jpeg';
  fs.writeFileSync(path.join(fotos, manuscrito), Buffer.from(conteudo('M', { valor: 21539.53, data: '2026-07-12', tipo_doc: 'outros', confianca: 0.6, fornecedor: null }), 'base64'));
  // 7) outro print do MESMO Pix de 10 mil (bytes diferentes) na pasta: possivel duplicata -> revisar, nao soma
  const print2 = 'WA_1784555475000_3A1111111111_Rafael_Marques_Trans.jpeg';
  fs.writeFileSync(path.join(fotos, print2), Buffer.from(conteudo('P2', pix(null, 10000, 'RL NORDESTE LTDA', '2026-07-13')), 'base64'));
  // 8) print do SALDO da conta (bug real da 1a rodada): IA diz "outros" com a RL -> nao pode virar deposito
  const saldo = 'WA_1785249963000_4A81817D6F1A_Bruna.jpeg';
  fs.writeFileSync(path.join(fotos, saldo), Buffer.from(conteudo('S', { valor: 8375.61, data: '2024-06-24', fornecedor: 'RL NORDESTE LTDA', tipo_doc: 'outros', confianca: 0.8 }), 'base64'));
  // 9) print da LISTA de boletos (sem autenticacao, data chutada) -> nao pode virar despesa
  const lista = 'WA_1783619493000_4AA141EAB238_Bruna.jpeg';
  fs.writeFileSync(path.join(fotos, lista), Buffer.from(conteudo('L', { valor: 240, data: '2026-06-24', hora: '13:34', fornecedor: 'Gnre Sefaz Pernambuco', tipo_doc: 'comprovante_boleto', confianca: 0.9 }), 'base64'));
  const textoAntigo = { timestamp: ts('2026-06-30'), id: { id: 'IDTXTXXXXXXXXX' }, hasMedia: false, body: 'bom dia', type: 'chat' }; // historico cobre a janela
  mensagensDoGrupo = [textoAntigo, mA, mG, mB];

  // SIMULACAO: lista e nao grava
  const sim = await http('POST', '/api/auditoria-midias?simular=1&de=2026-07-01&ate=2026-07-31');
  assert(sim.ok, JSON.stringify(sim));
  assert.equal(sim.grupo.pendentes.length, 1, 'simulacao acha a midia do grupo nao lancada');
  assert.equal(sim.pasta.orfaos.length, 5, 'simulacao acha os 5 orfaos (copia fica de fora): ' + JSON.stringify(sim.pasta.orfaos));
  assert.equal((await http('GET', '/api/depositos')).length, 0, 'simulacao nao grava');

  // EXECUCAO
  const r = await http('POST', '/api/auditoria-midias?de=2026-07-01&ate=2026-07-31');
  assert(r.ok, JSON.stringify(r));
  console.log('grupo:', JSON.stringify(r.grupo.recuperadas), '\npasta lancados:', JSON.stringify(r.pasta.lancados), '\nrevisar:', JSON.stringify(r.pasta.revisar));
  deps = await http('GET', '/api/depositos');
  assert.deepEqual(deps.map(d => d.valor).sort((a, b) => a - b), [5000, 10000], 'Pix do grupo e Pix orfao lancados, print repetido nao: ' + JSON.stringify(deps.map(d => [d.valor, d.arquivo])));
  assert.equal(r.pasta.copias, 1, 'copia identica reconhecida');
  const rev = r.pasta.revisar.map(x => x.arquivo).sort();
  assert.deepEqual(rev, [print2, manuscrito, saldo, lista].sort(), 'manuscrito, print repetido, print de saldo e lista de boletos ficam para revisao');
  assert.equal(r.pendencias, 4, 'quatro pendencias abertas');
  dash = await http('GET', '/api/dashboard');
  assert.equal(dash.total_despesas, 297.84, 'nada de despesa falsa');

  // pendencias no painel e resolucao manual
  let p = await http('GET', '/api/auditoria-midias');
  assert.equal(p.itens.length, 4);
  assert((await http('POST', '/api/auditoria-midias/resolver?arquivo=' + encodeURIComponent(manuscrito) + '&nota=fechamento%20semanal')).ok);
  p = await http('GET', '/api/auditoria-midias');
  assert.deepEqual(p.itens.map(i => i.arquivo).sort(), [print2, saldo, lista].sort());

  // segunda execucao: idempotente (nada novo, nada relancado)
  const r2 = await http('POST', '/api/auditoria-midias?de=2026-07-01&ate=2026-07-31');
  assert.equal(r2.grupo.recuperadas.length, 0); assert.equal(r2.pasta.lancados.length, 0);
  assert.equal((await http('GET', '/api/depositos')).length, 2, 'nao duplica na segunda rodada');
  console.log('TODOS OK'); process.exit(0);
})().catch(e => { console.error('FALHOU', e); process.exit(1); });
