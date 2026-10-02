-- 2026-10-02: alerta_executor_config / alerta_executor_log estavam sem RLS (anon lia e alterava).
-- Regra: somente o administrador ativo do CPF 10461295890 (Ricardo Aqueri) le e altera.
-- Aplicada em producao (projeto "sistema de auditoria") via MCP.

create or replace function private.alerta_executor_e_dono()
returns boolean
language sql stable security definer
set search_path to ''
as $$
  select exists (
    select 1
      from public.orc_perfis p
     where p.user_id = (select auth.uid()) and p.ativo and p.perfil = 'administrador'
       and (exists (select 1 from public.portal_acesso_permanente a where a.user_id = p.user_id and regexp_replace(a.cpf,'\D','','g') = '10461295890')
         or exists (select 1 from public.ajuste_usuarios u where u.user_id = p.user_id and u.ativo and regexp_replace(u.cpf,'\D','','g') = '10461295890'))
  )
$$;
revoke all on function private.alerta_executor_e_dono() from public, anon;
grant execute on function private.alerta_executor_e_dono() to authenticated;

alter table public.alerta_executor_config enable row level security;
alter table public.alerta_executor_log enable row level security;

-- RLS nao cobre TRUNCATE/TRIGGER/REFERENCES: tira do anon e do authenticated.
revoke all on public.alerta_executor_config, public.alerta_executor_log from anon;
revoke truncate, trigger, references on public.alerta_executor_config, public.alerta_executor_log from authenticated;
grant usage on schema private to authenticated; -- ja existia (politicas orc_* usam private.*)

create policy alerta_cfg_dono_le on public.alerta_executor_config for select to authenticated using ((select private.alerta_executor_e_dono()));
create policy alerta_cfg_dono_insere on public.alerta_executor_config for insert to authenticated with check ((select private.alerta_executor_e_dono()));
create policy alerta_cfg_dono_altera on public.alerta_executor_config for update to authenticated using ((select private.alerta_executor_e_dono())) with check ((select private.alerta_executor_e_dono()));
create policy alerta_cfg_dono_apaga on public.alerta_executor_config for delete to authenticated using ((select private.alerta_executor_e_dono()));

create policy alerta_log_dono_le on public.alerta_executor_log for select to authenticated using ((select private.alerta_executor_e_dono()));
create policy alerta_log_dono_insere on public.alerta_executor_log for insert to authenticated with check ((select private.alerta_executor_e_dono()));
create policy alerta_log_dono_altera on public.alerta_executor_log for update to authenticated using ((select private.alerta_executor_e_dono())) with check ((select private.alerta_executor_e_dono()));
create policy alerta_log_dono_apaga on public.alerta_executor_log for delete to authenticated using ((select private.alerta_executor_e_dono()));

-- verificar_executor so LE as tabelas (status do robo); roda como dono da funcao para
-- continuar funcionando para quem ja chama, sem abrir as tabelas.
alter function public.verificar_executor() security definer;
alter function public.verificar_executor() set search_path to public, private;
