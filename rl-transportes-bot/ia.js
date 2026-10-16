/**
 * LEITURA COM IA — compartilhada pela RL (bot_v3.js) e por Obras (obras_bot.js). 16/10/2026.
 *
 * Por que existe: em 16/10/2026 a RL só tinha Gemini e o Gemini gratuito passou a aceitar só 20 leituras POR DIA por modelo
 * ("generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash"). Depois da 20ª o resto do dia ficava sem
 * leitura. E em Obras o Claude, ao dar um erro de crédito uma vez, ficava desligado até reiniciar o bot.
 *
 * Ordem: Claude (ANTHROPIC_API_KEY) → cada modelo Gemini da lista (GEMINI_MODELOS) → erro (quem chama marca para reler).
 *  - Claude sem crédito/chave recusada: pausa 30 min e tenta de novo sozinho (não fica desligado até reiniciar).
 *  - Gemini com cota DIÁRIA esgotada: aquele modelo fica de fora até a hora que o Google mandou voltar; passa para o próximo
 *    modelo na hora, sem esperar 20 s à toa. Limite POR MINUTO: espera o tempo pedido (até 60 s) e tenta 1 vez.
 */
'use strict';

const MODELO_CLAUDE = process.env.IA_MODELO_CLAUDE || process.env.OBRAS_MODELO_IA || 'claude-sonnet-5-5';
const MODELOS_GEMINI = (process.env.GEMINI_MODELOS || 'gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash')
  .split(',').map(s => s.trim()).filter(Boolean);
const PAUSA_CLAUDE_MS = 30 * 60 * 1000;

const espera = ms => new Promise(r => setTimeout(r, ms));
const limparJson = txt => {
  const t = String(txt || '').trim().replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  return JSON.parse(i >= 0 && j > i ? t.slice(i, j + 1) : t);
};
// "retryDelay":"41976s" ou "Please retry in 11h39m36s" → ms
function atrasoPedido(msg) {
  const s = String(msg || '');
  const m1 = s.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i);
  if (m1) return Math.ceil(parseFloat(m1[1]) * 1000);
  const m2 = s.match(/retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (m2 && (m2[1] || m2[2] || m2[3])) return ((+m2[1] || 0) * 3600 + (+m2[2] || 0) * 60 + (parseFloat(m2[3]) || 0)) * 1000;
  return null;
}
const ehCotaDiaria = msg => /PerDay|per day|daily/i.test(String(msg || '')) || (atrasoPedido(msg) || 0) > 10 * 60 * 1000;
const ehLimite = msg => /429|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(String(msg || ''));
const ehSobrecarga = msg => /503|529|overloaded|Service Unavailable|UNAVAILABLE/i.test(String(msg || ''));
const ehSemCreditoClaude = msg => /credit balance|billing|insufficient|401|403|authentication|invalid x-api-key|permission/i.test(String(msg || ''));

