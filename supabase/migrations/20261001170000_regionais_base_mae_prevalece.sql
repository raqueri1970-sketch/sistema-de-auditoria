-- Base Mãe é a fonte correta das regionais (confirmado pela Controladoria em 01/10/2026).
-- Corrige as lojas 933, 949 e 950 no cadastro do Robô Ajuste, que estavam como ALEX.
update public.ajuste_cadastro_regionais a set regional = upper(r.nome)
from public.portal_lojas l join public.portal_regionais r on r.id = l.regional_id
where a.loja = l.codigo - 900 and l.codigo in (933, 949, 950);

-- Propagação Base Mãe -> Robô passa a gravar a regional em maiúsculas, igual ao carregador do robô.
create or replace function public.portal_base_mae_propagar_loja()
 returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare nloja int; rnome text;
begin
 nloja:=case when new.codigo>=900 and new.codigo<1000 then new.codigo-900 else new.codigo end;
 if nloja=10 then
   delete from public.ajuste_cadastro_regionais where loja=10;
 else
   select upper(nome) into rnome from public.portal_regionais where id=new.regional_id;
   if rnome is not null then
     insert into public.ajuste_cadastro_regionais(loja,regional,lote_id)
     values(nloja,rnome,(select id from public.ajuste_cadastro_lotes order by id desc limit 1))
     on conflict(loja) do update set regional=excluded.regional,lote_id=excluded.lote_id;
   end if;
 end if;
 update public.portal_funcionarios set regional_id=new.regional_id,atualizado_em=now() where loja_codigo=new.codigo and regional_id is distinct from new.regional_id;
 return new;
end $$;
