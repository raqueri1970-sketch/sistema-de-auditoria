-- OBRAS — CONTAS A PAGAR (08/10/2026)
-- Regra: tudo que já está no módulo (prestações importadas até hoje) = PAGO.
-- Todo recibo novo que chega pelas fotos do WhatsApp entra como A PAGAR e fecha por semana (segunda a domingo),
-- por responsável (número do WhatsApp), para reembolso. Só acréscimos: nada é apagado nem renomeado.

-- 1) Situação de pagamento em cada comprovante.
--    Coluna criada com default 'pago' para marcar os 982 lançamentos existentes; depois o default vira 'a_pagar'.
alter table public.obras_comprovantes
  add column if not exists situacao_pagamento text not null default 'pago',
  add column if not exists pago_em timestamptz,
  add column if not exists remetente_numero text;
update public.obras_comprovantes set pago_em = coalesce(pago_em, now()) where situacao_pagamento = 'pago' and pago_em is null;
alter table public.obras_comprovantes alter column situacao_pagamento set default 'a_pagar';
alter table public.obras_comprovantes drop constraint if exists obras_comprovantes_situacao_pagamento_check;
alter table public.obras_comprovantes add constraint obras_comprovantes_situacao_pagamento_check
  check (situacao_pagamento in ('a_pagar', 'pago'));

-- Semana de fechamento (segunda-feira) pela data da despesa.
alter table public.obras_comprovantes
  add column if not exists semana_ref date generated always as ((date_trunc('week', data_despesa::timestamp))::date) stored;
create index if not exists obras_comprovantes_apagar_ix on public.obras_comprovantes (situacao_pagamento, semana_ref);

-- 2) Quem manda recibo: número do WhatsApp → nome do responsável.
create table if not exists public.obras_remetentes (
  numero      text primary key,           -- só dígitos, com DDI: 5581999999999
  nome        text not null,
  obra_id     uuid references public.obras(id) on delete set null,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.obras_remetentes enable row level security;
drop policy if exists "obras remetentes administracao" on public.obras_remetentes;
create policy "obras remetentes administracao" on public.obras_remetentes for all to authenticated
  using ((select public.obras_pode_auditar())) with check ((select public.obras_pode_auditar()));
drop policy if exists "obras remetentes leitura portal" on public.obras_remetentes;
create policy "obras remetentes leitura portal" on public.obras_remetentes for select to authenticated
  using ((select public.portal_pode_ver()));

-- 3) Fechamento semanal (um por responsável e semana). Os totais vêm da view; aqui ficam
--    adiantamento, aprovação e pagamento.
create table if not exists public.obras_contas_pagar (
  id               uuid primary key default gen_random_uuid(),
  responsavel      text not null,          -- número do WhatsApp (ou nome, se o número não veio)
  semana_inicio    date not null,
  valor_adiantado  numeric not null default 0 check (valor_adiantado >= 0),
  status           text not null default 'aberta' check (status in ('aberta', 'fechada', 'aprovada', 'paga')),
  aprovada_em      timestamptz,
  pago_em          timestamptz,
  prestacao_id     uuid references public.obras_prestacoes(id) on delete set null,
  observacao       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (responsavel, semana_inicio)
);
alter table public.obras_contas_pagar enable row level security;
drop policy if exists "obras contas pagar administracao" on public.obras_contas_pagar;
create policy "obras contas pagar administracao" on public.obras_contas_pagar for all to authenticated
  using ((select public.obras_pode_auditar())) with check ((select public.obras_pode_auditar()));
drop policy if exists "obras contas pagar leitura portal" on public.obras_contas_pagar;
create policy "obras contas pagar leitura portal" on public.obras_contas_pagar for select to authenticated
  using ((select public.portal_pode_ver()));

