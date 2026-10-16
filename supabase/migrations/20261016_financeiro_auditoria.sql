-- Auditoria Financeira (Contas a Pagar do Sallamo)
-- Quem pode ver: administrador, controladoria e diretoria (mesmos perfis do orc_perfis usados no Portal).
-- As movimentações vêm ao vivo da API do Sallamo pela Edge Function financeiro-sallamo (o token fica só lá, como segredo).
-- Aqui fica só o trabalho do auditor: a análise de cada ocorrência (justificada / irregular / em análise) e o histórico.

create or replace function public.fin_pode_auditar()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.orc_perfis p
                 where p.user_id = (select auth.uid()) and p.ativo and p.perfil in ('administrador', 'controladoria', 'diretoria'))
$$;
revoke all on function public.fin_pode_auditar() from public, anon;
grant execute on function public.fin_pode_auditar() to authenticated;

-- Análise de cada ocorrência. ocorrencia_id = "<regra>|<chave>" gerado pelo motor (financeiro/auditoria.js).
create table if not exists public.fin_analises (
  ocorrencia_id text primary key,
  regra text not null,
  situacao text not null default 'em_analise' check (situacao in ('em_analise', 'justificada', 'irregular', 'corrigida')),
  comentario text,
  fornecedor text,
  valor numeric(14, 2),
  detalhe text,
  atualizado_por text,
  atualizado_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);
create index if not exists fin_analises_regra on public.fin_analises (regra);

-- Histórico (quem mudou o quê) — trilha de auditoria da própria auditoria
create table if not exists public.fin_analises_historico (
  id bigint generated always as identity primary key,
  ocorrencia_id text not null,
  situacao text,
  comentario text,
  usuario text,
  em timestamptz not null default now()
);
create index if not exists fin_analises_historico_oc on public.fin_analises_historico (ocorrencia_id, em desc);

create or replace function public.fin_analises_registra()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := coalesce((select email from auth.users where id = auth.uid()), new.atualizado_por);
  insert into public.fin_analises_historico (ocorrencia_id, situacao, comentario, usuario)
  values (new.ocorrencia_id, new.situacao, new.comentario, new.atualizado_por);
  return new;
end $$;
drop trigger if exists fin_analises_registra on public.fin_analises;
create trigger fin_analises_registra before insert or update on public.fin_analises
  for each row execute function public.fin_analises_registra();

alter table public.fin_analises enable row level security;
alter table public.fin_analises_historico enable row level security;

drop policy if exists fin_analises_ler on public.fin_analises;
create policy fin_analises_ler on public.fin_analises for select to authenticated using ((select public.fin_pode_auditar()));
drop policy if exists fin_analises_gravar on public.fin_analises;
create policy fin_analises_gravar on public.fin_analises for insert to authenticated with check ((select public.fin_pode_auditar()));
drop policy if exists fin_analises_alterar on public.fin_analises;
create policy fin_analises_alterar on public.fin_analises for update to authenticated
  using ((select public.fin_pode_auditar())) with check ((select public.fin_pode_auditar()));

drop policy if exists fin_hist_ler on public.fin_analises_historico;
create policy fin_hist_ler on public.fin_analises_historico for select to authenticated using ((select public.fin_pode_auditar()));

revoke all on function public.fin_analises_registra() from public, anon, authenticated;
revoke all on public.fin_analises, public.fin_analises_historico from anon;
revoke delete, truncate on public.fin_analises from authenticated;               -- análise não se apaga, só muda de situação
revoke insert, update, delete, truncate on public.fin_analises_historico from authenticated;  -- histórico só pelo gatilho
grant select, insert, update on public.fin_analises to authenticated;
grant select on public.fin_analises_historico to authenticated;
