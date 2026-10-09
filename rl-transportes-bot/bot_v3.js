/**
 * RL TRANSPORTES — Bot IA Financeiro v3 (SQLite local)
 * WhatsApp → Claude Vision → SQLite → Painel HTML
 * Sem Supabase · Dados salvos localmente · Zero custo de nuvem
 */

'use strict';
require('dotenv').config();

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode    = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Database  = require('better-sqlite3');
const puppeteer = require('puppeteer');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ─── SUPABASE (cópia durável, mesmo projeto usado pelo Portal/RH/Inventário) ────
// SQLite continua sendo a fonte principal do bot — se o Supabase cair ou as
// tabelas rl_* ainda não existirem, o bot segue funcionando 100% normal. O
// Supabase só existe pra dar visão consolidada no portal e sobreviver a uma
// reinstalação/troca de máquina do bot.
const sb = (process.env.SUPABASE_URL && process.env.SUPABASE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;
// Desde 19/09/2026 as tabelas rl_* nao aceitam mais a chave publica sozinha: o bot entra com a conta de robo
// `robo-rl` (so enxerga rl_*). Login/senha em SUPABASE_ROBO_EMAIL / SUPABASE_ROBO_SENHA no .env. O supabase-js renova o token sozinho.
if (sb && process.env.SUPABASE_ROBO_EMAIL && process.env.SUPABASE_ROBO_SENHA) {
  sb.auth.signInWithPassword({ email: process.env.SUPABASE_ROBO_EMAIL, password: process.env.SUPABASE_ROBO_SENHA })
    .then(({ error }) => { if (error) console.warn('Supabase: login do robo falhou:', error.message); else console.log('Supabase: robo-rl autenticado'); })
    .catch(e => console.warn('Supabase: login do robo falhou:', e.message));
} else if (sb) {
  console.warn('Supabase: SUPABASE_ROBO_EMAIL/SENHA ausentes no .env — a copia para o Supabase vai falhar (o SQLite segue normal).');
}
function sbSync(promise, label) {
  if (!sb) return;
  Promise.resolve(promise).then(({ error }) => {
    if (error) log(`Supabase sync falhou (${label}): ${error.message}`, 'warn');
  }).catch(e => log(`Supabase sync falhou (${label}): ${e.message}`, 'warn'));
}
// Ressincronização completa (usada depois de /api/restaurar, que reescreve o SQLite
// inteiro de uma vez — mais simples e seguro espelhar tudo de novo do que tentar
// acompanhar linha a linha uma operação de restauração de backup).
async function sbFullResync() {
  if (!sb) return;
  try {
    const deps = db.prepare('SELECT * FROM depositos').all();
    const desps = db.prepare('SELECT * FROM despesas').all();
    await sb.from('rl_despesas').delete().neq('id', -1);
    await sb.from('rl_depositos').delete().neq('id', -1);
    if (deps.length) await sb.from('rl_depositos').insert(deps.map(d => ({ ...d, ocr_json: d.ocr_json ? JSON.parse(d.ocr_json) : null })));
    if (desps.length) await sb.from('rl_despesas').insert(desps.map(d => ({ ...d, ocr_json: d.ocr_json ? JSON.parse(d.ocr_json) : null })));
    log(`Supabase ressincronizado: ${deps.length} depósitos, ${desps.length} despesas`);
  } catch (e) { log(`Ressincronização Supabase falhou: ${e.message}`, 'warn'); }
}

// ─── CONFIG ────────────────────────────────────────────────────
const GRUPO_ALVO    = process.env.GRUPO_NOME || 'RL TRANSPORTES';
const PORTA         = parseInt(process.env.PORT || '3456');
const PASTA_FOTOS   = path.join(__dirname, 'fotos');
const DB_PATH       = path.join(__dirname, 'rl_transportes.db');
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

if (!fs.existsSync(PASTA_FOTOS)) fs.mkdirSync(PASTA_FOTOS, { recursive: true });

// ─── BANCO SQLite ───────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS depositos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  data           TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  data_documento TEXT,
  hora_documento TEXT,
  valor          REAL    NOT NULL DEFAULT 0,
  remetente      TEXT    DEFAULT 'Paulo',
  banco          TEXT,
  pix            TEXT,
  descricao      TEXT,
  arquivo        TEXT,
  arquivo_hash   TEXT,
  ocr_json       TEXT,
  saldo_restante REAL    DEFAULT 0,
  status         TEXT    DEFAULT 'ativo',
  created_at     TEXT    DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS despesas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  deposito_id  INTEGER REFERENCES depositos(id) ON DELETE SET NULL,
  data         TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  data_documento TEXT,
  hora_documento TEXT,
  valor        REAL,
  remetente    TEXT    DEFAULT 'Bruna',
  fornecedor   TEXT,
  servico      TEXT,
  placa        TEXT,
  nf           TEXT,
  cnpj         TEXT,
  banco        TEXT,
  pix          TEXT,
  tipo_doc     TEXT    DEFAULT 'outros',
  descricao    TEXT,
  arquivo      TEXT,
  arquivo_hash TEXT,
  ocr_json     TEXT,
  status       TEXT    DEFAULT 'confirmado',
  confianca    REAL,
  created_at   TEXT    DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fornecedores (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nome              TEXT UNIQUE NOT NULL,
  aliases           TEXT DEFAULT '[]',
  servicos          TEXT DEFAULT '[]',
  total_gasto       REAL DEFAULT 0,
  total_ocorrencias INTEGER DEFAULT 0,
  updated_at        TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS logs (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT DEFAULT (datetime('now','localtime')),
  evento TEXT NOT NULL,
  nivel  TEXT DEFAULT 'info',
  dados  TEXT
);

-- Ajuste manual de saldo: correcao pontual (positiva ou negativa) fora do fluxo
-- normal de despesas/depositos, para acertar diferencas encontradas manualmente
-- (ex: conferencia contra comprovantes fisicos/scans).
CREATE TABLE IF NOT EXISTS ajustes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  data       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  valor      REAL    NOT NULL,
  descricao  TEXT,
  created_at TEXT    DEFAULT (datetime('now','localtime'))
);

-- Saldo inicial: ancora fixa de uma conciliacao (ex: conferencia manual de comprovantes).
-- A partir da data desta ancora, o saldo disponivel vira extrato: inicial + entradas -
-- saidas ocorridas DEPOIS dessa data (nao soma o historico inteiro de novo). Linha unica.
CREATE TABLE IF NOT EXISTS saldo_inicial (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  valor      REAL NOT NULL,
  data       TEXT NOT NULL,
  descricao  TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_despesas_deposito   ON despesas(deposito_id);
CREATE INDEX IF NOT EXISTS idx_despesas_data       ON despesas(data DESC);
CREATE INDEX IF NOT EXISTS idx_despesas_fornecedor ON despesas(fornecedor);
CREATE INDEX IF NOT EXISTS idx_despesas_placa      ON despesas(placa);
CREATE INDEX IF NOT EXISTS idx_despesas_nf         ON despesas(nf);
CREATE INDEX IF NOT EXISTS idx_depositos_data      ON depositos(data DESC);
CREATE INDEX IF NOT EXISTS idx_logs_ts             ON logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_ajustes_data        ON ajustes(data DESC);
`);

// Migracao: bancos criados antes da coluna arquivo_hash existir
try { db.exec(`ALTER TABLE despesas ADD COLUMN arquivo_hash TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE depositos ADD COLUMN arquivo_hash TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE despesas ADD COLUMN data_documento TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE depositos ADD COLUMN data_documento TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE despesas ADD COLUMN hora_documento TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE depositos ADD COLUMN hora_documento TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE despesas ADD COLUMN autenticacao TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE depositos ADD COLUMN autenticacao TEXT`); } catch(e) {}
db.exec(`CREATE INDEX IF NOT EXISTS idx_despesas_hash ON despesas(arquivo_hash)`);

function hashArquivo(nomeArquivo) {
  if (!nomeArquivo) return null;
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(PASTA_FOTOS, nomeArquivo))).digest('hex'); }
  catch(e) { return null; }
}

// Backfill: preenche arquivo_hash de registros gravados antes dessa coluna existir
(function backfillHashes() {
  const updDesp = db.prepare(`UPDATE despesas SET arquivo_hash=? WHERE id=?`);
  const updDep  = db.prepare(`UPDATE depositos SET arquivo_hash=? WHERE id=?`);
  const pendDesp = db.prepare(`SELECT id,arquivo FROM despesas WHERE arquivo_hash IS NULL AND arquivo IS NOT NULL`).all();
  const pendDep  = db.prepare(`SELECT id,arquivo FROM depositos WHERE arquivo_hash IS NULL AND arquivo IS NOT NULL`).all();
  pendDesp.forEach(r => { const h = hashArquivo(r.arquivo); if (h) updDesp.run(h, r.id); });
  pendDep.forEach(r => { const h = hashArquivo(r.arquivo); if (h) updDep.run(h, r.id); });
  if (pendDesp.length || pendDep.length) log(`Backfill de hash: ${pendDesp.length} despesas + ${pendDep.length} depositos`);
})();

// Backfill: extrai a data real do comprovante (ocr_json.data) para registros gravados antes dessa coluna existir
function extrairDataDocumento(ocrJson) {
  if (!ocrJson) return null;
  try {
    const j = JSON.parse(ocrJson);
    if (j?.data && /^\d{4}-\d{2}-\d{2}/.test(j.data)) return j.data.substring(0,10);
  } catch(e) {}
  return null;
}
function extrairHoraDocumento(ocrJson) {
  if (!ocrJson) return null;
  try {
    const j = JSON.parse(ocrJson);
    // Preserva os segundos quando a IA os retornar (HH:MM:SS) — truncar pra HH:MM
    // fazia 2 pagamentos DIFERENTES no mesmo minuto (comum em guias GNRE em sequencia,
    // ex: 14:29:12 e 14:29:47) serem tratados como duplicata um do outro.
    const m = j?.hora && /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(j.hora);
    if (m) return `${m[1].padStart(2,'0')}:${m[2]}${m[3] ? ':'+m[3] : ''}`;
  } catch(e) {}
  return null;
}
(function backfillDataDocumento() {
  const updDesp = db.prepare(`UPDATE despesas SET data_documento=?,hora_documento=? WHERE id=?`);
  const updDep  = db.prepare(`UPDATE depositos SET data_documento=?,hora_documento=? WHERE id=?`);
  const pendDesp = db.prepare(`SELECT id,ocr_json FROM despesas WHERE data_documento IS NULL AND ocr_json IS NOT NULL`).all();
  const pendDep  = db.prepare(`SELECT id,ocr_json FROM depositos WHERE data_documento IS NULL AND ocr_json IS NOT NULL`).all();
  let c1=0, c2=0;
  pendDesp.forEach(r => { const d = extrairDataDocumento(r.ocr_json); if (d) { updDesp.run(d, extrairHoraDocumento(r.ocr_json), r.id); c1++; } });
  pendDep.forEach(r => { const d = extrairDataDocumento(r.ocr_json); if (d) { updDep.run(d, extrairHoraDocumento(r.ocr_json), r.id); c2++; } });
  if (c1 || c2) log(`Backfill de data do comprovante: ${c1} despesas + ${c2} depositos`);
})();

// Backfill: despesas (ex: PIX da Bruna) sem placa, mas com a placa escrita na descricao
(function backfillPlacaDaDescricao() {
  const upd  = db.prepare(`UPDATE despesas SET placa=? WHERE id=?`);
  const pend = db.prepare(`SELECT id,descricao FROM despesas WHERE (placa IS NULL OR placa='') AND descricao IS NOT NULL`).all();
  let c = 0;
  pend.forEach(r => { const p = extrairPlacaDeTexto(r.descricao); if (p) { upd.run(p, r.id); c++; } });
  if (c) log(`Backfill de placa extraida da descricao: ${c} despesas`);
})();

// Fornecedores iniciais
const seedForn = [
  { nome: 'Aquarius',               aliases: ['Aquarius Mecanica'],                servicos: ['Troca de oleo','Correia dentada','Filtros'] },
  { nome: 'NEM Pneus',              aliases: ['NEM','Nem Pneus'],                  servicos: ['Servico de pneu','Montagem','Balanceamento'] },
  { nome: 'Figueira Pneus',         aliases: ['Figueira','Figueira Com e Serv'],   servicos: ['Venda de pneu','Reforma pneu'] },
  { nome: 'Casa do Mercedes',       aliases: ['Casa Mercedes'],                    servicos: ['Pecas','Faixa','Lanternas','Retrovisor'] },
  { nome: 'Borracharia Pai e Filho', aliases: ['Pai e Filho','Borracharia 24h'],   servicos: ['Borracharia','Conserto','Montagem'] },
  { nome: 'Atacadao',               aliases: ['Atacadao'],                         servicos: ['Compras gerais','Material limpeza'] },
  { nome: 'Jaquie e Exata Contabilidade', aliases: ['Jaquie','Exata'],            servicos: ['Contabilidade','Honorarios'] }
];
const stmtSeedForn = db.prepare(`INSERT OR IGNORE INTO fornecedores (nome, aliases, servicos) VALUES (?,?,?)`);
seedForn.forEach(f => stmtSeedForn.run(f.nome, JSON.stringify(f.aliases), JSON.stringify(f.servicos)));

// ─── LOGGER ─────────────────────────────────────────────────────
const stmtInsertLog = db.prepare(`INSERT INTO logs (evento, nivel, dados) VALUES (?,?,?)`);
function log(evento, nivel = 'info', dados = null) {
  const ts = new Date().toLocaleTimeString('pt-BR');
  const icon = nivel === 'error' ? 'ERR' : nivel === 'warn' ? 'AVS' : 'OK ';
  console.log(`[${ts}] [${icon}] ${evento}`);
  try { stmtInsertLog.run(evento.substring(0,500), nivel, dados ? JSON.stringify(dados).substring(0,2000) : null); } catch {}
}

// ─── IA GEMINI (GRATUITO) ─────────────────────────────────────────
const ai = GEMINI_KEY ? new GoogleGenerativeAI(GEMINI_KEY) : null;

const PROMPT_IA = `Voce e um sistema de extracao de dados financeiros de documentos de transportadora.
Analise a imagem/documento e extraia as informacoes.

IMPORTANTE - tipo_doc:
- "orcamento": se o documento for orcamento, cotacao, proposta, previsao de custo (NAO e pagamento real)
- "nf": nota fiscal de produto
- "nfs": nota fiscal de servico
- "os": ordem de servico
- "comprovante_pix": comprovante de pagamento PIX
- "comprovante_ted": comprovante TED/DOC
- "comprovante_boleto": comprovante de pagamento de boleto/guia (GNRE, DAS, boleto bancario, etc.) — documento mostra "pagamento realizado", "pago", protocolo de pagamento ou confirmacao do banco, MAS NAO e PIX nem TED
- "recibo": recibo de pagamento generico, sem confirmacao clara de que o dinheiro ja saiu da conta
- "outros": demais documentos
Se for ORCAMENTO ou COTACAO: defina tipo_doc="orcamento" e is_orcamento=true.

Regras:
- placa: formato "XXX-0000" ou "XXX0X00" (Mercosul). Exemplo: FFO9A45 -> FFO-9A45
- valor: valor principal do documento (decimal, sem simbolo R$)
- data: formato YYYY-MM-DD. Se nao visivel, use a data de hoje
- hora: horario da transacao no formato HH:MM:SS (24h) SEMPRE que o documento mostrar os segundos — NAO trunque, os segundos sao essenciais pra distinguir pagamentos diferentes feitos no mesmo minuto (ex: "24/06/2026 01:38:15" -> hora="01:38:15", NUNCA "01:38"). Se o documento so mostrar HH:MM (sem segundos), use hora="HH:MM". Se nao houver horario visivel, retorne null — NUNCA invente um horario nem invente segundos
- cnpj: formato 00.000.000/0000-00
- confianca: 0.0 a 1.0
- Para comprovante_pix, comprovante_ted ou recibo: fornecedor = nome de quem RECEBEU o pagamento (campo "Para" / "Beneficiario" / "Favorecido"); descricao = motivo do pagamento se houver, senao repita o nome do destinatario
- servico: se o campo "Descricao"/"Mensagem"/"Motivo" do comprovante mencionar o que foi pago (ex: "limpeza de bau", "diaria", "abastecimento", "pedagio", "manutencao", "frete"), copie esse texto literalmente para servico. Se junto com o motivo tambem aparecer uma placa (ex: "diaria QPJ8A65"), coloque a placa SOMENTE no campo placa (formato correto), mas mantenha o motivo (sem a placa) em servico. Se o campo descricao nao mencionar nenhum servico/motivo (so o nome do beneficiario, por exemplo), deixe servico=null
- autenticacao: codigo de autenticacao/autorizacao/protocolo do comprovante, se houver (ex: campo "Autenticacao" de bancos como Cora/Itau/Bradesco, ID da transacao, codigo de autorizacao). Copie o codigo exatamente como aparece. Se nao houver esse campo no documento, retorne null — NUNCA invente

Retorne SOMENTE o JSON, sem markdown, sem explicacao:
{"valor":null,"data":"YYYY-MM-DD","hora":null,"fornecedor":null,"servico":null,"placa":null,"nf":null,"cnpj":null,"banco":null,"pix":null,"tipo_doc":"outros","descricao":null,"confianca":0.5,"is_orcamento":false,"autenticacao":null}`;

const geminiModel = ai ? ai.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } } }) : null;

// Free tier do Gemini = 5 requisicoes/minuto. Em rajada (upload em lote) isso estoura,
// entao tentamos 1x, e se vier 429/quota, esperamos e tentamos de novo antes de desistir.
// Leitor LOCAL de PDF (leitor_pdf.py, sem IA e sem custo). Le o texto dos comprovantes do
// Cora (PIX e boleto/guia) - a grande maioria do que a Bruna envia. Usado ANTES da IA para
// PDFs: poupa a cota gratuita do Gemini (5 req/min), que em 01/10/2026 acabou no meio de
// uma importacao e deixou 39 despesas zeradas.
function lerPdfLocal(mediaData) {
  const tmp = path.join(require('os').tmpdir(), `rl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.pdf`);
  try {
    fs.writeFileSync(tmp, Buffer.from(mediaData, 'base64'));
    const out = require('child_process').execFileSync('python', [path.join(__dirname, 'leitor_pdf.py'), tmp],
      { timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
    return out ? JSON.parse(out) : null;
  } catch(e) { return null; }  // codigo 1 = documento nao reconhecido -> segue para a IA
  finally { try { fs.unlinkSync(tmp); } catch(e) {} }
}

async function extrairComIA(mediaData, mimetype) {
  if (mimetype === 'application/pdf') {
    const local = lerPdfLocal(mediaData);
    if (local && local.valor > 0) { log(`Leitor local de PDF: R$ ${local.valor} — ${local.fornecedor} (sem usar IA)`); return local; }
  }
  if (!geminiModel) throw new Error('GEMINI_API_KEY nao configurada');
  const mimeType = (mimetype && (mimetype.startsWith('image/') || mimetype === 'application/pdf')) ? mimetype : 'image/jpeg';
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const result = await geminiModel.generateContent([
        { inlineData: { mimeType, data: mediaData } },
        { text: PROMPT_IA }
      ]);
      const txt = result.response.text().trim().replace(/^```json?\s*/i,'').replace(/\s*```$/,'');
      return JSON.parse(txt);
    } catch (e) {
      const rateLimited = /429|quota|RESOURCE_EXHAUSTED/i.test(e.message);
      const overloaded   = /503|Service Unavailable|overloaded/i.test(e.message);
      if ((rateLimited || overloaded) && tentativa < 3) {
        const espera = rateLimited ? 20000 : 5000 * tentativa;
        log(`Gemini: ${rateLimited ? 'limite de requisicoes' : 'servidor sobrecarregado (503)'} — aguardando ${espera/1000}s e tentando de novo...`, 'warn');
        await new Promise(r => setTimeout(r, espera));
        continue;
      }
      throw e;
    }
  }
}

// ─── INFERIR SERVICO PELO FORNECEDOR ───────────────────────────
// Comprovante PIX simples (a maioria dos bancos) so mostra nome do beneficiario,
// banco e valor — nao tem campo de "motivo da compra", entao a IA retorna servico=null.
// Quando isso acontece, deduz uma categoria pelo proprio nome do fornecedor (ex:
// "REDIESEL...AUTODIESEL" -> Abastecimento), so pra dar uma referencia rapida na tela.
const PALAVRAS_SERVICO = [
  [/diesel|combust[ií]vel|posto\b|gasolina/i, 'Abastecimento'],
  [/pneu|borrachar/i, 'Pneus'],
  [/mec[aâ]nic|oficina|auto\s*center/i, 'Manutenção'],
  [/pe[cç]as/i, 'Peças'],
  [/segur(o|adora)/i, 'Seguro'],
  [/ped[aá]gio|sem\s*parar|conectcar/i, 'Pedágio'],
  [/contabil|contador/i, 'Contabilidade'],
  [/restaurante|lanchonete|churrascaria|refei[cç][aã]o/i, 'Alimentação'],
  [/uber|99\s*tecnologia|mobilidade/i, 'Transporte/App'],
];
function inferirServicoPorFornecedor(fornecedor) {
  if (!fornecedor) return null;
  for (const [re, categoria] of PALAVRAS_SERVICO) {
    if (re.test(fornecedor)) return categoria;
  }
  return null;
}

// ─── VALOR PARSER ───────────────────────────────────────────────
// Gemini as vezes manda o valor como texto e, raramente, no formato BR (virgula
// decimal, ex: "555,48"). Number() sozinho falha nesse caso e vira NaN -> 0,
// mas se cair como string crua no banco, corrompe qualquer soma (concatena texto).
function parseValor(v) {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim();
  if (s.includes(',')) s = s.replace(/\./g,'').replace(',','.'); // formato BR: 1.234,56 -> 1234.56
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

// ─── REGRA: SO CONTA COMO DESPESA REAL PAGAMENTO CONFIRMADO (PIX/TED/BOLETO) ──
// NF, OS, recibo generico, orcamento e "outros" ficam salvos e visiveis na lista,
// mas nao entram nos totais financeiros nem consomem saldo de deposito.
// comprovante_boleto cobre guias/boletos pagos (GNRE, DAS, etc.) que mostram
// "pagamento realizado" mas nao sao PIX nem TED.
function ehDespesaReal(tipoDoc) {
  return tipoDoc === 'comprovante_pix' || tipoDoc === 'comprovante_ted' || tipoDoc === 'comprovante_boleto';
}

// ─── REMETENTES QUE SO ENTRAM COMO RECEITA (DEPOSITO), NUNCA DESPESA ──
// Paulo e Rafael (RH): tudo que eles mandam e receita/deposito, mesmo que seja uma foto.
function ehRemetenteReceita(nome) {
  const n = (nome || '').toLowerCase();
  return n.includes('paulo') || n.includes('rafael');
}

// Qualquer comprovante (PIX/TED/boleto) em que o BENEFICIARIO (campo "fornecedor" — quem
// recebeu o pagamento) e a propria RL Nordeste/RL Transportes e dinheiro ENTRANDO na empresa,
// mesmo que a Bruna (ou qualquer um que nao seja Paulo/Rafael) seja quem encaminhou a foto
// no WhatsApp. Nesse caso o lancamento e um DEPOSITO, nao uma despesa — quem mandou a foto
// so avisou, nao foi quem recebeu o dinheiro.
const NOME_PROPRIO_EMPRESA_REGEX = /\bRL\s*NORDESTE\b/i;
function ehBeneficiarioProprioEmpresa(fornecedor) {
  return !!(fornecedor && NOME_PROPRIO_EMPRESA_REGEX.test(fornecedor));
}

// ─── PLACA FORMATTER ────────────────────────────────────────────
function formatarPlaca(p) {
  if (!p) return null;
  const s = p.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if (s.length === 7) return s.slice(0,3) + '-' + s.slice(3);
  return p;
}

// Bruna manda comprovante PIX (que raramente tem a placa impressa) e escreve a placa
// na legenda da foto ou na descricao do pagamento. Extrai o padrao de placa (antiga ou
// Mercosul) de qualquer texto livre, para usar quando a IA nao achou placa no documento.
function extrairPlacaDeTexto(texto) {
  if (!texto) return null;
  const m = String(texto).toUpperCase().match(/\b([A-Z]{3})[-\s]?(\d[A-Z]\d{2}|\d{4})\b/);
  if (!m) return null;
  return formatarPlaca(m[1] + m[2]);
}

// ─── CONCILIACAO FIFO ───────────────────────────────────────────
const stmtDepAtivo   = db.prepare(`SELECT * FROM depositos WHERE status='ativo' AND saldo_restante>0 ORDER BY data ASC LIMIT 1`);
const stmtUpdSaldo   = db.prepare(`UPDATE depositos SET saldo_restante=MAX(0,saldo_restante-?), status=CASE WHEN saldo_restante-?<=0 THEN 'esgotado' ELSE 'ativo' END WHERE id=?`);
const stmtInsDep     = db.prepare(`INSERT INTO depositos (valor,remetente,banco,pix,descricao,arquivo,arquivo_hash,ocr_json,saldo_restante,data_documento,hora_documento,autenticacao) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
const stmtInsDesp    = db.prepare(`INSERT INTO despesas (deposito_id,valor,remetente,fornecedor,servico,placa,nf,cnpj,banco,pix,tipo_doc,descricao,arquivo,arquivo_hash,ocr_json,confianca,data_documento,hora_documento,autenticacao) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const stmtUpdForn    = db.prepare(`INSERT INTO fornecedores (nome,total_gasto,total_ocorrencias) VALUES (?,?,1) ON CONFLICT(nome) DO UPDATE SET total_gasto=total_gasto+?,total_ocorrencias=total_ocorrencias+1,updated_at=datetime('now','localtime')`);

function criarDeposito(dadosIA, remetente, arquivo) {
  const valor = parseValor(dadosIA?.valor);
  const dataDoc = extrairDataDocumento(JSON.stringify(dadosIA));
  const horaDoc = extrairHoraDocumento(JSON.stringify(dadosIA));
  const arqHash = hashArquivo(arquivo);
  const { lastInsertRowid: id } = stmtInsDep.run(valor, remetente, dadosIA?.banco||null, dadosIA?.pix||null, dadosIA?.descricao||'Deposito via WhatsApp', arquivo, arqHash, JSON.stringify(dadosIA), valor, dataDoc, horaDoc, dadosIA?.autenticacao||null);
  log(`DEPOSITO #${id} criado — R$ ${valor.toFixed(2)} — ${remetente}`);
  if (sb) sbSync(sb.from('rl_depositos').insert({
    id, valor, remetente, banco: dadosIA?.banco||null, pix: dadosIA?.pix||null,
    descricao: dadosIA?.descricao||'Deposito via WhatsApp', arquivo, arquivo_hash: arqHash,
    ocr_json: dadosIA||null, saldo_restante: valor, status: 'ativo',
    data_documento: dataDoc, hora_documento: horaDoc, autenticacao: dadosIA?.autenticacao||null
  }), `deposito #${id}`);
  return id;
}

// Segunda trava contra duplicata, alem do hash do arquivo: mesmo fornecedor + valor +
// data + hora do comprovante e praticamente certeza de ser o mesmo pagamento (o hash do
// arquivo pode falhar em pegar isso se o arquivo foi salvo com nome colidido no passado,
// reprocessado de fontes diferentes, etc). So aplica quando a hora e conhecida (comprovante
// PIX/TED normalmente mostra horario exato) — sem hora seria arriscado demais (dois
// pagamentos iguais no mesmo dia sao possiveis).
const stmtDespesaEquivalente = db.prepare(`SELECT id FROM despesas WHERE fornecedor=? AND valor=? AND COALESCE(data_documento,substr(data,1,10))=? AND hora_documento=? AND status!='cancelado' LIMIT 1`);
function criarDespesa(dadosIA, remetente, arquivo) {
  const isOrcamento = !!(dadosIA?.is_orcamento || dadosIA?.tipo_doc === 'orcamento');
  const contaComoDespesa = ehDespesaReal(dadosIA?.tipo_doc) && !isOrcamento;
  const valor    = parseValor(dadosIA?.valor);
  const dataDoc  = extrairDataDocumento(JSON.stringify(dadosIA));
  const horaDoc  = extrairHoraDocumento(JSON.stringify(dadosIA));

  if (dadosIA?.fornecedor && valor && dataDoc && horaDoc) {
    const equivalente = stmtDespesaEquivalente.get(dadosIA.fornecedor, valor, dataDoc, horaDoc);
    if (equivalente) {
      log(`Despesa equivalente ja existe (#${equivalente.id} — mesmo fornecedor/valor/data/hora) — ignorando duplicata`, 'warn');
      if (arquivo) { try { fs.unlinkSync(path.join(PASTA_FOTOS, arquivo)); } catch(e) {} }
      return equivalente.id;
    }
  }

  const deposito = contaComoDespesa ? stmtDepAtivo.get() : null;
  const placa    = formatarPlaca(dadosIA?.placa);
  let   depId    = null;

  if (!contaComoDespesa) {
    log(`${dadosIA?.tipo_doc||'documento'} nao e comprovante bancario — nao consome saldo de deposito nem conta como gasto real`, 'warn');
  } else if (deposito) {
    depId = deposito.id;
    stmtUpdSaldo.run(valor, valor, deposito.id);
    const novoSaldo = Math.max(0, deposito.saldo_restante - valor);
    log(`Despesa vinculada ao deposito #${deposito.id} (saldo: R$ ${novoSaldo.toFixed(2)})`);
    if (sb) sbSync(sb.from('rl_depositos').update({ saldo_restante: novoSaldo, status: novoSaldo <= 0 ? 'esgotado' : 'ativo' }).eq('id', deposito.id), `saldo deposito #${deposito.id}`);
  } else {
    log('Despesa sem deposito ativo — registrada sem vinculo', 'warn');
  }

  const servico = dadosIA?.servico || inferirServicoPorFornecedor(dadosIA?.fornecedor);
  const arqHashDesp = hashArquivo(arquivo);
  const { lastInsertRowid: id } = stmtInsDesp.run(depId, valor, remetente, dadosIA?.fornecedor||null, servico||null, placa, dadosIA?.nf||null, dadosIA?.cnpj||null, dadosIA?.banco||null, dadosIA?.pix||null, dadosIA?.tipo_doc||'outros', dadosIA?.descricao||null, arquivo, arqHashDesp, JSON.stringify(dadosIA), dadosIA?.confianca||null, dataDoc, horaDoc, dadosIA?.autenticacao||null);
  if (dadosIA?.fornecedor && contaComoDespesa) stmtUpdForn.run(dadosIA.fornecedor, valor, valor);
  log(`DESPESA #${id} criada — R$ ${valor.toFixed(2)} — ${dadosIA?.fornecedor||'fornecedor desconhecido'}`);
  if (sb) {
    sbSync(sb.from('rl_despesas').insert({
      id, deposito_id: depId, valor, remetente, fornecedor: dadosIA?.fornecedor||null, servico: servico||null,
      placa, nf: dadosIA?.nf||null, cnpj: dadosIA?.cnpj||null, banco: dadosIA?.banco||null, pix: dadosIA?.pix||null,
      tipo_doc: dadosIA?.tipo_doc||'outros', descricao: dadosIA?.descricao||null, arquivo, arquivo_hash: arqHashDesp,
      ocr_json: dadosIA||null, confianca: dadosIA?.confianca||null, status: 'confirmado',
      data_documento: dataDoc, hora_documento: horaDoc, autenticacao: dadosIA?.autenticacao||null
    }), `despesa #${id}`);
    if (dadosIA?.fornecedor && contaComoDespesa) {
      sbSync(sb.rpc('rl_upsert_fornecedor', { p_nome: dadosIA.fornecedor, p_valor: valor }), `fornecedor ${dadosIA.fornecedor}`);
    }
  }
  return id;
}

// ─── PROCESSAR MIDIA ────────────────────────────────────────────
// Trava em memoria por hash de arquivo: quando o bot reconecta, o WhatsApp pode entregar
// a mesma mensagem atrasada tanto pro listener 'message' ao vivo quanto pela busca manual
// de mensagens perdidas, quase ao mesmo tempo. Sem isso as duas rodam em paralelo, nenhuma
// ve o INSERT da outra a tempo, e a checagem de duplicidade por hash no banco nao pega.
const hashesEmProcessamento = new Set();
// Trava por mensagem (prefixo deterministico do nome do arquivo). A trava por hash sozinha
// nao bastava: quando a mesma mensagem chegava 2x em paralelo (rescan + listener ao vivo),
// a 2a chamada caia em "hash em processamento" e dava unlink no arquivo que a 1a ainda
// estava usando -> despesa gravada sem arquivo_hash -> no proximo rescan o arquivo era
// baixado de novo e virava despesa DUPLICADA (caso #1156/#1157 de 28/09/2026).
const msgsEmProcessamento = new Set();
function prefixoArquivoMsg(msg) {
  if (!msg?.timestamp || !msg?.id?.id) return null;
  const idMsg = msg.id.id.replace(/[^A-Za-z0-9]/g,'').substring(0,12);
  return `WA_${msg.timestamp * 1000}_${idMsg}_`;
}
const stmtDespPorPrefixo = db.prepare(`SELECT id FROM despesas WHERE arquivo LIKE ? LIMIT 1`);
const stmtDepPorPrefixo  = db.prepare(`SELECT id FROM depositos WHERE arquivo LIKE ? LIMIT 1`);
function mensagemJaLancada(msg) {
  const pref = prefixoArquivoMsg(msg);
  if (!pref) return false;
  return !!(stmtDespPorPrefixo.get(pref + '%') || stmtDepPorPrefixo.get(pref + '%'));
}

async function processarMidia(msg, nomeRemetente) {
  // Sai ANTES de baixar a midia se essa mensagem ja virou lancamento (rescan barato:
  // nao gasta download nem IA com as centenas de mensagens antigas ja processadas).
  if (mensagemJaLancada(msg)) return 'ja_lancada';
  const prefMsg = prefixoArquivoMsg(msg);
  if (prefMsg) {
    if (msgsEmProcessamento.has(prefMsg)) { log(`Mensagem ${prefMsg} ja em processamento neste instante — ignorando chamada concorrente`, 'warn'); return 'concorrente'; }
    msgsEmProcessamento.add(prefMsg);
  }
  try { return await processarMidiaInterno(msg, nomeRemetente); }
  finally { if (prefMsg) msgsEmProcessamento.delete(prefMsg); }
}

// Download alternativo, direto na pagina do WhatsApp Web, para quando msg.downloadMedia()
// da lib falha. BUG REAL (01-06/10/2026): os depositos do Paulo (02/10) e do Rafael (05/10 e
// 06/10) davam "Erro baixar midia: t" (erro minificado do WA Web) em toda varredura, enquanto
// os PDFs da Bruna baixavam normal. Como o retry era sempre pelo mesmo caminho, esses
// depositos nunca entravam. Aqui: (1) pede ao WA Web para baixar como se o usuario tivesse
// clicado (isso tambem pede ao celular de quem mandou reenviar midia expirada), espera
// resolver, (2) le o arquivo ja resolvido da memoria do WA Web e, se nao der, (3) baixa do
// CDN testando o tipo de midia (o tipo entra na chave de decriptacao). Devolve o motivo
// exato de cada falha em 'info' para o log.
async function baixarMidiaPelaPagina(msg, esperaMs = 30000) {
  if (!client.pupPage || !msg?.id?._serialized) return { info: { erro: 'pagina do WhatsApp indisponivel' } };
  return client.pupPage.evaluate(async (msgId, esperaMs) => {
    const info = { etapas: [] };
    const serr = e => {
      try {
        return { nome: e?.name, msg: e?.message, status: e?.status, texto: String(e),
                 campos: e && typeof e === 'object' ? Object.keys(e).slice(0, 8) : [],
                 pilha: String(e?.stack || '').split('\n').slice(0, 3).join(' | ') };
      } catch (_) { return { texto: 'erro nao serializavel' }; }
    };
    const C = window.require('WAWebCollections');
    let m = C.Msg.get(msgId);
    if (!m) { try { m = (await C.Msg.getMessagesById([msgId]))?.messages?.[0]; } catch (e) { info.etapas.push({ getMessagesById: serr(e) }); } }
    if (!m) { info.erro = 'mensagem nao encontrada no WhatsApp Web'; return { info }; }
    Object.assign(info, { tipo: m.type, mimetype: m.mimetype, tamanho: m.size, nomeArquivo: m.filename,
      temDirectPath: !!m.directPath, temMediaKey: !!m.mediaKey, visualizacaoUnica: !!m.isViewOnce,
      etapaInicial: m.mediaData?.mediaStage });
    const paraBase64 = async buf => window.WWebJS.arrayBufferToBase64Async(buf);
    const resposta = (via, data) => ({ info: { ...info, via }, data, mimetype: m.mimetype, filename: m.filename });

    try { await m.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true }); }
    catch (e) { info.etapas.push({ downloadMediaInterno: serr(e) }); }
    const limite = Date.now() + esperaMs;
    while (Date.now() < limite && m.mediaData && m.mediaData.mediaStage !== 'RESOLVED' && !String(m.mediaData.mediaStage).includes('ERROR')) {
      await new Promise(r => setTimeout(r, 1000));
    }
    info.etapaDepois = m.mediaData?.mediaStage;

    try {
      const mb = m.mediaData?.mediaBlob;
      let blob = null;
      if (mb && typeof mb.forceToBlob === 'function') blob = await mb.forceToBlob();
      else if (mb instanceof Blob) blob = mb;
      else if (mb && mb._blob instanceof Blob) blob = mb._blob;
      if (blob && blob.size) return resposta('memoria', await paraBase64(await blob.arrayBuffer()));
      if (mb) info.etapas.push({ memoria: 'blob vazio' });
    } catch (e) { info.etapas.push({ memoria: serr(e) }); }

    if (!m.directPath || !m.mediaKey) { info.erro = 'mensagem sem directPath/mediaKey'; return { info }; }
    const qpl = { addAnnotations() { return this; }, addPoint() { return this; } };
    const tipoPorMime = String(m.mimetype || '').startsWith('image/') ? 'image' : 'document';
    for (const type of [...new Set([m.type, tipoPorMime, 'image', 'document'])].filter(Boolean)) {
      try {
        const buf = await window.require('WAWebDownloadManager').downloadManager.downloadAndMaybeDecrypt({
          directPath: m.directPath, encFilehash: m.encFilehash, filehash: m.filehash, mediaKey: m.mediaKey,
          mediaKeyTimestamp: m.mediaKeyTimestamp, type, signal: new AbortController().signal, downloadQpl: qpl });
        return resposta(`cdn:${type}`, await paraBase64(buf));
      } catch (e) { info.etapas.push({ [`cdn_${type}`]: serr(e) }); }
    }
    return { info };
  }, msg.id._serialized, esperaMs);
}

