-- Base Mãe: inserir/atualizar liberado para administrador e controladoria (portal_pode_base_mae).
-- As policies de DELETE continuam com portal_is_admin().
set local lock_timeout = '10s';
alter policy portal_funcionarios_admin_insert on public.portal_funcionarios with check ((select public.portal_pode_base_mae()));
alter policy portal_funcionarios_admin_update on public.portal_funcionarios using ((select public.portal_pode_base_mae())) with check ((select public.portal_pode_base_mae()));
alter policy portal_lojas_admin_insert on public.portal_lojas with check ((select public.portal_pode_base_mae()));
alter policy portal_lojas_admin_update on public.portal_lojas using ((select public.portal_pode_base_mae())) with check ((select public.portal_pode_base_mae()));
alter policy portal_regionais_admin_insert on public.portal_regionais with check ((select public.portal_pode_base_mae()));
alter policy portal_regionais_admin_update on public.portal_regionais using ((select public.portal_pode_base_mae())) with check ((select public.portal_pode_base_mae()));
alter policy portal_setores_admin_insert on public.portal_setores with check ((select public.portal_pode_base_mae()));
alter policy portal_setores_admin_update on public.portal_setores using ((select public.portal_pode_base_mae())) with check ((select public.portal_pode_base_mae()));
alter policy portal_base_mae_importacoes_admin_insert on public.portal_base_mae_importacoes with check ((select public.portal_pode_base_mae()));
alter policy portal_base_mae_importacoes_admin_update on public.portal_base_mae_importacoes using ((select public.portal_pode_base_mae())) with check ((select public.portal_pode_base_mae()));
