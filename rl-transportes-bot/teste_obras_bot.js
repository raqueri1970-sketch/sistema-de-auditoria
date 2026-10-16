// Teste do módulo Obras sem WhatsApp, sem Supabase e sem IA de verdade (tudo simulado em memória).
// Uso: node teste_obras_bot.js   → sai com código 0 se todos os cenários passarem.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// ── Supabase falso: só o que o módulo usa (select/eq/like/not/order/limit/insert/update + storage) ──
function criarSupabaseFalso() {
  const tabela = [];
  const arquivos = {};
  const tabelas = new Set();
  let seq = 0;
  const from = (t) => {
    tabelas.add(t);
    const f = { filtros: [], acao: 'select', dados: null, lim: Infinity, ordem: null };
    const api = {
      select() { return api; },
      eq(c, v) { f.filtros.push(r => r[c] === v); return api; },
      like(c, p) { const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); f.filtros.push(r => re.test(String(r[c] ?? ''))); return api; },
      not(c, op, v) { f.filtros.push(r => r[c] != null); return api; },
      is(c, v) { f.filtros.push(r => (r[c] ?? null) === v); return api; },
      order(c, o = {}) { f.ordem = [c, o.ascending !== false]; return api; },
      limit(n) { f.lim = n; return api; },
      insert(d) { f.acao = 'insert'; f.dados = Array.isArray(d) ? d : [d]; return api; },
      update(d) { f.acao = 'update'; f.dados = d; return api; },
      then(res, rej) {
        try {
          if (f.acao === 'insert') {
            for (const d of f.dados) {
              if (d.wa_msg_id && tabela.some(r => r.wa_msg_id === d.wa_msg_id)) return res({ data: null, error: { message: 'duplicate key wa_msg_id' } });
            }
            for (const d of f.dados) tabela.push({ id: 'id' + (++seq), created_at: new Date().toISOString(), ...d });
            return res({ data: null, error: null });
          }
          let rows = tabela.filter(r => f.filtros.every(fn => fn(r)));
          if (f.acao === 'update') { rows.forEach(r => Object.assign(r, f.dados)); return res({ data: null, error: null }); }
          if (f.ordem) { const [c, asc] = f.ordem; rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)); }
          res({ data: rows.slice(0, f.lim).map(r => ({ ...r })), error: null, count: rows.length });
        } catch (e) { rej(e); }
      }
    };
    return api;
  };
  return {
    tabela, arquivos, tabelas,
    from,
    storage: { from: () => ({
      upload: async (p, buf) => { if (arquivos[p]) return { error: { message: 'The resource already exists' } }; arquivos[p] = buf; return { error: null }; },
      download: async p => arquivos[p] ? { data: { arrayBuffer: async () => arquivos[p] }, error: null } : { data: null, error: { message: 'not found' } }
    }) }
  };
}

// ── IA falsa: responde conforme o conteúdo do "arquivo" (texto JSON em base64) ──
let IA_FORA = false;
class AnthropicFalso {
  constructor() { this.messages = { create: async ({ messages }) => {
    if (IA_FORA) throw new Error('529 overloaded');
    const bloco = messages[0].content[0];
    const conteudo = JSON.parse(Buffer.from(bloco.source.data, 'base64').toString());
    return { content: [{ type: 'text', text: JSON.stringify(conteudo) }] };
  } }; }
}
const origLoad = Module._load;
// Gemini falso (16/10/2026: os modelos grátis vêm primeiro e a auditoria de fundo só usa eles) — mesmo comportamento do Claude falso
class GeminiFalso { getGenerativeModel() { return { generateContent: async (partes) => {
  if (IA_FORA) throw new Error('503 overloaded');
  const conteudo = JSON.parse(Buffer.from(partes[0].inlineData.data, 'base64').toString());
  return { response: { text: () => JSON.stringify(conteudo) } };
} }; } }
Module._load = function (req, ...r) {
  if (req === '@anthropic-ai/sdk') return AnthropicFalso;
  if (req === '@google/generative-ai') return { GoogleGenerativeAI: GeminiFalso };
  return origLoad.call(this, req, ...r);
};