async function processarMidiaInterno(msg, nomeRemetente) {
  let media, erroLib = null;
  const dataMsg = msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleString('pt-BR') : '?';
  for (let t = 1; t <= 3 && !media; t++) {
    try { media = await msg.downloadMedia(); if (!media) break; }
    catch (e) {
      erroLib = e;
      if (t < 3) await new Promise(r => setTimeout(r, 3000 * t));
    }
  }
  if (!media) {
    let alt = null;
    try { alt = await baixarMidiaPelaPagina(msg); }
    catch (e) { alt = { info: { erro: `download alternativo falhou: ${e.message}` } }; }
    if (alt?.data) {
      media = { data: alt.data, mimetype: alt.mimetype || 'application/octet-stream', filename: alt.filename };
      log(`Midia de ${nomeRemetente} (${dataMsg}) baixada pelo caminho alternativo (${alt.info?.via}) — lib falhou: ${erroLib ? erroLib.message : 'midia vazia'}`, 'warn');
    } else {
      log(`Erro baixar midia (msg de ${nomeRemetente} em ${dataMsg}, id ${msg.id?.id||'?'}): ${erroLib ? erroLib.message : 'midia vazia'} — caminho alternativo tambem falhou`, 'error', alt?.info || null);
      return 'erro_download';
    }
  }

  const isImagem = media.mimetype.startsWith('image/');
  const isPdf    = media.mimetype === 'application/pdf';
  const isDoc    = media.mimetype.startsWith('application/');

  if (!isImagem && !isPdf && !isDoc) { log(`Tipo ignorado: ${media.mimetype}`, 'warn'); return; }

  const ts    = msg.timestamp ? msg.timestamp * 1000 : Date.now();
  const ext   = isPdf ? '.pdf' : isImagem ? '.jpeg' : '.bin';
  // msg.timestamp so tem resolucao de 1 segundo — quando a Bruna manda varios
  // comprovantes em sequencia rapida, duas mensagens diferentes podem cair no
  // mesmo segundo. Sem um sufixo unico por mensagem, o nome do arquivo colide
  // e a segunda foto sobrescreve a primeira no disco (mesmo com valores certos
  // no banco, o anexo salvo fica errado). msg.id.id identifica a mensagem.
  const idMsg = (msg.id?.id || crypto.randomBytes(4).toString('hex')).replace(/[^A-Za-z0-9]/g,'').substring(0,12);
  const nome  = `WA_${ts}_${idMsg}_${nomeRemetente.replace(/\s+/g,'_').substring(0,20)}${ext}`;
  const fPath = path.join(PASTA_FOTOS, nome);

  // O nome do arquivo agora e deterministico (baseado no ID real da mensagem), entao
  // reprocessar a MESMA mensagem (ex: rescan de mensagens perdidas a cada boot do bot)
  // produz exatamente o mesmo nome do arquivo ja salvo. Se ja existe em disco E ja esta
  // no banco, e certeza de que essa mensagem ja foi processada — sai sem tocar no arquivo,
  // para nao sobrescrever e depois apagar (unlink) o proprio arquivo original por engano.
  if (fs.existsSync(fPath)) {
    const hashExistente = hashArquivo(nome);
    const jaExisteNoBanco = hashExistente && (
      db.prepare(`SELECT id FROM despesas WHERE arquivo=? OR arquivo_hash=? LIMIT 1`).get(nome, hashExistente) ||
      db.prepare(`SELECT id FROM depositos WHERE arquivo=? OR arquivo_hash=? LIMIT 1`).get(nome, hashExistente)
    );
    if (jaExisteNoBanco) {
      log(`Mensagem ja processada anteriormente (arquivo ${nome} ja existe) — ignorando reprocessamento`, 'warn');
      return 'duplicada';
    }
  }

  try { fs.writeFileSync(fPath, Buffer.from(media.data, 'base64')); log(`Arquivo salvo: ${nome}`); }
  catch (e) { log(`Erro salvar: ${e.message}`, 'error'); return; }

  // Evita duplicidade: mesma foto ja capturada antes (ex: historico rodado mais de uma vez)
  const hash = hashArquivo(nome);
  if (hash) {
    if (hashesEmProcessamento.has(hash)) {
      log(`Midia identica ja em processamento neste instante (chamada concorrente) — ignorando`, 'warn');
      try { fs.unlinkSync(fPath); } catch(e) {}
      return 'duplicada';
    }
    const jaDesp = db.prepare(`SELECT id, arquivo FROM despesas WHERE arquivo_hash=? LIMIT 1`).get(hash);
    const jaDep  = db.prepare(`SELECT id, arquivo FROM depositos WHERE arquivo_hash=? LIMIT 1`).get(hash);
    if (jaDesp || jaDep) {
      log(`Midia identica ja processada (despesa #${jaDesp?.id||'-'} / deposito #${jaDep?.id||'-'}) — ignorando duplicata`, 'warn');
      // So apaga o arquivo recem-gravado se ele NAO for o proprio arquivo original ja
      // referenciado no banco (nome deterministico pode coincidir com o original).
      const arquivoOriginal = jaDesp?.arquivo || jaDep?.arquivo;
      if (arquivoOriginal !== nome) { try { fs.unlinkSync(fPath); } catch(e) {} }
      return 'duplicada';
    }
    hashesEmProcessamento.add(hash);
  }

  try {
    const ehPaulo = ehRemetenteReceita(nomeRemetente);
    let dadosIA = null;

    if (ai && (isImagem || isPdf)) {
      try {
        log(`IA extraindo dados de ${nome}...`);
        dadosIA = await extrairComIA(media.data, media.mimetype);
        log(`IA: valor=${dadosIA?.valor} fornecedor=${dadosIA?.fornecedor} conf=${dadosIA?.confianca}`);
      } catch (e) {
        log(`Erro IA: ${e.message}`, 'warn');
        dadosIA = { tipo_doc: isPdf ? 'comprovante_pdf' : 'outros', descricao: 'Extracao IA falhou — revisar manualmente', confianca: 0 };
      }
    } else {
      dadosIA = { descricao: 'Sem IA — revisar manualmente', confianca: 0 };
    }

    // Sem placa impressa no documento (comum em PIX): tenta achar na legenda da foto
    // (msg.body, quando enviada junto com a imagem) ou na descricao lida pela IA.
    if (!ehPaulo && !dadosIA?.placa) {
      const placaLegenda = extrairPlacaDeTexto(msg.body) || extrairPlacaDeTexto(dadosIA?.descricao);
      if (placaLegenda) dadosIA.placa = placaLegenda;
    }

    const ehRecebimentoProprio = ehBeneficiarioProprioEmpresa(dadosIA?.fornecedor);
    if (ehPaulo || ehRecebimentoProprio) {
      if (ehRecebimentoProprio && !ehPaulo) log(`Comprovante para a propria RL Nordeste (beneficiario=${dadosIA?.fornecedor}) — lancado como DEPOSITO mesmo enviado por ${nomeRemetente}`);
      criarDeposito(dadosIA, nomeRemetente, nome);
    } else if (dadosIA?.is_orcamento || dadosIA?.tipo_doc === 'orcamento') {
      log(`ORÇAMENTO recebido de ${nomeRemetente} — R$ ${dadosIA?.valor||0} — arquivo salvo, nao lancado como despesa`);
    } else {
      // Junta a descricao lida no comprovante com a legenda que a Bruna escreveu
      // junto da foto no WhatsApp (msg.body) — a legenda costuma trazer contexto
      // que nao esta no documento (motivo do pagamento, placa, observacao).
      if (msg.body && msg.body.trim()) {
        const legenda = msg.body.trim();
        dadosIA.descricao = dadosIA?.descricao ? `${dadosIA.descricao} | Msg: ${legenda}` : `Msg: ${legenda}`;
      }
      criarDespesa(dadosIA, nomeRemetente, nome);
    }
  } finally {
    if (hash) hashesEmProcessamento.delete(hash);
  }
}

