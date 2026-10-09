/**
 * MÓDULO OBRAS — lê o grupo "Adm Obras Esposende" e lança cada comprovante em obras_comprovantes (Supabase).
 * Roda DENTRO do bot_v3.js (mesma sessão do WhatsApp — não dá pra abrir duas sessões no mesmo perfil).
 * Não mexe em nada da RL: SQLite da RL não é tocado, tabelas rl_* não são tocadas.
 *
 * Fonte da verdade = Supabase (obras_comprovantes + bucket privado obras-comprovantes).
 * Cópia local de cada arquivo em ./fotos_obras (nome determinístico OB_<ts>_<idMsg>_<remetente>.ext).
 * Dedup: wa_msg_id (índice único "<idMsg>#<n>") + hash do arquivo (foto reenviada).
 * Leitura: Claude (ANTHROPIC_API_KEY do .env) — lê foto, nota, cupom e PDF de prestação com vários comprovantes.
 *
 * Rotas (todas sob /api/obras/):
 *   GET  status                         → grupo, conexão, totais
 *   GET  mensagens?de=AAAA-MM-DD&ate=    → lista as mídias do grupo no período e se já foram lançadas (só leitura)
 *   POST importar?de=&ate=[&simular=1]   → lança o que falta no período (roda em 2º plano)
 *   GET  importacao                     → andamento da importação
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATEGORIAS = ['materiais_insumos','alimentacao','transporte_combustivel','estacionamento','frete',
  'mao_de_obra_prestador','hospedagem','equipamento_manutencao','taxas','diversos'];
const TIPOS_DESPESA = ['cupom_fiscal','nf','nfs','comprovante_pix','comprovante_ted','comprovante_boleto','comprovante_cartao','recibo'];

const PROMPT = `Voce le comprovantes de despesas de OBRAS/REFORMAS de lojas de uma rede de calcados (Esposende).
Os documentos sao enviados pelo engenheiro/encarregado no grupo de WhatsApp: fotos de cupom fiscal, nota fiscal,
recibo manuscrito, comprovante PIX/cartao, ou um PDF de "prestacao de contas" com varios comprovantes dentro.

Extraia CADA despesa como um item. Se o documento tiver varios comprovantes (ex.: PDF de prestacao), liste todos.
Nao conte duas vezes o mesmo pagamento (ex.: cupom + comprovante do cartao da mesma compra = 1 item so).

tipo_doc de cada item: cupom_fiscal | nf | nfs | comprovante_pix | comprovante_ted | comprovante_boleto | comprovante_cartao | recibo | orcamento | outros
- "orcamento": cotacao/proposta/previsao (NAO e gasto realizado)
- "outros": print de conversa, foto da obra, lista sem valor, etc.

categoria (escolha UMA): ${CATEGORIAS.join(' | ')}
- materiais_insumos: cimento, argamassa, drywall, eletrica, hidraulica, tinta, ferragens, madeira, vidro/espelho
- alimentacao: almoco, jantar, lanche, cafe, marmita de equipe, restaurante, padaria/panificacao, lanchonete, mercado (comida)
- transporte_combustivel: uber/taxi/99, onibus, passagem, combustivel, pedagio
- estacionamento (ticket de shopping/estacionamento, 'entrada/saida', placa do carro) | frete (carreto, entrega de material) | hospedagem (hotel, pousada, pernoite)
- mao_de_obra_prestador: diaria, empreitada, servico de pedreiro/eletricista/pintor, hora extra
- equipamento_manutencao: aluguel de andaime/betoneira/ferramenta, chaveiro, conserto
- taxas: taxas, guias, licencas, cartorio | diversos: o resto

Regras:
- valor: decimal (ponto), valor efetivamente pago. Sem valor legivel -> null
- data: YYYY-MM-DD da compra/pagamento. Ano com 2 digitos: "26" = 2026 (os documentos sao de 2026 em diante). Nao invente: se nao houver, null
- hora: "HH:MM" ou "HH:MM:SS" se visivel, senao null
- fornecedor: nome do estabelecimento / quem recebeu
- descricao: o que foi comprado/pago, curto (ex.: "3 sacos de cimento + argamassa")
- loja_obra: loja/cidade/obra citada no documento (ex.: "Loja Caruaru", "Carpina"), senao null
- forma_pagamento: pix | dinheiro | cartao_credito | cartao_debito | boleto | transferencia | null
- autenticacao: codigo de autenticacao/ID da transacao/NSU/chave de acesso da NF se visivel, senao null
- confianca: 0.0 a 1.0
Se o documento for a CAPA de uma prestacao de contas com totais, preencha tambem "resumo".

Responda SOMENTE JSON valido, sem markdown:
{"tipo_documento":"comprovante|prestacao_contas|orcamento|outros","itens":[{"tipo_doc":"cupom_fiscal","categoria":"materiais_insumos","valor":null,"data":null,"hora":null,"fornecedor":null,"cnpj":null,"descricao":null,"loja_obra":null,"forma_pagamento":null,"autenticacao":null,"confianca":0.5}],"resumo":{"responsavel":null,"periodo":null,"valor_total":null,"valor_adiantado":null,"reembolso":null}}`;

module.exports = function criarModuloObras({ client, log, sb, baixarMidiaPelaPagina }) {
  const GRUPO = process.env.OBRAS_GRUPO_NOME || 'Adm Obras Esposende';
  const PASTA = path.join(__dirname, 'fotos_obras');
  if (!fs.existsSync(PASTA)) fs.mkdirSync(PASTA, { recursive: true });
  const L = (m, nivel = 'info', dados = null) => log(`[OBRAS] ${m}`, nivel, dados);

  let anthropic = null;
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const Anthropic = require('@anthropic-ai/sdk');
      anthropic = new (Anthropic.default || Anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
  } catch (e) { L(`SDK Anthropic indisponivel: ${e.message}`, 'warn'); }
  const MODELO = process.env.OBRAS_MODELO_IA || 'claude-sonnet-5-5';

  const ehGrupo = chat => !!(chat && chat.isGroup && chat.name && chat.name.includes(GRUPO));
  const idMsgCurto = msg => (msg.id?.id || '').replace(/[^A-Za-z0-9]/g, '').substring(0, 24);

  async function acharGrupo() {
    const chats = await client.getChats();
    return chats.find(ehGrupo) || null;
  }

  async function jaLancada(msg) {
    if (!sb) return false;
    const id = idMsgCurto(msg);
    if (!id) return false;
    const { data, error } = await sb.from('obras_comprovantes').select('id').like('wa_msg_id', `${id}#%`).limit(1);
    if (error) throw new Error(`consulta Supabase: ${error.message}`);
    return !!(data && data.length);
  }

  async function baixar(msg, nome) {
    let media = null, erroLib = null;
    for (let t = 1; t <= 3 && !media; t++) {
      try { media = await msg.downloadMedia(); if (!media) break; }
      catch (e) { erroLib = e; if (t < 3) await new Promise(r => setTimeout(r, 3000 * t)); }
    }
    if (!media && baixarMidiaPelaPagina) {
      const alt = await baixarMidiaPelaPagina(msg).catch(e => ({ info: { erro: e.message } }));
      if (alt?.data) media = { data: alt.data, mimetype: alt.mimetype || 'application/octet-stream', filename: alt.filename };
      else L(`Erro baixar midia de ${nome} (id ${msg.id?.id}): ${erroLib ? erroLib.message : 'vazia'}`, 'error', alt?.info || null);
    }
    return media;
  }

  let gemini = null;
  try {
    if (process.env.GEMINI_API_KEY) {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: 'gemini-2.5-flash',
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } } });
    }
  } catch (e) { L(`Gemini indisponivel: ${e.message}`, 'warn'); }
  let claudeSemCredito = false;

  // Claude primeiro (melhor em manuscrito/PDF de prestação); sem crédito/erro → Gemini; os dois falharam → pendente_leitura.
  async function lerComIA(base64, mimetype) {
    if (anthropic && !claudeSemCredito) {
      try { return await lerComClaude(base64, mimetype); }
      catch (e) {
        if (/credit balance|billing|401|403/i.test(e.message)) { claudeSemCredito = true; L('Claude sem credito — usando Gemini', 'warn'); }
        else L(`Claude falhou (${e.message.substring(0, 120)}) — tentando Gemini`, 'warn');
      }
    }
    if (!gemini) throw new Error('nenhuma IA disponivel');
    const mimeType = /image\/|application\/pdf/.test(mimetype) ? mimetype : 'image/jpeg';
    for (let t = 1; t <= 3; t++) {
      try {
        const r = await gemini.generateContent([{ inlineData: { mimeType, data: base64 } }, { text: PROMPT }]);
        const txt = r.response.text().trim().replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
        return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
      } catch (e) {
        if (/503|overloaded/i.test(e.message) && t < 3) { await new Promise(r => setTimeout(r, 5000 * t)); continue; }
        if (/429|quota|RESOURCE_EXHAUSTED/i.test(e.message) && t < 2) { await new Promise(r => setTimeout(r, 20000)); continue; }
        throw e;
      }
    }
  }

  async function lerComClaude(base64, mimetype) {
    const bloco = mimetype === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: /image\/(png|gif|webp)/.test(mimetype) ? mimetype : 'image/jpeg', data: base64 } };
    for (let t = 1; t <= 3; t++) {
      try {
        const r = await anthropic.messages.create({
          model: MODELO, max_tokens: 8000,
          messages: [{ role: 'user', content: [bloco, { type: 'text', text: PROMPT }] }]
        });
        const txt = r.content.filter(c => c.type === 'text').map(c => c.text).join('').trim()
          .replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
        return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
      } catch (e) {
        const transitorio = /429|529|overloaded|rate_limit/i.test(e.message) && !/credit/i.test(e.message);
        if (transitorio && t < 3) { await new Promise(r => setTimeout(r, 15000 * t)); continue; }
        throw e;
      }
    }
  }

  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    let s = String(v).replace(/[^\d,.-]/g, '');
    if (s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s); return isNaN(n) ? null : n;
  }
  // Data lida tem que fazer sentido perto da data da mensagem (até 120 dias antes, 3 depois); senão vale a data da mensagem.
  const dataPlausivel = (d, tsMsg) => { const ok = dataOk(d); if (!ok) return null;
    const t = new Date(ok + 'T12:00:00-03:00').getTime(); return (t >= tsMsg - 120 * 864e5 && t <= tsMsg + 3 * 864e5) ? ok : null; };
  const dataOk = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2024-01-01' && d <= '2030-12-31') ? d : null;

  // Converte a resposta da IA em linhas de obras_comprovantes (uma por comprovante do documento).
  function montarLinhas(ia, erroIA, base, idMsg, ts) {
    const waData = new Date(ts).toISOString();
    const itens = (ia && Array.isArray(ia.itens) && ia.itens.length) ? ia.itens : [{}];
    return itens.map((it, i) => {
      const tipo = it.tipo_doc || (ia ? 'outros' : null);
      const valor = num(it.valor);
      const ehDespesa = TIPOS_DESPESA.includes(tipo) && valor > 0;
      return { ...base, wa_msg_id: `${idMsg}#${i}`,
        categoria: CATEGORIAS.includes(it.categoria) ? it.categoria : 'diversos',
        valor: valor != null && valor >= 0 ? valor : 0,
        data_despesa: dataPlausivel(it.data, ts) || waData.substring(0, 10),
        hora_documento: it.hora || null, fornecedor: it.fornecedor || null, cnpj: it.cnpj || null,
        descricao: it.descricao || (erroIA ? `Leitura pendente: ${erroIA}`.substring(0, 300) : null),
        loja: it.loja_obra || null, forma_pagamento: it.forma_pagamento || null, autenticacao: it.autenticacao || null,
        tipo_doc: tipo, confianca_ocr: typeof it.confianca === 'number' ? it.confianca : null,
        status: !ia ? 'pendente_leitura' : ehDespesa ? 'lancado' : (tipo === 'orcamento' ? 'orcamento' : 'nao_despesa'),
        revisado: false, ia_json: i === 0 ? ia : null };
    });
  }

  // Mesmo gasto já lançado (inclusive nas prestações já pagas) → "duplicada", não soma.
  // Critério forte: mesma autenticação/NSU/chave. Sem autenticação: mesmo valor + mesma data + mesmo fornecedor
  // e, quando os dois têm hora, mesma hora (dois almoços iguais no mesmo dia em horários diferentes continuam valendo).
  const normForn = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\b(LTDA|ME|EPP|EIRELI|S\/?A|COMERCIO|DE|DA|DO|E)\b/g, ' ').replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').slice(0, 2).join(' ');
  const normHora = h => (String(h || '').match(/^(\d{1,2}):(\d{2})/) || []).slice(1).map(x => x.padStart(2, '0')).join(':') || null;
  async function marcarDuplicados(linhas, ignorarIds = []) {
    for (const l of linhas) {
      if (l.status !== 'lancado') continue;
      let achou = null;
      const aut = String(l.autenticacao || '').replace(/\s+/g, '');
      if (aut.length >= 6) {
        const { data } = await sb.from('obras_comprovantes').select('id,wa_msg_id,status').eq('autenticacao', l.autenticacao).eq('status', 'lancado').limit(5);
        achou = (data || []).find(r => !ignorarIds.includes(r.id)) || null;
      }
      if (!achou && l.valor > 0 && l.data_despesa && l.fornecedor) {
        const { data } = await sb.from('obras_comprovantes').select('id,wa_msg_id,fornecedor,hora_documento')
          .eq('valor', l.valor).eq('data_despesa', l.data_despesa).eq('status', 'lancado').limit(20);
        const f = normForn(l.fornecedor), h = normHora(l.hora_documento);
        achou = (data || []).find(r => !ignorarIds.includes(r.id) && f && normForn(r.fornecedor) === f &&
          (!h || !normHora(r.hora_documento) || normHora(r.hora_documento) === h)) || null;
      }
      if (achou) {
        l.status = 'duplicada';
        l.descricao = `Duplicado de ${achou.wa_msg_id || achou.id} — nao somado. ${l.descricao || ''}`.substring(0, 500);
        L(`Comprovante repetido (${l.fornecedor} R$ ${l.valor} ${l.data_despesa}) — igual a ${achou.wa_msg_id || achou.id}, nao somado`, 'warn');
      }
    }
  }

  // Relê com a IA o que ficou "pendente_leitura" (IA fora do ar / sem crédito na hora). Usa a cópia local ou o bucket.
  async function relerPendentes() {
    if (!sb) return;
    const { data, error } = await sb.from('obras_comprovantes').select('*')
      .eq('origem', 'whatsapp').eq('status', 'pendente_leitura').like('wa_msg_id', '%#0').order('created_at').limit(20);
    if (error || !data || !data.length) return;
    let ok = 0;
    for (const r of data) {
      try {
        let buf = null;
        const local = path.join(PASTA, r.arquivo_nome || '');
        if (r.arquivo_nome && fs.existsSync(local)) buf = fs.readFileSync(local);
        else if (r.arquivo_path) { const dl = await sb.storage.from('obras-comprovantes').download(r.arquivo_path); if (!dl.error) buf = Buffer.from(await dl.data.arrayBuffer()); }
        if (!buf) continue;
        const mt = /\.pdf$/i.test(r.arquivo_nome || r.arquivo_path || '') ? 'application/pdf' : 'image/jpeg';
        const ia = await lerComIA(buf.toString('base64'), mt);
        const idMsg = String(r.wa_msg_id).replace(/#\d+$/, '');
        const base = { origem: r.origem, remetente: r.remetente, remetente_numero: r.remetente_numero, situacao_pagamento: r.situacao_pagamento,
          wa_data: r.wa_data, legenda: r.legenda, arquivo_nome: r.arquivo_nome, arquivo_path: r.arquivo_path, arquivo_hash: r.arquivo_hash };
        const linhas = montarLinhas(ia, null, base, idMsg, new Date(r.wa_data || r.created_at).getTime());
        await marcarDuplicados(linhas, [r.id]);
        const [primeira, ...resto] = linhas;
        const { error: e1 } = await sb.from('obras_comprovantes').update({ ...primeira, updated_at: new Date().toISOString() }).eq('id', r.id);
        if (e1) throw new Error(e1.message);
        if (resto.length) { const { error: e2 } = await sb.from('obras_comprovantes').insert(resto); if (e2) throw new Error(e2.message); }
        ok++;
      } catch (e) { L(`Releitura de ${r.arquivo_nome}: ${e.message}`, 'warn'); }
    }
    if (ok) L(`Releitura: ${ok} de ${data.length} comprovante(s) pendente(s) lido(s)`);
  }

  // Processa UMA mensagem com mídia. Retorna 'ja_lancada' | 'duplicada' | 'erro_download' | 'ignorada' | n (itens lançados)
  async function processar(msg, nomeRemetente, { simular = false, numero = null } = {}) {
    if (!sb) throw new Error('Supabase indisponivel');
    if (await jaLancada(msg)) return 'ja_lancada';
    if (simular) return 'faltando';
    const media = await baixar(msg, nomeRemetente);
    if (!media) return 'erro_download';
    const mt = media.mimetype || '';
    const isImg = mt.startsWith('image/'), isPdf = mt === 'application/pdf';
    if (!isImg && !isPdf) { L(`Tipo ignorado (${mt}) de ${nomeRemetente}`); return 'ignorada'; }

    const buf = Buffer.from(media.data, 'base64');
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const ts = msg.timestamp ? msg.timestamp * 1000 : Date.now();
    const idMsg = idMsgCurto(msg) || crypto.randomBytes(6).toString('hex');
    const nome = `OB_${ts}_${idMsg}_${nomeRemetente.replace(/[^A-Za-z0-9]+/g, '_').substring(0, 20)}${isPdf ? '.pdf' : '.jpeg'}`;
    fs.writeFileSync(path.join(PASTA, nome), buf);

    const { data: dupHash } = await sb.from('obras_comprovantes').select('id,wa_msg_id').eq('arquivo_hash', hash).limit(1);
    const waData = new Date(ts).toISOString();
    const caminho = `wa/${waData.substring(0, 7)}/${nome}`;
    // Contas a pagar (08/10/2026): todo recibo novo entra "a_pagar" e fecha por semana, por número de quem mandou.
    const base = { origem: 'whatsapp', remetente: nomeRemetente, remetente_numero: numero, situacao_pagamento: 'a_pagar',
      wa_data: waData, legenda: (msg.body || '').substring(0, 500) || null,
      arquivo_nome: nome, arquivo_path: caminho, arquivo_hash: hash };

    if (dupHash && dupHash.length) {
      // Mesma foto reenviada: registra só a marcação (valor 0, status duplicada) — não soma de novo.
      await sb.from('obras_comprovantes').insert({ ...base, wa_msg_id: `${idMsg}#0`, categoria: 'diversos', valor: 0,
        status: 'duplicada', descricao: `Foto reenviada (igual a ${dupHash[0].wa_msg_id})`, revisado: false });
      L(`Foto reenviada por ${nomeRemetente} — igual a ${dupHash[0].wa_msg_id}, nao somada`, 'warn');
      return 'duplicada';
    }

    for (let t = 1; t <= 3; t++) {
      const up = await sb.storage.from('obras-comprovantes').upload(caminho, buf, { contentType: isPdf ? 'application/pdf' : mt, upsert: false });
      if (!up.error || /exists|Duplicate/i.test(up.error.message)) break;
      if (t === 3) L(`Upload do arquivo falhou (${nome}): ${up.error.message} — copia local em fotos_obras`, 'warn');
      else await new Promise(r => setTimeout(r, 5000 * t));
    }

    let ia = null, erroIA = null;
    try { ia = await lerComIA(media.data, mt); } catch (e) { erroIA = e.message; L(`IA falhou em ${nome}: ${e.message}`, 'warn'); }

    const linhas = montarLinhas(ia, erroIA, base, idMsg, ts);
    await marcarDuplicados(linhas);
    const { error } = await sb.from('obras_comprovantes').insert(linhas);
    if (error) { L(`Gravar no Supabase falhou (${nome}): ${error.message}`, 'error'); throw new Error(error.message); }
    const total = linhas.filter(l => l.status === 'lancado').reduce((s, l) => s + l.valor, 0);
    L(`${nomeRemetente}: ${linhas.length} item(ns) de ${nome} — R$ ${total.toFixed(2)} lancado`);
    return linhas.length;
  }

  // Fila serial: WhatsApp + IA uma de cada vez (evita corrida no dedup e estouro de limite)
  let fila = Promise.resolve();
  const enfileirar = fn => (fila = fila.then(fn, fn));

  async function onMessage(msg, chat) {
    if (!msg.hasMedia) return;
    const { nome, numero } = await contatoDe(msg);
    L(`Midia de ${nome} (${numero || 'sem numero'})`);
    return enfileirar(() => processar(msg, nome, { numero }).catch(e => L(`Erro processando midia de ${nome}: ${e.message}`, 'error')));
  }

  // Nome para exibir + número (só dígitos, com DDI) — o número é a chave do fechamento semanal.
  async function contatoDe(m) {
    try {
      const c = await m.getContact();
      const numero = String(c.number || c.id?.user || '').replace(/\D/g, '') || null;
      return { nome: c.pushname || c.name || c.number || 'Desconhecido', numero };
    } catch (e) { return { nome: 'Desconhecido', numero: null }; }
  }

  async function mensagensPeriodo(deMs, ateMs) {
    const grupo = await acharGrupo();
    if (!grupo) throw new Error(`grupo "${GRUPO}" nao encontrado`);
    // Igual à RL: o aparelho vinculado só tem parte do histórico; se não cobriu o período, pede ao celular (syncHistory) e tenta de novo.
    let limite = 1000, msgs = [];
    for (let t = 0; t < 8; t++) {
      msgs = await grupo.fetchMessages({ limit: limite });
      const cobriu = msgs.length && msgs[0].timestamp * 1000 <= deMs;
      if (cobriu) break;
      if (msgs.length >= limite) { limite *= 2; continue; }
      let pediu = false;
      try { pediu = await grupo.syncHistory(); } catch (e) { L(`syncHistory: ${e.message}`, 'warn'); }
      if (!pediu && t > 1) break;
      await new Promise(r => setTimeout(r, 25000));
    }
    ultimaBusca = { total: msgs.length, mais_antiga: msgs.length ? new Date(msgs[0].timestamp * 1000).toISOString() : null,
      com_midia: msgs.filter(m => m.hasMedia).length, tipos: msgs.reduce((a, m) => (a[m.type] = (a[m.type] || 0) + 1, a), {}) };
    return msgs.filter(m => m.hasMedia && m.timestamp * 1000 >= deMs && m.timestamp * 1000 <= ateMs);
  }
  let ultimaBusca = null;
  async function nomeDe(m) { return (await contatoDe(m)).nome; }
  function periodo(qs) {
    const p = new URLSearchParams(qs);
    const de = p.get('de') || new Date(Date.now() - 30 * 864e5).toISOString().substring(0, 10);
    const ate = p.get('ate') || new Date().toISOString().substring(0, 10);
    return { de, ate, deMs: new Date(`${de}T00:00:00-03:00`).getTime(), ateMs: new Date(`${ate}T23:59:59-03:00`).getTime(), simular: p.get('simular') === '1' };
  }

  const importacao = { rodando: false };
  async function importarPeriodo(de, ate, deMs, ateMs, simular = false, origemChamada = 'manual') {
    Object.assign(importacao, { rodando: true, de, ate, simular, origem: origemChamada, inicio: new Date().toISOString(), fim: null,
      total: 0, feitas: 0, lancadas: 0, itens: 0, ja: 0, duplicadas: 0, erros: 0, faltando: 0, erro: null });
    try {
      const msgs = await mensagensPeriodo(deMs, ateMs);
      importacao.total = msgs.length;
      for (const m of msgs.sort((a, b) => a.timestamp - b.timestamp)) {
        try {
          const ct = await contatoDe(m);
          const r = await processar(m, ct.nome, { simular, numero: ct.numero });
          if (r === 'ja_lancada') importacao.ja++; else if (r === 'duplicada') importacao.duplicadas++;
          else if (r === 'erro_download') importacao.erros++; else if (r === 'faltando') importacao.faltando++;
          else if (typeof r === 'number') { importacao.lancadas++; importacao.itens += r; }
        } catch (e) { importacao.erros++; L(`Importacao: ${e.message}`, 'warn'); }
        importacao.feitas++;
      }
    } catch (e) { importacao.erro = e.message; }
    importacao.rodando = false; importacao.fim = new Date().toISOString();
    const nada = origemChamada !== 'manual' && !importacao.lancadas && !importacao.erros && !importacao.erro;
    if (!nada) L(`Importacao ${origemChamada} ${de}..${ate} ${simular ? '(simulacao) ' : ''}concluida: ${JSON.stringify(importacao)}`,
      importacao.erros || importacao.erro ? 'warn' : 'info');
  }

  // Varredura automática: ao reconectar e a cada 2h, lança o que chegou no grupo e não entrou (WhatsApp caiu,
  // Supabase fora, download falhou). Começa 2 dias antes do último recibo do WhatsApp já lançado (mínimo: 3 dias).
  async function varrerPerdidas(motivo) {
    if (!sb || importacao.rodando) return;
    // getState() pode ficar pendurado para sempre quando o Chrome do WhatsApp trava ("detached Frame") — limite de 15s.
    const estado = await Promise.race([client.getState().catch(() => null), new Promise(r => setTimeout(() => r('TIMEOUT'), 15000))]);
    if (estado !== 'CONNECTED') { if (estado === 'TIMEOUT') L('Varredura adiada: WhatsApp nao respondeu (navegador travado?)', 'warn'); return; }
    const { data } = await sb.from('obras_comprovantes').select('wa_data').eq('origem', 'whatsapp').not('wa_data', 'is', null)
      .order('wa_data', { ascending: false }).limit(1);
    const ultimo = data && data[0] ? new Date(data[0].wa_data).getTime() : 0;
    const deMs = Math.max(Math.min(ultimo ? ultimo - 2 * 864e5 : Infinity, Date.now() - 3 * 864e5), Date.now() - 15 * 864e5);
    const ateMs = Date.now();
    const iso = ms => new Date(ms - 3 * 3600e3).toISOString().substring(0, 10);
    await importarPeriodo(iso(deMs), iso(ateMs), deMs, ateMs, false, motivo);
    await relerPendentes().catch(e => L(`Releitura: ${e.message}`, 'warn'));
  }
  client.on('ready', () => setTimeout(() => enfileirar(() => varrerPerdidas('reconexao')), 90 * 1000));
  setTimeout(() => enfileirar(() => varrerPerdidas('inicio')), 3 * 60 * 1000);
  setInterval(() => enfileirar(() => varrerPerdidas('rotina 2h')), 2 * 60 * 60 * 1000 + 5 * 60 * 1000);
  function jsonResp(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  }

  function http(req, res, url, qs) {
    (async () => {
      try {
        if (url === '/api/obras/status') {
          const { count } = sb ? await sb.from('obras_comprovantes').select('id', { count: 'exact', head: true }) : { count: null };
          return jsonResp(res, { grupo: GRUPO, ia: anthropic ? MODELO : null, supabase: !!sb, comprovantes: count, importacao });
        }
        if (url === '/api/obras/importacao') return jsonResp(res, importacao);
        if (url === '/api/obras/mensagens') {
          const { de, ate, deMs, ateMs } = periodo(qs);
          const msgs = await mensagensPeriodo(deMs, ateMs);
          const itens = [];
          for (const m of msgs) itens.push({ data: new Date(m.timestamp * 1000).toLocaleString('pt-BR'), remetente: await nomeDe(m),
            tipo: m.type, legenda: (m.body || '').substring(0, 100), id: idMsgCurto(m), ja_lancada: await jaLancada(m) });
          return jsonResp(res, { grupo: GRUPO, de, ate, busca: ultimaBusca, total: itens.length, faltando: itens.filter(i => !i.ja_lancada).length, itens });
        }
        if (url === '/api/obras/importar' && req.method === 'POST') {
          if (importacao.rodando) return jsonResp(res, { erro: 'ja existe importacao rodando', importacao }, 409);
          const { de, ate, deMs, ateMs, simular } = periodo(qs);
          Object.assign(importacao, { rodando: true, de, ate, simular, inicio: new Date().toISOString(), fim: null,
            total: 0, feitas: 0, lancadas: 0, itens: 0, ja: 0, duplicadas: 0, erros: 0, faltando: 0, erro: null });
          jsonResp(res, { ok: true, importacao });
          enfileirar(() => importarPeriodo(de, ate, deMs, ateMs, simular));
          return;
        }
        return jsonResp(res, { erro: 'rota obras nao encontrada' }, 404);
      } catch (e) { return jsonResp(res, { erro: e.message }, 500); }
    })();
  }

  L(`Modulo Obras ativo — grupo "${GRUPO}", IA ${anthropic ? MODELO : '-'} / ${gemini ? 'gemini' : '-'}`);
  return { ehGrupo, onMessage, http, _lerComIA: lerComIA, _relerPendentes: relerPendentes, _varrerPerdidas: varrerPerdidas };
};
