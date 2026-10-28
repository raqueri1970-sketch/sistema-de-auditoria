-- 28/10/2026 — DEPÓSITO PARA O PRESTADOR NUNCA É DESPESA (pedido do Ricardo).
--
-- Caso: em 27/10 o Jhony mandou no grupo o PDF do extrato que o próprio sistema gerou (extrato_Jhony_2026-10-26.pdf).
-- A IA leu cada linha do extrato; a linha "Recarga (PIX) nº 20 — R$ 7.993,00" (o PIX da Mar Aberto para a MARTINS SOUZA
-- CONSTRUTORA, empresa do Jhony, de 20/10) virou comprovante_pix "lancado" = DESPESA em aberto do Jhony.
-- O depósito já estava certo como Recarga nº 20; a linha do extrato contou o mesmo dinheiro de novo, ao contrário.
--
-- Regra (vale para tudo o que entrar ou voltar a "lancado", venha do bot, da tela ou de quem for):
--   1) Extrato/relatório gerado pelo próprio sistema (extrato_*.pdf, resumo-presidente-*.pdf, visao-geral-obras-*.pdf)
--      e linha "Recarga (PIX) nº" / "Reembolso nº" nunca são despesa.
--   2) PIX/TED cujo RECEBEDOR é o próprio prestador (tabela obras_favorecido_prestador: MARTINS SOUZA → Jhony,
--      JOSEMAR → Josemar Henrique) é DEPÓSITO para ele, nunca despesa. Se o pagador é a empresa (Mar Aberto/Presidente)
--      a regra antiga já transforma em pagamento (recarga). Nos outros casos fica "nao_despesa" e a descrição diz
--      se o depósito já está identificado como recarga (nº) ou se ainda precisa ser conferido.
--   3) O Auditor marca CRÍTICO qualquer depósito ao prestador que ainda esteja somando como despesa.

create schema if not exists obras_interno;

-- Por que este comprovante não é despesa (null = pode ser despesa)
create or replace function obras_interno.deposito_motivo(p_fornecedor text, p_descricao text, p_legenda text, p_tipo text, p_forma text)
returns jsonb language sql stable set search_path to 'public' as $$
  select case
    when coalesce(p_legenda, '') ~* '^\s*(extrato|resumo-presidente|visao-geral-obras)[_-][^/]*\.pdf\s*$'
      then jsonb_build_object('tipo', 'extrato', 'motivo', 'linha do extrato/relatório gerado pelo próprio sistema (' || trim(p_legenda) || ')')
    when coalesce(p_descricao, '') ~* '^\s*(recarga|reembolso)\s*(\(pix\))?\s*n\s*[º°o.]'
      then jsonb_build_object('tipo', 'extrato', 'motivo', 'é a linha "' || left(trim(p_descricao), 40) || '" de um extrato, não um gasto')
    when (coalesce(p_tipo, '') in ('comprovante_pix', 'comprovante_ted') or coalesce(p_forma, '') in ('pix', 'transferencia'))
     and (select f.prestador from public.obras_favorecido_prestador f
           where f.ativo and public.obras_norm_favorecido(p_fornecedor) like '%' || f.padrao || '%'
           order by length(f.padrao) desc limit 1) is not null
      then jsonb_build_object('tipo', 'deposito',
             'prestador', (select f.prestador from public.obras_favorecido_prestador f
                            where f.ativo and public.obras_norm_favorecido(p_fornecedor) like '%' || f.padrao || '%'
                            order by length(f.padrao) desc limit 1),
             'motivo', 'o recebedor (' || trim(p_fornecedor) || ') é o próprio prestador')
  end
$$;

-- Recarga já registrada para o prestador com o mesmo valor (±R$ 0,05) e data (±3 dias)
create or replace function obras_interno.recarga_do_deposito(p_prest text, p_valor numeric, p_data date)
returns text language sql stable set search_path to 'public' as $$
  select coalesce(
    (select 'Recarga (PIX) nº ' || p.numero from public.obras_pagamentos p
      where p.prestador = p_prest and p.status in ('pago', 'auditado', 'pendencia')
        and abs(coalesce(p.valor_pago, p.valor_aprovado) - p_valor) <= 0.05
        and (p.pago_em at time zone 'America/Sao_Paulo')::date between p_data - 3 and p_data + 3
      order by abs((p.pago_em at time zone 'America/Sao_Paulo')::date - p_data) limit 1),
    (select 'adiantamento de ' || to_char(a.data, 'DD/MM/YYYY') from public.obras_adiantamentos a
      where a.prestador = p_prest and not coalesce(a.cancelado, false) and abs(a.valor - p_valor) <= 0.05
        and a.data between p_data - 3 and p_data + 3 limit 1))
$$;

