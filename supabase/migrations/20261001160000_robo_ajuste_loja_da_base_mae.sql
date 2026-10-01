-- Robô Ajuste: quando o cadastro do robô vem sem loja do funcionário, usa a loja da Base Mãe
-- (portal_funcionarios), no formato do robô (935 -> 35). Cadastro MANUAL continua com prioridade total.
-- loja_origem só alimenta o aviso "fora_da_loja" e o perfil exibido; não bloqueia pedidos.
create or replace function private.ajuste_cadastro_de(p_cpf text)
 returns table(nome text, cargo text, loja_origem integer, situacao text, fonte text)
 language plpgsql stable security definer set search_path to ''
as $$
declare v text := regexp_replace(coalesce(p_cpf,''),'\D','','g');
        v_loja_mae integer := (select case when b.loja_codigo between 900 and 999 then b.loja_codigo - 900 else b.loja_codigo end
                                 from public.portal_funcionarios b where b.cpf = v limit 1);
begin
  if exists (select 1 from public.ajuste_cadastro_extra x where x.cpf = v) then
    return query select x.nome, x.cargo, x.loja_origem, x.situacao, 'MANUAL'::text from public.ajuste_cadastro_extra x where x.cpf = v limit 1;
    return;
  end if;
  if exists (select 1 from public.ajuste_cadastro_lotes where tipo = 'funcionarios') then
    return query select f.nome, f.cargo, coalesce(f.loja_origem, v_loja_mae), f.situacao, 'SETA_ARQUIVO'::text from public.ajuste_cadastro_funcionarios f where f.cpf = v limit 1;
  else
    return query select h.nome, h.cargo, v_loja_mae, h.situacao, 'RH'::text from public.rh_funcionarios_historico h where h.cpf = v order by h.id desc limit 1;
  end if;
end $$;
