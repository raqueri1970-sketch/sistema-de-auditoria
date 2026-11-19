-- Perfil "colaborador" no Portal: vê os módulos operacionais em modo consulta, SEM acesso a nada de folha/RH.
-- Bloqueados para o colaborador: Auditoria RH / Folha (rh), Desconto em Folha · Crediário (cred),
-- Fechamento Rescisão (resc), Descontos Funcionários (cmpaud), Comissões Meias (mei), Comissões Grendene (gren).
-- RH e Crediário já ficam fechados sozinhos: portal_pode('rh') e cred_pode_auditar() não incluem "colaborador".
-- Despesas, CFTV e Patrimônio de Segurança têm login próprio só para administrador/controladoria/diretoria.
-- Aplicada em 19/11/2026. Usuários: criar no Supabase Auth e inserir orc_perfis (perfil colaborador).

-- 1) Novo perfil permitido em orc_perfis
alter table public.orc_perfis drop constraint if exists orc_perfis_perfil_check;
alter table public.orc_perfis add constraint orc_perfis_perfil_check check (perfil = any (array[
  'gestor_departamento', 'comprador', 'gestor_compras', 'controladoria', 'diretoria', 'administrador', 'colaborador']));

create or replace function public.portal_is_colaborador()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.orc_perfis p
                where p.user_id = (select auth.uid()) and p.ativo and p.perfil = 'colaborador')
$$;
revoke all on function public.portal_is_colaborador() from public, anon;
grant execute on function public.portal_is_colaborador() to authenticated;

-- 2) Módulos de folha/comissão/descontos de funcionário que o colaborador nunca lê
create or replace function public.portal_modulo_restrito(p_module_id text)
returns boolean language sql immutable set search_path = '' as $$
  select split_part(p_module_id, '_', 1) in ('rh', 'cred', 'resc', 'cmpaud', 'mei', 'gren')
$$;

-- 3) Dados dos módulos (portal_sync): colaborador só LÊ, e só os módulos liberados
drop policy if exists portal_sync_colaborador_select on public.portal_sync;
create policy portal_sync_colaborador_select on public.portal_sync
  for select to authenticated
  using ((select public.portal_is_colaborador()) and not public.portal_modulo_restrito(module_id));

-- 4) Sistema de Inventário: leitura
drop policy if exists inv_inventarios_colaborador_select on public.inv_inventarios;
create policy inv_inventarios_colaborador_select on public.inv_inventarios for select to authenticated using ((select public.portal_is_colaborador()));
drop policy if exists inv_detalhe_colaborador_select on public.inv_detalhe;
create policy inv_detalhe_colaborador_select on public.inv_detalhe for select to authenticated using ((select public.portal_is_colaborador()));
drop policy if exists inv_estoque_final_colaborador_select on public.inv_estoque_final;
create policy inv_estoque_final_colaborador_select on public.inv_estoque_final for select to authenticated using ((select public.portal_is_colaborador()));
drop policy if exists inv_fotos_colaborador_select on public.inv_fotos;
create policy inv_fotos_colaborador_select on public.inv_fotos for select to authenticated using ((select public.portal_is_colaborador()));

-- 5) Arquivo do Portal no Storage: colaborador lê só o arquivo principal (backups continuam fechados)
drop policy if exists portal_file_colaborador_read on storage.objects;
create policy portal_file_colaborador_read on storage.objects for select to authenticated
  using (bucket_id = 'portal-file' and name = 'PORTAL_ESPOSENDE_V4_AUTH.html' and (select public.portal_is_colaborador()));
