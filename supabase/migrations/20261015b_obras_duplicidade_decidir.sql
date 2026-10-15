-- 15/10/2026 (pedido do Ricardo): toda duplicidade apontada pelo sistema tem que dizer, sem dúvida, se ESTÁ ou NÃO ESTÁ somada
-- no total, e ter os botões APROVAR / REPROVAR:
--   * não somada (status 'duplicada', barrada pelo robô):
--       aprovar  = não é duplicidade → volta a valer (status 'lancado'), entra no total;
--       reprovar = duplicidade confirmada → continua fora do total e sai da lista de pendentes (só tira do visual).
--   * somada (status 'lancado' com ponto de duplicidade do Auditor):
--       aprovar  = não é duplicidade → os pontos de duplicidade ficam resolvidos e ela continua somada;
--       reprovar = duplicidade confirmada → sai do total (status 'duplicada') e o "a pagar" é recalculado na hora.
--   * se a duplicada JÁ FOI PAGA (pagamento ou prestação quitada), reprovar pode lançar o valor como DESCONTO (glosa):
--       vira crédito da empresa (obras_adiantamentos) e é abatido sozinho no próximo pagamento ao prestador.
-- Tudo fica registrado (quem, quando, observação) em obras_comprovantes e em obras_pagamento_eventos.

alter table public.obras_comprovantes
  add column if not exists dup_decisao text check (dup_decisao in ('aprovada', 'reprovada', 'glosada')),
  add column if not exists dup_decidido_por text,
  add column if not exists dup_decidido_em timestamptz,
  add column if not exists dup_obs text;

