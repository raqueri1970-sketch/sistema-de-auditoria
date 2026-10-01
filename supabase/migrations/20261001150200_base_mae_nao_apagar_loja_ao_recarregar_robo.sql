-- Recarregar o cadastro do Robô Ajuste (arquivo sem loja) apagava a loja de cada funcionário na Base Mãe.
-- Agora campo vazio vindo do robô nunca sobrescreve dado preenchido, e loja curta (35) vira o código da rede (935).
create or replace function public.portal_sync_funcionario_ajuste()
 returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_loja int := case when new.loja_origem between 1 and 99 then new.loja_origem + 900 else new.loja_origem end;
begin
 if v_loja is not null then
   insert into public.portal_lojas(codigo,nome) values(v_loja,'Loja '||v_loja)
   on conflict(codigo) do nothing;
 end if;
 insert into public.portal_funcionarios(cpf,nome,cargo,loja_codigo,situacao,ativo,fonte,fonte_atualizada_em,atualizado_em)
 values(regexp_replace(new.cpf,'\D','','g'),new.nome,new.cargo,v_loja,new.situacao,
   case when new.situacao is null then true else lower(new.situacao) not like '%demit%' and lower(new.situacao) not like '%deslig%' end,
   'ajuste_cadastro_funcionarios',now(),now())
 on conflict(cpf) do update set
   nome=coalesce(excluded.nome,portal_funcionarios.nome),
   cargo=coalesce(excluded.cargo,portal_funcionarios.cargo),
   loja_codigo=coalesce(excluded.loja_codigo,portal_funcionarios.loja_codigo),
   situacao=coalesce(excluded.situacao,portal_funcionarios.situacao),
   ativo=excluded.ativo,fonte=excluded.fonte,fonte_atualizada_em=excluded.fonte_atualizada_em,atualizado_em=now();
 return new;
end $$;

create or replace function public.portal_sincronizar_funcionarios_ajuste()
 returns integer language plpgsql security definer set search_path to 'public'
as $$
declare n integer;
begin
 insert into public.portal_lojas(codigo,nome)
 select distinct case when loja_origem between 1 and 99 then loja_origem+900 else loja_origem end,null
 from public.ajuste_cadastro_funcionarios where loja_origem is not null
 on conflict(codigo) do nothing;
 insert into public.portal_funcionarios(cpf,nome,cargo,loja_codigo,situacao,ativo,fonte,fonte_atualizada_em,atualizado_em)
 select regexp_replace(cpf,'\D','','g'), max(nome), max(cargo),
        max(case when loja_origem between 1 and 99 then loja_origem+900 else loja_origem end), max(situacao), true,
        'ajuste_cadastro_funcionarios', now(), now()
 from public.ajuste_cadastro_funcionarios where length(regexp_replace(coalesce(cpf,''),'\D','','g'))=11
 group by regexp_replace(cpf,'\D','','g')
 on conflict(cpf) do update set
   nome=coalesce(excluded.nome,portal_funcionarios.nome),
   cargo=coalesce(excluded.cargo,portal_funcionarios.cargo),
   loja_codigo=coalesce(excluded.loja_codigo,portal_funcionarios.loja_codigo),
   situacao=coalesce(excluded.situacao,portal_funcionarios.situacao),
   ativo=true,fonte=excluded.fonte,fonte_atualizada_em=now(),atualizado_em=now();
 get diagnostics n=row_count;
 return n;
end $$;
