// Teste do bot_v3.js inteiro com WhatsApp, IA e Supabase simulados: comprovante REUTILIZADO (mesma foto, mesma autenticacao,
// mesmo fornecedor/valor/data/hora) de outro periodo nao soma e aparece na Auditoria com os dois comprovantes.
// Uso: node teste_reuso_rl.js  -> banco temporario (DADOS_DIR), porta 34561; sai com codigo 0 se passar.
const assert = require('assert'); const Module = require('module'); const fs = require('fs'); const os = require('os'); const path = require('path');
const BOT = process.argv[2] || path.join(__dirname, 'bot_v3.js');
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'rl'));
process.env.DADOS_DIR = dados; process.env.PORT = '34561'; process.env.GEMINI_API_KEY = 'x';
delete process.env.SUPABASE_URL; delete process.env.ANTHROPIC_API_KEY;
const { EventEmitter } = require('events');
// IA falsa: o conteudo do arquivo (texto) diz o que "esta escrito" no comprovante
class GeminiFalso { getGenerativeModel() { return { generateContent: async ([inl]) => ({ response: { text: () => Buffer.from(inl.inlineData.data, 'base64').toString().split('|')[1] } }) }; } }
class ClientFalso extends EventEmitter { constructor() { super(); this.pupPage = null; ClientFalso.ultimo = this; } initialize() { return new Promise(() => {}); } getState() { return Promise.resolve('CONNECTED'); } getChats() { return Promise.resolve([]); } }
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'whatsapp-web.js') return { Client: ClientFalso, LocalAuth: class {}, MessageMedia: class {} };
  if (req === '@google/generative-ai') return { GoogleGenerativeAI: GeminiFalso };
  if (req === 'puppeteer' || req === 'qrcode-terminal' || req === '@anthropic-ai/sdk') return {};
  if (req === '@supabase/supabase-js') return { createClient: () => null };
  return orig.call(this, req, ...r);
};
const iv = global.setInterval; global.setInterval = (f, ms) => iv(f, Math.max(ms, 1e9));
process.chdir(path.dirname(BOT));
require(BOT);
const http = (m, u) => new Promise((ok, ko) => { const r = require('http').request({ host: '127.0.0.1', port: 34561, path: u, method: m }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => ok(JSON.parse(b))); }); r.on('error', ko); r.end(); });
const espera = ms => new Promise(r => setTimeout(r, ms));
let seq = 0;
// mensagem do grupo RL com um "PDF" cujo texto e: id|json
function msg(nome, ts, json, id) {
  const conteudo = Buffer.from(`${id}|${JSON.stringify(json)}`).toString('base64');
  return { timestamp: ts, id: { id: 'ID' + (id || ++seq) + 'XXXXXXXXXX' }, hasMedia: true, body: '', fromMe: false,
    getChat: async () => ({ isGroup: true, name: 'RL TRANSPORTES' }), getContact: async () => ({ pushname: nome }),
    downloadMedia: async () => ({ data: conteudo, mimetype: 'image/jpeg' }) };
}

const pix = (aut, valor, forn, data, hora) => ({ valor, data, hora, fornecedor: forn, tipo_doc: 'comprovante_pix', confianca: 0.95, autenticacao: aut });
(async () => {
  await espera(800);
  const cli = ClientFalso.ultimo;
  const enviar = async m => { cli.emit('message', m); await espera(400); };
  const t0 = Math.floor(new Date('2026-09-10T12:00:00-03:00').getTime() / 1000);
  // 1) setembro: comprovante original
  await enviar(msg('Bruna', t0, pix('AUT-SET-123456', 500, 'POSTO A', '2026-09-10', '11:00:01'), 'A'));
  let desp = await http('GET', '/api/despesas');
  assert.equal(desp.length, 1, 'original lancado');
  // 2) a MESMA mensagem de novo (rescan): nada novo, nenhum reuso
  await enviar(msg('Bruna', t0, pix('AUT-SET-123456', 500, 'POSTO A', '2026-09-10', '11:00:01'), 'A'));
  // 3) outubro: a MESMA foto reenviada em outra mensagem
  const t1 = Math.floor(new Date('2026-10-15T09:00:00-03:00').getTime() / 1000);
  await enviar(msg('Bruna', t1, pix('AUT-SET-123456', 500, 'POSTO A', '2026-09-10', '11:00:01'), 'A'));
  // 4) outubro: print/foto diferente do MESMO pagamento (mesma autenticacao e valor)
  await enviar(msg('Bruna', t1 + 60, pix('AUT-SET-123456', 500, 'POSTO A ', '2026-09-10', null), 'B'));
  // 5) outubro: outra foto, sem autenticacao, mesmo fornecedor/valor/data/hora
  await enviar(msg('Bruna', t1 + 120, pix(null, 500, 'POSTO A', '2026-09-10', '11:00:01'), 'C'));
  // 6) pagamento novo legitimo: mesmo fornecedor e valor, outro dia
  await enviar(msg('Bruna', t1 + 180, pix('AUT-OUT-999999', 500, 'POSTO A', '2026-10-15', '08:59:00'), 'D'));
  desp = await http('GET', '/api/despesas');
  assert.equal(desp.length, 2, 'so o original e o pagamento novo contam: ' + desp.map(d => d.id + ':' + d.fornecedor).join(','));
  const aud = await http('GET', '/api/auditoria');
  const re = aud.filter(a => a.tipo_alerta === 'Comprovante Reutilizado');
  assert.equal(re.length, 3, 'tres reusos: ' + JSON.stringify(re, null, 1));
  console.log(re.map(r => r.referencia).join('\n'));
  const det = await http('GET', '/api/reuso/' + re[re.length - 1].ids);
  assert.equal(det.original.id, desp.find(d => d.autenticacao === 'AUT-SET-123456').id);
  assert(fs.existsSync(path.join(dados, 'fotos', det.reuso.arquivo)), 'arquivo do reenvio mantido');
  assert(fs.existsSync(path.join(dados, 'fotos', det.original.arquivo)), 'arquivo original mantido');
  assert.match(det.original.periodo.texto, /semana/);
  console.log('motivos:', re.map(r => r.motivo).join(' | '));
  // 7) rescan da mensagem de reuso nao duplica alerta
  await enviar(msg('Bruna', t1, pix('AUT-SET-123456', 500, 'POSTO A', '2026-09-10', '11:00:01'), 'A'));
  assert.equal((await http('GET', '/api/auditoria')).filter(a => a.tipo_alerta === 'Comprovante Reutilizado').length, 3);
  console.log('TODOS OK'); process.exit(0);
})().catch(e => { console.error('FALHOU', e); process.exit(1); });