-- A view das despesas passa a trazer a decisão (colunas novas no fim; o resto é igual).
create or replace view public.obras_despesas_pagamento as
 WITH it AS (
         SELECT i.comprovante_id,
            sum(i.valor) FILTER (WHERE (p.status = ANY (ARRAY['pago'::text, 'auditado'::text, 'pendencia'::text]))) AS pago,
            sum(i.valor) FILTER (WHERE (p.status = 'aprovado'::text)) AS reservado,
            max(p.pago_em) FILTER (WHERE (p.status = ANY (ARRAY['pago'::text, 'auditado'::text, 'pendencia'::text]))) AS ultimo_pagamento_em,
            (array_agg(p.numero ORDER BY p.created_at DESC))[1] AS ultimo_pagamento_numero
           FROM (obras_pagamento_itens i
             JOIN obras_pagamentos p ON ((p.id = i.pagamento_id)))
          WHERE (p.status <> 'cancelado'::text)
          GROUP BY i.comprovante_id
        ), ach AS (
         SELECT obras_auditoria_achados.comprovante_id,
            count(*) FILTER (WHERE (obras_auditoria_achados.nivel = 'critico'::text)) AS criticos,
            count(*) FILTER (WHERE (obras_auditoria_achados.nivel = 'atencao'::text)) AS atencoes,
            jsonb_agg(jsonb_build_object('id', obras_auditoria_achados.id, 'nivel', obras_auditoria_achados.nivel, 'mensagem', obras_auditoria_achados.mensagem, 'regra', obras_auditoria_achados.regra, 'relacionado_id', obras_auditoria_achados.relacionado_id) ORDER BY obras_auditoria_achados.nivel DESC) AS achados
           FROM obras_auditoria_achados
          WHERE ((NOT obras_auditoria_achados.resolvido) AND (obras_auditoria_achados.comprovante_id IS NOT NULL))
          GROUP BY obras_auditoria_achados.comprovante_id
        )
 SELECT c.id,
    c.responsavel AS prestador,
    c.semana_ref AS semana,
    (c.semana_ref + 6) AS semana_fim,
    c.data_despesa,
    c.hora_documento,
    c.fornecedor,
    c.categoria,
    c.descricao,
    c.tipo_doc,
    c.forma_pagamento,
    c.valor,
    c.status,
    c.situacao_pagamento,
    c.arquivo_path,
    c.remetente,
    c.remetente_numero,
    c.obra_id,
    o.nome AS obra,
    c.confianca_ocr,
    c.wa_data,
    c.legenda,
    c.recusado_motivo,
    c.recusado_por,
    c.recusado_em,
        CASE
            WHEN ((c.situacao_pagamento = 'pago'::text) AND (COALESCE(it.pago, (0)::numeric) = (0)::numeric)) THEN c.valor
            ELSE COALESCE(it.pago, (0)::numeric)
        END AS valor_pago,
    COALESCE(it.reservado, (0)::numeric) AS valor_reservado,
        CASE
            WHEN ((c.status <> 'lancado'::text) OR (c.situacao_pagamento = ANY (ARRAY['pago'::text, 'recusado'::text]))) THEN (0)::numeric
            ELSE GREATEST(((c.valor - COALESCE(it.pago, (0)::numeric)) - COALESCE(it.reservado, (0)::numeric)), (0)::numeric)
        END AS saldo,
        CASE
            WHEN (c.status = 'orcamento'::text) THEN 'orcamento'::text
            WHEN (c.status <> 'lancado'::text) THEN c.status
            WHEN (c.situacao_pagamento = 'recusado'::text) THEN 'recusado'::text
            WHEN (c.situacao_pagamento = 'pago'::text) THEN 'pago'::text
            WHEN (COALESCE(it.reservado, (0)::numeric) > (0)::numeric) THEN 'com_financeiro'::text
            WHEN (COALESCE(it.pago, (0)::numeric) > (0)::numeric) THEN 'parcial'::text
            ELSE 'a_pagar'::text
        END AS situacao,
    COALESCE(ach.criticos, (0)::bigint) AS criticos,
    COALESCE(ach.atencoes, (0)::bigint) AS atencoes,
    COALESCE(ach.achados, '[]'::jsonb) AS achados,
    COALESCE(it.ultimo_pagamento_em, c.pago_em) AS pago_em,
    it.ultimo_pagamento_numero,
    c.pagamento_id,
    c.pagador,
    c.dup_decisao,
    c.dup_decidido_por,
    c.dup_decidido_em,
    c.dup_obs,
    c.origem,
    c.prestacao_id
   FROM (((obras_comprovantes c
     LEFT JOIN it ON ((it.comprovante_id = c.id)))
     LEFT JOIN ach ON ((ach.comprovante_id = c.id)))
     LEFT JOIN obras o ON ((o.id = c.obra_id)));

