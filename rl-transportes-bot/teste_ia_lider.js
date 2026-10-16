// Teste de ia.js (Claude → Gemini, cota diária, sem crédito) e lider.js (uma instância só gravando). Sem rede: tudo simulado.
// Uso: node teste_ia_lider.js   → sai com código 0 se todos os cenários passarem.
'use strict';
const assert = require('assert');
const Module = require('module');

// ── SDKs falsos ──
const cenario = { claude: 'ok', gemini: {} };   // gemini: modelo → 'ok' | 'cota_dia' | 'cota_min' | 'erro'
const chamadas = [];
class AnthropicFalso {
  constructor() { this.messages = { create: async () => {
    chamadas.push('claude');
    if (cenario.claude === 'sem_credito') throw new Error('400 {"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API."}}');
    if (cenario.claude === 'fora') throw new Error('529 overloaded');
    return { content: [{ type: 'text', text: '```json\n{"valor": 10, "fonte": "claude"}\n```' }] };
  } }; }
}
class GeminiFalso {
  getGenerativeModel({ model }) { return { generateContent: async () => {
    chamadas.push(model);
    const c = cenario.gemini[model] || 'ok';
    if (c === 'cota_dia') throw new Error('[429 Too Many Requests] You exceeded your current quota. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: ' + model + ' Please retry in 11h39m36.338146652s. [{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"},{"retryDelay":"41976s"}]');
    if (c === 'cota_min') { cenario.gemini[model] = 'ok'; throw new Error('[429 Too Many Requests] quota "retryDelay":"1s" PerMinute'); }
    if (c === 'erro') throw new Error('500 interno');
    return { response: { text: () => JSON.stringify({ valor: 20, fonte: model }) } };
  } }; }
}
const origLoad = Module._load;
Module._load = function (req, ...r) {
  if (req === '@anthropic-ai/sdk') return AnthropicFalso;
  if (req === '@google/generative-ai') return { GoogleGenerativeAI: GeminiFalso };
  return origLoad.call(this, req, ...r);
};
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms) => realSetTimeout(fn, Math.min(ms, 5));
const realSetInterval = global.setInterval;
global.setInterval = () => 0;

