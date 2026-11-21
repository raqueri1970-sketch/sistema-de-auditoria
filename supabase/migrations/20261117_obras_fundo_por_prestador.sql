-- 17/11/2026 (pedido do usuário) — fundo fixo POR PRESTADOR. Jhony passa a ter fundo de R$ 12 mil; os demais seguem com 10 mil.
-- O fundo é só o ALVO da recarga: não é dinheiro entregue (isso continua nos adiantamentos).
--   saldo_devedor (Recarga) = fundo − (greatest(crédito, 10000) − em aberto − com o financeiro)
--   Ex.: Jhony crédito 10 mil, em aberto 6.663,04 → saldo 3.336,96 → recarga 12.000 − 3.336,96 = 8.663,04
--   (os 2 mil a mais do fundo entram na próxima recarga). Sem fundo: em aberto + com o financeiro (igual antes).
-- Nova coluna obras_saldo_prestador.fundo (no fim, para não quebrar quem lê a view).

create table if not exists public.obras_fundo_prestador (
  prestador text primary key,
  valor numeric(12,2) not null check (valor > 0),
  observacao text,
  atualizado_em timestamptz not null default now()
);
alter table public.obras_fundo_prestador enable row level security;
drop policy if exists "obras fundo leitura" on public.obras_fundo_prestador;
create policy "obras fundo leitura" on public.obras_fundo_prestador for select to authenticated
  using ((select obras_pode_ver_fluxo()));

insert into public.obras_fundo_prestador (prestador, valor, observacao)
values ('Jhony', 12000, 'Fundo aumentado de 10 mil para 12 mil em 17/11/2026')
on conflict (prestador) do update set valor = excluded.valor, observacao = excluded.observacao, atualizado_em = now();

