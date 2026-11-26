-- Minerador Meta Ads (projeto Supabase "Mapa da mima", tazyeczbbgspqbyluynf). Aplicado em 26/11/2026.
-- Acesso so pela edge function minerador-api (service role). A chave fica no PC (minerador_chave.txt) e no app;
-- aqui fica apenas o hash SHA-256 dela (minerador.config).
create schema if not exists minerador;
create table if not exists minerador.config (id int primary key default 1 check (id = 1), chave_hash text not null);
create table if not exists minerador.status (id int primary key default 1 check (id = 1),
  dados jsonb not null default '{}'::jsonb, atualizado timestamptz not null default now());
create table if not exists minerador.rodadas (id bigserial primary key, versao text unique, tipo text,
  criado_em timestamptz not null default now(), resumo jsonb not null default '{}'::jsonb,
  linhas jsonb not null default '[]'::jsonb, anunciantes jsonb not null default '[]'::jsonb);
alter table minerador.config enable row level security;
alter table minerador.status enable row level security;
alter table minerador.rodadas enable row level security;
revoke all on schema minerador from anon, authenticated;
grant usage on schema minerador to service_role;
grant all on all tables in schema minerador to service_role;
grant all on all sequences in schema minerador to service_role;
insert into minerador.status (id) values (1) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('minerador-fotos', 'minerador-fotos', true) on conflict (id) do nothing;
-- (a linha de minerador.config com o hash da chave foi inserida direto no banco, fora do repositorio)

create or replace function public.minerador_chave_ok(p_chave text) returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from minerador.config where chave_hash = encode(extensions.digest(coalesce(p_chave, ''), 'sha256'), 'hex'));
$$;
create or replace function public.minerador_salvar_status(p_dados jsonb) returns void language sql security definer set search_path = '' as $$
  insert into minerador.status (id, dados, atualizado) values (1, p_dados, now())
  on conflict (id) do update set dados = excluded.dados, atualizado = now();
$$;
create or replace function public.minerador_salvar_rodada(p_versao text, p_tipo text, p_resumo jsonb, p_linhas jsonb, p_anunciantes jsonb)
returns bigint language sql security definer set search_path = '' as $$
  insert into minerador.rodadas (versao, tipo, resumo, linhas, anunciantes) values (p_versao, p_tipo, p_resumo, p_linhas, p_anunciantes)
  on conflict (versao) do update set tipo = excluded.tipo, resumo = excluded.resumo, linhas = excluded.linhas,
    anunciantes = excluded.anunciantes, criado_em = now()
  returning id;
$$;
create or replace function public.minerador_painel() returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', (select jsonb_build_object('dados', dados, 'atualizado', extract(epoch from atualizado)) from minerador.status where id = 1),
    'rodadas', coalesce((select jsonb_agg(r order by r.criado_em desc) from (
        select id, versao, tipo, criado_em, resumo, linhas, anunciantes from minerador.rodadas order by criado_em desc limit 6) r), '[]'::jsonb));
$$;
create or replace function public.minerador_status() returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('dados', dados, 'atualizado', extract(epoch from atualizado),
         'ultima_rodada', (select versao from minerador.rodadas order by criado_em desc limit 1))
  from minerador.status where id = 1;
$$;
revoke all on function public.minerador_chave_ok(text) from public, anon, authenticated;
revoke all on function public.minerador_salvar_status(jsonb) from public, anon, authenticated;
revoke all on function public.minerador_salvar_rodada(text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.minerador_painel() from public, anon, authenticated;
revoke all on function public.minerador_status() from public, anon, authenticated;
grant execute on function public.minerador_chave_ok(text) to service_role;
grant execute on function public.minerador_salvar_status(jsonb) to service_role;
grant execute on function public.minerador_salvar_rodada(text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.minerador_painel() to service_role;
grant execute on function public.minerador_status() to service_role;