(async () => {
  process.env.ANTHROPIC_API_KEY = 'x'; process.env.GEMINI_API_KEY = 'y';
  process.env.GEMINI_MODELOS = 'g-flash,g-lite';
  const logs = [];
  const criarIA = require('./ia');
  const { atrasoPedido, ehCotaDiaria } = criarIA._interno;

  assert.strictEqual(atrasoPedido('"retryDelay":"41976s"'), 41976000);
  assert.strictEqual(atrasoPedido('Please retry in 11h39m36.3s'), (11 * 3600 + 39 * 60 + 36.3) * 1000);
  assert.ok(ehCotaDiaria('GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
  assert.ok(!ehCotaDiaria('[429] "retryDelay":"20s"'));
  console.log('ok 1 entende o tempo de espera e a cota diaria do Google');

  let ia = criarIA({ log: (m, n) => logs.push(`[${n}] ${m}`) });
  let r = await ia.ler('AAA', 'image/jpeg', 'p');
  assert.strictEqual(r.fonte, 'claude');
  console.log('ok 2 Claude e a primeira opcao (le JSON mesmo dentro de ```json)');

  cenario.claude = 'sem_credito'; chamadas.length = 0;
  r = await ia.ler('AAA', 'image/jpeg', 'p');
  assert.strictEqual(r.fonte, 'g-flash');
  assert.ok(/claude PAUSADO/.test(ia.estado()), ia.estado());
  chamadas.length = 0;
  await ia.ler('AAA', 'image/jpeg', 'p');
  assert.deepStrictEqual(chamadas, ['g-flash'], 'Claude em pausa nao e chamado de novo a cada leitura');
  console.log('ok 3 Claude sem credito: pausa (nao para sempre) e usa o Gemini');

  cenario.gemini['g-flash'] = 'cota_dia'; chamadas.length = 0;
  r = await ia.ler('AAA', 'image/jpeg', 'p');
  assert.strictEqual(r.fonte, 'g-lite');
  chamadas.length = 0;
  r = await ia.ler('AAA', 'image/jpeg', 'p');
  assert.deepStrictEqual(chamadas, ['g-lite'], 'modelo com cota diaria esgotada fica de fora');
  console.log('ok 4 cota diaria esgotada: pula para o proximo modelo na hora');

  cenario.gemini['g-lite'] = 'cota_dia';
  await assert.rejects(ia.ler('AAA', 'image/jpeg', 'p'), e => e.semIA === true);
  assert.ok(!ia.temAgora());
  assert.ok(/COTA ESGOTADA/.test(ia.estado()), ia.estado());
  console.log('ok 5 sem nenhuma IA: erro claro (quem chama marca para reler) e temAgora()=false');

  ia = criarIA({ log: () => {} });
  cenario.claude = 'fora'; cenario.gemini = { 'g-flash': 'cota_min' }; chamadas.length = 0;
  r = await ia.ler('AAA', 'image/jpeg', 'p');
  assert.strictEqual(r.fonte, 'g-flash');
  assert.ok(/claude claude-/.test(ia.estado()), 'Claude sobrecarregado (529) nao entra em pausa: ' + ia.estado());
  console.log('ok 6 limite por minuto: espera e tenta de novo no mesmo modelo; Claude sobrecarregado nao pausa');

  // ── lider.js ──
  const criarLider = require('./lider');
  function sbFalso(linhas, { logado = true } = {}) {
    return {
      auth: { getSession: async () => ({ data: { session: logado ? { user: {} } : null } }) },
      from: () => {
        const f = [];
        const api = { select: () => api, gt: (c, v) => (f.push(r => r[c] > v), api), neq: (c, v) => (f.push(r => r[c] !== v), api),
          then: res => res({ data: linhas.filter(r => f.every(fn => fn(r))), error: null }) };
        return api;
      }
    };
  }
  const agora = () => new Date().toISOString();
  const antigo = new Date(Date.now() - 3600e3).toISOString();

  process.env.CAPTURADOR_INSTANCIA = 'D-90-001167'; delete process.env.CAPTURADOR_PRIORIDADE;
  let linhas = [{ instancia: 'nuvem', atualizado_em: agora(), iniciado_em: new Date(Date.now() + 1000).toISOString(), versao: 'bot_v3', detalhes: {} }];
  let L = criarLider({ sb: sbFalso(linhas), log: () => {} });
  assert.strictEqual(L.papel(), 'verificando'); assert.ok(!L.rlPode() && !L.obrasPode());
  await L.verificar();
  assert.strictEqual(L.papel(), 'reserva');
  assert.ok(!L.rlPode() && !L.obrasPode());
  console.log('ok 7 D90 com a nuvem no ar: fica em reserva (nem RL nem Obras), mesmo ligado antes');

  let assumiu = 0; L.aoAssumir(() => assumiu++);
  linhas[0].atualizado_em = antigo;                       // nuvem caiu (sem batimento há 1h)
  await L.verificar();
  assert.strictEqual(L.papel(), 'principal');
  assert.ok(L.obrasPode() && !L.rlPode(), 'Obras assume; RL continua parada ate reiniciar');
  assert.strictEqual(assumiu, 1);
  console.log('ok 8 nuvem caiu: D90 assume Obras e roda a varredura; RL fica parada (protege o SQLite)');

  process.env.CAPTURADOR_INSTANCIA = 'nuvem';
  linhas = [{ instancia: 'D-90-001167', atualizado_em: agora(), iniciado_em: antigo, versao: 'bot_v3', detalhes: { prioridade: 1 } }];
  L = criarLider({ sb: sbFalso(linhas), log: () => {} });
  await L.verificar();
  assert.strictEqual(L.papel(), 'principal'); assert.ok(L.rlPode() && L.obrasPode());
  console.log('ok 9 nuvem e sempre a principal, mesmo com o D90 ligado antes');

  linhas = [{ instancia: 'outra-nuvem', atualizado_em: agora(), iniciado_em: antigo, versao: 'bot_v3 (sombra)', detalhes: { prioridade: 99 } }];
  L = criarLider({ sb: sbFalso(linhas), log: () => {} });
  await L.verificar();
  assert.strictEqual(L.papel(), 'principal');
  console.log('ok 10 instancia em modo sombra nao conta');

  L = criarLider({ sb: sbFalso([{ instancia: 'nuvem2', atualizado_em: agora(), iniciado_em: antigo, versao: 'bot_v3', detalhes: { prioridade: 50 } }], { logado: false }), log: () => {} });
  await L.verificar();
  assert.strictEqual(L.papel(), 'verificando', 'sem login do robo nao decide (RLS devolveria lista vazia)');
  console.log('ok 11 sem login do robo nao conclui que esta sozinha');

  console.log('\nTODOS OS CENARIOS PASSARAM');
  global.setInterval = realSetInterval;
  process.exit(0);
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