// ─── WHATSAPP CLIENT ────────────────────────────────────────────
// BUG CONHECIDO (jul/2026): WhatsApp renomeou um campo interno (_serialized -> $1),
// quebrando client.getChats()/getContact()/downloadMedia() na lib whatsapp-web.js@1.34.7
// com erro minificado "r: r". Confirmado como bug ativo/generalizado da lib (nao do nosso
// codigo) em https://github.com/wwebjs/whatsapp-web.js/issues/201845 — ainda sem fix
// oficial lancado. Tentativa de contornar fixando uma versao antiga do WA Web via
// webVersionCache NAO resolveu (testado). Enquanto nao sai um patch, o upload manual de
// foto (aba "Enviar Foto", endpoint /api/upload-foto) continua funcionando normalmente,
// pois nao depende de nenhuma chamada quebrada do WWebJS.
// 09/10/2026: a versao do WhatsApp Web publicada em 08/10 ~19:31 desmonta a pagina segundos depois do "ready"
// ("detached Frame") e o bot parou de capturar. Fixada a ultima versao que funcionou (cache local em .wwebjs_cache).
// Para testar outra: variavel WA_WEB_VERSION; para voltar a usar sempre a mais nova: WA_WEB_VERSION=auto.
const WA_WEB_VERSION = process.env.WA_WEB_VERSION || '2.3000.1049732041';
const client = new Client({
  authStrategy: new LocalAuth(),
  ...(WA_WEB_VERSION !== 'auto' ? { webVersion: WA_WEB_VERSION, webVersionCache: { type: 'local', path: path.join(__dirname, '.wwebjs_cache') + path.sep } } : {}),
  puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] }
});

