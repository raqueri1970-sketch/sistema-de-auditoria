-- 27/10/2026: card "Auditoria · verificação" do painel do Desconto em Folha. Cada achado da competência recebe
-- Auditado ou Recusado (com observação), de quem e quando; vale o registro mais recente de cada item (histórico fica).
create table if not exists public.cred_verificacoes (
  id bigint generated always as identity primary key,
  competencia text not null,
  item text not null,
  status text not null check (status in ('auditado', 'recusado')),
  observacao text,
  usuario text default (auth.jwt() ->> 'email'),
  criado_em timestamptz not null default now()
);
create index if not exists cred_verificacoes_comp on public.cred_verificacoes (competencia, item, id);
alter table public.cred_verificacoes enable row level security;
drop policy if exists cred_verificacoes_auditor on public.cred_verificacoes;
create policy cred_verificacoes_auditor on public.cred_verificacoes for all to authenticated
  using ((select public.cred_pode_auditar())) with check ((select public.cred_pode_auditar()));
revoke all on public.cred_verificacoes from anon;
grant select, insert on public.cred_verificacoes to authenticated;