-- 4) Resumo do card "Contas a pagar": uma linha por responsável × semana.
--    Soma só despesa realizada (status 'lancado'); orçamento, duplicado e pendente aparecem contados à parte.
--    A semana fecha sozinha quando o domingo passa (horário de Brasília).
create or replace view public.obras_contas_pagar_resumo with (security_invoker = true) as
with base as (
  select coalesce(c.remetente_numero, c.remetente, 'Desconhecido') as responsavel,
         c.semana_ref as semana_inicio,
         max(coalesce(r.nome, c.remetente)) as nome,
         count(*) filter (where c.status = 'lancado')                         as qtd_comprovantes,
         coalesce(sum(c.valor) filter (where c.status = 'lancado'), 0)        as total_despesas,
         count(*) filter (where c.status = 'pendente_leitura')                as qtd_pendente_leitura,
         count(*) filter (where c.status = 'duplicada')                       as qtd_duplicados,
         count(*) filter (where c.status = 'orcamento')                       as qtd_orcamentos,
         coalesce(sum(c.valor) filter (where c.status = 'orcamento'), 0)      as total_orcamentos,
         min(c.wa_data) as primeiro_recibo, max(c.wa_data) as ultimo_recibo
  from public.obras_comprovantes c
  left join public.obras_remetentes r on r.numero = c.remetente_numero
  where c.situacao_pagamento = 'a_pagar' and c.semana_ref is not null
  group by 1, 2
)
select b.responsavel, b.nome, b.semana_inicio, (b.semana_inicio + 6) as semana_fim,
       b.qtd_comprovantes, b.total_despesas, b.qtd_pendente_leitura, b.qtd_duplicados,
       b.qtd_orcamentos, b.total_orcamentos, b.primeiro_recibo, b.ultimo_recibo,
       coalesce(k.valor_adiantado, 0) as valor_adiantado,
       b.total_despesas - coalesce(k.valor_adiantado, 0) as valor_reembolso,
       case when k.status in ('aprovada', 'paga') then k.status
            when (b.semana_inicio + 6) < (now() at time zone 'America/Sao_Paulo')::date then 'fechada'
            else 'aberta' end as status,
       k.id as conta_id, k.aprovada_em, k.pago_em, k.observacao
from base b
left join public.obras_contas_pagar k on k.responsavel = b.responsavel and k.semana_inicio = b.semana_inicio;

grant select on public.obras_contas_pagar_resumo to authenticated;

-- 5) Ações do card (rodam com as permissões de quem clica: só administrador/controladoria/diretoria grava).
create or replace function public.obras_conta_pagar_definir(p_responsavel text, p_semana date,
  p_status text default null, p_adiantado numeric default null, p_observacao text default null)
returns public.obras_contas_pagar language plpgsql security invoker set search_path = public as $$
declare v public.obras_contas_pagar;
begin
  if p_status is not null and p_status not in ('aberta', 'fechada', 'aprovada', 'paga') then
    raise exception 'status invalido: %', p_status;
  end if;
  p_semana := date_trunc('week', p_semana::timestamp)::date;
  insert into public.obras_contas_pagar as k (responsavel, semana_inicio, status, valor_adiantado, observacao)
  values (p_responsavel, p_semana, coalesce(p_status, 'aberta'), coalesce(p_adiantado, 0), p_observacao)
  on conflict (responsavel, semana_inicio) do update set
    status          = coalesce(p_status, k.status),
    valor_adiantado = coalesce(p_adiantado, k.valor_adiantado),
    observacao      = coalesce(p_observacao, k.observacao),
    aprovada_em     = case when p_status = 'aprovada' then now() else k.aprovada_em end,
    pago_em         = case when p_status = 'paga' then now() else k.pago_em end,
    updated_at      = now()
  returning * into v;
  -- Semana paga: os comprovantes dela saem de "a pagar" e passam a "pago".
  if p_status = 'paga' then
    update public.obras_comprovantes c set situacao_pagamento = 'pago', pago_em = now(), updated_at = now()
     where c.situacao_pagamento = 'a_pagar' and c.semana_ref = p_semana
       and coalesce(c.remetente_numero, c.remetente, 'Desconhecido') = p_responsavel;
  end if;
  return v;
end $$;
grant execute on function public.obras_conta_pagar_definir(text, date, text, numeric, text) to authenticated;
