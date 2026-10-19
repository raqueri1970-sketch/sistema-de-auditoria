-- Obras (19/10/2026): cada comprovante DUPLICADO aponta para o comprovante original (duplicado_de), em qualquer período.
-- Antes só o texto da descrição dizia "igual a <mensagem>" — e esse texto é trocado quando alguém decide a duplicidade.
-- Com a ligação, as telas mostram sempre os dois comprovantes lado a lado e em que semana/pagamento o original foi usado.
alter table public.obras_comprovantes        add column if not exists duplicado_de uuid references public.obras_comprovantes(id) on delete set null;
alter table public.obras_comprovantes_sombra add column if not exists duplicado_de uuid;
create index if not exists obras_comprovantes_duplicado_de on public.obras_comprovantes (duplicado_de);

-- Preenche as duplicadas que já existem: 1) mensagem citada na descrição; 2) ponto do Auditor que ligou as duas;
-- 3) mesma foto (hash) lançada antes.
update public.obras_comprovantes c set duplicado_de = coalesce(
  (select o.id from public.obras_comprovantes o
    where o.wa_msg_id = substring(c.descricao from '(?:igual a|Duplicado de) ([A-Za-z0-9]+#[A-Za-z0-9]+)') and o.id <> c.id limit 1),
  (select a.comprovante_id from public.obras_auditoria_achados a
    where a.relacionado_id = c.id and a.comprovante_id <> c.id
      and a.regra in ('duplicidade_valor_data_fornecedor', 'duplicidade_autenticacao', 'arquivo_repetido') limit 1),
  (select a.relacionado_id from public.obras_auditoria_achados a
    where a.comprovante_id = c.id and a.relacionado_id is not null and a.relacionado_id <> c.id
      and a.regra in ('duplicidade_valor_data_fornecedor', 'duplicidade_autenticacao', 'arquivo_repetido') limit 1),
  (select o.id from public.obras_comprovantes o
    where o.arquivo_hash = c.arquivo_hash and o.id <> c.id and o.status <> 'duplicada' order by o.created_at limit 1))
where c.status = 'duplicada' and c.duplicado_de is null;

-- View das telas: mesma definição de antes + duplicado_de no fim.
create or replace view public.obras_despesas_pagamento as
 WITH it AS (
         SELECT i.comprovante_id,
            sum(i.valor) FILTER (WHERE p.status = ANY (ARRAY['pago'::text, 'auditado'::text, 'pendencia'::text])) AS pago,
            sum(i.valor) FILTER (WHERE p.status = 'aprovado'::text) AS reservado,
            max(p.pago_em) FILTER (WHERE p.status = ANY (ARRAY['pago'::text, 'auditado'::text, 'pendencia'::text])) AS ultimo_pagamento_em,
            (array_agg(p.numero ORDER BY p.created_at DESC))[1] AS ultimo_pagamento_numero
           FROM obras_pagamento_itens i
             JOIN obras_pagamentos p ON p.id = i.pagamento_id
          WHERE p.status <> 'cancelado'::text
          GROUP BY i.comprovante_id
        ), ach AS (
         SELECT obras_auditoria_achados.comprovante_id,
            count(*) FILTER (WHERE obras_auditoria_achados.nivel = 'critico'::text) AS criticos,
            count(*) FILTER (WHERE obras_auditoria_achados.nivel = 'atencao'::text) AS atencoes,
            jsonb_agg(jsonb_build_object('id', obras_auditoria_achados.id, 'nivel', obras_auditoria_achados.nivel, 'mensagem', obras_auditoria_achados.mensagem, 'regra', obras_auditoria_achados.regra, 'relacionado_id', obras_auditoria_achados.relacionado_id) ORDER BY obras_auditoria_achados.nivel DESC) AS achados
           FROM obras_auditoria_achados
          WHERE NOT obras_auditoria_achados.resolvido AND obras_auditoria_achados.comprovante_id IS NOT NULL
          GROUP BY obras_auditoria_achados.comprovante_id
        )
 SELECT c.id,
    c.responsavel AS prestador,
    c.semana_ref AS semana,
    c.semana_ref + 6 AS semana_fim,
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
            WHEN c.situacao_pagamento = 'pago'::text AND COALESCE(it.pago, 0::numeric) = 0::numeric THEN c.valor
            ELSE COALESCE(it.pago, 0::numeric)
        END AS valor_pago,
    COALESCE(it.reservado, 0::numeric) AS valor_reservado,
        CASE
            WHEN c.status <> 'lancado'::text OR (c.situacao_pagamento = ANY (ARRAY['pago'::text, 'recusado'::text])) THEN 0::numeric
            ELSE GREATEST(c.valor - COALESCE(it.pago, 0::numeric) - COALESCE(it.reservado, 0::numeric), 0::numeric)
        END AS saldo,
        CASE
            WHEN c.status = 'orcamento'::text THEN 'orcamento'::text
            WHEN c.status <> 'lancado'::text THEN c.status
            WHEN c.situacao_pagamento = 'recusado'::text THEN 'recusado'::text
            WHEN c.situacao_pagamento = 'pago'::text THEN 'pago'::text
            WHEN COALESCE(it.reservado, 0::numeric) > 0::numeric THEN 'com_financeiro'::text
            WHEN COALESCE(it.pago, 0::numeric) > 0::numeric THEN 'parcial'::text
            ELSE 'a_pagar'::text
        END AS situacao,
    COALESCE(ach.criticos, 0::bigint) AS criticos,
    COALESCE(ach.atencoes, 0::bigint) AS atencoes,
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
    c.prestacao_id,
    c.duplicado_de
   FROM obras_comprovantes c
     LEFT JOIN it ON it.comprovante_id = c.id
     LEFT JOIN ach ON ach.comprovante_id = c.id
     LEFT JOIN obras o ON o.id = c.obra_id;