// ─── MÓDULO OBRAS (08/10/2026): grupo "Adm Obras Esposende" → obras_comprovantes (Supabase) ──
// Mesma sessão do WhatsApp; não toca no SQLite nem nas tabelas rl_*. Ver obras_bot.js.
let obras = null;
try { obras = require('./obras_bot')({ client, log, sb, baixarMidiaPelaPagina }); }
catch (e) { log(`Modulo Obras nao carregou: ${e.message}`, 'warn'); }
// Health check (09/10/2026): publica o estado em capturador_status a cada 1 min. So le; nunca derruba o bot.
try { require('./capturador_status')({ client, sb, db, obras, log }); }
catch (e) { log(`Health check nao carregou: ${e.message}`, 'warn'); }

client.on('qr', qr => {
  qrcode.generate(qr, { small: true }, qrAscii => {
    const linhas    = qrAscii.replace(/\n$/, '').split('\n');
    const larguraQr = Math.max(...linhas.map(l => l.length));
    const larguraTerm = process.stdout.columns || 80;
    const alturaTerm   = process.stdout.rows || 24;
    const padEsq = ' '.repeat(Math.max(0, Math.floor((larguraTerm - larguraQr) / 2)));
    const padTopo = Math.max(0, Math.floor((alturaTerm - linhas.length - 2) / 2));

    console.clear();
    console.log('\n'.repeat(padTopo));
    const titulo = 'Escaneie o QR Code:';
    console.log(' '.repeat(Math.max(0, Math.floor((larguraTerm - titulo.length) / 2))) + titulo + '\n');
    linhas.forEach(l => console.log(padEsq + l));
  });
});
// Processa mensagens com midia recentes do grupo — usado tanto na reconexao quanto
// sob demanda (via /api/reprocessar-nao-lidas), com retry porque logo apos conectar
// o WhatsApp Web as vezes ainda esta sincronizando e a chamada da timeout.
// NAO depende de unreadCount: o WhatsApp pode marcar o grupo como lido (celular aberto,
// outro aparelho vinculado, etc.) mesmo com fotos que o bot nunca processou. Por isso
// sempre revisita as ultimas mensagens da janela recente; midia ja lancada e ignorada
// automaticamente pelo hash (ver processarMidia).
// Timestamp (ms) da mensagem de WhatsApp mais recente que ja virou lancamento.
// O nome do arquivo carrega o timestamp da mensagem: WA_{ms}_{idMsg}_{remetente}.ext
function ultimoTimestampLancado() {
  const r = db.prepare(`
    SELECT MAX(CAST(substr(arquivo, 4, instr(substr(arquivo, 4), '_') - 1) AS INTEGER)) AS ts FROM (
      SELECT arquivo FROM despesas  WHERE arquivo LIKE 'WA\\_%' ESCAPE '\\'
      UNION ALL
      SELECT arquivo FROM depositos WHERE arquivo LIKE 'WA\\_%' ESCAPE '\\'
    )`).get();
  return r?.ts || 0;
}

async function acharGrupo() {
  const chats = await client.getChats();
  return chats.find(c => c.isGroup && c.name && c.name.includes(GRUPO_ALVO)) || null;
}

// Busca no historico do grupo ate cobrir 'desdeMs'. BUG REAL (20-27/09/2026): o bot ficou
// uma semana sem conectar; ao voltar, o fetchMessages devolveu so as ultimas 15 mensagens
// (o WhatsApp Web ainda estava sincronizando o historico logo apos conectar) e tudo entre
// 19/09 e 25/09 ficou de fora sem nenhum aviso. Agora: busca, confere se a mensagem mais
// antiga devolvida ja alcanca 'desdeMs'; se nao alcancar, espera e tenta de novo
// (o historico vai chegando aos poucos) e, se mesmo assim nao alcancar, registra ERRO
// com o periodo exato que pode ter ficado de fora.
async function buscarMensagensDesde(grupo, desdeMs, { maxTentativas = 6, esperaMs = 45000, limiteInicial = 1000 } = {}) {
  let limite = limiteInicial, msgs = [];
  for (let t = 1; t <= maxTentativas; t++) {
    msgs = await grupo.fetchMessages({ limit: limite });
    const maisAntiga = msgs.length ? Math.min(...msgs.map(m => (m.timestamp || 0) * 1000)) : Infinity;
    if (maisAntiga <= desdeMs) return { msgs, cobriu: true, maisAntiga };
    if (msgs.length >= limite) { limite *= 2; continue; } // veio cheio: so precisa pedir mais
    // Pede ao CELULAR o historico antigo do grupo (o aparelho vinculado so recebe parte do
    // historico; o resto fica no telefone). Cada pedido traz um lote; repete a cada tentativa.
    try {
      const pediu = await grupo.syncHistory();
      log(`Pedido de historico antigo ao celular: ${pediu ? 'enviado' : 'nao necessario/indisponivel'}`, 'warn');
    } catch(e) { log(`syncHistory falhou: ${e.message}`, 'warn'); }
    if (t < maxTentativas) {
      log(`Historico ainda nao alcancou ${new Date(desdeMs).toLocaleString('pt-BR')} (mais antiga: ${isFinite(maisAntiga) ? new Date(maisAntiga).toLocaleString('pt-BR') : '-'}; ${msgs.length} msgs) — aguardando sincronizacao do WhatsApp (${t}/${maxTentativas})`, 'warn');
      await new Promise(r => setTimeout(r, esperaMs));
    } else {
      return { msgs, cobriu: false, maisAntiga };
    }
  }
  return { msgs, cobriu: false, maisAntiga: Infinity };
}

let varreduraRodando = false;
async function processarMensagensPerdidas(tentativa = 1, opcoes = {}) {
  if (varreduraRodando) return { ok:false, erro:'varredura ja em andamento' };
  varreduraRodando = true;
  let erroVarredura = null;
  try {
    const grupo = await acharGrupo();
    if (!grupo) { log('Grupo nao encontrado ao verificar mensagens perdidas', 'warn'); return { ok:false, erro:'grupo nao encontrado' }; }
    // Margem de 2 dias antes da ultima mensagem lancada: pega tambem midias que falharam
    // download/IA logo antes da queda (as ja lancadas sao puladas sem baixar nada).
    const ultimo = ultimoTimestampLancado();
    const desdeMs = opcoes.desdeMs || (ultimo ? ultimo - 2*24*3600*1000 : Date.now() - 7*24*3600*1000);
    const { msgs, cobriu, maisAntiga } = await buscarMensagensDesde(grupo, desdeMs, opcoes);
    const comMidia = msgs.filter(m => m.hasMedia && (m.timestamp||0)*1000 >= desdeMs);
    log(`Verificando ${msgs.length} mensagens do grupo desde ${new Date(desdeMs).toLocaleString('pt-BR')} — ${comMidia.length} com midia no periodo`);
    if (!cobriu) {
      log(`ATENCAO: o WhatsApp so devolveu historico a partir de ${isFinite(maisAntiga) ? new Date(maisAntiga).toLocaleString('pt-BR') : '-'} — mensagens entre ${new Date(desdeMs).toLocaleString('pt-BR')} e essa data podem ter ficado SEM LANCAMENTO. Rode /api/recuperar-periodo para conferir.`, 'error');
    }
    let processadas = 0, jaLancadas = 0, erros = 0;
    for (const msg of comMidia) {
      try {
        if (mensagemJaLancada(msg)) { jaLancadas++; continue; }
        const contact = await msg.getContact();
        const nome = contact.pushname || contact.name || contact.number || 'Desconhecido';
        const r = await processarMidia(msg, nome);
        if (r === 'erro_download') erros++; else if (["ja_lancada","duplicada","concorrente"].includes(r)) jaLancadas++; else processadas++;
      } catch(e) { erros++; log(`Erro reprocessar: ${e.message}`, 'warn'); }
    }
    log(`Varredura concluida: ${processadas} novas, ${jaLancadas} ja lancadas, ${erros} erros`);
    return { ok:true, cobriu, verificadas: msgs.length, comMidia: comMidia.length, processadas, jaLancadas, erros };
  } catch(e) {
    log(`Erro verificar msgs perdidas (tentativa ${tentativa}): ${e.message} | ${e.stack||''}`.substring(0,490), 'warn');
    erroVarredura = e;
  } finally {
    varreduraRodando = false;
  }
  if (tentativa < 3) { await new Promise(r => setTimeout(r, 8000)); return processarMensagensPerdidas(tentativa + 1, opcoes); }
  return { ok:false, erro: erroVarredura?.message };
}

// ─── WATCHDOG DE CONEXAO ────────────────────────────────────────
// BUG REAL (20-27/09/2026): o Chrome do puppeteer caiu ("Target closed" / "Execution
// context was destroyed") durante a inicializacao; o erro so virou um log de
// unhandledRejection e o processo ficou de pe servindo o painel, mas SEM WhatsApp, por
// uma semana. Agora: se nao ficar CONNECTED, reinicia o cliente sozinho.
let waPronto = false, falhasEstado = 0, reiniciandoCliente = false;
async function reiniciarCliente(motivo) {
  if (reiniciandoCliente) return;
  reiniciandoCliente = true;
  waPronto = false;
  log(`Reiniciando cliente WhatsApp (${motivo})...`, 'warn');
  try { await client.destroy(); } catch(e) {}
  await new Promise(r => setTimeout(r, 5000));
  try { await client.initialize(); }
  catch(e) {
    // 09/10/2026: com o Chrome do WhatsApp "detached", reinicializar dentro do processo falha sempre e o bot
    // ficava parado. Encerra o processo: o INICIAR_BOT_*.bat reinicia limpo em 15s e a varredura recupera o atraso.
    log(`Erro ao reinicializar WhatsApp: ${e.message} — encerrando para reinicio limpo`, 'error');
    try { await client.destroy(); } catch(_) {}
    setTimeout(() => process.exit(3), 2000);
  }
  reiniciandoCliente = false;
}
async function checarConexao() {
  if (reiniciandoCliente) return;
  let estado = null;
  try { estado = await Promise.race([client.getState(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000))]); } catch(e) {}
  if (estado === 'CONNECTED') {
    falhasEstado = 0;
    // Visto em 01/10/2026: apos reiniciar, o WhatsApp conecta (estado CONNECTED, chats
    // acessiveis) mas o evento 'ready' da lib nunca dispara -> a varredura de mensagens
    // perdidas nao rodava. Nesse caso assume pronto e roda a varredura por aqui.
    if (!waPronto) {
      waPronto = true;
      log(`WhatsApp CONNECTED sem evento 'ready' — assumindo conectado e verificando mensagens perdidas`, 'warn');
      processarMensagensPerdidas();
    }
    return;
  }
  falhasEstado++;
  log(`WhatsApp nao conectado (estado: ${estado || 'indisponivel'}) — checagem ${falhasEstado}/2`, 'warn');
  if (falhasEstado >= 2) { falhasEstado = 0; reiniciarCliente(`estado ${estado || 'indisponivel'}`); }
}
setTimeout(checarConexao, 2 * 60 * 1000);
setInterval(checarConexao, 2 * 60 * 1000);

client.on('ready', async () => {
  console.clear();
  waPronto = true; falhasEstado = 0;
  log(`Bot conectado! Grupo: "${GRUPO_ALVO}"`);
  log(`Painel: http://localhost:${PORTA}`);
  log(`IA: ${ai ? 'ATIVA' : 'SEM CHAVE'} | Banco: ${DB_PATH}`);
  // Processar mensagens perdidas enquanto o PC estava desligado/desconectado.
  // 30s (antes 8s): da tempo do WhatsApp Web sincronizar o historico do grupo.
  setTimeout(() => processarMensagensPerdidas(), 30000);
});
client.on('disconnected', r => {
  waPronto = false;
  log(`Desconectado: ${r} — tentando reconectar em 10s...`, 'warn');
  setTimeout(() => reiniciarCliente(`desconectado: ${r}`), 10000);
});
// Rede de seguranca: a cada 2h revisita o historico recente (mensagens ja lancadas sao
// puladas sem download, entao custa quase nada) e tenta de novo as despesas zeradas por
// falha da IA.
setInterval(() => { if (waPronto) processarMensagensPerdidas(); }, 2 * 60 * 60 * 1000);

