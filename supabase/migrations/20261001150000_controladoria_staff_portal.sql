-- Controladoria passa a ser staff do portal (já era admin em Compras via orc_manage_admin).
-- Sem isso, todo salvamento do perfil controladoria em portal_sync/portal_uploads/portal_logs volta 403.
create or replace function public.portal_is_staff()
 returns boolean language sql stable security definer set search_path to ''
as $$
  select exists(select 1 from public.orc_perfis p
                where p.user_id = (select auth.uid()) and p.ativo
                  and p.perfil in ('administrador','comprador','controladoria'))
$$;

-- Quem pode alimentar a Base Mãe (funcionários/lojas/regionais/setores). Exclusão continua só administrador.
create or replace function public.portal_pode_base_mae()
 returns boolean language sql stable security definer set search_path to ''
as $$
  select exists(select 1 from public.orc_perfis p
                where p.user_id = (select auth.uid()) and p.ativo
                  and p.perfil in ('administrador','controladoria'))
$$;
revoke all on function public.portal_pode_base_mae() from public, anon;
grant execute on function public.portal_pode_base_mae() to authenticated;
