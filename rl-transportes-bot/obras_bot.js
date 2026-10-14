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
Cupom fiscal / NF / NFC-e com varios produtos = UM item so, com o VALOR TOTAL da nota (o "valor a pagar");
liste os produtos na descricao (ex.: "Cadeado 93,00; Parafusos 11,50; ..."). Nunca um item por produto.
Print de corrida Uber/99/taxi com valor = comprovante de despesa (tipo_doc "recibo", categoria transporte_combustivel).

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
- pagador: em comprovante PIX/TED/transferencia, nome de QUEM PAGOU (campo pagador/origem/"de"), senao null
- descricao: o que foi comprado/pago, curto (ex.: "3 sacos de cimento + argamassa")
- loja_obra: loja/cidade/obra citada no documento (ex.: "Loja Caruaru", "Carpina"), senao null
- forma_pagamento: pix | dinheiro | cartao_credito | cartao_debito | boleto | transferencia | null
- autenticacao: codigo de autenticacao/ID da transacao/NSU/chave de acesso da NF se visivel, senao null
- confianca: 0.0 a 1.0
Se o documento for a CAPA de uma prestacao de contas com totais, preencha tambem "resumo".

Responda SOMENTE JSON valido, sem markdown:
{"tipo_documento":"comprovante|prestacao_contas|orcamento|outros","itens":[{"tipo_doc":"cupom_fiscal","categoria":"materiais_insumos","valor":null,"data":null,"hora":null,"fornecedor":null,"pagador":null,"cnpj":null,"descricao":null,"loja_obra":null,"forma_pagamento":null,"autenticacao":null,"confianca":0.5}],"resumo":{"responsavel":null,"periodo":null,"valor_total":null,"valor_adiantado":null,"reembolso":null}}`;

// Auditoria antifraude da FOTO (14/10/2026): a IA olha cada comprovante como auditor e aponta fraude/desvio de finalidade.
const PROMPT_AUDITOR = `Voce e AUDITOR ANTIFRAUDE de despesas de obras/reformas de lojas (rede de calcados Esposende).
O prestador manda a foto/PDF do comprovante no WhatsApp e a empresa reembolsa. Olhe o documento com desconfianca profissional e procure:
- adulteracao/montagem: numeros ou data com fonte, cor ou alinhamento diferente, borrao/recorte sobre valor ou data, rasura, valor reescrito
- print de tela ou foto de foto no lugar do comprovante original; PIX "agendado" ou nao concluido; comprovante sem autenticacao
- recibo manuscrito generico (sem CNPJ/CPF do emissor, sem descricao do servico), valor redondo sem nota fiscal
- desvio de finalidade: bebida alcoolica, cigarro, cosmeticos, roupas, presentes, lazer, comida fora do razoavel, itens de uso pessoal
- estabelecimento incompativel com obra; cupom em nome/CPF de outra pessoa; documento de outra cidade/data muito antiga
- divergencia entre a foto e o que foi lancado (dados abaixo)
Lancado no sistema: {LANCADO}
Seja justo: comprovante comum, legivel e coerente = risco "baixo" e motivos vazio. So use "alto" com sinal concreto.
Responda SOMENTE JSON: {"risco":"baixo|medio|alto","motivos":["frase curta em portugues"],"valor_na_foto":null,"data_na_foto":null}`;

module.exports = function criarModuloObras({ client, log, sb, baixarMidiaPelaPagina, sombra = false }) {
  // Modo sombra: tudo vai para obras_comprovantes_sombra e para a pasta sombra/ do bucket (nada oficial é tocado).
  // OBRAS_OFICIAL=1 (13/10/2026): a VPS em MODO=sombra para a RL passa a gravar Obras na tabela OFICIAL
  // (o D90 caiu do WhatsApp em 12/10 e as Obras pararam de entrar). Dedup por wa_msg_id evita duplicar se o D90 voltar.
  if (sombra && process.env.OBRAS_OFICIAL === '1') sombra = false;
  const TAB = sombra ? 'obras_comprovantes_sombra' : 'obras_comprovantes';
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
    const { data, error } = await sb.from(TAB).select('id').like('wa_msg_id', `${id}#%`).limit(1);
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
  async function lerComIA(base64, mimetype, prompt = PROMPT) {
    if (anthropic && !claudeSemCredito) {
      try { return await lerComClaude(base64, mimetype, prompt); }
      catch (e) {
        if (/credit balance|billing|401|403/i.test(e.message)) { claudeSemCredito = true; L('Claude sem credito — usando Gemini', 'warn'); }
        else L(`Claude falhou (${e.message.substring(0, 120)}) — tentando Gemini`, 'warn');
      }
    }
    if (!gemini) throw new Error('nenhuma IA disponivel');
    const mimeType = /image\/|application\/pdf/.test(mimetype) ? mimetype : 'image/jpeg';
    for (let t = 1; t <= 3; t++) {
      try {
        const r = await gemini.generateContent([{ inlineData: { mimeType, data: base64 } }, { text: prompt }]);
        const txt = r.response.text().trim().replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
        return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
      } catch (e) {
        if (/503|overloaded/i.test(e.message) && t < 3) { await new Promise(r => setTimeout(r, 5000 * t)); continue; }
        if (/429|quota|RESOURCE_EXHAUSTED/i.test(e.message) && t < 2) { await new Promise(r => setTimeout(r, 20000)); continue; }
        throw e;
      }
    }
  }

  async function lerComClaude(base64, mimetype, prompt = PROMPT) {
    const bloco = mimetype === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: /image\/(png|gif|webp)/.test(mimetype) ? mimetype : 'image/jpeg', data: base64 } };
    for (let t = 1; t <= 3; t++) {
      try {
        const r = await anthropic.messages.create({
          model: MODELO, max_tokens: 8000,
          messages: [{ role: 'user', content: [bloco, { type: 'text', text: prompt }] }]
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

  // Nota fiscal = UMA despesa (14/10/2026): se a IA ainda devolver um item por produto da mesma nota
  // (mesmo fornecedor, data e autenticação), junta tudo num item só com o total e os produtos na descrição.
  const NOTAS = ['cupom_fiscal', 'nf', 'nfs', 'recibo'];
  function juntarItensDaNota(itens) {
    const grupos = new Map(), saida = [];
    for (const it of itens) {
      const v = num(it.valor);
      if (!NOTAS.includes(it.tipo_doc) || !(v > 0)) { saida.push(it); continue; }
      const k = [it.tipo_doc, normForn(it.fornecedor), it.data || '', String(it.autenticacao || '').replace(/\s+/g, '')].join('|');
      const g = grupos.get(k);
      if (!g) { const novo = { ...it, valor: v, _produtos: [it] }; grupos.set(k, novo); saida.push(novo); continue; }
      g.valor = Math.round((g.valor + v) * 100) / 100; g._produtos.push(it);
      g.confianca = Math.min(g.confianca ?? 1, it.confianca ?? 1);
    }
    return saida.map(it => {
      if (!it._produtos) return it;
      const { _produtos, ...resto } = it;
      if (_produtos.length === 1) return resto;
      const fmt = x => Number(num(x.valor) || 0).toFixed(2).replace('.', ',');
      return { ...resto, descricao: `Nota com ${_produtos.length} itens: ${_produtos.map(x => `${x.descricao || 'item'} R$ ${fmt(x)}`).join('; ')}`.substring(0, 2000) };
    });
  }
  // Print de corrida de app (Uber/99) com valor é despesa de transporte, não "outros".
  const ehCorridaApp = (it, legenda) => /\b(uber|99|99pop|taxi|t[aá]xi)\b|corrida|viagem de/i.test(`${it.fornecedor || ''} ${it.descricao || ''} ${legenda || ''}`);

  // Converte a resposta da IA em linhas de obras_comprovantes (uma por comprovante do documento).
  function montarLinhas(ia, erroIA, base, idMsg, ts) {
    const waData = new Date(ts).toISOString();
    const itens = (ia && Array.isArray(ia.itens) && ia.itens.length) ? juntarItensDaNota(ia.itens) : [{}];
    return itens.map((it, i) => {
      let tipo = it.tipo_doc || (ia ? 'outros' : null);
      if (tipo === 'outros' && num(it.valor) > 0 && ehCorridaApp(it, base.legenda)) { tipo = 'recibo'; it = { ...it, categoria: 'transporte_combustivel' }; }
      const valor = num(it.valor);
      const ehDespesa = TIPOS_DESPESA.includes(tipo) && valor > 0;
      return { ...base, wa_msg_id: `${idMsg}#${i}`,
        categoria: CATEGORIAS.includes(it.categoria) ? it.categoria : 'diversos',
        valor: valor != null && valor >= 0 ? valor : 0,
        data_despesa: dataPlausivel(it.data, ts) || waData.substring(0, 10),
        hora_documento: it.hora || null, fornecedor: it.fornecedor || null, pagador: it.pagador || null, cnpj: it.cnpj || null,
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
        const { data } = await sb.from(TAB).select('id,wa_msg_id,status').eq('autenticacao', l.autenticacao).eq('status', 'lancado').limit(5);
        achou = (data || []).find(r => !ignorarIds.includes(r.id)) || null;
      }
      if (!achou && l.valor > 0 && l.data_despesa && l.fornecedor) {
        const { data } = await sb.from(TAB).select('id,wa_msg_id,fornecedor,hora_documento')
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
    const { data, error } = await sb.from(TAB).select('*')
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
        const { error: e1 } = await sb.from(TAB).update({ ...primeira, updated_at: new Date().toISOString() }).eq('id', r.id);
        if (e1) throw new Error(e1.message);
        if (resto.length) { const { error: e2 } = await sb.from(TAB).insert(resto); if (e2) throw new Error(e2.message); }
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
    const nome = `OB_${ts}_${idMsg}_${(nomeRemetente || 'sem_nome').replace(/[^A-Za-z0-9]+/g, '_').substring(0, 20)}${isPdf ? '.pdf' : '.jpeg'}`;
    fs.writeFileSync(path.join(PASTA, nome), buf);

    const { data: dupHash } = await sb.from(TAB).select('id,wa_msg_id').eq('arquivo_hash', hash).limit(1);
    const waData = new Date(ts).toISOString();
    const caminho = `${sombra ? 'sombra/' : ''}wa/${waData.substring(0, 7)}/${nome}`;
    // Contas a pagar (08/10/2026): todo recibo novo entra "a_pagar" e fecha por semana, por número de quem mandou.
    const base = { origem: 'whatsapp', remetente: nomeRemetente || null, remetente_numero: numero, situacao_pagamento: 'a_pagar',
      wa_data: waData, legenda: (msg.body || '').substring(0, 500) || null,
      arquivo_nome: nome, arquivo_path: caminho, arquivo_hash: hash };

    if (dupHash && dupHash.length) {
      // Mesma foto reenviada: registra só a marcação (valor 0, status duplicada) — não soma de novo.
      await sb.from(TAB).insert({ ...base, wa_msg_id: `${idMsg}#0`, categoria: 'diversos', valor: 0,
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
    const { error } = await sb.from(TAB).insert(linhas);
    if (error) { L(`Gravar no Supabase falhou (${nome}): ${error.message}`, 'error'); throw new Error(error.message); }
    const total = linhas.filter(l => l.status === 'lancado').reduce((s, l) => s + l.valor, 0);
    L(`${nomeRemetente}: ${linhas.length} item(ns) de ${nome} — R$ ${total.toFixed(2)} lancado`);
    if (linhas.some(l => l.status === 'lancado')) setTimeout(() => enfileirar(() => auditarArquivo(caminho).catch(e => L(`Auditor IA (${nome}): ${e.message}`, 'warn'))), 5000);
    return linhas.length;
  }

  // ── TEXTO DE PAGAMENTO (13/10/2026) ─────────────────────────────────────────────────────────────
  // O Jhony escreve no grupo blocos "Favorecido / Pix: chave / R$ valor / o que é / data". Pedido do Ricardo:
  // cada bloco entra como despesa JÁ PAGA (não vira reembolso a pagar ao prestador), com a loja/obra citada.
  // (14/10/2026: o Financeiro saiu do fluxo — é direto despesa e pagamento.)
  const AUTORES_TEXTO = (process.env.OBRAS_TEXTO_PAGO_AUTORES || 'jhony').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const NUMEROS_TEXTO = (process.env.OBRAS_TEXTO_PAGO_NUMEROS || '5511917849843,551117849843,226886227640325').split(',').map(x => x.trim()).filter(Boolean);
  const CIDADES = /\b(petrolina|recife|macei[oó]|caruaru|carpina|jo[aã]o pessoa|natal|aracaju|garanhuns|olinda|paulista|jaboat[aã]o|arapiraca|campina grande|mossor[oó]|juazeiro|feira de santana|salvador|teresina|fortaleza|cabo de santo agostinho|vit[oó]ria de santo ant[aã]o|santa cruz do capibaribe|toritama|surubim|limoeiro|goiana|igarassu|serra talhada|arcoverde|palmares|escada|gravat[aá]|bezerros|belo jardim|pesqueira)\b/i;
  const RE_VALOR = /R\$\s*([\d.]+(?:,\d{1,2})?)/i;
  const RE_PIX = /^\s*pix\s*[:\-]?\s*(.+)$/i;
  const RE_DATA = /^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(.*)$/;
  function autorTextoPago(nome, numero) {
    const n = String(nome || '').toLowerCase();
    return AUTORES_TEXTO.some(a => n.includes(a)) || (numero && NUMEROS_TEXTO.includes(String(numero)));
  }
  const ehTextoPagamento = body => { const b = String(body || ''); return RE_VALOR.test(b) && /\bpix\b/i.test(b); };
  function lerBlocosPagamento(body, tsMsg) {
    const anoMsg = new Date(tsMsg).getFullYear();
    const blocos = String(body || '').replace(/\r/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    const saida = [];
    for (const b of blocos) {
      const linhas = b.split('\n').map(l => l.trim()).filter(Boolean);
      let valor = null, pix = null, venc = null, obsData = '', favorecido = null; const desc = [];
      for (const l of linhas) {
        const mv = l.match(RE_VALOR), mp = l.match(RE_PIX), md = l.match(RE_DATA);
        if (mp && !pix) { pix = mp[1].trim(); continue; }
        if (mv && valor == null && l.replace(mv[0], '').replace(/[^A-Za-z]/g, '').length < 4) { valor = num(mv[1]); continue; }
        if (md && !venc && +md[2] >= 1 && +md[2] <= 12 && +md[1] >= 1 && +md[1] <= 31) {
          const ano = md[3] ? (md[3].length === 2 ? 2000 + +md[3] : +md[3]) : anoMsg;
          venc = `${ano}-${md[2].padStart(2, '0')}-${md[1].padStart(2, '0')}`; obsData = md[4].replace(/[()]/g, '').trim(); continue;
        }
        if (!favorecido) { favorecido = l; continue; }
        desc.push(l);
      }
      if (valor == null || !(valor > 0)) continue;
      const cid = desc.join(' ').match(CIDADES) || desc.join(' ').match(/shopping\s+[A-Za-zÀ-ú]+/i);
      saida.push({ favorecido, pix, valor, venc, obsData, descricao: desc.join(' / ') || null,
        loja: cid ? cid[0].replace(/^./, c => c.toUpperCase()) : null, bruto: b });
    }
    return saida;
  }
  async function processarTexto(msg, nomeRemetente, { simular = false, numero = null } = {}) {
    if (!sb) throw new Error('Supabase indisponivel');
    if (await jaLancada(msg)) return 'ja_lancada';
    const ts = msg.timestamp ? msg.timestamp * 1000 : Date.now();
    const blocos = lerBlocosPagamento(msg.body, ts);
    if (!blocos.length) return 'ignorada';
    if (simular) return 'faltando';
    const idMsg = idMsgCurto(msg) || crypto.randomBytes(6).toString('hex');
    const waData = new Date(ts).toISOString();
    const linhas = [];
    for (const [i, b] of blocos.entries()) {
      const hash = crypto.createHash('sha256').update('TXT|' + b.bruto.replace(/\s+/g, ' ').toUpperCase()).digest('hex');
      const { data: dup } = await sb.from(TAB).select('id,wa_msg_id').eq('arquivo_hash', hash).limit(1);
      const descr = [b.descricao, b.venc ? `vencimento ${b.venc.split('-').reverse().join('/')}${b.obsData ? ' (' + b.obsData + ')' : ''}` : null,
        b.pix ? `Pix: ${b.pix}` : null, 'já pago'].filter(Boolean).join(' — ');
      const cat = /estrutur|manuten|servi|instala|empreit|m[aã]o de obra|pintur|pedreir|eletric|plataforma/i.test(b.descricao || '') ? 'mao_de_obra_prestador' : 'diversos';
      linhas.push({ origem: 'whatsapp', remetente: nomeRemetente || null, remetente_numero: numero, wa_data: waData,
        wa_msg_id: `${idMsg}#T${i}`, legenda: b.bruto.substring(0, 500), arquivo_hash: hash, arquivo_nome: null, arquivo_path: null,
        tipo_doc: 'comprovante_pix', forma_pagamento: 'pix', categoria: cat, valor: b.valor,
        data_despesa: waData.substring(0, 10), fornecedor: b.favorecido, pagador: 'Esposende', loja: b.loja,
        status: dup && dup.length ? 'duplicada' : 'lancado', situacao_pagamento: 'pago', pago_em: waData,
        descricao: ((dup && dup.length ? `Texto repetido (igual a ${dup[0].wa_msg_id}) — nao somado. ` : '') + descr).substring(0, 500),
        confianca_ocr: 1, revisado: false,
        ia_json: i === 0 ? { fonte: 'texto_whatsapp', regra: 'ja_pago', blocos: blocos.map(x => ({ ...x, bruto: undefined })) } : null });
    }
    const { error } = await sb.from(TAB).insert(linhas);
    if (error) { L(`Gravar texto no Supabase falhou (${idMsg}): ${error.message}`, 'error'); throw new Error(error.message); }
    L(`${nomeRemetente}: texto com ${linhas.length} pagamento(s) já pago(s) — R$ ${linhas.filter(l => l.status === 'lancado').reduce((s, l) => s + l.valor, 0).toFixed(2)}`);
    return linhas.length;
  }

  // ── AUDITORIA ANTIFRAUDE DAS FOTOS (14/10/2026) ──────────────────────────────────────────────────
  // Cada arquivo de comprovante lançado é lido de novo pela IA como auditor. O resultado vai para auditoria_ia
  // e o Agente Auditor do Supabase transforma em ponto de atenção/crítico. Novos primeiro; os antigos em lotes.
  const LOTE_AUDITORIA = Number(process.env.OBRAS_AUDITORIA_LOTE || 12);
  async function auditarArquivo(arquivoPath) {
    const { data: linhas, error } = await sb.from(TAB).select('id,valor,data_despesa,fornecedor,descricao,categoria,tipo_doc,legenda,responsavel,arquivo_nome')
      .eq('arquivo_path', arquivoPath).eq('status', 'lancado').limit(60);
    if (error || !linhas || !linhas.length) return false;
    let buf = null;
    const local = linhas[0].arquivo_nome ? path.join(PASTA, linhas[0].arquivo_nome) : null;
    if (local && fs.existsSync(local)) buf = fs.readFileSync(local);
    else { const dl = await sb.storage.from('obras-comprovantes').download(arquivoPath); if (!dl.error) buf = Buffer.from(await dl.data.arrayBuffer()); }
    const marcar = async aud => { const { error: e } = await sb.from(TAB).update({ auditoria_ia: aud }).eq('arquivo_path', arquivoPath).eq('status', 'lancado'); if (e) throw new Error(e.message); };
    if (!buf) { await marcar({ risco: 'nao_lido', motivos: ['arquivo nao encontrado para auditar'], em: new Date().toISOString() }); return false; }
    const mt = /\.pdf$/i.test(arquivoPath) ? 'application/pdf' : /\.png$/i.test(arquivoPath) ? 'image/png' : 'image/jpeg';
    const lancado = linhas.slice(0, 15).map(l => `R$ ${Number(l.valor).toFixed(2)} em ${l.data_despesa} · ${l.fornecedor || '?'} · ${l.categoria} · ${l.tipo_doc} · ${(l.descricao || '').substring(0, 80)}`).join(' | ')
      + ` · legenda: "${(linhas[0].legenda || '').substring(0, 120)}" · prestador: ${linhas[0].responsavel || '?'}`;
    const r = await lerComIA(buf.toString('base64'), mt, PROMPT_AUDITOR.replace('{LANCADO}', lancado));
    const motivos = Array.isArray(r && r.motivos) ? r.motivos.filter(Boolean).map(String).slice(0, 6) : [];
    let risco = ['baixo', 'medio', 'alto'].includes(String(r && r.risco).toLowerCase()) ? String(r.risco).toLowerCase() : 'baixo';
    // valor da foto x valor lançado (só quando o arquivo é um comprovante só)
    const vf = num(r && r.valor_na_foto);
    if (linhas.length === 1 && vf > 0 && Math.abs(vf - Number(linhas[0].valor)) > Math.max(1, Number(linhas[0].valor) * 0.01)) {
      motivos.unshift(`valor na foto R$ ${vf.toFixed(2)} diferente do lançado R$ ${Number(linhas[0].valor).toFixed(2)}`);
      if (risco === 'baixo') risco = 'medio';
    }
    await marcar({ risco, motivos, valor_na_foto: vf ?? null, data_na_foto: r && r.data_na_foto || null, em: new Date().toISOString() });
    if (risco !== 'baixo') L(`Auditor IA: ${risco.toUpperCase()} em ${arquivoPath} — ${motivos.join('; ')}`, 'warn');
    return true;
  }
  let auditando = false;
  async function auditarFotos(max = LOTE_AUDITORIA) {
    if (!sb || auditando || !(anthropic || gemini)) return 0;
    auditando = true; let n = 0;
    try {
      const { data, error } = await sb.from(TAB).select('arquivo_path,created_at').eq('status', 'lancado').is('auditoria_ia', null)
        .not('arquivo_path', 'is', null).order('created_at', { ascending: false }).limit(max * 8);
      if (error) throw new Error(error.message);
      const arquivos = [...new Set((data || []).map(d => d.arquivo_path))].slice(0, max);
      for (const a of arquivos) {
        try { if (await auditarArquivo(a)) n++; }
        catch (e) { L(`Auditor IA falhou em ${a}: ${e.message}`, 'warn'); if (/nenhuma IA|quota|RESOURCE_EXHAUSTED/i.test(e.message)) break; }
      }
      if (n) L(`Auditor IA: ${n} comprovante(s) auditado(s)`);
    } catch (e) { L(`Auditor IA: ${e.message}`, 'warn'); }
    auditando = false;
    return n;
  }

  // Fila serial: WhatsApp + IA uma de cada vez (evita corrida no dedup e estouro de limite)
  let fila = Promise.resolve(), naFila = 0;
  // Erro numa tarefa nunca vira "unhandled rejection" (no Node 24 isso derruba o processo inteiro, inclusive a RL).
  const enfileirar = fn => { naFila++; const p = fila.then(fn, fn).finally(() => naFila--).catch(e => L(`Tarefa da fila falhou: ${e.message}`, 'warn')); fila = p; return p; };

  async function onMessage(msg, chat) {
    if (!msg.hasMedia) {
      if (!ehTextoPagamento(msg.body)) return;
      const ct = await contatoDe(msg);
      if (!autorTextoPago(ct.nome, ct.numero)) return;
      L(`Texto de pagamento de ${ct.nome} (${ct.numero || 'sem numero'})`);
      return enfileirar(() => processarTexto(msg, ct.nome, { numero: ct.numero }).catch(e => L(`Erro processando texto de ${ct.nome}: ${e.message}`, 'error')));
    }
    const { nome, numero } = await contatoDe(msg);
    L(`Midia de ${nome} (${numero || 'sem numero'})`);
    return enfileirar(() => processar(msg, nome, { numero }).catch(e => L(`Erro processando midia de ${nome}: ${e.message}`, 'error')));
  }

  // Nome para exibir + número (só dígitos, com DDI) — o número é a chave do fechamento semanal.
  async function contatoDe(m) {
    try {
      const c = await m.getContact();
      const numero = String(c.number || c.id?.user || '').replace(/\D/g, '') || null;
      // Sem nome no WhatsApp: vai vazio e o Supabase aloca no prestador do número (nunca "Desconhecido").
      return { nome: c.pushname || c.name || c.number || '', numero };
    } catch (e) { return { nome: '', numero: null }; }
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
    return msgs.filter(m => (m.hasMedia || ehTextoPagamento(m.body)) && m.timestamp * 1000 >= deMs && m.timestamp * 1000 <= ateMs);
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
          if (!m.hasMedia && !autorTextoPago(ct.nome, ct.numero)) { importacao.feitas++; continue; }
          const r = m.hasMedia ? await processar(m, ct.nome, { simular, numero: ct.numero })
                               : await processarTexto(m, ct.nome, { simular, numero: ct.numero });
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
    const { data } = await sb.from(TAB).select('wa_data').eq('origem', 'whatsapp').not('wa_data', 'is', null)
      .order('wa_data', { ascending: false }).limit(1);
    const ultimo = data && data[0] ? new Date(data[0].wa_data).getTime() : 0;
    const deMs = Math.max(Math.min(ultimo ? ultimo - 2 * 864e5 : Infinity, Date.now() - 3 * 864e5), Date.now() - 15 * 864e5);
    const ateMs = Date.now();
    const iso = ms => new Date(ms - 3 * 3600e3).toISOString().substring(0, 10);
    await importarPeriodo(iso(deMs), iso(ateMs), deMs, ateMs, false, motivo);
    await relerPendentes().catch(e => L(`Releitura: ${e.message}`, 'warn'));
  }
  client.on('ready', () => setTimeout(() => enfileirar(() => varrerPerdidas('reconexao')), 20 * 1000));
  setTimeout(() => enfileirar(() => varrerPerdidas('inicio')), 3 * 60 * 1000);
  setInterval(() => enfileirar(() => varrerPerdidas('rotina 2h')), 2 * 60 * 60 * 1000 + 5 * 60 * 1000);
  // Fotos antigas e as que ficaram sem auditoria: um lote a cada 15 min, sem atrapalhar a leitura das novas.
  setInterval(() => { if (naFila === 0) enfileirar(() => auditarFotos()); }, 15 * 60 * 1000);
  function jsonResp(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  }

  function http(req, res, url, qs) {
    (async () => {
      try {
        if (url === '/api/obras/status') {
          const { count } = sb ? await sb.from(TAB).select('id', { count: 'exact', head: true }) : { count: null };
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
  return { ehGrupo, onMessage, http, _lerComIA: lerComIA, _relerPendentes: relerPendentes, _varrerPerdidas: varrerPerdidas,
    _fila: () => naFila, _auditarFotos: auditarFotos, _tabela: () => TAB, _lerBlocosPagamento: lerBlocosPagamento,
    _estadoIA: () => [anthropic && !claudeSemCredito ? 'claude' : (anthropic ? 'claude SEM CREDITO' : null), gemini ? 'gemini' : null].filter(Boolean).join(' + ') || 'nenhuma' };
};
