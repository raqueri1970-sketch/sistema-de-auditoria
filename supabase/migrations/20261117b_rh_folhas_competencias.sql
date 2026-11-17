-- Central de Auditoria RH: folhas mensais importadas (uma linha por competência), compartilhadas entre usuários com acesso de RH.
-- dados_gz = JSON da competência (funcionários agregados, rubricas) em gzip+base64; CPF gravado mascarado + código de cruzamento.
-- Aplicada em 17/11/2026. Carga inicial 01 a 10/2026 feita uma vez pela função rh-folhas-carga-inicial (depois desativada).
create table if not exists public.rh_folhas_competencias (
  tenant_id text not null default 'esposende',
  competencia text not null,                -- ex.: '10/26-1' (Mês_Ano Folha)
  ordem integer not null,                   -- AAAAMMS para ordenar
  arquivo text not null,
  linhas integer not null,
  funcionarios integer not null,
  bruto numeric(14,2) not null,
  descontos numeric(14,2) not null,
  dados_gz text not null,
  enviado_por uuid default auth.uid(),
  enviado_por_email text default (auth.jwt() ->> 'email'),
  enviado_em timestamptz not null default now(),
  primary key (tenant_id, competencia)
);
comment on table public.rh_folhas_competencias is 'Central de Auditoria RH — folhas mensais (FOLHA MM-AAAA.xlsx) agregadas por funcionário; leitura/gravação só portal_pode(''rh'').';

alter table public.rh_folhas_competencias enable row level security;
drop policy if exists rh_folhas_competencias_rh_all on public.rh_folhas_competencias;
create policy rh_folhas_competencias_rh_all on public.rh_folhas_competencias
  for all to authenticated
  using (tenant_id = 'esposende' and (select public.portal_pode('rh')))
  with check (tenant_id = 'esposende' and (select public.portal_pode('rh')));

create or replace function public.rh_folhas_competencias_carimbo()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.enviado_por := auth.uid();
  new.enviado_por_email := auth.jwt() ->> 'email';
  new.enviado_em := now();
  return new;
end $$;
drop trigger if exists rh_folhas_competencias_carimbo on public.rh_folhas_competencias;
create trigger rh_folhas_competencias_carimbo before insert or update on public.rh_folhas_competencias
  for each row execute function public.rh_folhas_competencias_carimbo();

revoke all on public.rh_folhas_competencias from anon;
grant select, insert, update, delete on public.rh_folhas_competencias to authenticated;
