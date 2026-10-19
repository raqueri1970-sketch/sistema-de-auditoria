/**
 * UMA INSTÂNCIA SÓ GRAVANDO (16/10/2026).
 *
 * BUG REAL (16/10/2026): a nuvem (VPS) e o D90 ficaram ligados ao mesmo tempo, os dois em produção. Cada um tem o seu
 * SQLite da RL e os dois gravavam nas mesmas tabelas rl_* com a mesma numeração ("duplicate key value violates unique
 * constraint rl_despesas_pkey", despesa #1342). Pior: o espelho de 2h de cada um apaga do Supabase o que não existe no
 * SQLite dele, então um apagava os lançamentos do outro.
 *
 * Regra: cada instância publica prioridade e início em capturador_status (detalhes.prioridade). Se houver OUTRA instância
 * de produção viva (batimento nos últimos 3 min) com prioridade maior — ou igual e ligada antes —, esta fica em RESERVA:
 *  - RL: não processa nada nem espelha no Supabase. Fica parada ATÉ REINICIAR, mesmo que a outra caia: o SQLite daqui
 *    ficou desatualizado e assumir apagaria/colidiria lançamentos da outra (o banco da RL é de UMA máquina só).
 *  - Obras: não processa enquanto a outra estiver viva. Se a outra cair, assume (Supabase é a fonte da verdade e o
 *    wa_msg_id impede duplicar) e a varredura recupera o que ficou para trás.
 * Prioridade: CAPTURADOR_PRIORIDADE no .env; sem isso, "nuvem" = 10 e qualquer outra = 1. Modo sombra não usa a trava.
 */
'use strict';
const os = require('os');

const VIVO_MS = 3 * 60 * 1000;
const prioridadePadrao = inst => (inst === 'nuvem' ? 10 : 1);

module.exports = function criarLider({ sb, log = () => {}, sombra = false }) {
  const INSTANCIA = process.env.CAPTURADOR_INSTANCIA || os.hostname();
  const PRIORIDADE = Number(process.env.CAPTURADOR_PRIORIDADE) || prioridadePadrao(INSTANCIA);
  const iniciadoEm = new Date().toISOString(), inicioMs = Date.now();
  let papel = sombra || !sb ? 'principal' : 'verificando';
  let rlBloqueada = false, concorrente = null, aoAssumir = [];

  async function verificar() {
    if (sombra || !sb) return papel;
    try {
      // Sem o login do robô o RLS devolve lista vazia (sem erro) — pareceria que não há outra instância.
      const ses = await sb.auth.getSession();
      if (!ses || !ses.data || !ses.data.session) throw new Error('robo ainda sem login no Supabase');
      const desde = new Date(Date.now() - VIVO_MS).toISOString();
      const { data, error } = await sb.from('capturador_status').select('instancia,atualizado_em,iniciado_em,versao,detalhes')
        .gt('atualizado_em', desde).neq('instancia', INSTANCIA);
      if (error) throw new Error(error.message);
      const outras = (data || []).filter(o => !String(o.versao || '').includes('sombra')).map(o => ({
        ...o, prioridade: Number(o.detalhes && o.detalhes.prioridade) || prioridadePadrao(o.instancia) }));
      const maisForte = outras.find(o => o.prioridade > PRIORIDADE
        || (o.prioridade === PRIORIDADE && String(o.iniciado_em || '') < iniciadoEm));
      const antes = papel;
      if (maisForte) {
        papel = 'reserva'; concorrente = maisForte.instancia;
        if (!rlBloqueada) {
          rlBloqueada = true;
          log(`ATENCAO: a instancia "${maisForte.instancia}" (prioridade ${maisForte.prioridade}) esta no ar — esta ("${INSTANCIA}", prioridade ${PRIORIDADE}) fica em RESERVA e nao grava nada. RL parada ate reiniciar; Obras assume sozinho se a outra cair.`, 'error');
        }
      } else {
        papel = 'principal'; concorrente = null;
        if (antes === 'reserva') log(`A instancia "${INSTANCIA}" assumiu Obras (nenhuma outra no ar).${rlBloqueada ? ' RL continua parada aqui ate reiniciar.' : ''}`, 'warn');
      }
      if (antes !== 'principal' && papel === 'principal') { const fns = aoAssumir; fns.forEach(fn => { try { fn(); } catch (e) {} }); }
    } catch (e) {
      // Sem Supabase (ou robô ainda entrando) não dá para saber. Depois de 2 min tentando, trabalha normal:
      // o bot tem de funcionar sem Supabase.
      if (papel === 'verificando' && Date.now() - inicioMs > 2 * 60 * 1000) {
        papel = 'principal';
        log(`Trava de instancia: Supabase nao respondeu (${e.message}) — trabalhando como principal`, 'warn');
        const fns = aoAssumir; fns.forEach(fn => { try { fn(); } catch (_) {} });
      }
    }
    return papel;
  }

  setInterval(verificar, 30 * 1000);
  return {
    INSTANCIA, PRIORIDADE, iniciadoEm, verificar,
    papel: () => papel,
    // RL só grava se nunca viu uma instância mais forte desde que ligou
    rlPode: () => !rlBloqueada && papel !== 'verificando',
    obrasPode: () => papel === 'principal',
    concorrente: () => concorrente,
    rlBloqueada: () => rlBloqueada,
    aoAssumir: fn => aoAssumir.push(fn)
  };
};