// ── WhatsApp falso ──
let estado = 'CONNECTED';
const historico = [];
const client = { on() {}, getState: async () => estado, getChats: async () => [{ isGroup: true, name: 'Adm Obras Esposende', fetchMessages: async () => historico, syncHistory: async () => false }] };
let nMsg = 0;
function msgFalsa(conteudo, { numero = '5581984535320', nome = 'Josemar Henrique', ts = Date.now() } = {}) {
  const data = Buffer.from(JSON.stringify(conteudo)).toString('base64');
  const m = { id: { id: 'MSG' + (++nMsg) + 'ABC' }, hasMedia: true, body: '', type: 'image', timestamp: Math.floor(ts / 1000),
    downloadMedia: async () => ({ data, mimetype: 'image/jpeg' }),
    getContact: async () => ({ pushname: nome, number: numero }) };
  historico.push(m);
  return m;
}
const item = (o) => ({ tipo_documento: 'comprovante', itens: [{ tipo_doc: 'cupom_fiscal', categoria: 'materiais_insumos', confianca: 0.9, ...o }] });

(async () => {
  process.env.ANTHROPIC_API_KEY = 'teste';
  process.env.GEMINI_API_KEY = 'teste';
  process.env.GEMINI_MODELOS_FUNDO = 'modelo-fundo-teste';  // separado: o cenário 'IA fora' deixa os principais de lado por 3 min
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obras-'));
  for (const f of ['obras_bot.js', 'ia.js']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));
  const logs = [];
  const sb = criarSupabaseFalso();
  const realSetInterval = global.setInterval, realSetTimeout = global.setTimeout;
  global.setInterval = () => 0;                                       // sem agendamentos de verdade no teste
  global.setTimeout = (fn, ms) => realSetTimeout(fn, Math.min(ms, 5)); // esperas de retry viram 5ms
  const obras = require(path.join(dir, 'obras_bot.js'))({ client, log: (m, n = 'info') => logs.push(`[${n}] ${m}`), sb, baixarMidiaPelaPagina: null });
  const esperar = () => new Promise(r => realSetTimeout(r, 50));
  const linhas = () => sb.tabela;
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().substring(0, 10);

  // 1) Recibo novo → a_pagar, com número e nome
  await obras.onMessage(msgFalsa(item({ valor: 150.5, data: hoje, hora: '10:15', fornecedor: 'Casa do Construtor LTDA', autenticacao: 'NSU123456' })), {});
  await esperar();
  assert.strictEqual(linhas().length, 1);
  assert.strictEqual(linhas()[0].status, 'lancado');
  assert.strictEqual(linhas()[0].situacao_pagamento, 'a_pagar');
  assert.strictEqual(linhas()[0].remetente_numero, '5581984535320');
  console.log('ok 1 recibo novo entra a_pagar com numero');

  // 2) Mesma foto reenviada → duplicada pelo hash
  const m1 = historico[0];
  const reenvio = { ...m1, id: { id: 'MSG' + (++nMsg) + 'REENVIO' } }; historico.push(reenvio);
  await obras.onMessage(reenvio, {}); await esperar();
  assert.strictEqual(linhas().filter(l => l.status === 'duplicada').length, 1);
  assert.strictEqual(linhas().find(l => l.status === 'duplicada').valor, 150.5, 'duplicada guarda o valor da original');
  console.log('ok 2 foto reenviada = duplicada (hash), com o valor da original');

  // 3) Outra foto do MESMO pagamento (mesma autenticação) → duplicada
  await obras.onMessage(msgFalsa(item({ valor: 150.5, data: hoje, fornecedor: 'Casa do Construtor', autenticacao: 'NSU123456', tipo_doc: 'comprovante_cartao' })), {}); await esperar();
  assert.strictEqual(linhas().filter(l => l.status === 'duplicada').length, 2);
  console.log('ok 3 mesmo pagamento em outra foto = duplicada (autenticacao)');

  // 4) Mesmo valor/data/fornecedor mas hora diferente → NÃO é duplicado (dois almoços no mesmo dia)
  await obras.onMessage(msgFalsa(item({ valor: 25, data: hoje, hora: '12:10', fornecedor: 'Restaurante Sabor', categoria: 'alimentacao' })), {}); await esperar();
  await obras.onMessage(msgFalsa(item({ valor: 25, data: hoje, hora: '19:40', fornecedor: 'Restaurante Sabor', categoria: 'alimentacao' })), {}); await esperar();
  assert.strictEqual(linhas().filter(l => l.fornecedor === 'Restaurante Sabor' && l.status === 'lancado').length, 2);
  console.log('ok 4 mesmo valor em horarios diferentes continua valendo');

  // 5) Mesmo valor/data/fornecedor/hora → duplicado (sem autenticação)
  await obras.onMessage(msgFalsa(item({ valor: 25, data: hoje, hora: '19:40', fornecedor: 'RESTAURANTE SABOR LTDA', categoria: 'alimentacao' })), {}); await esperar();
  assert.strictEqual(linhas().filter(l => /RESTAURANTE SABOR LTDA/.test(l.fornecedor || '') && l.status === 'duplicada').length, 1);
  console.log('ok 5 mesmo valor+data+fornecedor+hora = duplicada');

  // 6) Recibo igual a um já PAGO (prestação antiga) → duplicada
  sb.tabela.push({ id: 'antigo1', origem: 'prestacao_pdf', status: 'lancado', situacao_pagamento: 'pago', valor: 980, data_despesa: hoje, fornecedor: 'Deposito Sao Jose', autenticacao: null });
  await obras.onMessage(msgFalsa(item({ valor: 980, data: hoje, fornecedor: 'DEPÓSITO SÃO JOSÉ' })), {}); await esperar();
  assert.strictEqual(linhas().filter(l => /DEP/.test(l.fornecedor || '') && l.status === 'duplicada').length, 1);
  console.log('ok 6 recibo ja pago na prestacao antiga = duplicada');

  // 7) Orçamento não soma
  await obras.onMessage(msgFalsa({ tipo_documento: 'orcamento', itens: [{ tipo_doc: 'orcamento', categoria: 'materiais_insumos', valor: 5000, fornecedor: 'Vidracaria X' }] }), {}); await esperar();
  assert.strictEqual(linhas().find(l => l.fornecedor === 'Vidracaria X').status, 'orcamento');
  console.log('ok 7 orcamento nao entra como despesa');

  // 8) PDF com 3 comprovantes → 3 linhas
  await obras.onMessage(msgFalsa({ tipo_documento: 'prestacao_contas', itens: [
    { tipo_doc: 'comprovante_pix', categoria: 'frete', valor: 300, data: hoje, fornecedor: 'Carreto A' },
    { tipo_doc: 'recibo', categoria: 'mao_de_obra_prestador', valor: 450, data: hoje, fornecedor: 'Pedreiro B' },
    { tipo_doc: 'cupom_fiscal', categoria: 'alimentacao', valor: 62.9, data: hoje, fornecedor: 'Lanchonete C' }] }), {}); await esperar();
  assert.deepStrictEqual(linhas().filter(l => ['Carreto A', 'Pedreiro B', 'Lanchonete C'].includes(l.fornecedor)).map(l => l.wa_msg_id.split('#')[1]).sort(), ['0', '1', '2']);
  console.log('ok 8 documento com 3 comprovantes = 3 lancamentos');

  // 9) IA fora do ar → pendente_leitura; depois relê sozinho
  IA_FORA = true;
  const mPend = msgFalsa(item({ valor: 77.7, data: hoje, fornecedor: 'Ferragens Pendente' }));
  await obras.onMessage(mPend, {}); await esperar();
  const pend = linhas().find(l => l.status === 'pendente_leitura');
  assert.ok(pend, 'deveria ficar pendente_leitura');
  IA_FORA = false;
  await obras._relerPendentes(); await esperar();
  const relido = linhas().find(l => l.id === pend.id);
  assert.strictEqual(relido.status, 'lancado'); assert.strictEqual(relido.valor, 77.7);
  console.log('ok 9 IA fora do ar: fica pendente e e relido depois');

  // 10) Mensagem que chegou com o Supabase/WhatsApp fora → varredura lança depois, sem duplicar as já lançadas
  const antes = linhas().length;
  msgFalsa(item({ valor: 33.3, data: hoje, fornecedor: 'Posto Perdido', categoria: 'transporte_combustivel' })); // não passou por onMessage
  await obras._varrerPerdidas('teste'); await esperar();
  assert.strictEqual(linhas().length, antes + 1);
  assert.ok(linhas().some(l => l.fornecedor === 'Posto Perdido' && l.status === 'lancado'));
  console.log('ok 10 varredura recupera mensagem perdida e nao duplica as ja lancadas');

  // 11) WhatsApp travado (getState nunca responde) → varredura desiste sem travar
  client.getState = () => new Promise(() => {});
  const t0 = Date.now(); await obras._varrerPerdidas('teste-travado');
  assert.ok(Date.now() - t0 < 2000);
  console.log('ok 11 WhatsApp travado nao trava a varredura');

  // 12) Comprovante de PIX traz quem pagou (para reconhecer o pagamento do Presidente / Mar Aberto)
  client.getState = async () => 'CONNECTED';
  await obras.onMessage(msgFalsa(item({ valor: 1500, data: hoje, tipo_doc: 'comprovante_pix', fornecedor: 'JHONY PEDI', pagador: 'MAR ABERTO LTDA' })), {}); await esperar();
  assert.strictEqual(linhas().find(l => l.fornecedor === 'JHONY PEDI').pagador, 'MAR ABERTO LTDA');
  assert.deepStrictEqual([...sb.tabelas], ['obras_comprovantes']);
  console.log('ok 12 PIX grava o pagador (ex.: Mar Aberto)');

  // 12b) NF/cupom com vários produtos (a IA devolve um item por produto) → UMA despesa com o total da nota
  await obras.onMessage(msgFalsa({ tipo_documento: 'comprovante', itens: [
    { tipo_doc: 'cupom_fiscal', categoria: 'materiais_insumos', valor: 93, data: hoje, hora: '15:13:25', fornecedor: 'CASA DOS PARAFUSOS', autenticacao: '227260284244130', descricao: 'CADEADO' },
    { tipo_doc: 'cupom_fiscal', categoria: 'materiais_insumos', valor: 11.5, data: hoje, hora: '15:13:25', fornecedor: 'CASA DOS PARAFUSOS', autenticacao: '227260284244130', descricao: 'PARAFUSO' },
    { tipo_doc: 'cupom_fiscal', categoria: 'materiais_insumos', valor: 6.8, data: hoje, hora: '15:13:25', fornecedor: 'CASA DOS PARAFUSOS', autenticacao: '227260284244130', descricao: 'ARRUELA' }] }), {});
  await esperar();
  const nf = linhas().filter(l => l.fornecedor === 'CASA DOS PARAFUSOS');
  assert.strictEqual(nf.length, 1, 'a nota deveria virar uma linha so');
  assert.strictEqual(nf[0].valor, 111.3); assert.strictEqual(nf[0].status, 'lancado');
  assert.ok(/Nota com 3 itens/.test(nf[0].descricao));
  console.log('ok 12b nota fiscal com varios produtos = 1 despesa com o total');

  // 12c) Print de corrida Uber/99 (a IA chama de "outros") → despesa de transporte
  const mUber = msgFalsa({ tipo_documento: 'outros', itens: [{ tipo_doc: 'outros', categoria: 'diversos', valor: 25.8, data: hoje, fornecedor: null, descricao: 'Uber trip' }] });
  mUber.body = 'Uber - Maceió centro';
  await obras.onMessage(mUber, {}); await esperar();
  const uber = linhas().find(l => l.valor === 25.8);
  assert.strictEqual(uber.status, 'lancado'); assert.strictEqual(uber.categoria, 'transporte_combustivel');
  console.log('ok 12c print de corrida Uber/99 entra como despesa');

  // 12e) Legenda do WhatsApp vira a descrição (no lugar de "Transferência PIX"); nome de arquivo não conta como legenda
  const mLeg = msgFalsa(item({ tipo_doc: 'comprovante_pix', valor: 130, data: hoje, fornecedor: 'Edimar', descricao: 'Transferência PIX' }));
  mLeg.body = 'Diaria servente 12/10 - Maceió centro';
  await obras.onMessage(mLeg, {}); await esperar();
  assert.strictEqual(linhas().find(l => l.valor === 130).descricao, 'Diaria servente 12/10 - Maceió centro');
  const mLeg2 = msgFalsa(item({ valor: 88.8, data: hoje, fornecedor: 'Loja X', descricao: 'Cimento 2 sacos' }));
  mLeg2.body = 'Insumos - Maceió centro';
  await obras.onMessage(mLeg2, {}); await esperar();
  assert.strictEqual(linhas().find(l => l.valor === 88.8).descricao, 'Insumos - Maceió centro · Cimento 2 sacos');
  const mLeg3 = msgFalsa(item({ valor: 66.6, data: hoje, fornecedor: 'Loja Y', descricao: 'Areia' }));
  mLeg3.body = 'comprovante_pix_13-10.pdf';
  await obras.onMessage(mLeg3, {}); await esperar();
  assert.strictEqual(linhas().find(l => l.valor === 66.6).descricao, 'Areia');
  console.log('ok 12e legenda do WhatsApp entra na descricao da despesa');

  // 12d) Auditor IA da foto: toda despesa lançada recebe a leitura antifraude (auditoria_ia)
  await esperar(); await obras._auditarFotos(50); await esperar();
  const semAud = linhas().filter(l => l.status === 'lancado' && l.arquivo_path && !l.auditoria_ia);
  assert.strictEqual(semAud.length, 0, 'todas as fotos lancadas deveriam estar auditadas');
  assert.ok(linhas().filter(l => l.auditoria_ia).every(l => ['baixo', 'medio', 'alto', 'nao_lido'].includes(l.auditoria_ia.risco)));
  console.log('ok 12d todas as fotos passam pelo auditor IA');

  // 13) Modo sombra (servidor novo em paralelo): grava só em obras_comprovantes_sombra e na pasta sombra/
  const sb2 = criarSupabaseFalso();
  const sombra = require(path.join(dir, 'obras_bot.js'))({ client, log: () => {}, sb: sb2, baixarMidiaPelaPagina: null, sombra: true });
  await sombra.onMessage(msgFalsa(item({ valor: 42, data: hoje, fornecedor: 'Loja Sombra' })), {}); await esperar();
  assert.deepStrictEqual([...sb2.tabelas], ['obras_comprovantes_sombra']);
  assert.ok(Object.keys(sb2.arquivos).length > 0 && Object.keys(sb2.arquivos).every(k => k.startsWith('sombra/')));
  assert.ok(sb2.tabela.some(l => l.fornecedor === 'Loja Sombra' && l.status === 'lancado'));
  assert.ok(sb2.tabela.every(l => l.arquivo_path.startsWith('sombra/')));
  console.log('ok 13 modo sombra nao toca na tabela nem na pasta oficiais');

  global.setInterval = realSetInterval; global.setTimeout = realSetTimeout;
  console.log(`\nTODOS OS CENARIOS PASSARAM (${linhas().length} linhas no banco simulado)`);
  process.exit(0);
})().catch(e => { console.error('FALHOU:', e.message); console.error(e.stack); process.exit(1); });