// ─── ESPELHO COMPLETO NO SUPABASE ───────────────────────────────
// O sbSync linha-a-linha cobre o fluxo normal, mas NAO cobre: conciliacao FIFO (revincula
// tudo), reprocessamento sob demanda, correcoes direto no banco e falhas de rede. Em
// 01/10/2026 o Supabase estava com 4 depositos e 8 despesas a menos e ~120 valores
// divergentes. sync_supabase.js faz upsert de tudo e remove o que foi excluido localmente.
let espelhoRodando = false, espelhoPendente = false;
function sincronizarSupabase(motivo) {
  if (!sb) return;
  if (espelhoRodando) { espelhoPendente = true; return; }
  espelhoRodando = true;
  require('child_process').execFile('node', [path.join(__dirname, 'sync_supabase.js'), 'aplicar'], { cwd: __dirname, timeout: 5 * 60 * 1000 },
    (err, stdout) => {
      const depois = (stdout || '').split('== DEPOIS ==')[1] || '';
      const ok = !err && depois.includes('"faltando_no_supabase"') && !/"faltando_no_supabase": [1-9]/.test(depois)
        && !/"sobrando_no_supabase": \[\s*\d/.test(depois) && !/"valor_divergente": \[\s*\d/.test(depois);
      log(`Espelho Supabase (${motivo}): ${ok ? 'OK, identico ao SQLite' : 'FALHOU/DIVERGENTE — ' + (err ? err.message : 'ver sync_supabase.js')}`, ok ? 'info' : 'warn');
      espelhoRodando = false;
      if (espelhoPendente) { espelhoPendente = false; sincronizarSupabase('pendente'); }
    });
}
setTimeout(() => sincronizarSupabase('inicio do bot'), 3 * 60 * 1000);
setInterval(() => sincronizarSupabase('rotina 2h'), 2 * 60 * 60 * 1000 + 20 * 60 * 1000);
setInterval(() => { reprocessarZeradas({ automatico: true }).catch(e => log(`Erro reprocessar zeradas (auto): ${e.message}`, 'warn')); }, 2 * 60 * 60 * 1000 + 10 * 60 * 1000);

client.on('message', async msg => {
  try {
    const chat = await msg.getChat();
    if (!chat.isGroup) return;
    if (obras && obras.ehGrupo(chat)) { await obras.onMessage(msg, chat); return; }
    if (!chat.name.includes(GRUPO_ALVO)) return;
    const contact = await msg.getContact();
    const nome = contact.pushname || contact.name || contact.number || 'Desconhecido';

    if (msg.hasMedia) {
      log(`Midia de ${nome} no grupo ${chat.name}`);
      await processarMidia(msg, nome);
      return;
    }

    // Texto: tenta extrair valor de mensagens do Paulo/Rafael (receita)
    if (msg.body && msg.body.trim()) {
      const ehPaulo = ehRemetenteReceita(nome);
      const m = msg.body.match(/R\$\s*([\d.,]+)|([\d]+[.,][\d]{2})/i);
      if (ehPaulo && m) {
        const v = parseFloat((m[1]||m[2]).replace(',','.'));
        if (v > 0) { criarDeposito({ valor: v, descricao: msg.body.substring(0,200), confianca: 0.7 }, nome, null); }
      }
    }
  } catch (e) { log(`Erro mensagem: ${e.message} | ${e.stack||''}`.substring(0,490), 'error'); }
});

client.initialize();

// ─── REPROCESSAR ZERADAS (funcao reutilizavel: endpoint manual + rodada automatica) ──
// automatico=true: so pega itens dos ultimos 30 dias e ignora orcamentos/anotacoes (que
// sao zerados de proposito), pra nao gastar IA a cada 2h com os mesmos itens.
async function reprocessarZeradas({ automatico = false } = {}) {
  if (!ai) return { erro:'IA nao configurada (GEMINI_API_KEY ausente)' };
  if (reprocessStatus.rodando) return { erro:'Ja existe um reprocessamento em andamento', status:reprocessStatus };
  const filtroAuto = automatico ? `AND tipo_doc IS NOT 'orcamento' AND created_at >= datetime('now','localtime','-30 days')` : '';
  const pendentesDesp = db.prepare(`SELECT * FROM despesas  WHERE (valor IS NULL OR valor=0) AND arquivo IS NOT NULL ${filtroAuto} ORDER BY id ASC`).all().map(d => ({ ...d, _tabela:'despesa' }));
  const pendentesDep  = db.prepare(`SELECT * FROM depositos WHERE (valor IS NULL OR valor=0) AND arquivo IS NOT NULL ${automatico ? "AND created_at >= datetime('now','localtime','-30 days')" : ''} ORDER BY id ASC`).all().map(d => ({ ...d, _tabela:'deposito' }));
  const pendentes = [...pendentesDesp, ...pendentesDep];
  if (automatico && !pendentes.length) return { ok:true, total:0 };
  reprocessStatus = { rodando:true, total:pendentes.length, processados:0, reaproveitados:0, erros:0, semArquivo:0, atual:null, iniciadoEm:new Date().toISOString(), concluidoEm:null };
  if (automatico) log(`Reprocessamento automatico de zeradas: ${pendentes.length} pendentes`);
  (async () => {
      const cacheHash = new Map(); // hash -> dadosIA ja extraido nesta rodada (evita gastar IA em foto repetida)
      for (const d of pendentes) {
        reprocessStatus.atual = d.arquivo;
        const fPath = path.join(PASTA_FOTOS, d.arquivo);
        if (!fs.existsSync(fPath)) { reprocessStatus.semArquivo++; continue; }
        let reaproveitado = false;
        try {
          const hash = d.arquivo_hash || hashArquivo(d.arquivo);
          let dadosIA = null;

          if (hash && cacheHash.has(hash)) {
            dadosIA = cacheHash.get(hash);
            reaproveitado = true;
          } else if (hash) {
            const tabelaOrigem = d._tabela === 'despesa' ? 'despesas' : 'depositos';
            const existente = db.prepare(`SELECT ocr_json FROM ${tabelaOrigem} WHERE arquivo_hash=? AND valor>0 AND id!=? LIMIT 1`).get(hash, d.id);
            if (existente?.ocr_json) { try { dadosIA = JSON.parse(existente.ocr_json); reaproveitado = true; } catch(e) {} }
          }

          if (!dadosIA) {
            const ext = path.extname(d.arquivo).toLowerCase();
            const mimetype = ext === '.pdf' ? 'application/pdf' : (MIME_MAP[ext] || 'image/jpeg');
            const base64 = fs.readFileSync(fPath).toString('base64');
            dadosIA = await extrairComIA(base64, mimetype);
            if (hash) cacheHash.set(hash, dadosIA);
          }

          const valor = parseValor(dadosIA?.valor);
          const dataDoc = extrairDataDocumento(JSON.stringify(dadosIA));
          const horaDoc = extrairHoraDocumento(JSON.stringify(dadosIA));

          if (d._tabela === 'despesa') {
            const placa = formatarPlaca(dadosIA?.placa) || extrairPlacaDeTexto(dadosIA?.descricao);
            const isOrcamento = !!(dadosIA?.is_orcamento || dadosIA?.tipo_doc === 'orcamento');
            const contaComoDespesa = ehDespesaReal(dadosIA?.tipo_doc) && !isOrcamento;
            let fornecedor = dadosIA?.fornecedor || null;
            let descricao  = dadosIA?.descricao || d.descricao;
            if (!fornecedor && descricao) fornecedor = descricao;
            const servico = dadosIA?.servico || inferirServicoPorFornecedor(fornecedor);
            db.prepare(`UPDATE despesas SET valor=?,fornecedor=?,servico=?,placa=?,nf=?,cnpj=?,banco=?,pix=?,tipo_doc=?,descricao=?,arquivo_hash=?,ocr_json=?,confianca=?,data_documento=?,hora_documento=?,autenticacao=? WHERE id=?`)
              .run(valor, fornecedor, servico||null, placa, dadosIA?.nf||null, dadosIA?.cnpj||null, dadosIA?.banco||null, dadosIA?.pix||null, dadosIA?.tipo_doc||'outros', descricao, hash, JSON.stringify(dadosIA), dadosIA?.confianca||null, dataDoc, horaDoc, dadosIA?.autenticacao||null, d.id);
            if (fornecedor && valor && contaComoDespesa) stmtUpdForn.run(fornecedor, valor, valor);
            reprocessStatus.processados++;
            if (reaproveitado) { reprocessStatus.reaproveitados++; log(`Reaproveitado despesa #${d.id} (foto identica ja lida) — R$ ${valor.toFixed(2)} — ${fornecedor||'?'} [sem chamada de IA]`); }
            else log(`Reprocessado despesa #${d.id} — R$ ${valor.toFixed(2)} — ${fornecedor||'?'}`);
          } else {
            // Deposito: remetente vem do contato do WhatsApp (Paulo/Rafael), nao do documento — nao mexe nele aqui.
            // valor=0 nunca teve saldo alocado a despesas (saldo_restante nasce igual ao valor), entao e seguro
            // recalcular saldo_restante = valor novo, igual ao que aconteceria numa criacao nova de deposito.
            const descricao = dadosIA?.descricao || d.descricao;
            db.prepare(`UPDATE depositos SET valor=?,banco=?,pix=?,descricao=?,arquivo_hash=?,ocr_json=?,data_documento=?,hora_documento=?,autenticacao=?,saldo_restante=? WHERE id=?`)
              .run(valor, dadosIA?.banco||null, dadosIA?.pix||null, descricao, hash, JSON.stringify(dadosIA), dataDoc, horaDoc, dadosIA?.autenticacao||null, valor, d.id);
            reprocessStatus.processados++;
            if (reaproveitado) { reprocessStatus.reaproveitados++; log(`Reaproveitado deposito #${d.id} (foto identica ja lida) — R$ ${valor.toFixed(2)} [sem chamada de IA]`); }
            else log(`Reprocessado deposito #${d.id} — R$ ${valor.toFixed(2)}`);
          }
        } catch (e) {
          reprocessStatus.erros++;
          log(`Erro reprocessar ${d._tabela} #${d.id}: ${e.message}`, 'warn');
        }
        // Free tier do Gemini = 5 req/min (1 a cada 12s). 1s de pausa nao bastava — varios
        // itens seguidos ainda colidiam com o limite mesmo com retry/backoff interno, e
        // esgotavam as 3 tentativas sem conseguir (visto num lote de 40: só 1 passou).
        if (!reaproveitado) await new Promise(r => setTimeout(r, 13000));
      }
      reprocessStatus.rodando = false;
      reprocessStatus.atual = null;
      reprocessStatus.concluidoEm = new Date().toISOString();
      if (reprocessStatus.processados) sincronizarSupabase('reprocessamento de zeradas');
      log(`Reprocessamento concluido: ${reprocessStatus.processados} ok (${reprocessStatus.reaproveitados} sem custo de IA por serem fotos repetidas), ${reprocessStatus.erros} erros, ${reprocessStatus.semArquivo} sem arquivo (de ${reprocessStatus.total} pendentes)`);
    })();
  return { ok:true, iniciado:true, total:pendentes.length };
}

// ─── HTTP SERVER / API ──────────────────────────────────────────
let reprocessStatus = { rodando:false, total:0, processados:0, reaproveitados:0, erros:0, semArquivo:0, atual:null, iniciadoEm:null, concluidoEm:null };
let historicoStatus = { rodando:false, totalMsgs:0, totalMidias:0, processados:0, pulados:0, erros:0, atual:null, iniciadoEm:null, concluidoEm:null };
let recuperacaoStatus = { rodando:false, totalFaltando:0, recuperados:0, naoEncontrados:0, atual:null, iniciadoEm:null, concluidoEm:null };

const MIME_MAP = {
  '.html':'text/html','.js':'application/javascript','.css':'text/css',
  '.jpeg':'image/jpeg','.jpg':'image/jpeg','.png':'image/png',
  '.pdf':'application/pdf','.gif':'image/gif','.webp':'image/webp'
};

function jsonResp(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const qs  = req.url.includes('?') ? req.url.split('?')[1] : '';

  if (req.method === 'OPTIONS') {
    res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,PATCH,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
    return res.end();
  }

  if (url === '/' || url === '/index.html') {
    const p = path.join(__dirname, 'painel_v3.html');
    if (fs.existsSync(p)) { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return res.end(fs.readFileSync(p)); }
    return jsonResp(res, { erro:'painel_v3.html nao encontrado' }, 404);
  }

  if (obras && url.startsWith('/api/obras/')) return obras.http(req, res, url, qs);

  if (url === '/api/config') return jsonResp(res, { grupo:GRUPO_ALVO, tem_ia:!!ai, banco:'SQLite local', versao:'3.1-sqlite' });

  // Debug temporario: lista chats disponiveis pro bot (usado pra localizar a conversa
  // "Mensagens para Voce Mesmo" quando precisa importar fotos de la)
  if (url === '/api/debug-chats') {
    (async () => {
      try {
        const meId = client.info?.wid?._serialized;
        const chats = await client.getChats();
        const lista = chats.map(c => ({ nome:c.name, id:c.id?._serialized, isGroup:c.isGroup, ehVoceMesmo: c.id?._serialized===meId, unread:c.unreadCount }));
        return jsonResp(res, { meId, total:chats.length, chats:lista });
      } catch(e) { return jsonResp(res, { erro:e.message }, 500); }
    })();
    return;
  }

  // Recuperacao pontual: processa as midias de HOJE de um chat pelo nome (usado pra
  // importar o lote que a Bruna/Ricardo reenviou pra "EU MESMO" pra contornar o bug de
  // paginacao de historico antigo do WhatsApp Web). So pega mensagens de hoje, ignora
  // o resto do historico do chat.
  if (url.startsWith('/api/importar-chat-hoje')) {
    (async () => {
      try {
        const nomeAlvo = decodeURIComponent((qs.match(/nome=([^&]*)/) || ['',''])[1]);
        const remetenteRotulo = decodeURIComponent((qs.match(/remetente=([^&]*)/) || ['','Bruna (recuperado)'])[1]);
        const chats = await client.getChats();
        const chat = chats.find(c => c.name === nomeAlvo);
        if (!chat) return jsonResp(res, { erro:'chat nao encontrado' }, 404);
        const msgs = await chat.fetchMessages({ limit: 300 });
        const hojeStr = new Date().toISOString().substring(0,10);
        const deHoje = msgs.filter(m => m.hasMedia && m.timestamp && new Date(m.timestamp*1000).toISOString().substring(0,10) === hojeStr);
        log(`Importar-chat-hoje "${nomeAlvo}": ${deHoje.length} midias de hoje encontradas`);
        jsonResp(res, { ok:true, iniciado:true, total:deHoje.length });
        (async () => {
          let processadas = 0;
          for (const msg of deHoje) {
            try { await processarMidia(msg, remetenteRotulo); processadas++; }
            catch(e) { log(`Erro importar-chat-hoje item: ${e.message}`, 'warn'); }
          }
          log(`Importar-chat-hoje "${nomeAlvo}" concluido: ${processadas}/${deHoje.length} processadas`);
        })();
      } catch(e) {
        log(`Erro importar-chat-hoje: ${e.message}`, 'error');
      }
    })();
    return;
  }

  // Debug temporario: preview das mensagens de um chat pelo nome, sem processar nada
  if (url.startsWith('/api/debug-preview-chat')) {
    (async () => {
      try {
        const nomeAlvo = decodeURIComponent((qs.match(/nome=([^&]*)/) || ['',''])[1]);
        const chats = await client.getChats();
        const chat = chats.find(c => c.name === nomeAlvo);
        if (!chat) return jsonResp(res, { erro:'chat nao encontrado' }, 404);
        const msgs = await chat.fetchMessages({ limit: 200 });
        const preview = msgs.map(m => ({
          data: m.timestamp ? new Date(m.timestamp*1000).toISOString() : null,
          hasMedia: m.hasMedia,
          body: (m.body||'').substring(0,80),
          tipo: m.type
        }));
        return jsonResp(res, { total:msgs.length, comMidia: preview.filter(p=>p.hasMedia).length, preview });
      } catch(e) { return jsonResp(res, { erro:e.message }, 500); }
    })();
    return;
  }

  if (url === '/api/dashboard') {
    const s = db.prepare(`SELECT COALESCE(SUM(valor),0) AS total_depositos, COUNT(*) AS qtd_depositos, COUNT(*) FILTER(WHERE status='ativo') AS depositos_ativos FROM depositos`).get();
    const d = db.prepare(`SELECT COALESCE(SUM(valor),0) AS total_despesas, COUNT(*) AS qtd_despesas, COUNT(*) FILTER(WHERE deposito_id IS NULL) AS sem_deposito FROM despesas WHERE status!='cancelado' AND tipo_doc IN ('comprovante_pix','comprovante_ted','comprovante_boleto')`).get();
    const a = db.prepare(`SELECT COALESCE(SUM(valor),0) AS total_ajustes, COUNT(*) AS qtd_ajustes FROM ajustes`).get();
    // Ajuste manual de saldo conta como deposito (colocar, valor>0) ou despesa (tirar, valor<0)
    // nos totais/cards do dashboard — nao so no calculo isolado do saldo disponivel.
    const aPos = db.prepare(`SELECT COALESCE(SUM(valor),0) v, COUNT(*) n FROM ajustes WHERE valor>0`).get();
    const aNeg = db.prepare(`SELECT COALESCE(SUM(ABS(valor)),0) v, COUNT(*) n FROM ajustes WHERE valor<0`).get();
    s.total_depositos += aPos.v; s.qtd_depositos += aPos.n;
    d.total_despesas  += aNeg.v; d.qtd_despesas  += aNeg.n;
    const saldoIni = db.prepare(`SELECT * FROM saldo_inicial WHERE id=1`).get();
    let saldo_disponivel;
    if (saldoIni) {
      const depPos  = db.prepare(`SELECT COALESCE(SUM(valor),0) v FROM depositos WHERE COALESCE(data_documento,substr(data,1,10)) >= ?`).get(saldoIni.data).v
                     + db.prepare(`SELECT COALESCE(SUM(valor),0) v FROM ajustes WHERE valor>0 AND substr(data,1,10) >= ?`).get(saldoIni.data).v;
      const despPos = db.prepare(`SELECT COALESCE(SUM(valor),0) v FROM despesas WHERE status!='cancelado' AND tipo_doc IN ('comprovante_pix','comprovante_ted','comprovante_boleto') AND COALESCE(data_documento,substr(data,1,10)) >= ?`).get(saldoIni.data).v
                     + db.prepare(`SELECT COALESCE(SUM(ABS(valor)),0) v FROM ajustes WHERE valor<0 AND substr(data,1,10) >= ?`).get(saldoIni.data).v;
      saldo_disponivel = saldoIni.valor + depPos - despPos;
    } else {
      saldo_disponivel = s.total_depositos - d.total_despesas;
    }
    return jsonResp(res, {...s,...d,...a, saldo_inicial: saldoIni||null, saldo_disponivel});
  }

  if (url === '/api/saldo-inicial' && req.method === 'GET') {
    return jsonResp(res, db.prepare(`SELECT * FROM saldo_inicial WHERE id=1`).get() || null);
  }

  if (url === '/api/saldo-inicial' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { valor, data, descricao } = JSON.parse(body);
        const v = parseValor(valor);
        if (!data) return jsonResp(res, { erro:'data obrigatoria (a partir de quando vale este saldo)' }, 400);
        db.prepare(`INSERT INTO saldo_inicial (id,valor,data,descricao) VALUES (1,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET valor=excluded.valor, data=excluded.data, descricao=excluded.descricao, created_at=datetime('now','localtime')`)
          .run(v, data, descricao||null);
        log(`SALDO INICIAL definido — R$ ${v.toFixed(2)} a partir de ${data} — ${descricao||'sem descricao'}`);
        if (sb) sbSync(sb.from('rl_saldo_inicial').upsert({ id: 1, valor: v, data, descricao: descricao||null }), 'saldo inicial');
        return jsonResp(res, { ok:true });
      } catch(e) { return jsonResp(res, { erro:e.message }, 400); }
    });
    return;
  }

  if (req.method === 'DELETE' && url === '/api/saldo-inicial') {
    db.prepare(`DELETE FROM saldo_inicial WHERE id=1`).run();
    log('SALDO INICIAL removido — voltando ao calculo historico completo', 'warn');
    if (sb) sbSync(sb.from('rl_saldo_inicial').delete().eq('id', 1), 'delete saldo inicial');
    return jsonResp(res, { ok:true });
  }

  if (url === '/api/depositos') {
    const rows = db.prepare(`SELECT * FROM depositos ORDER BY data DESC`).all();
    return jsonResp(res, rows.map(r=>({...r, ocr_json: r.ocr_json?JSON.parse(r.ocr_json):null})));
  }

  if (url === '/api/ajustes') {
    const rows = db.prepare(`SELECT * FROM ajustes ORDER BY data DESC`).all();
    return jsonResp(res, rows);
  }

  if (url === '/api/ajuste' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { valor, descricao, data } = JSON.parse(body);
        const v = parseValor(valor);
        if (!v) return jsonResp(res, { erro:'valor obrigatorio e diferente de zero' }, 400);
        const { lastInsertRowid: id } = db.prepare(`INSERT INTO ajustes (data,valor,descricao) VALUES (COALESCE(?, datetime('now','localtime')),?,?)`).run(data||null, v, descricao||null);
        log(`AJUSTE #${id} — ${v>0?'+':''}R$ ${v.toFixed(2)} — ${descricao||'sem descricao'}`);
        if (sb) sbSync(sb.from('rl_ajustes').insert({ id, data: data || new Date().toISOString(), valor: v, descricao: descricao||null }), `ajuste #${id}`);
        return jsonResp(res, { ok:true, id });
      } catch(e) { return jsonResp(res, { erro:e.message }, 400); }
    });
    return;
  }

  if (req.method === 'DELETE' && url.startsWith('/api/ajuste/')) {
    const id = parseInt(url.split('/').pop());
    const aj = db.prepare('SELECT * FROM ajustes WHERE id=?').get(id);
    if (!aj) return jsonResp(res, { erro:'Nao encontrado' }, 404);
    db.prepare('DELETE FROM ajustes WHERE id=?').run(id);
    log(`AJUSTE #${id} excluido (${aj.valor>0?'+':''}R$${aj.valor})`);
    if (sb) sbSync(sb.from('rl_ajustes').delete().eq('id', id), `delete ajuste #${id}`);
    return jsonResp(res, { ok:true });
  }

  if (url === '/api/despesas') {
    // SEM LIMIT: a Conciliacao e o Dashboard do painel calculam saldo no navegador com esta
    // lista. Com LIMIT 500, em 01/10/2026 ficavam de fora 105 despesas (R$ 45.801,04) e o
    // "Saldo Disponivel" aparecia +R$ 37.179,64 quando o real era -R$ 8.201,40.
    const rows = db.prepare(`SELECT * FROM despesas ORDER BY data DESC`).all();
    return jsonResp(res, rows.map(r=>({...r, ocr_json: r.ocr_json?JSON.parse(r.ocr_json):null})));
  }

  if (url === '/api/conciliacao') {
    const deps = db.prepare(`SELECT * FROM depositos ORDER BY data DESC LIMIT 100`).all();
    return jsonResp(res, deps.map(dep => {
      const despesas = db.prepare(`SELECT * FROM despesas WHERE deposito_id=? AND status!='cancelado' ORDER BY data DESC`).all(dep.id);
      const total = despesas.filter(d=>ehDespesaReal(d.tipo_doc)).reduce((s,d) => s+(Number(d.valor)||0), 0);
      return { ...dep, ocr_json: dep.ocr_json?JSON.parse(dep.ocr_json):null,
        despesas: despesas.map(d=>({...d, ocr_json:d.ocr_json?JSON.parse(d.ocr_json):null})),
        qtd_despesas: despesas.length, total_despesas: total,
        pct_utilizado: dep.valor>0 ? Math.round((total/dep.valor)*1000)/10 : 0 };
    }));
  }

  if (url === '/api/fornecedores') {
    const rows = db.prepare(`SELECT f.nome,f.total_gasto,f.total_ocorrencias,f.updated_at FROM fornecedores f ORDER BY f.total_gasto DESC`).all();
    return jsonResp(res, rows);
  }

  if (url === '/api/busca-index') {
    const forn = db.prepare(`SELECT fornecedor AS nome, SUM(valor) AS total, COUNT(*) AS qtd FROM despesas WHERE fornecedor IS NOT NULL GROUP BY fornecedor ORDER BY total DESC LIMIT 30`).all();
    const tipos = db.prepare(`SELECT tipo_doc AS nome, SUM(valor) AS total, COUNT(*) AS qtd FROM despesas WHERE tipo_doc IS NOT NULL GROUP BY tipo_doc ORDER BY total DESC`).all();
    const placas = db.prepare(`SELECT placa AS nome, SUM(valor) AS total, COUNT(*) AS qtd FROM despesas WHERE placa IS NOT NULL GROUP BY placa ORDER BY total DESC LIMIT 20`).all();
    const servicos = db.prepare(`SELECT servico AS nome, SUM(valor) AS total, COUNT(*) AS qtd FROM despesas WHERE servico IS NOT NULL GROUP BY servico ORDER BY total DESC LIMIT 15`).all();
    return jsonResp(res, { fornecedores:forn, tipos, placas, servicos });
  }

  if (url.startsWith('/api/busca')) {
    const q = decodeURIComponent((qs.match(/q=([^&]*)/) || ['',''])[1]);
    const di = decodeURIComponent((qs.match(/di=([^&]*)/) || ['',''])[1]);
    const df = decodeURIComponent((qs.match(/df=([^&]*)/) || ['',''])[1]);
    const qp = '%' + q + '%';
    let sql = `SELECT * FROM despesas WHERE (fornecedor LIKE ? OR placa LIKE ? OR nf LIKE ? OR descricao LIKE ? OR pix LIKE ? OR banco LIKE ? OR servico LIKE ? OR tipo_doc LIKE ?)`;
    const params = [qp,qp,qp,qp,qp,qp,qp,qp];
    if (di) { sql += ` AND COALESCE(data_documento,data) >= ?`; params.push(di); }
    if (df) { sql += ` AND COALESCE(data_documento,data) <= ?`; params.push(df + ' 23:59:59'); }
    sql += ` ORDER BY COALESCE(data_documento,data) DESC LIMIT 200`;
    const rows = db.prepare(sql).all(...params);
    return jsonResp(res, rows);
  }

  if (url.startsWith('/api/periodo')) {
    const di = decodeURIComponent((qs.match(/di=([^&]*)/) || ['',''])[1]) || '2000-01-01';
    const df = decodeURIComponent((qs.match(/df=([^&]*)/) || ['',''])[1]) || '2099-12-31';
    const dfFull = df + ' 23:59:59';
    const deps = db.prepare(`SELECT * FROM depositos WHERE COALESCE(data_documento,data) BETWEEN ? AND ? ORDER BY COALESCE(data_documento,data) DESC`).all(di, dfFull);
    const desps = db.prepare(`SELECT * FROM despesas WHERE COALESCE(data_documento,data) BETWEEN ? AND ? AND status!='cancelado' ORDER BY COALESCE(data_documento,data) DESC`).all(di, dfFull);
    const totalDep = deps.reduce((s,d)=>s+parseValor(d.valor), 0);
    const totalDesp = desps.filter(d=>ehDespesaReal(d.tipo_doc)).reduce((s,d)=>s+parseValor(d.valor), 0);
    const porForn = {};
    desps.filter(d=>ehDespesaReal(d.tipo_doc)).forEach(d => {
      const k = d.fornecedor || 'Sem fornecedor';
      if(!porForn[k]) porForn[k]={nome:k,total:0,qtd:0,tipo:d.tipo_doc};
      porForn[k].total += parseValor(d.valor); porForn[k].qtd++;
    });
    const porTipo = {};
    desps.forEach(d => {
      const k = d.tipo_doc || 'outros';
      if(!porTipo[k]) porTipo[k]={tipo:k,total:0,qtd:0};
      porTipo[k].total += parseValor(d.valor); porTipo[k].qtd++;
    });
    return jsonResp(res, {
      periodo:{di,df},
      depositos:{total:totalDep, qtd:deps.length, itens:deps},
      despesas:{total:totalDesp, qtd:desps.length, itens:desps},
      saldo: totalDep - totalDesp,
      por_fornecedor: Object.values(porForn).sort((a,b)=>b.total-a.total),
      por_tipo: Object.values(porTipo).sort((a,b)=>b.total-a.total)
    });
  }

  if (url === '/api/auditoria') {
    // Fotos duplicadas CONFIRMADAS: mesmo codigo de autenticacao do banco (Cora/Itau/etc)
    // E mesma data+hora+minuto+segundo do comprovante — praticamente certeza absoluta de
    // ser a mesma foto/pagamento reenviado (nao apenas "parece igual"). Usado pro menu
    // dedicado "Fotos Duplicadas" na Auditoria, separado dos alertas genericos.
    const fotoDupConfirmada = db.prepare(`SELECT 'Foto Duplicada Confirmada' AS tipo_alerta,(fornecedor||' — autenticação '||autenticacao) AS referencia,COUNT(*) AS ocorrencias,SUM(valor) AS valor_total,MIN(data) AS primeira,MAX(data) AS ultima,'despesa' AS tabela,GROUP_CONCAT(id) AS ids FROM despesas WHERE autenticacao IS NOT NULL AND status!='cancelado' GROUP BY autenticacao,COALESCE(data_documento,substr(data,1,10)),hora_documento HAVING COUNT(*)>1`).all();
    const hashDupDesp    = db.prepare(`SELECT 'Foto Identica Reenviada (Despesa)' AS tipo_alerta,('hash '||substr(arquivo_hash,1,10)) AS referencia,COUNT(*) AS ocorrencias,SUM(valor) AS valor_total,MIN(data) AS primeira,MAX(data) AS ultima,'despesa' AS tabela,GROUP_CONCAT(id) AS ids FROM despesas WHERE arquivo_hash IS NOT NULL AND status!='cancelado' GROUP BY arquivo_hash HAVING COUNT(*)>1`).all();
    const hashDupDep     = db.prepare(`SELECT 'Foto Identica Reenviada (Deposito)' AS tipo_alerta,('hash '||substr(arquivo_hash,1,10)) AS referencia,COUNT(*) AS ocorrencias,SUM(valor) AS valor_total,MIN(data) AS primeira,MAX(data) AS ultima,'deposito' AS tabela,GROUP_CONCAT(id) AS ids FROM depositos WHERE arquivo_hash IS NOT NULL GROUP BY arquivo_hash HAVING COUNT(*)>1`).all();
    const arquivoDupDesp = db.prepare(`SELECT 'Despesa - Arquivo Duplicado' AS tipo_alerta,arquivo AS referencia,COUNT(*) AS ocorrencias,SUM(valor) AS valor_total,MIN(data) AS primeira,MAX(data) AS ultima,'despesa' AS tabela,GROUP_CONCAT(id) AS ids FROM despesas WHERE arquivo IS NOT NULL AND status!='cancelado' GROUP BY arquivo HAVING COUNT(*)>1`).all();
    const arquivoDupDep  = db.prepare(`SELECT 'Deposito - Arquivo Duplicado' AS tipo_alerta,arquivo AS referencia,COUNT(*) AS ocorrencias,SUM(valor) AS valor_total,MIN(data) AS primeira,MAX(data) AS ultima,'deposito' AS tabela,GROUP_CONCAT(id) AS ids FROM depositos WHERE arquivo IS NOT NULL GROUP BY arquivo HAVING COUNT(*)>1`).all();
    // So conta como duplicidade se fornecedor+valor+data baterem E o horario (quando conhecido nos dois) tambem bater.
    // Horario desconhecido (NULL) agrupa junto por COALESCE('') — mantem o comportamento antigo quando o comprovante nao mostra hora.
    const valorDataDup   = db.prepare(`SELECT 'Possivel Lancamento Duplicado' AS tipo_alerta,(fornecedor||' — R$ '||valor) AS referencia,COUNT(*) AS ocorrencias,SUM(valor) AS valor_total,MIN(data) AS primeira,MAX(data) AS ultima,'despesa' AS tabela,GROUP_CONCAT(id) AS ids FROM despesas WHERE valor>0 AND fornecedor IS NOT NULL AND status!='cancelado' GROUP BY fornecedor,valor,COALESCE(data_documento,substr(data,1,10)),COALESCE(hora_documento,'') HAVING COUNT(*)>1`).all();
    const nfDup = db.prepare(`SELECT 'NF Duplicada' AS tipo_alerta,nf AS referencia,COUNT(*) AS ocorrencias,SUM(valor) AS valor_total,MIN(data) AS primeira,MAX(data) AS ultima,'despesa' AS tabela,GROUP_CONCAT(id) AS ids FROM despesas WHERE nf IS NOT NULL AND status!='cancelado' GROUP BY nf HAVING COUNT(*)>1`).all();
    const semDep = db.prepare(`SELECT 'Despesa sem Deposito' AS tipo_alerta,descricao AS referencia,1 AS ocorrencias,valor AS valor_total,data AS primeira,data AS ultima,'despesa' AS tabela,CAST(id AS TEXT) AS ids FROM despesas WHERE deposito_id IS NULL AND status='confirmado' LIMIT 50`).all();
    const altosVal = db.prepare(`SELECT 'Valor Alto' AS tipo_alerta,descricao AS referencia,1 AS ocorrencias,valor AS valor_total,data AS primeira,data AS ultima,'despesa' AS tabela,CAST(id AS TEXT) AS ids FROM despesas WHERE valor>20000 AND status='confirmado'`).all();

    // Arquivo referenciado no banco mas ausente no disco (ex: perdido em falha de gravacao ou limpeza manual)
    const despComArquivo = db.prepare(`SELECT id,fornecedor,arquivo,valor,data,data_documento FROM despesas WHERE arquivo IS NOT NULL AND status!='cancelado'`).all();
    const depComArquivo  = db.prepare(`SELECT id,remetente,arquivo,valor,data,data_documento FROM depositos WHERE arquivo IS NOT NULL`).all();
    const faltandoDesp = despComArquivo.filter(d => !fs.existsSync(path.join(PASTA_FOTOS, d.arquivo)));
    const faltandoDep  = depComArquivo.filter(d => !fs.existsSync(path.join(PASTA_FOTOS, d.arquivo)));
    const arquivoAusente = [];
    if (faltandoDesp.length) arquivoAusente.push({ tipo_alerta:'Arquivo Ausente (Despesa)', referencia:`${faltandoDesp.length} lançamento(s) sem foto no servidor`, ocorrencias:faltandoDesp.length, valor_total:faltandoDesp.reduce((s,d)=>s+(d.valor||0),0), primeira:faltandoDesp.reduce((m,d)=>!m||d.data<m?d.data:m,null), ultima:faltandoDesp.reduce((m,d)=>!m||d.data>m?d.data:m,null), tabela:'despesa', ids:faltandoDesp.map(d=>d.id).join(',') });
    if (faltandoDep.length)  arquivoAusente.push({ tipo_alerta:'Arquivo Ausente (Deposito)', referencia:`${faltandoDep.length} depósito(s) sem foto no servidor`, ocorrencias:faltandoDep.length, valor_total:faltandoDep.reduce((s,d)=>s+(d.valor||0),0), primeira:faltandoDep.reduce((m,d)=>!m||d.data<m?d.data:m,null), ultima:faltandoDep.reduce((m,d)=>!m||d.data>m?d.data:m,null), tabela:'deposito', ids:faltandoDep.map(d=>d.id).join(',') });

    return jsonResp(res, [...fotoDupConfirmada,...hashDupDesp,...hashDupDep,...arquivoDupDesp,...arquivoDupDep,...valorDataDup,...nfDup,...semDep,...altosVal,...arquivoAusente]);
  }

  // ── REPROCESSAR ZERADAS (despesas e depositos, revalida com IA, roda em 2º plano) ──
  if (url === '/api/reprocessar-zeradas' && req.method === 'POST') {
    reprocessarZeradas().then(r => jsonResp(res, r, r.erro ? (reprocessStatus.rodando ? 409 : 400) : 200))
      .catch(e => jsonResp(res, { erro:e.message }, 500));
    return;
  }

  // ── RECUPERAR PERIODO (lacuna de mensagens do WhatsApp) ──
  // GET/POST /api/recuperar-periodo?de=2026-09-19&ate=2026-09-27[&simular=1]
  // simular=1: so lista as midias do periodo e se ja viraram lancamento (nao grava nada).
  if (url.startsWith('/api/recuperar-periodo') && !url.startsWith('/api/recuperar-periodo-status')) {
    (async () => {
      try {
        const de  = (qs.match(/de=(\d{4}-\d{2}-\d{2})/)  || [])[1];
        const ate = (qs.match(/ate=(\d{4}-\d{2}-\d{2})/) || [])[1];
        const simular = /simular=1/.test(qs);
        if (!de || !ate) return jsonResp(res, { erro:'informe de=AAAA-MM-DD e ate=AAAA-MM-DD' }, 400);
        if (!waPronto) return jsonResp(res, { erro:'WhatsApp nao conectado' }, 503);
        const deMs  = new Date(de + 'T00:00:00-03:00').getTime();
        const ateMs = new Date(ate + 'T23:59:59-03:00').getTime();
        const grupo = await acharGrupo();
        if (!grupo) return jsonResp(res, { erro:'grupo nao encontrado' }, 404);
        const { msgs, cobriu, maisAntiga } = await buscarMensagensDesde(grupo, deMs, { maxTentativas: 10, esperaMs: 25000, limiteInicial: 2000 });
        const doPeriodo = msgs.filter(m => m.hasMedia && m.timestamp*1000 >= deMs && m.timestamp*1000 <= ateMs);
        const itens = [];
        for (const m of doPeriodo) {
          let nome = '?';
          try { const c = await m.getContact(); nome = c.pushname || c.name || c.number || 'Desconhecido'; } catch(e) {}
          itens.push({ data: new Date(m.timestamp*1000).toLocaleString('pt-BR'), remetente: nome, tipo: m.type, legenda: (m.body||'').substring(0,80), ja_lancada: mensagemJaLancada(m), _msg: m });
        }
        const resumo = { cobriu, mais_antiga: isFinite(maisAntiga) ? new Date(maisAntiga).toLocaleString('pt-BR') : null, total_msgs_carregadas: msgs.length, midias_no_periodo: itens.length, faltando: itens.filter(i => !i.ja_lancada).length };
        const lista = itens.map(({ _msg, ...r }) => r);
        if (simular) return jsonResp(res, { ok:true, simulacao:true, ...resumo, itens: lista });
        jsonResp(res, { ok:true, iniciado:true, ...resumo });
        let novas = 0, erros = 0;
        for (const it of itens.filter(i => !i.ja_lancada)) {
          try { const r = await processarMidia(it._msg, it.remetente); if (r === 'erro_download') erros++; else if (!["ja_lancada","duplicada","concorrente"].includes(r)) novas++; }
          catch(e) { erros++; log(`Erro recuperar-periodo item: ${e.message}`, 'warn'); }
        }
        sincronizarSupabase('recuperar periodo');
        log(`Recuperar periodo ${de} a ${ate} concluido: ${novas} lancadas, ${erros} erros`);
      } catch(e) {
        log(`Erro recuperar-periodo: ${e.message}`, 'error');
        try { jsonResp(res, { erro:e.message }, 500); } catch(_) {}
      }
    })();
    return;
  }

  if (url === '/api/reprocessar-status') return jsonResp(res, reprocessStatus);

  // ── FORCAR BUSCA DE MENSAGENS NAO LIDAS (sob demanda, ex: apos instabilidade de conexao) ──
  if (url === '/api/reprocessar-nao-lidas' && req.method === 'POST') {
    processarMensagensPerdidas()
      .then(r => jsonResp(res, r))
      .catch(e => jsonResp(res, { erro: e.message }, 500));
    return;
  }

  // ── REPROCESSAR UMA DESPESA ESPECIFICA (sob demanda, ex: pegar horario p/ checar duplicidade) ──
  if (url.match(/^\/api\/reprocessar-item\/\d+$/) && req.method === 'POST') {
    (async () => {
      try {
        if (!ai) return jsonResp(res, { erro:'IA nao configurada (GEMINI_API_KEY ausente)' }, 400);
        const id = parseInt(url.split('/').pop());
        const d = db.prepare('SELECT * FROM despesas WHERE id=?').get(id);
        if (!d) return jsonResp(res, { erro:'Despesa nao encontrada' }, 404);
        if (!d.arquivo) return jsonResp(res, { erro:'Despesa sem arquivo salvo' }, 400);
        const fPath = path.join(PASTA_FOTOS, d.arquivo);
        if (!fs.existsSync(fPath)) return jsonResp(res, { erro:'Arquivo nao encontrado no servidor' }, 404);

        const ext = path.extname(d.arquivo).toLowerCase();
        const mimetype = ext === '.pdf' ? 'application/pdf' : (MIME_MAP[ext] || 'image/jpeg');
        const base64 = fs.readFileSync(fPath).toString('base64');
        const dadosIA = await extrairComIA(base64, mimetype);

        const valor = parseValor(dadosIA?.valor);
        const placa = formatarPlaca(dadosIA?.placa) || extrairPlacaDeTexto(dadosIA?.descricao) || extrairPlacaDeTexto(d.descricao);
        const isOrcamento = !!(dadosIA?.is_orcamento || dadosIA?.tipo_doc === 'orcamento');
        const contaComoDespesa = ehDespesaReal(dadosIA?.tipo_doc) && !isOrcamento;
        let fornecedor = dadosIA?.fornecedor || null;
        let descricao  = dadosIA?.descricao || d.descricao;
        if (!fornecedor && descricao) fornecedor = descricao;
        const dataDoc = extrairDataDocumento(JSON.stringify(dadosIA));
        const horaDoc = extrairHoraDocumento(JSON.stringify(dadosIA));
        const servico = dadosIA?.servico || inferirServicoPorFornecedor(fornecedor);
        db.prepare(`UPDATE despesas SET valor=?,fornecedor=?,servico=?,placa=?,nf=?,cnpj=?,banco=?,pix=?,tipo_doc=?,descricao=?,arquivo_hash=?,ocr_json=?,confianca=?,data_documento=?,hora_documento=?,autenticacao=? WHERE id=?`)
          .run(valor, fornecedor, servico||null, placa, dadosIA?.nf||null, dadosIA?.cnpj||null, dadosIA?.banco||null, dadosIA?.pix||null, dadosIA?.tipo_doc||'outros', descricao, hashArquivo(d.arquivo), JSON.stringify(dadosIA), dadosIA?.confianca||null, dataDoc, horaDoc, dadosIA?.autenticacao||null, id);
        if (fornecedor && valor && contaComoDespesa) stmtUpdForn.run(fornecedor, valor, valor);
        log(`Reprocessado sob demanda despesa #${id} — R$ ${valor.toFixed(2)} — ${fornecedor||'?'} — hora:${horaDoc||'nao encontrada'}`);
        sincronizarSupabase(`reprocessar item #${id}`);
        return jsonResp(res, { ok:true, despesa: db.prepare('SELECT * FROM despesas WHERE id=?').get(id) });
      } catch(e) {
        log(`Erro reprocessar-item: ${e.message}`, 'error');
        return jsonResp(res, { erro:e.message }, 500);
      }
    })();
    return;
  }

  // ── RECONCILIAR FIFO (revincula despesas a depositos pela data real) ──
  if (url === '/api/reconciliar-fifo' && req.method === 'POST') {
    try {
      db.pragma('foreign_keys = OFF');
      db.prepare(`UPDATE depositos SET saldo_restante=valor, status='ativo'`).run();
      db.prepare(`UPDATE despesas SET deposito_id=NULL`).run();

      const depositos = db.prepare(`SELECT id,valor FROM depositos ORDER BY COALESCE(data_documento,substr(data,1,10)) ASC, id ASC`).all();
      const despesas  = db.prepare(`SELECT id,valor,tipo_doc FROM despesas WHERE status!='cancelado' AND tipo_doc IN ('comprovante_pix','comprovante_ted','comprovante_boleto') ORDER BY COALESCE(data_documento,substr(data,1,10)) ASC, id ASC`).all();

      const fila = depositos.map(d => ({ id: d.id, saldo: d.valor }));
      let vinculadas = 0, semSaldo = 0;
      for (const desp of despesas) {
        let restante = desp.valor || 0;
        if (restante <= 0) continue;
        for (const dep of fila) {
          if (dep.saldo <= 0) continue;
          if (dep.saldo >= restante) {
            dep.saldo -= restante;
            db.prepare(`UPDATE despesas SET deposito_id=? WHERE id=?`).run(dep.id, desp.id);
            restante = 0;
            break;
          } else {
            restante -= dep.saldo;
            dep.saldo = 0;
          }
        }
        if (restante > 0) semSaldo++; else vinculadas++;
      }
      fila.forEach(dep => {
        db.prepare(`UPDATE depositos SET saldo_restante=?, status=? WHERE id=?`).run(dep.saldo, dep.saldo>0?'ativo':'esgotado', dep.id);
      });
      db.pragma('foreign_keys = ON');
      log(`Reconciliacao FIFO concluida: ${vinculadas} despesas vinculadas, ${semSaldo} sem saldo suficiente (de ${despesas.length} comprovantes bancarios)`, 'warn');
      sincronizarSupabase('conciliacao FIFO');
      return jsonResp(res, { ok:true, total:despesas.length, vinculadas, sem_saldo:semSaldo });
    } catch(e) {
      log(`Erro reconciliar-fifo: ${e.message}`, 'error');
      return jsonResp(res, { erro:e.message }, 500);
    }
  }

  // ── LIMPAR TUDO (reset em lote p/ reimportar sem duplicidade) ──
  if (url === '/api/limpar-tudo' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const apagarArquivos = !!parsed.apagarArquivos;
        const qtdDesp = db.prepare('SELECT COUNT(*) c FROM despesas').get().c;
        const qtdDep  = db.prepare('SELECT COUNT(*) c FROM depositos').get().c;
        db.pragma('foreign_keys = OFF');
        db.prepare('DELETE FROM despesas').run();
        db.prepare('DELETE FROM depositos').run();
        db.prepare('DELETE FROM fornecedores').run();
        try { db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('depositos','despesas','fornecedores')").run(); } catch(e) {}
        seedForn.forEach(f => stmtSeedForn.run(f.nome, JSON.stringify(f.aliases), JSON.stringify(f.servicos)));
        db.pragma('foreign_keys = ON');
        let arquivosApagados = 0;
        if (apagarArquivos) {
          fs.readdirSync(PASTA_FOTOS).forEach(f => {
            try { fs.unlinkSync(path.join(PASTA_FOTOS, f)); arquivosApagados++; } catch(e) {}
          });
        }
        log(`LIMPAR TUDO executado: ${qtdDesp} despesas + ${qtdDep} depositos removidos${apagarArquivos?` + ${arquivosApagados} arquivos apagados`:''}`, 'warn');
        return jsonResp(res, { ok:true, despesas_removidas:qtdDesp, depositos_removidos:qtdDep, arquivos_apagados:arquivosApagados });
      } catch(e) { return jsonResp(res, { erro:e.message }, 400); }
    });
    return;
  }

  if (url === '/api/logs') {
    const rows = db.prepare(`SELECT * FROM logs ORDER BY ts DESC LIMIT 300`).all();
    return jsonResp(res, rows);
  }

  // ── GERAR PDF REAL (via Puppeteer) ───────────────────────────
  if (url === '/api/gerar-pdf' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { html, nome } = JSON.parse(body);
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '1.5cm', bottom: '1.5cm', left: '1.5cm', right: '1.5cm' }
        });
        await browser.close();
        const nomeArq = (nome || 'RL_TRANSPORTES') + '.pdf';
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${nomeArq}"`,
          'Content-Length': pdfBuffer.length
        });
        res.end(pdfBuffer);
        log(`PDF gerado: ${nomeArq} (${(pdfBuffer.length/1024).toFixed(0)}KB)`);
      } catch(e) {
        log(`Erro gerar PDF: ${e.message}`, 'error');
        jsonResp(res, { erro: e.message }, 500);
      }
    });
    return;
  }

  if (url === '/api/gastos_placa') {
    const rows = db.prepare(`SELECT COALESCE(placa,'Sem placa') AS placa,COUNT(*) AS total_servicos,COALESCE(SUM(valor),0) AS total_gasto,MAX(data) AS ultimo_servico FROM despesas WHERE status!='cancelado' AND tipo_doc IN ('comprovante_pix','comprovante_ted','comprovante_boleto') GROUP BY placa ORDER BY total_gasto DESC`).all();
    return jsonResp(res, rows);
  }

  if (req.method === 'PATCH' && url.startsWith('/api/aprovar/')) {
    const id = parseInt(url.split('/').pop());
    db.prepare(`UPDATE despesas SET status='confirmado' WHERE id=?`).run(id);
    return jsonResp(res, { ok:true });
  }

  if (req.method === 'PATCH' && url.startsWith('/api/despesa/')) {
    const id = parseInt(url.split('/').pop());
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const fields = [], vals = [];
        if (data.valor      !== undefined) { fields.push('valor=?');      vals.push(data.valor); }
        if (data.fornecedor !== undefined) { fields.push('fornecedor=?'); vals.push(data.fornecedor); }
        if (data.servico    !== undefined) { fields.push('servico=?');    vals.push(data.servico); }
        if (data.placa      !== undefined) { fields.push('placa=?');      vals.push(formatarPlaca(data.placa)); }
        if (data.status     !== undefined) { fields.push('status=?');     vals.push(data.status); }
        if (fields.length) {
          vals.push(id); db.prepare(`UPDATE despesas SET ${fields.join(',')} WHERE id=?`).run(...vals);
          if (sb) {
            const patch = {};
            if (data.valor !== undefined) patch.valor = data.valor;
            if (data.fornecedor !== undefined) patch.fornecedor = data.fornecedor;
            if (data.servico !== undefined) patch.servico = data.servico;
            if (data.placa !== undefined) patch.placa = formatarPlaca(data.placa);
            if (data.status !== undefined) patch.status = data.status;
            sbSync(sb.from('rl_despesas').update(patch).eq('id', id), `patch despesa #${id}`);
          }
        }
        return jsonResp(res, { ok:true });
      } catch { return jsonResp(res, { erro:'JSON invalido' }, 400); }
    });
    return;
  }

  if (req.method === 'PATCH' && url.startsWith('/api/deposito/')) {
    const id = parseInt(url.split('/').pop());
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const fields = [], vals = [];
        if (data.valor      !== undefined) { fields.push('valor=?');      vals.push(data.valor); }
        if (data.remetente  !== undefined) { fields.push('remetente=?');  vals.push(data.remetente); }
        if (data.banco      !== undefined) { fields.push('banco=?');      vals.push(data.banco); }
        if (data.pix        !== undefined) { fields.push('pix=?');        vals.push(data.pix); }
        if (fields.length) {
          vals.push(id); db.prepare(`UPDATE depositos SET ${fields.join(',')} WHERE id=?`).run(...vals);
          if (sb) {
            const patch = {};
            if (data.valor !== undefined) patch.valor = data.valor;
            if (data.remetente !== undefined) patch.remetente = data.remetente;
            if (data.banco !== undefined) patch.banco = data.banco;
            if (data.pix !== undefined) patch.pix = data.pix;
            sbSync(sb.from('rl_depositos').update(patch).eq('id', id), `patch deposito #${id}`);
          }
        }
        return jsonResp(res, { ok:true });
      } catch { return jsonResp(res, { erro:'JSON invalido' }, 400); }
    });
    return;
  }

  if (url.startsWith('/fotos/')) {
    const nome  = path.basename(url.replace('/fotos/',''));
    const fPath = path.join(PASTA_FOTOS, nome);
    if (fs.existsSync(fPath)) {
      const mime = MIME_MAP[path.extname(fPath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime,'Access-Control-Allow-Origin':'*'});
      return res.end(fs.readFileSync(fPath));
    }
    return jsonResp(res, { erro:'Nao encontrado' }, 404);
  }

  // ── RESTAURAR BACKUP ───────────────────────────────────────────
  if (url === '/api/restaurar' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const registros = JSON.parse(body);
        if (!Array.isArray(registros)) return jsonResp(res, { erro:'JSON deve ser array' }, 400);
        db.pragma('foreign_keys = OFF');
        db.prepare('DELETE FROM despesas').run();
        db.prepare('DELETE FROM depositos').run();
        try { db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('depositos','despesas')").run(); } catch(e) {}
        const deps  = registros.filter(r => r.tipo === 'deposito').sort((a,b) => (a.data||'').localeCompare(b.data||''));
        const desps = registros.filter(r => r.tipo === 'despesa').sort((a,b)  => (a.data||'').localeCompare(b.data||''));
        const insD = db.prepare(`INSERT INTO depositos (data,valor,remetente,descricao,arquivo,saldo_restante,status) VALUES (?,?,?,?,?,?,?)`);
        deps.forEach(d => insD.run(d.data||'2026-01-01', d.valor||0, d.remetente||'Paulo', d.descricao||'', d.arquivo||null, d.valor||0, 'ativo'));
        const insE = db.prepare(`INSERT INTO despesas (data,valor,remetente,descricao,arquivo,fornecedor,servico,status) VALUES (?,?,?,?,?,?,?,?)`);
        desps.forEach(d => {
          const forn = (d.descricao||'').replace(/\.(jpeg|jpg|png|pdf)/gi,'').replace(/ - .*/,'').trim() || d.categoria || '';
          insE.run(d.data||'2026-01-01', d.valor||0, d.remetente||'', d.descricao||'', d.arquivo||null, forn, d.categoria||'', d.status||'confirmado');
        });
        // FIFO
        db.prepare('SELECT id,valor FROM despesas ORDER BY data ASC').all().forEach(desp => {
          const dep = db.prepare("SELECT id,saldo_restante FROM depositos WHERE status='ativo' AND saldo_restante>0 ORDER BY data ASC LIMIT 1").get();
          if (dep) {
            db.prepare('UPDATE despesas SET deposito_id=? WHERE id=?').run(dep.id, desp.id);
            const novo = Math.max(0, dep.saldo_restante - desp.valor);
            db.prepare("UPDATE depositos SET saldo_restante=?,status=? WHERE id=?").run(novo, novo<=0?'esgotado':'ativo', dep.id);
          }
        });
        db.pragma('foreign_keys = ON');
        log(`Backup restaurado via API: ${deps.length} depósitos, ${desps.length} despesas`);
        if (sb) sbFullResync();
        return jsonResp(res, { ok:true, depositos:deps.length, despesas:desps.length });
      } catch(e) { return jsonResp(res, { erro:e.message }, 400); }
    });
    return;
  }

  // ── PROCESSAR HISTORICO DO GRUPO (roda em 2º plano) ────────────
  if (url === '/api/processar-historico' && req.method === 'POST') {
    if (historicoStatus.rodando) return jsonResp(res, { erro:'Ja existe uma varredura de historico em andamento', status:historicoStatus }, 409);
    const limite = parseInt((qs.match(/limite=(\d+)/) || ['','200'])[1]) || 200;
    historicoStatus = { rodando:true, totalMsgs:0, totalMidias:0, processados:0, pulados:0, erros:0, atual:null, iniciadoEm:new Date().toISOString(), concluidoEm:null };
    jsonResp(res, { ok:true, iniciado:true });
    (async () => {
      try {
        const chats = await client.getChats();
        const chat = chats.find(c => c.name && c.name.includes(GRUPO_ALVO));
        if (!chat) { log('Historico: grupo nao encontrado', 'error'); historicoStatus.rodando=false; historicoStatus.concluidoEm=new Date().toISOString(); return; }
        const msgs = await chat.fetchMessages({ limit: limite });
        const mediaMsgs = msgs.filter(m => m.hasMedia);
        historicoStatus.totalMsgs = msgs.length;
        historicoStatus.totalMidias = mediaMsgs.length;
        log(`Historico: ${msgs.length} msgs, ${mediaMsgs.length} com midia`);
        const jaExistentes = new Set(fs.readdirSync(PASTA_FOTOS));
        for (const msg of mediaMsgs) {
          try {
            const contact = await msg.getContact();
            const nome = contact.pushname || contact.name || contact.number || 'Desconhecido';
            historicoStatus.atual = nome;
            const tsMsg = new Date(msg.timestamp * 1000).getTime();
            const jaSalvo = [...jaExistentes].some(f => f.startsWith(`WA_${tsMsg}`));
            if (jaSalvo) { historicoStatus.pulados++; continue; }
            await processarMidia(msg, nome);
            historicoStatus.processados++;
          } catch(e) {
            log(`Erro historico msg: ${e.message}`, 'error');
            historicoStatus.erros++;
          }
        }
        log(`Historico concluido: ${historicoStatus.processados} processados, ${historicoStatus.pulados} pulados, ${historicoStatus.erros} erros`);
      } catch(e) {
        log(`Erro processar historico: ${e.message}`, 'error');
      }
      historicoStatus.rodando = false;
      historicoStatus.atual = null;
      historicoStatus.concluidoEm = new Date().toISOString();
    })();
    return;
  }

  if (url === '/api/processar-historico-status') return jsonResp(res, historicoStatus);

  // ── RECUPERAR ARQUIVOS AUSENTES (rebusca a mensagem original no WhatsApp pelo horario) ──
  if (url === '/api/recuperar-arquivos-ausentes' && req.method === 'POST') {
    if (recuperacaoStatus.rodando) return jsonResp(res, { erro:'Ja existe uma recuperacao em andamento', status:recuperacaoStatus }, 409);

    const despFaltando = db.prepare(`SELECT id,arquivo FROM despesas WHERE arquivo IS NOT NULL AND status!='cancelado'`).all().filter(d => !fs.existsSync(path.join(PASTA_FOTOS, d.arquivo)));
    const depFaltando  = db.prepare(`SELECT id,arquivo FROM depositos WHERE arquivo IS NOT NULL`).all().filter(d => !fs.existsSync(path.join(PASTA_FOTOS, d.arquivo)));
    const arquivosUnicos = [...new Set([...despFaltando,...depFaltando].map(d => d.arquivo))].filter(a => a.startsWith('WA_'));

    recuperacaoStatus = { rodando:true, totalFaltando:arquivosUnicos.length, recuperados:0, naoEncontrados:0, atual:null, iniciadoEm:new Date().toISOString(), concluidoEm:null };
    jsonResp(res, { ok:true, iniciado:true, total:arquivosUnicos.length });

    (async () => {
      try {
        const chats = await client.getChats();
        const chat = chats.find(c => c.name && c.name.includes(GRUPO_ALVO));
        if (!chat) { log('Recuperacao: grupo nao encontrado', 'error'); recuperacaoStatus.rodando=false; recuperacaoStatus.concluidoEm=new Date().toISOString(); return; }

        const msgs = await chat.fetchMessages({ limit: 3000 });
        const mediaMsgs = msgs.filter(m => m.hasMedia);
        log(`Recuperacao: buscando entre ${mediaMsgs.length} mensagens com midia disponiveis`);

        // Mensagens ja usadas nesta rodada — evita que duas fotos enviadas no mesmo segundo
        // (msg.timestamp so tem resolucao de 1s) sejam confundidas e recebam o mesmo conteudo.
        const usadas = new Set();
        for (const arquivo of arquivosUnicos) {
          recuperacaoStatus.atual = arquivo;
          // Formato novo: WA_{ts}_{idMsg}_{remetente}.ext — idMsg identifica a mensagem com precisao.
          // Formato antigo (antes do fix de colisao): WA_{ts}_{codigo}.ext — codigo nao e garantidamente
          // um id de mensagem real, entao so da pra casar por timestamp (risco de colisao se houver
          // mais de uma midia no mesmo segundo, mas e o melhor disponivel pra esses arquivos antigos).
          const mNovo = arquivo.match(/^WA_(\d+)_([A-Za-z0-9]+)_/);
          const mAntigo = arquivo.match(/^WA_(\d+)_/);
          if (!mNovo && !mAntigo) { recuperacaoStatus.naoEncontrados++; continue; }
          const tsAlvo = parseInt((mNovo||mAntigo)[1]);
          const idAlvo = mNovo ? mNovo[2] : null;
          const candidatos = mediaMsgs.filter(msg => Math.round(msg.timestamp * 1000) === tsAlvo && !usadas.has(msg.id?.id));
          let msgAlvo = idAlvo
            ? candidatos.find(msg => (msg.id?.id||'').replace(/[^A-Za-z0-9]/g,'').substring(0,12) === idAlvo)
            : null;
          if (!msgAlvo) msgAlvo = candidatos[0]; // fallback: so timestamp bateu (formato antigo, ou id nao confere)
          if (!msgAlvo) { recuperacaoStatus.naoEncontrados++; log(`Recuperacao: mensagem nao encontrada para ${arquivo}`, 'warn'); continue; }
          if (msgAlvo.id?.id) usadas.add(msgAlvo.id.id);
          try {
            const media = await msgAlvo.downloadMedia();
            if (!media) { recuperacaoStatus.naoEncontrados++; continue; }
            const fPath = path.join(PASTA_FOTOS, arquivo);
            fs.writeFileSync(fPath, Buffer.from(media.data, 'base64'));
            const hash = hashArquivo(arquivo);
            db.prepare(`UPDATE despesas SET arquivo_hash=? WHERE arquivo=?`).run(hash, arquivo);
            db.prepare(`UPDATE depositos SET arquivo_hash=? WHERE arquivo=?`).run(hash, arquivo);
            recuperacaoStatus.recuperados++;
            log(`Arquivo recuperado: ${arquivo}`);
          } catch(e) {
            recuperacaoStatus.naoEncontrados++;
            log(`Erro ao recuperar ${arquivo}: ${e.message}`, 'warn');
          }
        }
      } catch(e) {
        log(`Erro recuperar-arquivos-ausentes: ${e.message}`, 'error');
      }
      recuperacaoStatus.rodando = false;
      recuperacaoStatus.atual = null;
      recuperacaoStatus.concluidoEm = new Date().toISOString();
      log(`Recuperacao concluida: ${recuperacaoStatus.recuperados} recuperados, ${recuperacaoStatus.naoEncontrados} nao encontrados (de ${recuperacaoStatus.totalFaltando})`);
    })();
    return;
  }

  if (url === '/api/recuperar-arquivos-ausentes-status') return jsonResp(res, recuperacaoStatus);

  // ── SALVAR PDF VIA API (usado pelo WhatsApp Web JS) ────────────
  if (url === '/api/salvar-pdf' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { nome, data, mimetype, remetente } = JSON.parse(body);
        if (!data || !nome) return jsonResp(res, { erro:'data e nome obrigatorios' }, 400);
        const fPath = path.join(PASTA_FOTOS, path.basename(nome));
        fs.writeFileSync(fPath, Buffer.from(data, 'base64'));
        log(`PDF salvo via API: ${path.basename(nome)} (${remetente||'desconhecido'})`);
        const ehPaulo = ehRemetenteReceita(remetente);
        const dadosIA = { tipo_doc:'comprovante_pdf', descricao:`PDF: ${nome}`, confianca:0.5 };
        if (ehPaulo) criarDeposito(dadosIA, remetente||'Paulo', path.basename(nome));
        else         criarDespesa (dadosIA, remetente||'Bruna',  path.basename(nome));
        return jsonResp(res, { ok:true, arquivo:path.basename(nome) });
      } catch(e) { return jsonResp(res, { erro:e.message }, 400); }
    });
    return;
  }

  // ── EXCLUIR DESPESA ───────────────────────────────────────────
  if (req.method === 'DELETE' && url.startsWith('/api/despesa/')) {
    const id = parseInt(url.split('/').pop());
    const desp = db.prepare('SELECT * FROM despesas WHERE id=?').get(id);
    if (!desp) return jsonResp(res, { erro:'Nao encontrado' }, 404);
    if (desp.deposito_id && desp.valor > 0) {
      // Devolver saldo ao depósito
      db.prepare(`UPDATE depositos SET
        saldo_restante = MIN(valor, saldo_restante + ?),
        status = CASE WHEN MIN(valor, saldo_restante + ?) > 0 THEN 'ativo' ELSE status END
        WHERE id=?`).run(desp.valor, desp.valor, desp.deposito_id);
    }
    db.prepare('DELETE FROM despesas WHERE id=?').run(id);
    log(`DESPESA #${id} excluida (R$${desp.valor||0})`);
    if (sb) {
      if (desp.deposito_id && desp.valor > 0) {
        sbSync(sb.rpc('rl_devolver_saldo', { p_deposito_id: desp.deposito_id, p_valor: desp.valor }), `devolver saldo deposito #${desp.deposito_id}`);
      }
      sbSync(sb.from('rl_despesas').delete().eq('id', id), `delete despesa #${id}`);
    }
    return jsonResp(res, { ok:true });
  }

  // ── EXCLUIR DEPOSITO ──────────────────────────────────────────
  if (req.method === 'DELETE' && url.startsWith('/api/deposito/')) {
    const id = parseInt(url.split('/').pop());
    const dep = db.prepare('SELECT * FROM depositos WHERE id=?').get(id);
    if (!dep) return jsonResp(res, { erro:'Nao encontrado' }, 404);
    // Desvincula despesas mas não as exclui
    db.prepare('UPDATE despesas SET deposito_id=NULL WHERE deposito_id=?').run(id);
    db.prepare('DELETE FROM depositos WHERE id=?').run(id);
    log(`DEPOSITO #${id} excluido (R$${dep.valor||0})`);
    if (sb) {
      sbSync(sb.from('rl_despesas').update({ deposito_id: null }).eq('deposito_id', id), `desvincular despesas do deposito #${id}`);
      sbSync(sb.from('rl_depositos').delete().eq('id', id), `delete deposito #${id}`);
    }
    return jsonResp(res, { ok:true });
  }

  // ── UPLOAD FOTO/PDF MANUAL ────────────────────────────────────
  if (url === '/api/upload-foto' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { arquivo, mimetype, tipo, remetente } = JSON.parse(body);
        if (!arquivo) return jsonResp(res, { erro:'arquivo base64 obrigatorio' }, 400);
        const isPdf = (mimetype||'').includes('pdf');
        const isImg = (mimetype||'').startsWith('image/');
        const ext   = isPdf ? '.pdf' : '.jpeg';
        const nome  = `UP_${Date.now()}_${(remetente||'manual').replace(/\s+/g,'_').substring(0,15)}${ext}`;
        const fPath = path.join(PASTA_FOTOS, nome);
        fs.writeFileSync(fPath, Buffer.from(arquivo, 'base64'));
        log(`Upload manual: ${nome} (${tipo||'despesa'} de ${remetente||'?'})`);

        let dadosIA = { descricao:'Upload manual', confianca:0 };
        if (ai && (isImg || isPdf)) {
          try {
            dadosIA = await extrairComIA(arquivo, mimetype);
            log(`IA upload: valor=${dadosIA?.valor} fornecedor=${dadosIA?.fornecedor} conf=${dadosIA?.confianca}`);
          } catch(e) { log(`Erro IA upload: ${e.message}`, 'warn'); }
        }

        // Mesma regra do WhatsApp: comprovante com a propria RL Nordeste como beneficiario
        // e deposito, independente do tipo escolhido no formulario.
        const ehDeposito = (tipo||'despesa') === 'deposito' || ehBeneficiarioProprioEmpresa(dadosIA?.fornecedor);
        const recId = ehDeposito
          ? criarDeposito(dadosIA, remetente||'Paulo (upload)', nome)
          : criarDespesa(dadosIA, remetente||'Bruna (upload)', nome);
        return jsonResp(res, { ok:true, arquivo:nome, id:recId, dados:dadosIA });
      } catch(e) {
        log(`Erro upload: ${e.message}`, 'error');
        return jsonResp(res, { erro:e.message }, 400);
      }
    });
    return;
  }

  // ── STATUS DO CLIENTE WHATSAPP ─────────────────────────────────
  if (url === '/api/status-wa') {
    client.getState().then(state => {
      return jsonResp(res, { estado:state, grupo_alvo:GRUPO_ALVO, ia_ativa:!!ai });
    }).catch(() => {
      return jsonResp(res, { estado:'DESCONECTADO', grupo_alvo:GRUPO_ALVO, ia_ativa:!!ai });
    });
    return;
  }

  jsonResp(res, { erro:'Rota nao encontrada' }, 404);
});

server.listen(PORTA, () => log(`Servidor ativo em http://localhost:${PORTA}`));
process.on('unhandledRejection', e => log(`Erro nao tratado: ${e?.message}`, 'error'));
