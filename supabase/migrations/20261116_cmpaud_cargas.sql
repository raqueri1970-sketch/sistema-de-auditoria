-- Descontos de Funcionários (cmpaud): carga da base em partes.
--
-- Problema (16/11/2026): desde 10/08 nenhum envio do módulo chegava à nuvem ("⚠ Não sincronizado").
-- Para trocar a base, o módulo apagava as 54.249 linhas de cmpaud_descontos num único comando; cada linha
-- apagada dispara 3 gatilhos de backup (archive_deleted_record, memoria_row, memoria_modulos) e o comando
-- passava do limite de 8 s do papel "authenticated" → cancelado. Quem abria o Portal (ex.: Controladoria)
-- continuava vendo a base de 10/08 mesmo depois do Roberto carregar a nova.
--
-- Solução: cada carga vira um registro em cmpaud_cargas + partes compactadas (gzip/base64, ~400 KB cada) em
-- cmpaud_cargas_partes. Cada parte é um INSERT pequeno (bem abaixo do limite). A carga só aparece para todos
-- quando está completa (status 'ativa'); a anterior fica como 'substituida' (histórico, nada é apagado).

create table if not exists public.cmpaud_cargas (
  id bigint generated always as identity primary key,
  tenant_id text not null default 'esposende',
  criado_em timestamptz not null default now(),
  usuario text,
  status text not null default 'enviando' check (status in ('enviando','ativa','substituida','falhou')),
  partes int not null default 0,
  bytes bigint,
  linhas int,
  periodo_ini date,
  periodo_fim date,
  total_desconto numeric(14,2),
  total_venda numeric(14,2),
  funcionarios int,
  arquivos jsonb not null default '{}'::jsonb,
  resumo jsonb not null default '{}'::jsonb,
  ativada_em timestamptz
);
create index if not exists cmpaud_cargas_ativa on public.cmpaud_cargas (tenant_id, status, ativada_em desc);

create table if not exists public.cmpaud_cargas_partes (
  carga_id bigint not null references public.cmpaud_cargas(id) on delete cascade,
  parte int not null,
  dados text not null,
  primary key (carga_id, parte)
);

alter table public.cmpaud_cargas enable row level security;
alter table public.cmpaud_cargas_partes enable row level security;

drop policy if exists cmpaud_cargas_staff on public.cmpaud_cargas;
create policy cmpaud_cargas_staff on public.cmpaud_cargas for all to authenticated
  using ((select public.portal_is_staff())) with check ((select public.portal_is_staff()));
drop policy if exists cmpaud_cargas_partes_staff on public.cmpaud_cargas_partes;
create policy cmpaud_cargas_partes_staff on public.cmpaud_cargas_partes for all to authenticated
  using ((select public.portal_is_staff())) with check ((select public.portal_is_staff()));

-- Quem enviou (e-mail do login) é gravado pelo banco, não pelo navegador.
create or replace function portal_private.cmpaud_carga_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin new.usuario := coalesce((select u.email from auth.users u where u.id = auth.uid()), new.usuario);
  exception when others then null; end;
  return new;
end $$;
drop trigger if exists cmpaud_carga_usuario on public.cmpaud_cargas;
create trigger cmpaud_carga_usuario before insert on public.cmpaud_cargas
  for each row execute function portal_private.cmpaud_carga_usuario();

-- Ativa a carga só se todas as partes chegaram; a ativa anterior vira histórico.
-- Também atualiza o resumo em portal_sync (selo "Atualizado na nuvem" do Portal).
create or replace function public.cmpaud_ativar_carga(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cmpaud_cargas; n int;
begin
  -- auth.uid() nulo = SQL Editor / chave de serviço (carga inicial feita pela Controladoria)
  if not public.portal_is_staff() and auth.uid() is not null then raise exception 'sem permissão'; end if;
  select * into c from public.cmpaud_cargas where id = p_id for update;
  if c.id is null then raise exception 'carga % não existe', p_id; end if;
  select count(*) into n from public.cmpaud_cargas_partes where carga_id = p_id;
  if n <> c.partes or n = 0 then raise exception 'carga incompleta: % de % partes', n, c.partes; end if;
  update public.cmpaud_cargas set status = 'substituida'
   where tenant_id = c.tenant_id and status = 'ativa' and id <> p_id;
  update public.cmpaud_cargas set status = 'ativa', ativada_em = now() where id = p_id;
  insert into public.portal_sync(module_id, tenant_id, payload, updated_at)
  values ('cmpaud', c.tenant_id, jsonb_build_object(
      'periodoInicio', c.periodo_ini, 'periodoFim', c.periodo_fim, 'valorTotal', c.total_desconto,
      'totalLinhas', c.linhas, 'cargaId', c.id, 'origem', 'cmpaud_cargas'), now())
  on conflict (tenant_id, module_id) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  return jsonb_build_object('id', p_id, 'partes', n, 'linhas', c.linhas);
end $$;
revoke all on function public.cmpaud_ativar_carga(bigint) from public, anon;
grant execute on function public.cmpaud_ativar_carga(bigint) to authenticated;