create or replace function public.obras_duplicidade_decidir(p_comp uuid, p_aprovar boolean, p_observacao text default null, p_glosar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c record; v_quem text := public.obras_usuario_nome(); v_obs text; v_acao text; v_glosa numeric := 0; v_ad uuid;
  v_regras text[] := array['duplicidade_autenticacao', 'duplicidade_valor_data_fornecedor', 'arquivo_repetido', 'fornecedor_varias_vezes_dia'];
begin
  if not (public.obras_tem_papel('presidente') or public.obras_pode_auditar()) then
    raise exception 'Somente o Presidente ou a Controladoria decidem duplicidade.'; end if;
  select * into c from public.obras_despesas_pagamento where id = p_comp;
  if not found then raise exception 'Despesa nao encontrada.'; end if;
  v_obs := coalesce(nullif(trim(p_observacao), ''), case when p_aprovar then 'Aprovada: nao e duplicidade (gastos diferentes)' else 'Reprovada: duplicidade confirmada' end);

  if c.status = 'duplicada' then
    -- NÃO estava somada
    if p_aprovar then
      update public.obras_comprovantes
         set status = 'lancado',
             situacao_pagamento = case when situacao_pagamento in ('pago', 'recusado') then situacao_pagamento else 'a_pagar' end,
             dup_decisao = 'aprovada', dup_decidido_por = v_quem, dup_decidido_em = now(), dup_obs = v_obs, updated_at = now()
       where id = p_comp;
      v_acao := 'Aprovada: passou a SOMAR no total (' || to_char(c.valor, 'FM999G999G990D00') || ').';
    else
      if p_glosar and c.situacao_pagamento = 'pago' and c.prestador is not null then
        v_glosa := c.valor;
      end if;
      update public.obras_comprovantes
         set dup_decisao = case when v_glosa > 0 then 'glosada' else 'reprovada' end,
             dup_decidido_por = v_quem, dup_decidido_em = now(), dup_obs = v_obs, updated_at = now()
       where id = p_comp;
      v_acao := 'Reprovada: continua FORA do total (nao estava somada).';
    end if;

  elsif c.status = 'lancado' then
    -- ESTAVA somada
    if p_aprovar then
      update public.obras_comprovantes set dup_decisao = 'aprovada', dup_decidido_por = v_quem, dup_decidido_em = now(), dup_obs = v_obs, updated_at = now()
       where id = p_comp;
      v_acao := 'Aprovada: continua SOMADA no total.';
    else
      if c.valor_reservado > 0 then raise exception 'Esta despesa esta num pagamento aprovado aguardando; cancele o pagamento antes.'; end if;
      if p_glosar and c.valor_pago > 0 and c.prestador is not null then v_glosa := c.valor_pago; end if;
      update public.obras_comprovantes
         set status = 'duplicada',
             descricao = left('Duplicidade confirmada por ' || coalesce(v_quem, '?') || ' em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ' - nao somado. ' || coalesce(descricao, ''), 2000),
             dup_decisao = case when v_glosa > 0 then 'glosada' else 'reprovada' end,
             dup_decidido_por = v_quem, dup_decidido_em = now(), dup_obs = v_obs, updated_at = now()
       where id = p_comp;
      v_acao := 'Reprovada: SAIU do total (' || to_char(c.valor, 'FM999G999G990D00') || ') e o a pagar foi recalculado.';
    end if;
  else
    raise exception 'Esta despesa nao e lancamento nem duplicada (status %).', c.status;
  end if;

  -- os pontos de duplicidade desta despesa e os que apontam para ela ficam resolvidos com a decisão
  update public.obras_auditoria_achados
     set resolvido = true, resolvido_por = (select auth.uid()), resolvido_por_nome = v_quem, resolvido_em = now(), observacao = v_obs, atualizado_em = now()
   where not resolvido and regra = any(v_regras) and (comprovante_id = p_comp or relacionado_id = p_comp);

  if v_glosa > 0 then
    insert into public.obras_adiantamentos (prestador, valor, data, observacao, registrado_por)
    values (c.prestador, v_glosa, (now() at time zone 'America/Sao_Paulo')::date,
            left('GLOSA duplicidade ja paga: ' || coalesce(c.fornecedor, '') || ' ' || to_char(c.data_despesa, 'DD/MM/YYYY') || ' - descontar no proximo pagamento', 500), v_quem)
    returning id into v_ad;
    v_acao := v_acao || ' Ja tinha sido paga: ' || to_char(v_glosa, 'FM999G999G990D00') || ' lancado como DESCONTO no proximo pagamento.';
  end if;

  perform public.obras_pag_evento(null, p_comp, c.prestador, case when p_aprovar then 'DUPLICIDADE_APROVADA' else 'DUPLICIDADE_REPROVADA' end, v_quem,
    jsonb_build_object('valor', c.valor, 'estava_somada', c.status = 'lancado', 'glosa', v_glosa, 'adiantamento_id', v_ad, 'observacao', v_obs));
  return jsonb_build_object('acao', v_acao, 'estava_somada', c.status = 'lancado', 'valor', c.valor, 'glosa', v_glosa);
end $$;

revoke all on function public.obras_duplicidade_decidir(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.obras_duplicidade_decidir(uuid, boolean, text, boolean) to authenticated;
