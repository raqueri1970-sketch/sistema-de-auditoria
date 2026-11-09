-- Auditoria de Relatórios de Despesas (reembolso / VExpenses) — 09/11/2026.
--
-- Cada relatório auditado vira uma linha: o número do relatório no sistema de despesas é a chave, e o resultado completo
-- da auditoria (despesas lidas nos comprovantes, achados, combustível × rotas, tabela CD × lojas, médias e plano) fica em
-- "payload" (jsonb). A tela auditoria-despesas/ lê daqui e mostra os cards; o mesmo relatório importado de novo atualiza a
-- linha (não duplica). Os dados têm nomes, CPFs e cartões: por isso ficam aqui, e não em arquivo no repositório.
--
-- Acesso: só administrador, controladoria e diretoria (cred_pode_auditar), igual ao Desconto em Folha. Sem DELETE.

create table if not exists public.aud_despesas_relatorios (
  relatorio text primary key,                   -- número do relatório no sistema de despesas (ex.: 12048002)
  titulo text not null,
  solicitante text,
  periodo_ini date,
  periodo_fim date,
  total numeric(14, 2) not null default 0,
  retido numeric(14, 2) not null default 0,     -- valor a reter até comprovação
  qtd_despesas int not null default 0,
  qtd_alto int not null default 0,              -- achados de risco alto
  status text not null default 'em análise' check (status in ('em análise', 'devolvido', 'liberado parcial', 'liberado', 'arquivado')),
  payload jsonb not null,
  importado_por text default (auth.jwt() ->> 'email'),
  importado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.aud_despesas_relatorios enable row level security;

drop policy if exists aud_desp_sel on public.aud_despesas_relatorios;
create policy aud_desp_sel on public.aud_despesas_relatorios for select to authenticated using (public.cred_pode_auditar());
drop policy if exists aud_desp_ins on public.aud_despesas_relatorios;
create policy aud_desp_ins on public.aud_despesas_relatorios for insert to authenticated with check (public.cred_pode_auditar());
drop policy if exists aud_desp_upd on public.aud_despesas_relatorios;
create policy aud_desp_upd on public.aud_despesas_relatorios for update to authenticated using (public.cred_pode_auditar()) with check (public.cred_pode_auditar());

revoke all on public.aud_despesas_relatorios from anon;
grant select, insert, update on public.aud_despesas_relatorios to authenticated;