create or replace view public.obras_saldo_prestador as
 WITH d AS (
         SELECT obras_despesas_pagamento.prestador,
            count(*) FILTER (WHERE obras_despesas_pagamento.saldo > 0::numeric) AS itens_abertos,
            COALESCE(sum(obras_despesas_pagamento.saldo), 0::numeric) AS em_aberto,
            count(*) FILTER (WHERE obras_despesas_pagamento.situacao = 'parcial'::text) AS itens_parciais,
            COALESCE(sum(obras_despesas_pagamento.valor_reservado), 0::numeric) AS com_financeiro,
            min(obras_despesas_pagamento.semana) FILTER (WHERE obras_despesas_pagamento.saldo > 0::numeric) AS semana_mais_antiga,
            count(DISTINCT obras_despesas_pagamento.semana) FILTER (WHERE obras_despesas_pagamento.saldo > 0::numeric) AS semanas_abertas,
            COALESCE(sum(obras_despesas_pagamento.criticos) FILTER (WHERE obras_despesas_pagamento.saldo > 0::numeric), 0::numeric) AS criticos,
            COALESCE(sum(obras_despesas_pagamento.atencoes) FILTER (WHERE obras_despesas_pagamento.saldo > 0::numeric), 0::numeric) AS atencoes,
            COALESCE(sum(obras_despesas_pagamento.valor) FILTER (WHERE obras_despesas_pagamento.status = 'lancado'::text AND obras_despesas_pagamento.situacao <> 'recusado'::text), 0::numeric) AS total_despesas,
            COALESCE(sum(obras_despesas_pagamento.valor_pago) FILTER (WHERE obras_despesas_pagamento.status = 'lancado'::text), 0::numeric) AS total_pago_despesas,
            count(*) FILTER (WHERE obras_despesas_pagamento.status = 'pendente_leitura'::text) AS pendentes_leitura
           FROM obras_despesas_pagamento
          WHERE obras_despesas_pagamento.prestador IS NOT NULL AND obras_despesas_pagamento.status <> 'pagamento'::text AND NOT (obras_despesas_pagamento.prestador IN ( SELECT n.nome
                   FROM obras_pagador_nomes n))
          GROUP BY obras_despesas_pagamento.prestador
        ), a AS (
         SELECT obras_adiantamentos.prestador,
            sum(obras_adiantamentos.valor) FILTER (WHERE obras_adiantamentos.tipo <> 'glosa'::text) AS adiantado,
            sum(obras_adiantamentos.valor) FILTER (WHERE obras_adiantamentos.tipo = 'glosa'::text) AS glosas
           FROM obras_adiantamentos
          WHERE NOT obras_adiantamentos.cancelado
          GROUP BY obras_adiantamentos.prestador
        ), p AS (
         SELECT obras_pagamentos.prestador,
            sum(obras_pagamentos.valor_abatido) AS abatido,
            max(obras_pagamentos.pago_em) AS ultimo_pagamento,
            sum(obras_pagamentos.valor_pago) FILTER (WHERE obras_pagamentos.status = ANY (ARRAY['pago'::text, 'auditado'::text, 'pendencia'::text])) AS pago_em_lotes,
            count(*) FILTER (WHERE obras_pagamentos.status = 'pendencia'::text) AS pagamentos_pendencia
           FROM obras_pagamentos
          WHERE obras_pagamentos.status <> 'cancelado'::text
          GROUP BY obras_pagamentos.prestador
        ), r AS (
         SELECT DISTINCT ON (obras_remetentes.nome) obras_remetentes.nome,
            obras_remetentes.pix_tipo,
            obras_remetentes.pix_chave,
            obras_remetentes.titular,
            obras_remetentes.banco,
            obras_remetentes.agencia,
            obras_remetentes.conta
           FROM obras_remetentes
          WHERE obras_remetentes.ativo
          ORDER BY obras_remetentes.nome, (obras_remetentes.pix_chave IS NOT NULL) DESC
        )
 SELECT COALESCE(d.prestador, a.prestador) AS prestador,
    COALESCE(d.itens_abertos, 0::bigint) AS itens_abertos,
    COALESCE(d.em_aberto, 0::numeric) AS em_aberto,
    COALESCE(d.itens_parciais, 0::bigint) AS itens_parciais,
    COALESCE(d.com_financeiro, 0::numeric) AS com_financeiro,
    d.semana_mais_antiga,
    COALESCE(d.semanas_abertas, 0::bigint) AS semanas_abertas,
    GREATEST(COALESCE(a.adiantado, 0::numeric) - COALESCE(p.abatido, 0::numeric), 0::numeric) AS adiantamento_disponivel,
    GREATEST(
        CASE
            WHEN GREATEST(COALESCE(a.adiantado, 0::numeric) - COALESCE(p.abatido, 0::numeric), 0::numeric) > 0::numeric THEN COALESCE(f.valor, 10000::numeric) - (GREATEST(GREATEST(COALESCE(a.adiantado, 0::numeric) - COALESCE(p.abatido, 0::numeric), 0::numeric), 10000::numeric) - COALESCE(d.em_aberto, 0::numeric) - COALESCE(d.com_financeiro, 0::numeric))
            ELSE COALESCE(d.em_aberto, 0::numeric) + COALESCE(d.com_financeiro, 0::numeric)
        END, 0::numeric) AS saldo_devedor,
    COALESCE(d.criticos, 0::numeric) AS criticos,
    COALESCE(d.atencoes, 0::numeric) AS atencoes,
    COALESCE(d.pendentes_leitura, 0::bigint) AS pendentes_leitura,
        CASE
            WHEN COALESCE(d.criticos, 0::numeric) > 0::numeric OR COALESCE(p.pagamentos_pendencia, 0::bigint) > 0 THEN 'critico'::text
            WHEN COALESCE(d.atencoes, 0::numeric) > 0::numeric OR COALESCE(d.pendentes_leitura, 0::bigint) > 0 THEN 'atencao'::text
            ELSE 'normal'::text
        END AS risco,
    COALESCE(d.total_despesas, 0::numeric) AS total_despesas,
    COALESCE(d.total_pago_despesas, 0::numeric) AS total_pago,
    COALESCE(a.adiantado, 0::numeric) AS total_adiantado,
    p.ultimo_pagamento,
    COALESCE(p.pagamentos_pendencia, 0::bigint) AS pagamentos_pendencia,
    r.titular,
    r.pix_tipo,
    r.pix_chave,
    r.banco,
    r.agencia,
    r.conta,
    COALESCE(a.glosas, 0::numeric) AS divergencia,
    COALESCE(f.valor, 10000::numeric) AS fundo
   FROM d
     FULL JOIN a ON a.prestador = d.prestador
     LEFT JOIN p ON p.prestador = COALESCE(d.prestador, a.prestador)
     LEFT JOIN r ON r.nome = COALESCE(d.prestador, a.prestador)
     LEFT JOIN obras_fundo_prestador f ON f.prestador = COALESCE(d.prestador, a.prestador);
