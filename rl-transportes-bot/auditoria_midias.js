/**
 * AUDITORIA DE MIDIAS DA RL (22/10/2026) — "toda foto do grupo vira lancamento, reuso ou alerta".
 *
 * BUG REAL: o Pix de R$ 10.000,00 da MAR ABERTO (13/07/2026) nunca entrou. O capturador ficou fora de 09/07 15:42 a
 * 18/07 20:10; em 20/07 os comprovantes foram reenviados e baixados para fotos/, mas a foto do Pix ficou so na pasta,
 * sem deposito, sem log e sem nenhum aviso. A varredura de 2h so olha o grupo a partir do ultimo lancamento - 2 dias e
 * so pelo nome do arquivo; ninguem conferia a pasta contra o banco nem uma janela fixa do grupo.
 *
 * O que faz (so na instancia principal da RL; a reserva so le as pendencias do Supabase para o painel):
 *  1. GRUPO — revisita TODAS as midias do grupo dos ultimos N dias (padrao 15). Cada uma tem de estar lancada
 *     (deposito/despesa/reuso), ja analisada (midias_auditadas) ou baixada na pasta (vai para o passo 2). O que faltar
 *     e baixado e lancado em modo conservador. Se o WhatsApp nao devolver o historico da janela inteira, vira ALERTA.
 *  2. PASTA — todo arquivo de fotos/ dos ultimos N dias (padrao 30) que nao e de nenhum lancamento: se for copia
 *     identica (mesmo hash) de algo lancado, so registra "copia"; senao a IA le de novo e lanca em modo conservador.
 *  3. Modo conservador (sem ninguem olhando): so lanca comprovante bancario claro (confianca >= 0.7) e sem lancamento
 *     parecido (mesmo valor e data). Guia, orcamento, manuscrito ou possivel duplicata ficam como "revisar".
 *  4. Tudo o que fica "revisar"/"faltando" e PENDENCIA: log de erro (aparece no health check), Supabase
 *     rl_auditoria_pendencias (portal e painel do D90) e, se AUDITORIA_ALERTA_WA estiver no .env, mensagem no WhatsApp.
 * Roda 20 min depois de ligar e a cada 6 h. Manual: GET/POST /api/auditoria-midias (ver bot_v3.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIA = 24 * 3600 * 1000;
const INTERVALO_MS = 6 * 3600 * 1000;
const PRIMEIRA_MS = 20 * 60 * 1000;

module.exports = function iniciarAuditoriaMidias(o) {
  const { db, log, sb, client, PASTA_FOTOS, hashArquivo, acharGrupo, buscarMensagensDesde, mensagemJaLancada,
    prefixoArquivoMsg, processarMidia, analisarELancar, rlGrava, waPronto, instancia = 'local' } = o;
  let rodando = false, ultimo = null;

  const tsDe = nome => Number((String(nome).match(/^(?:WA|UP)_(\d{12,})_/) || [])[1]) || null;
  const remetenteDe = nome => {
    const m = String(nome).match(/^(?:WA_\d+_(?:[A-Za-z0-9]{6,}_)?|UP_\d+_)(.+?)\.[a-z0-9]+$/i);
    return m ? m[1].replace(/_/g, ' ') : 'Desconhecido';
  };
  const mimeDe = nome => /\.pdf$/i.test(nome) ? 'application/pdf' : /\.png$/i.test(nome) ? 'image/png' : /\.(jpe?g|webp)$/i.test(nome) ? 'image/jpeg' : 'application/octet-stream';
  const dataBR = ms => ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Recife' }) : '-';

  const stArqLancado = db.prepare(`SELECT 1 FROM despesas WHERE arquivo=? UNION ALL SELECT 1 FROM depositos WHERE arquivo=? UNION ALL SELECT 1 FROM reusos WHERE arquivo=? LIMIT 1`);
  const stHashLancado = db.prepare(`SELECT 'despesa' t, id, arquivo FROM despesas WHERE arquivo_hash=? UNION ALL SELECT 'deposito', id, arquivo FROM depositos WHERE arquivo_hash=? UNION ALL SELECT 'reuso', id, arquivo FROM reusos WHERE arquivo_hash=? LIMIT 1`);
  const stAuditada = db.prepare(`SELECT resultado FROM midias_auditadas WHERE arquivo=?`);
  const stAuditadaPref = db.prepare(`SELECT arquivo, resultado FROM midias_auditadas WHERE arquivo LIKE ? LIMIT 1`);
  const stMarcar = db.prepare(`INSERT INTO midias_auditadas (arquivo,resultado,detalhe,remetente) VALUES (?,?,?,?)
    ON CONFLICT(arquivo) DO UPDATE SET resultado=excluded.resultado, detalhe=excluded.detalhe, atualizado_em=datetime('now','localtime')`);
  const stRevisar = db.prepare(`SELECT * FROM midias_auditadas WHERE resultado='revisar' ORDER BY arquivo`);

  // ── 2. PASTA ─────────────────────────────────────────────────────────────
  async function auditarPasta({ desdeMs, ateMs = Infinity, aplicar }) {
    const r = { analisados: 0, ja_lancados: 0, ja_auditados: 0, copias: 0, lancados: [], revisar: [], orfaos: [], erros: [] };
    let nomes = [];
    try { nomes = fs.readdirSync(PASTA_FOTOS).filter(n => /^(WA|UP)_\d{12,}_/.test(n)); } catch (e) { r.erros.push(`pasta: ${e.message}`); return r; }
    for (const nome of nomes.sort()) {
      const ts = tsDe(nome);
      if (!ts || ts < desdeMs || ts > ateMs) continue;
      r.analisados++;
      if (stArqLancado.get(nome, nome, nome)) { r.ja_lancados++; continue; }
      if (stAuditada.get(nome)) { r.ja_auditados++; continue; }
      const h = hashArquivo(nome);
      const igual = h && stHashLancado.get(h, h, h);
      if (igual) {
        r.copias++;
        if (aplicar) stMarcar.run(nome, 'copia', `copia identica do ${igual.t} #${igual.id} (${igual.arquivo})`, remetenteDe(nome));
        continue;
      }
      const item = { arquivo: nome, enviado_em: dataBR(ts), remetente: remetenteDe(nome) };
      if (!aplicar) { r.orfaos.push(item); continue; }
      const res = await analisarELancar({ nome, mimetype: mimeDe(nome), nomeRemetente: item.remetente, conservador: true });
      Object.assign(item, { resultado: res.resultado, detalhe: res.detalhe || null, valor: res.valor || null, data_documento: res.data_documento || null });
      if (res.resultado === 'deposito' || res.resultado === 'despesa') {
        r.lancados.push(item);
        log(`AUDITORIA: arquivo ${nome} estava na pasta SEM lancamento — lancado agora como ${res.resultado} #${res.id} (R$ ${Number(res.valor || 0).toFixed(2)})`, 'error');
      } else if (res.resultado === 'revisar') r.revisar.push(item);
      else if (res.resultado === 'erro') r.erros.push(`${nome}: ${res.detalhe}`);
      else if (res.resultado === 'duplicada' || res.resultado === 'reuso') { r.copias++; stMarcar.run(nome, 'copia', res.detalhe || res.resultado, item.remetente); }
    }
    return r;
  }

  // ── 1. GRUPO ─────────────────────────────────────────────────────────────
  async function auditarGrupo({ desdeMs, ateMs = Infinity, aplicar, conservador }) {
    const r = { cobriu: null, mais_antiga: null, midias: 0, ja_lancadas: 0, ja_auditadas: 0, na_pasta: 0, recuperadas: [], pendentes: [], erro: null };
    if (!waPronto()) { r.erro = 'WhatsApp nao conectado — grupo nao conferido'; return r; }
    const grupo = await acharGrupo();
    if (!grupo) { r.erro = 'grupo nao encontrado'; return r; }
    const { msgs, cobriu, maisAntiga } = await buscarMensagensDesde(grupo, desdeMs, { maxTentativas: 4, esperaMs: 30000, limiteInicial: 1500 });
    r.cobriu = cobriu; r.mais_antiga = dataBR(maisAntiga);
    let nomesPasta = [];
    try { nomesPasta = fs.readdirSync(PASTA_FOTOS); } catch (e) {}
    const naPasta = pref => nomesPasta.some(n => n.startsWith(pref));
    for (const msg of msgs) {
      const ts = (msg.timestamp || 0) * 1000;
      if (!msg.hasMedia || ts < desdeMs || ts > ateMs) continue;
      r.midias++;
      if (mensagemJaLancada(msg)) { r.ja_lancadas++; continue; }
      const pref = prefixoArquivoMsg(msg);
      if (pref && stAuditadaPref.get(pref + '%')) { r.ja_auditadas++; continue; }
      if (pref && naPasta(pref)) { r.na_pasta++; continue; } // baixada e nao lancada: a auditoria da pasta trata
      let nome = 'Desconhecido';
      try { const c = await msg.getContact(); nome = c.pushname || c.name || c.number || nome; } catch (e) {}
      const item = { enviado_em: dataBR(ts), remetente: nome, tipo: msg.type, legenda: String(msg.body || '').substring(0, 80), prefixo: pref };
      if (!aplicar) { r.pendentes.push(item); continue; }
      let res;
      try { res = await processarMidia(msg, nome, { conservador }); } catch (e) { res = 'erro: ' + e.message; }
      item.resultado = typeof res === 'object' && res ? res.resultado : res;
      if (['deposito', 'despesa', 'duplicada', 'reuso', 'orcamento', 'ja_lancada'].includes(item.resultado)) {
        r.recuperadas.push(item);
        log(`AUDITORIA: midia de ${nome} em ${item.enviado_em} NAO tinha sido lancada — processada agora (${item.resultado})`, 'error');
      } else r.pendentes.push(item);
    }
    return r;
  }

  // ── PENDENCIAS ───────────────────────────────────────────────────────────
  function pendenciasLocais(grupoPendentes = []) {
    const lista = stRevisar.all().map(p => ({ arquivo: p.arquivo, tipo: 'revisar', detalhe: p.detalhe, valor: p.valor, data_documento: p.data_documento,
      remetente: p.remetente, enviado_em: dataBR(tsDe(p.arquivo)) }));
    for (const g of grupoPendentes) lista.push({ arquivo: `GRUPO_${g.prefixo || g.enviado_em}`, tipo: 'faltando', detalhe: `midia do grupo sem lancamento (${g.tipo}${g.legenda ? ': ' + g.legenda : ''})${g.resultado ? ' — ' + g.resultado : ''}`,
      valor: null, data_documento: null, remetente: g.remetente, enviado_em: g.enviado_em });
    return lista;
  }

  async function publicar(rel, pend) {
    if (!sb) return;
    try {
      const agora = new Date().toISOString();
      const linhas = pend.map(p => ({ arquivo: p.arquivo, tipo: p.tipo, detalhe: p.detalhe, valor: p.valor, data_documento: p.data_documento,
        remetente: p.remetente, enviado_em: p.enviado_em, instancia, ultima_vez: agora, resolvido: false }));
      if (linhas.length) {
        const { error } = await sb.from('rl_auditoria_pendencias').upsert(linhas, { onConflict: 'arquivo' });
        if (error) log(`Auditoria: nao gravou pendencias no Supabase (${error.message})`, 'warn');
      }
      // O que nao esta mais pendente aqui foi resolvido (lancado, marcado como revisado ou apagado)
      const { data } = await sb.from('rl_auditoria_pendencias').select('arquivo').eq('resolvido', false);
      const abertos = new Set(linhas.map(l => l.arquivo));
      const resolver = (data || []).map(d => d.arquivo).filter(a => !abertos.has(a));
      if (resolver.length) await sb.from('rl_auditoria_pendencias').update({ resolvido: true, resolvido_em: agora }).in('arquivo', resolver);
      const { error: e2 } = await sb.from('rl_auditoria_execucoes').insert({ instancia, executado_em: agora, pendencias: pend.length, resumo: rel });
      if (e2) log(`Auditoria: nao gravou a execucao no Supabase (${e2.message})`, 'warn');
    } catch (e) { log(`Auditoria: Supabase falhou (${e.message})`, 'warn'); }
  }

  let ultimoAlertaWA = '';
  async function alertarWhatsApp(rel, pend) {
    const destino = process.env.AUDITORIA_ALERTA_WA;
    if (!destino || !client || (!pend.length && rel.grupo.cobriu !== false)) return;
    const chave = pend.map(p => p.arquivo).sort().join('|') + (rel.grupo.cobriu === false ? '|SEM_HISTORICO' : '');
    if (chave === ultimoAlertaWA) return; // mesmas pendencias: avisa uma vez so
    ultimoAlertaWA = chave;
    const linhas = pend.slice(0, 15).map(p => `• ${p.enviado_em} ${p.remetente || ''} — ${p.detalhe || p.tipo}`);
    const txt = `⚠️ *Auditoria RL Transportes*\n${pend.length} foto(s) do grupo sem lancamento ou para revisar:\n${linhas.join('\n')}${pend.length > 15 ? `\n… e mais ${pend.length - 15}` : ''}`
      + (rel.grupo.cobriu === false ? `\n\nATENCAO: o WhatsApp nao devolveu o historico desde ${rel.janela.grupo_desde}; pode haver fotos nao conferidas.` : '')
      + (rel.pasta.lancados.length || rel.grupo.recuperadas.length ? `\n\nLancado agora pela auditoria: ${rel.pasta.lancados.length + rel.grupo.recuperadas.length} item(ns).` : '');
    try { await client.sendMessage(destino, txt); } catch (e) { log(`Auditoria: alerta no WhatsApp falhou (${e.message})`, 'warn'); }
  }

  // ── EXECUCAO ─────────────────────────────────────────────────────────────
  async function executar({ diasGrupo = 15, diasPasta = 30, de = null, ate = null, simular = false, conservador = true, motivo = 'rotina' } = {}) {
    if (!rlGrava()) return { ok: false, erro: 'instancia em reserva — a auditoria roda na principal' };
    if (rodando) return { ok: false, erro: 'auditoria ja em andamento' };
    rodando = true;
    try {
      const agora = Date.now();
      const deMs = de ? new Date(de + 'T00:00:00-03:00').getTime() : null;
      const ateMs = ate ? new Date(ate + 'T23:59:59-03:00').getTime() : Infinity;
      const grupoDesde = deMs || agora - diasGrupo * DIA, pastaDesde = deMs || agora - diasPasta * DIA;
      const aplicar = !simular;
      const grupo = await auditarGrupo({ desdeMs: grupoDesde, ateMs, aplicar, conservador }).catch(e => ({ erro: e.message, recuperadas: [], pendentes: [] }));
      const pasta = await auditarPasta({ desdeMs: pastaDesde, ateMs, aplicar });
      const pend = aplicar ? pendenciasLocais(grupo.pendentes || []) : [];
      const rel = { ok: true, simulacao: simular, motivo, executado_em: new Date().toISOString(), instancia,
        janela: { grupo_desde: dataBR(grupoDesde), pasta_desde: dataBR(pastaDesde), ate: isFinite(ateMs) ? dataBR(ateMs) : 'agora' },
        grupo, pasta, pendencias: aplicar ? pend.length : (grupo.pendentes || []).length + pasta.orfaos.length };
      if (aplicar) {
        ultimo = rel;
        const problemas = pend.length || grupo.cobriu === false || grupo.erro;
        log(`Auditoria de midias (${motivo}): grupo ${grupo.midias || 0} midias desde ${rel.janela.grupo_desde} (${grupo.ja_lancadas || 0} lancadas, `
          + `${(grupo.recuperadas || []).length} recuperadas agora), pasta ${pasta.analisados} arquivos (${pasta.lancados.length} lancados agora, ${pasta.copias} copias) — `
          + `${pend.length} PENDENCIA(S)${grupo.cobriu === false ? ' — HISTORICO DO GRUPO INCOMPLETO' : ''}${grupo.erro ? ' — ' + grupo.erro : ''}`, problemas ? 'error' : 'info');
        await publicar(rel, pend);
        await alertarWhatsApp(rel, pend);
      }
      return rel;
    } catch (e) {
      log(`Auditoria de midias falhou: ${e.message}`, 'error');
      return { ok: false, erro: e.message };
    } finally { rodando = false; }
  }

  // Lista para o painel: na principal, do SQLite; na reserva, do Supabase (a principal publica la).
  async function pendencias() {
    if (rlGrava()) return { origem: 'local', ultima: ultimo ? ultimo.executado_em : null, itens: pendenciasLocais(ultimo && ultimo.grupo ? ultimo.grupo.pendentes || [] : []) };
    if (!sb) return { origem: 'nenhuma', itens: [] };
    const { data, error } = await sb.from('rl_auditoria_pendencias').select('*').eq('resolvido', false).order('arquivo');
    return { origem: 'supabase', erro: error ? error.message : null, itens: data || [] };
  }

  // Pessoa revisou e decidiu (lancou manualmente, ou nao e lancamento): sai das pendencias.
  function resolver(arquivo, nota) {
    const r = db.prepare(`UPDATE midias_auditadas SET resultado='resolvido', detalhe=COALESCE(detalhe,'') || ? , atualizado_em=datetime('now','localtime') WHERE arquivo=?`)
      .run(` | resolvido: ${nota || 'revisado'}`, arquivo);
    if (sb) Promise.resolve(sb.from('rl_auditoria_pendencias').update({ resolvido: true, resolvido_em: new Date().toISOString() }).eq('arquivo', arquivo)).catch(() => {});
    return r.changes > 0;
  }

  setTimeout(() => executar({ motivo: 'inicio do bot' }), PRIMEIRA_MS);
  setInterval(() => executar(), INTERVALO_MS);
  return { executar, pendencias, resolver, ultimo: () => ultimo, resumo: () => ultimo ? { ultima: ultimo.executado_em, pendencias: ultimo.pendencias, historico_completo: ultimo.grupo ? ultimo.grupo.cobriu : null } : null };
};
