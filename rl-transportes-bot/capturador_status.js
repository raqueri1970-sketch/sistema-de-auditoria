/**
 * HEALTH CHECK do capturador (09/10/2026). A cada minuto grava em capturador_status (Supabase) o estado da instância:
 * WhatsApp, Supabase, IA, última mensagem recebida, último comprovante de Obras, pendentes de leitura e erros em 24h.
 * O painel de Contas a Pagar lê essa tabela e mostra ALERTA se o estado ficar velho (capturador parado) ou ruim.
 * Não altera nada da RL nem de Obras: só lê e publica o estado. Qualquer erro aqui é engolido (nunca derruba o bot).
 */
'use strict';
const os = require('os');

module.exports = function iniciarStatus({ client, sb, db, obras, log, versao = 'bot_v3' }) {
  const INSTANCIA = process.env.CAPTURADOR_INSTANCIA || os.hostname();
  const iniciadoEm = new Date().toISOString();
  let ultimaMensagem = null;
  client.on('message', m => { ultimaMensagem = new Date((m.timestamp || Date.now() / 1000) * 1000).toISOString(); });

  // As consultas do supabase-js só têm then() (não catch) — por isso o Promise.resolve.
  const comLimite = (p, ms, padrao) => Promise.race([Promise.resolve(p).catch(() => padrao), new Promise(r => setTimeout(() => r(padrao), ms))]);
  let avisou = false;

  function errosSqlite() {
    try {
      const r = db.prepare("select count(*) n from logs where nivel='error' and ts >= datetime('now','localtime','-1 day')").get();
      const ult = db.prepare("select evento from logs where nivel='error' order by rowid desc limit 1").get();
      return { n: r ? r.n : 0, ultimo: ult ? String(ult.evento).substring(0, 300) : null };
    } catch (e) { return { n: null, ultimo: null }; }
  }

  async function publicar() {
    if (!sb) return;
    try {
      const estado = await comLimite(client.getState(), 15000, 'SEM_RESPOSTA');
      const [ult, pend] = await Promise.all([
        comLimite(sb.from('obras_comprovantes').select('created_at').eq('origem', 'whatsapp').order('created_at', { ascending: false }).limit(1), 10000, { error: { message: 'timeout' } }),
        comLimite(sb.from('obras_comprovantes').select('id', { count: 'exact', head: true }).eq('status', 'pendente_leitura'), 10000, { error: { message: 'timeout' } })
      ]);
      const supabaseOk = !ult.error && !pend.error;
      const erros = errosSqlite();
      const ia = obras && obras._estadoIA ? obras._estadoIA() : null;
      const { error } = await sb.from('capturador_status').upsert({
        instancia: INSTANCIA, atualizado_em: new Date().toISOString(), iniciado_em: iniciadoEm,
        whatsapp_estado: estado || 'DESCONHECIDO', supabase_ok: supabaseOk, ia,
        ultima_mensagem: ultimaMensagem, ultimo_comprovante: ult.data && ult.data[0] ? ult.data[0].created_at : null,
        pendentes_leitura: pend.count || 0, fila_pendente: obras && obras._fila ? obras._fila() : 0,
        erros_24h: erros.n, ultimo_erro: erros.ultimo, versao,
        detalhes: { node: process.version, memoria_mb: Math.round(process.memoryUsage().rss / 1048576), uptime_min: Math.round(process.uptime() / 60) }
      });
      if (error) log(`Health check: nao gravou no Supabase (${error.message})`, 'warn');
    } catch (e) { if (!avisou) { avisou = true; log(`Health check falhou: ${e.message}`, 'warn'); } } // nunca derruba o bot
  }

  setTimeout(publicar, 20 * 1000);
  setInterval(publicar, 60 * 1000);
  log(`Health check ativo — instancia "${INSTANCIA}" publica em capturador_status a cada 1 min`);
  return { publicar };
};
