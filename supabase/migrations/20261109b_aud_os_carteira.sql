-- Carteira de Ordens de Serviço de Facilities (Globalthings) — 09/11/2026.
--
-- Cada importação é uma fotografia da carteira (OS abertas/pendentes cruzadas com as fechadas): idade, alertas, custo previsto
-- por OS, prestadores, executores, preços de material, retrabalho e cruzamento com os relatórios de despesas. A tela
-- auditoria-despesas/ (aba "Ordens de serviço") lê daqui. A mesma data importada de novo substitui a fotografia.
-- Os dados têm nomes de colaboradores e prestadores: ficam aqui, não no repositório.
--
-- Acesso: só administrador, controladoria e diretoria (cred_pode_auditar). Sem DELETE.

create table if not exists public.aud_os_carteira (
  snapshot date primary key,
  fonte text,
  abertas int not null default 0,
  fechadas_base int not null default 0,
  custo_previsto numeric(14, 2) not null default 0,
  payload jsonb not null,
  importado_por text default (auth.jwt() ->> 'email'),
  importado_em timestamptz not null default now()
);

alter table public.aud_os_carteira enable row level security;
drop policy if exists aud_os_sel on public.aud_os_carteira;
create policy aud_os_sel on public.aud_os_carteira for select to authenticated using (public.cred_pode_auditar());
drop policy if exists aud_os_ins on public.aud_os_carteira;
create policy aud_os_ins on public.aud_os_carteira for insert to authenticated with check (public.cred_pode_auditar());
drop policy if exists aud_os_upd on public.aud_os_carteira;
create policy aud_os_upd on public.aud_os_carteira for update to authenticated using (public.cred_pode_auditar()) with check (public.cred_pode_auditar());
revoke all on public.aud_os_carteira from anon;
grant select, insert, update on public.aud_os_carteira to authenticated;