function criarIA({ log = () => {} } = {}) {
  let anthropic = null;
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const Anthropic = require('@anthropic-ai/sdk');
      anthropic = new (Anthropic.default || Anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
  } catch (e) { log(`IA: SDK da Anthropic indisponivel (${e.message})`, 'warn'); }

  let genAI = null;
  try {
    if (process.env.GEMINI_API_KEY) {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
  } catch (e) { log(`IA: SDK do Gemini indisponivel (${e.message})`, 'warn'); }

  let claudePausadoAte = 0, claudeMotivo = null;
  const geminiForaAte = {};          // modelo → timestamp até quando a cota diária está esgotada
  const modelosGemini = {};          // cache por modelo+maxTokens
  let ultimaFonte = null;

  function modeloGemini(nome, maxTokens) {
    const k = `${nome}|${maxTokens}`;
    if (!modelosGemini[k]) {
      const cfg = { responseMimeType: 'application/json', maxOutputTokens: maxTokens };
      if (/2\.5/.test(nome)) cfg.thinkingConfig = { thinkingBudget: 0 };
      modelosGemini[k] = genAI.getGenerativeModel({ model: nome, generationConfig: cfg });
    }
    return modelosGemini[k];
  }

  async function viaClaude(base64, mimetype, prompt, maxTokens) {
    const bloco = mimetype === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: /image\/(png|gif|webp)/.test(mimetype) ? mimetype : 'image/jpeg', data: base64 } };
    for (let t = 1; t <= 3; t++) {
      try {
        const r = await anthropic.messages.create({ model: MODELO_CLAUDE, max_tokens: maxTokens,
          messages: [{ role: 'user', content: [bloco, { type: 'text', text: prompt }] }] });
        return limparJson(r.content.filter(c => c.type === 'text').map(c => c.text).join(''));
      } catch (e) {
        const transitorio = (ehSobrecarga(e.message) || /429|rate_limit/i.test(e.message)) && !/credit/i.test(e.message);
        if (transitorio && t < 3) { await espera(15000 * t); continue; }
        throw e;
      }
    }
  }

  async function viaGemini(nome, base64, mimetype, prompt, maxTokens) {
    const mimeType = /image\/|application\/pdf/.test(mimetype) ? mimetype : 'image/jpeg';
    for (let t = 1; t <= 3; t++) {
      try {
        const r = await modeloGemini(nome, maxTokens).generateContent([{ inlineData: { mimeType, data: base64 } }, { text: prompt }]);
        return limparJson(r.response.text());
      } catch (e) {
        if (ehLimite(e.message) && ehCotaDiaria(e.message)) throw Object.assign(e, { cotaDiaria: true });
        if (ehLimite(e.message) && t < 2) { await espera(Math.min(atrasoPedido(e.message) || 20000, 60000)); continue; }
        if (ehSobrecarga(e.message) && t < 3) { await espera(5000 * t); continue; }
        throw e;
      }
    }
  }

  // Lê um documento (base64) e devolve o JSON pedido no prompt. Lança erro se nenhuma IA conseguiu.
  async function ler(base64, mimetype, prompt, { maxTokens = 4096 } = {}) {
    const falhas = [];
    if (anthropic && Date.now() >= claudePausadoAte) {
      try { const r = await viaClaude(base64, mimetype, prompt, Math.max(maxTokens, 2048)); ultimaFonte = 'claude'; claudeMotivo = null; return r; }
      catch (e) {
        if (ehSemCreditoClaude(e.message)) {
          claudePausadoAte = Date.now() + PAUSA_CLAUDE_MS; claudeMotivo = 'sem credito/chave recusada';
          log(`IA: Claude recusou (${e.message.substring(0, 140)}) — usando Gemini; tenta o Claude de novo em 30 min`, 'warn');
        } else log(`IA: Claude falhou (${e.message.substring(0, 140)}) — tentando Gemini`, 'warn');
        falhas.push(`claude: ${e.message.substring(0, 120)}`);
      }
    }
    if (genAI) {
      for (const nome of MODELOS_GEMINI) {
        if ((geminiForaAte[nome] || 0) > Date.now()) continue;
        try { const r = await viaGemini(nome, base64, mimetype, prompt, maxTokens); ultimaFonte = nome; return r; }
        catch (e) {
          if (e.cotaDiaria) {
            const volta = Date.now() + Math.max(atrasoPedido(e.message) || 0, 30 * 60 * 1000);
            geminiForaAte[nome] = volta;
            log(`IA: cota diaria do ${nome} esgotada — volta ${new Date(volta).toLocaleString('pt-BR')}; tentando o proximo modelo`, 'warn');
          } else if (/not found|404|not supported/i.test(e.message)) {
            geminiForaAte[nome] = Date.now() + 24 * 3600e3;
            log(`IA: modelo ${nome} indisponivel nesta chave — ignorado por 24h`, 'warn');
          } else log(`IA: ${nome} falhou (${e.message.substring(0, 140)})`, 'warn');
          falhas.push(`${nome}: ${e.message.substring(0, 120)}`);
        }
      }
    }
    if (!anthropic && !genAI) throw new Error('nenhuma IA configurada (ANTHROPIC_API_KEY / GEMINI_API_KEY ausentes)');
    const err = new Error(`nenhuma IA disponivel agora — ${falhas.join(' | ') || 'todas em pausa por limite/credito'}`);
    err.semIA = true;
    throw err;
  }

  // Texto curto para o painel de saúde (capturador_status.ia)
  function estado() {
    const agora = Date.now(), partes = [];
    if (anthropic) partes.push(agora < claudePausadoAte ? `claude PAUSADO (${claudeMotivo}) ate ${new Date(claudePausadoAte).toLocaleTimeString('pt-BR')}` : `claude ${MODELO_CLAUDE}`);
    if (genAI) {
      const livres = MODELOS_GEMINI.filter(m => (geminiForaAte[m] || 0) <= agora);
      partes.push(livres.length ? `gemini (${livres.join(', ')})` : 'gemini COTA ESGOTADA');
    }
    return partes.join(' + ') || 'nenhuma';
  }
  const disponivel = () => !!(anthropic || genAI);
  const temAgora = () => (anthropic && Date.now() >= claudePausadoAte) || (genAI && MODELOS_GEMINI.some(m => (geminiForaAte[m] || 0) <= Date.now()));
  // A pausa entre leituras em lote só é necessária no Gemini gratuito (limite por minuto)
  const pausaEntreLeituras = () => (anthropic && Date.now() >= claudePausadoAte) ? 1500 : 13000;

  log(`IA: ${estado()}`);
  return { ler, estado, disponivel, temAgora, pausaEntreLeituras, ultimaFonte: () => ultimaFonte, MODELO_CLAUDE };
}

module.exports = criarIA;
module.exports._interno = { atrasoPedido, ehCotaDiaria, limparJson };
