-- Perfil "carregador" (Carregador de Dados): vê o mesmo que o colaborador e CARREGA dados/planilhas nos módulos liberados.
-- Não gerencia usuários, não altera o Portal (arquivo no Storage), não apaga dados dos módulos e não vê nada de RH/folha/comissão.
-- O único administrador (tudo, incluindo usuários e programa) continua sendo o perfil "administrador".
-- Aplicada em 19/11/2026.

alter table public.orc_perfis drop constraint if exists orc_perfis_perfil_check;
alter table public.orc_perfis add constraint orc_perfis_perfil_check check (perfil = any (array[
  'gestor_departamento', 'comprador', 'gestor_compras', 'controladoria', 'diretoria', 'administrador', 'colaborador', 'carregador']));

-- Leitura (todas as policies "colaborador" já existentes passam a valer também para o carregador)
create or replace function public.portal_is_colaborador()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.orc_perfis p
                where p.user_id = (select auth.uid()) and p.ativo and p.perfil in ('colaborador', 'carregador'))
$$;

create or replace function public.portal_is_carregador()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.orc_perfis p
                where p.user_id = (select auth.uid()) and p.ativo and p.perfil = 'carregador')
$$;
revoke all on function public.portal_is_carregador() from public, anon;
grant execute on function public.portal_is_carregador() to authenticated;

-- portal_sync: grava (insert/update, sem delete) só os módulos liberados
drop policy if exists portal_sync_carregador_insert on public.portal_sync;
create policy portal_sync_carregador_insert on public.portal_sync for insert to authenticated
  with check ((select public.portal_is_carregador()) and not public.portal_modulo_restrito(module_id));
drop policy if exists portal_sync_carregador_update on public.portal_sync;
create policy portal_sync_carregador_update on public.portal_sync for update to authenticated
  using ((select public.portal_is_carregador()) and not public.portal_modulo_restrito(module_id))
  with check ((select public.portal_is_carregador()) and not public.portal_modulo_restrito(module_id));
-- histórico gerado pelo trigger portal_sync_archive_old (roda com o usuário)
drop policy if exists portal_sync_historico_carregador_insert on public.portal_sync_historico;
create policy portal_sync_historico_carregador_insert on public.portal_sync_historico for insert to authenticated
  with check ((select public.portal_is_carregador()) and not public.portal_modulo_restrito(module_id));

-- Sistema de Inventário: a importação apaga e regrava o detalhe do inventário (o trigger arquiva o que sai)
drop policy if exists inv_inventarios_carregador_all on public.inv_inventarios;
create policy inv_inventarios_carregador_all on public.inv_inventarios for all to authenticated
  using ((select public.portal_is_carregador())) with check ((select public.portal_is_carregador()));
drop policy if exists inv_detalhe_carregador_all on public.inv_detalhe;
create policy inv_detalhe_carregador_all on public.inv_detalhe for all to authenticated
  using ((select public.portal_is_carregador())) with check ((select public.portal_is_carregador()));
drop policy if exists inv_estoque_final_carregador_all on public.inv_estoque_final;
create policy inv_estoque_final_carregador_all on public.inv_estoque_final for all to authenticated
  using ((select public.portal_is_carregador())) with check ((select public.portal_is_carregador()));
drop policy if exists inv_fotos_carregador_all on public.inv_fotos;
create policy inv_fotos_carregador_all on public.inv_fotos for all to authenticated
  using ((select public.portal_is_carregador())) with check ((select public.portal_is_carregador()));