create or replace function public.obras_pagador_before()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_nome text; m jsonb; v_rec text; v_prest text;
begin
  select nome into v_nome from public.obras_pagadores where numero = new.remetente_numero and ativo;
  if v_nome is null and coalesce(new.pagador, '') <> '' then
    select nome into v_nome from public.obras_pagador_nomes
     where ativo and upper(translate(new.pagador, 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeioooucAAAAEEIOOOUC')) like '%' || padrao || '%' limit 1;
  end if;
  if v_nome is not null and new.status = 'lancado' then
    new.status := 'pagamento'; new.situacao_pagamento := 'pago'; new.responsavel := v_nome;
    return new;
  end if;

  -- 28/10/2026: depósito para o prestador / linha de extrato nunca entra como despesa
  if new.status = 'lancado' then
    m := obras_interno.deposito_motivo(new.fornecedor, new.descricao, new.legenda, new.tipo_doc, new.forma_pagamento);
    if m is not null then
      -- alguém clicou em "Aprovar"/"Reverter" num depósito: avisa em vez de voltar calado para "Não é despesa"
      if tg_op = 'UPDATE' and old.status in ('nao_despesa', 'cancelado', 'duplicada', 'orcamento') then
        raise exception 'DEPOSITO: não pode virar despesa — %. Depósito para o prestador é recarga, nunca gasto.', m->>'motivo'
          using errcode = 'P0001';
      end if;
      new.status := 'nao_despesa';
      if coalesce(new.descricao, '') not like 'DEPÓSITO%' and coalesce(new.descricao, '') not like 'NÃO É DESPESA%' then
        if m->>'tipo' = 'deposito' then
          v_prest := m->>'prestador';
          v_rec := obras_interno.recarga_do_deposito(v_prest, new.valor, new.data_despesa);
          new.descricao := left('DEPÓSITO para ' || v_prest || ' — não é despesa: ' || (m->>'motivo')
            || coalesce(' · já identificado como ' || v_rec, ' · recarga correspondente NÃO encontrada: conferir quem pagou')
            || '. ' || coalesce(new.descricao, ''), 500);
        else
          new.descricao := left('NÃO É DESPESA — ' || (m->>'motivo') || '. ' || coalesce(new.descricao, ''), 500);
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

-- Auditor: depósito ao prestador que ainda soma como despesa (lançado antes desta regra) = CRÍTICO
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.obras_auditar_comprovante(uuid)'::regprocedure);
  if position('deposito_ao_prestador' in d) = 0 then
    d := replace(d, '  perform obras_interno.auditar_fraude(c.id);',
$q$  perform public.obras_achado(c.id, 'deposito_ao_prestador',
    obras_interno.deposito_motivo(c.fornecedor, c.descricao, c.legenda, c.tipo_doc, c.forma_pagamento) is not null,
    'critico', 'Isto é DEPÓSITO para o prestador / linha de extrato, não despesa: '
      || coalesce(obras_interno.deposito_motivo(c.fornecedor, c.descricao, c.legenda, c.tipo_doc, c.forma_pagamento)->>'motivo', '')
      || '. Se já foi reembolsado, glosar no próximo pagamento.',
    jsonb_build_object('recebedor', c.fornecedor, 'pagador', c.pagador));
  perform obras_interno.auditar_fraude(c.id);$q$);
    if position('deposito_ao_prestador' in d) = 0 then raise exception 'obras_auditar_comprovante mudou: trecho do auditar_fraude não encontrado'; end if;
    execute d;
  end if;
end $mig$;

-- Correção do caso: a linha "Recarga (PIX) nº 20" do extrato do Jhony (R$ 7.993,00) sai da despesa.
-- Ela não foi paga por nenhuma recarga (sem pagamento_id e sem item de pagamento), então basta tirar do em aberto.
update public.obras_comprovantes c set status = 'lancado', updated_at = now()   -- passa pelo gatilho acima → nao_despesa
 where c.status = 'lancado' and c.origem = 'whatsapp'
   and obras_interno.deposito_motivo(c.fornecedor, c.descricao, c.legenda, c.tipo_doc, c.forma_pagamento)->>'tipo' = 'extrato'
   and not exists (select 1 from public.obras_pagamento_itens i where i.comprovante_id = c.id);

-- Reaudita o que ainda está lançado e é depósito (ex.: R$ 80,00 de 07/10 para a MARTINS & SOUZA, já pago no nº 11):
-- não mexe no que já foi pago, só aponta o crítico na Auditoria para o Ricardo decidir a glosa.
select public.obras_auditar_comprovante(c.id) from public.obras_comprovantes c
 where c.status = 'lancado' and obras_interno.deposito_motivo(c.fornecedor, c.descricao, c.legenda, c.tipo_doc, c.forma_pagamento) is not null;
