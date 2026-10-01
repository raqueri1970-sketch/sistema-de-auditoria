-- As views da Base Mãe rodavam como dono (ignorando RLS) e estavam liberadas para anon:
-- qualquer pessoa com a chave pública lia nome/CPF de todos os funcionários.
-- Agora respeitam as policies de quem está logado (staff: administrador/comprador/controladoria).
alter view public.portal_base_mae_funcionarios set (security_invoker = true);
alter view public.portal_base_mae_lojas set (security_invoker = true);
revoke all on public.portal_base_mae_funcionarios, public.portal_base_mae_lojas from anon;
revoke insert, update, delete, truncate, references, trigger on public.portal_base_mae_funcionarios, public.portal_base_mae_lojas from authenticated;
grant select on public.portal_base_mae_funcionarios, public.portal_base_mae_lojas to authenticated;
