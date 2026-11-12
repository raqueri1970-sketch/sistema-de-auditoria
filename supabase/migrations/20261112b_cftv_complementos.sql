-- Segurança Patrimonial e CFTV — complementos aplicados em 12/11/2026, depois de 20261112_cftv_seguranca.sql.

-- Liberação de acesso por e-mail (só administrador/controladoria do Portal)
create or replace function public.cftv_conceder_acesso(p_email text, p_papel text, p_ativo boolean default true, p_obs text default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if public.cftv_papel() is distinct from 'admin' then raise exception 'Só administrador ou controladoria liberam acesso ao módulo CFTV' using errcode = '42501'; end if;
  if p_papel not in ('presidencia', 'diretoria', 'seguranca', 'consulta') then raise exception 'Perfil inválido: %', p_papel; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then raise exception 'Usuário % não encontrado no Portal (crie o login antes).', p_email; end if;
  insert into public.cftv_acessos (user_id, papel, ativo, observacao) values (v_uid, p_papel, p_ativo, p_obs)
  on conflict (user_id) do update set papel = excluded.papel, ativo = excluded.ativo, observacao = excluded.observacao;
  insert into public.cftv_log (acao, tabela, registro, dados) values ('acesso_concedido', 'cftv_acessos', p_email, jsonb_build_object('papel', p_papel, 'ativo', p_ativo));
  return 'ok';
end $$;

create or replace function public.cftv_listar_acessos() returns table (email text, papel text, ativo boolean, origem text, observacao text)
language sql stable security definer set search_path = public, auth as $$
  select u.email::text, a.papel, a.ativo, 'módulo CFTV'::text, a.observacao from public.cftv_acessos a join auth.users u on u.id = a.user_id where public.cftv_papel() = 'admin'
  union all
  select u.email::text, case when p.perfil = 'diretoria' then 'diretoria' else 'admin' end, p.ativo, 'perfil do Portal (' || p.perfil || ')', null
  from public.orc_perfis p join auth.users u on u.id = p.user_id where p.perfil in ('administrador', 'controladoria', 'diretoria') and p.ativo and public.cftv_papel() = 'admin'
$$;
grant execute on function public.cftv_conceder_acesso(text, text, boolean, text), public.cftv_listar_acessos() to authenticated;

-- Lojas ativas do cadastro oficial para quem tem acesso ao módulo (Diretoria/Segurança não leem portal_lojas diretamente)
create or replace function public.cftv_lojas_ativas() returns table (codigo int, nome text, regional text, ativo boolean)
language sql stable security definer set search_path = public as $$
  select l.codigo, l.nome, r.nome, l.ativo from public.portal_lojas l left join public.portal_regionais r on r.id = l.regional_id where public.cftv_pode_ver()
$$;
grant execute on function public.cftv_lojas_ativas() to authenticated;

-- Mesmo CNPJ = mesmo fornecedor (evita "D GUARDIAN" e "D. GUARDIAN" separados no painel)
create or replace function public.cftv_trg_fornecedor() returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  select d.fornecedor into v_nome from public.cftv_documentos d
   where d.fornecedor_cnpj = new.fornecedor_cnpj and d.fornecedor is not null order by d.id limit 1;
  if v_nome is not null then new.fornecedor := v_nome; end if;
  return new;
end $$;
create or replace trigger cftv_doc_fornecedor before insert on public.cftv_documentos for each row
  when (new.fornecedor_cnpj is not null) execute function public.cftv_trg_fornecedor();
update public.cftv_documentos d set fornecedor = p.nome
from (select distinct on (fornecedor_cnpj) fornecedor_cnpj, fornecedor nome from public.cftv_documentos where fornecedor is not null and fornecedor_cnpj is not null order by fornecedor_cnpj, id) p
where d.fornecedor_cnpj = p.fornecedor_cnpj and d.fornecedor is distinct from p.nome;

-- Cabos (inclusive "cabo de alarme"), patch cord/panel e guia de cabo são cabeamento; kit porca gaiola é acessório
update public.cftv_documento_itens set categoria = 'cabeamento'
 where categoria in ('alarme_sensor', 'rede_rack') and (descricao ~* '\mCABO\M' or descricao ~* 'PATCH (CORD|PANEL)');
update public.cftv_documento_itens set categoria = 'conector_acessorio'
 where categoria = 'rede_rack' and (descricao ilike '%KIT FIXACAO%' or descricao ilike '%PORCA GAIOLA%');

-- Sentinela: teste de saúde do agente CFTV (sem expor números)
insert into public.portal_sentinel_tests (tenant_id, test_key, agent_code, agent_name, endpoint, module_code, control_question, request_body, truth_kind, truth_config,
  expected_sources, require_source_evidence, tolerance_abs, tolerance_pct, max_latency_ms, retry_count, interval_minutes, priority, active)
select 'esposende', 'cftv_investimento_2026', 'cftv', 'Agente Segurança Patrimonial e CFTV', '/functions/v1/portal-sentinel-agent-proxy', 'cftv',
  'Verifique se o agente Segurança e CFTV responde e bloqueia acesso sem autorização.',
  '{"modulo":"cftv","_target":"portal-cftv-query","pergunta":"Quanto investimos em segurança em 2026?"}'::jsonb, 'agent_only', '{}'::jsonb,
  array['cftv_documentos'], false, 0.01, 0.10, 18000, 1, 60, 85, true
where not exists (select 1 from public.portal_sentinel_tests where test_key = 'cftv_investimento_2026');
