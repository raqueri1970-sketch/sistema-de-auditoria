-- Acerto de Estoque Lojas: limpeza completa do "(SEM MARCA)" e do cadastro de custo.
-- Aplicado em 05/10/2026 (em partes, pelo MCP do Supabase). Registro do que foi feito.

-- 1. Marcas reais que faltavam e apelidos de grafia -------------------------------
insert into private.ajuste_marcas(nome) values ('FERRACINI'),('ONEFLIP'),('COLOMBO'),('MAGIA')
on conflict do nothing;
update private.ajuste_marca_alias set padrao='^(PAR )?(DE )?MEIAS? ' where padrao='^PAR (DE )?MEIAS? ';
insert into private.ajuste_marca_alias(padrao,troca) values
 ('^PICADILLY\M','PICCADILLY'),
 ('^STAR WHITE','STAR WHITE '),        -- "STAR WHITE1341" sem espaco
 ('^TENIS ',''),                        -- "TENIS STARFLEX ..."
 ('^MA-ORTOPE\M','ORTOPE'),
 ('^HOMEM ARANHA\M','GRENDENE KIDS'),   -- licenciado Grendene Kids
 ('^DISNEY\M','GRENDENE KIDS')          -- licenciado Grendene Kids
on conflict do nothing;

-- 2. Marcas antigas pegas pela "1a palavra" (PICADILLY, STAR, TENIS, MEIA, HOMEM, DISNEY, MA-ORTOPE)
with r as (select e.id, i.marca depois from public.ajuste_estoque_entrada e
  cross join lateral private.ajuste_produto_info(e.codigo_produto, e.descricao_produto) i
  where e.marca_fonte='descricao_1a_palavra' and i.fonte='descricao' and i.marca is distinct from e.marca)
update public.ajuste_estoque_entrada e set marca=r.depois, marca_fonte='descricao' from r where e.id=r.id;
update public.ajuste_estoque_entrada set marca_fonte='descricao'
 where marca_fonte='descricao_1a_palavra' and marca in ('COLOMBO','FERRACINI','MAGIA','ONEFLIP','TRITON');

-- 3. CADASTRO.CSV (26/09) era o catalogo de material de loja (cabo, cimento, EPI...),
--    3.040 dos 3.066 itens sem nenhuma marca. Backup + neutralizacao (custo 0, sem descricao).
create table if not exists private.ajuste_custo_produto_bkp_cadastro_csv as
select c.*, now() as removido_em from public.ajuste_custo_produto c
where c.fonte = 'portal: CADASTRO.CSV'
  and coalesce((select i.fonte from private.ajuste_produto_info('', c.descricao) i), '') <> 'descricao';
revoke all on private.ajuste_custo_produto_bkp_cadastro_csv from anon, authenticated;

update public.ajuste_custo_produto c set descricao=null, custo_unit=0, preco_venda=null,
  fonte='DESCARTADO: material de loja do CADASTRO.CSV (backup em private.ajuste_custo_produto_bkp_cadastro_csv)'
from private.ajuste_custo_produto_bkp_cadastro_csv b
where c.produto=b.produto and c.fonte='portal: CADASTRO.CSV';

-- 4. Ajustes corrigidos com evidencia (foto da etiqueta, leitura do Seta, formato do codigo Seta).
--    O codigo_produto original fica (ajuste concluido e imutavel); marca/descricao/custo passam
--    a ser os do produto conferido.
with m(id, base, ev) as (values
 (1706,'23216','conferido no Seta: robo leu 2321636 IPANEMA DAY 27321 no Seta'),
 (1620,'23217','conferido: numeracao 77 nao existe no Seta; 2321737 IPANEMA DAY existe no Seta'),
 (1348,'20245','conferido pela foto da etiqueta: 02024536'),
 (876 ,'19263','conferido pela foto da etiqueta: 01926336'),
 (852 ,'14613','conferido pela foto da etiqueta: 01461340'),
 (991 ,'19522','conferido pela foto da etiqueta: 019522 ref 19337'),
 (2365,'751'  ,'conferido: formato Seta 0751+43'),
 (3093,'811'  ,'conferido: formato Seta 0811+33'),
 (1655,'19328','conferido: 19328+36 com numeracao digitada 2x'),
 (1473,'21477','conferido: cinto FASOLO 21477 tamanho 120'),
 (813 ,'25764','provavel: foto mostra ref 2732(1) IPANEMA DAY')),
r as (select m.id, m.ev, i.marca, i.descricao, (select c.custo from private.ajuste_custo_de(m.base, null) c) custo
 from m cross join lateral private.ajuste_produto_info(m.base, null) i)
update public.ajuste_estoque_entrada e set
  marca = r.marca, marca_fonte = r.ev, descricao_produto = r.descricao,
  custo_unitario = case when e.custo_unitario is null or e.id in (852,991,1620) then coalesce(r.custo, e.custo_unitario) else e.custo_unitario end,
  custo_fonte = case when (e.custo_unitario is null or e.id in (852,991,1620)) and r.custo is not null then 'conferido' else e.custo_fonte end
from r where e.id=r.id;

-- 5. Ajustes que so tinham dado de material de loja: limpa e marca para revisao
--    (dois passos: o trigger de marca zera marca_fonte quando a descricao muda).
update public.ajuste_estoque_entrada set descricao_produto=null, custo_unitario=null, custo_total=null, custo_fonte=null, marca=null
where id in (1162,888,2718,2913);
update public.ajuste_estoque_entrada set marca_fonte='REVISAR: codigo nao existe no Seta (cadastro antigo era material de loja)'
where id in (1162,888,2718,2913);

-- 6. Motivo em cada ajuste que continua sem marca
with m(id, f) as (values
 (1782,'REVISAR: provavel 21333 MISSISSIPI (codigo com um 3 a menos)'),
 (1755,'REVISAR: provavel 22197 OLYMPIKUS (numeracao incompleta)'),
 (1428,'REVISAR: provavel 15588 HAVAIANAS (numeracao incompleta)'),
 (642 ,'REVISAR: provavel 1095 CARTAGO MINI tam 28 (msg: 10951-28)'),
 (2701,'REVISAR: pedido de teste (CPF Ricardo Aqueri)'),(1883,'REVISAR: pedido de teste (CPF Ricardo Aqueri)'),
 (2700,'REVISAR: pedido de teste (CPF Ricardo Aqueri)'),(1400,'REVISAR: pedido de teste (CPF Ricardo Aqueri)'),
 (1911,'REVISAR: pedido de teste (CPF Ricardo Aqueri)'),
 (3040,'REVISAR: Seta respondeu codigo invalido'),(3190,'REVISAR: Seta respondeu codigo invalido'))
update public.ajuste_estoque_entrada e set marca_fonte=m.f from m where e.id=m.id and e.marca is null;
update public.ajuste_estoque_entrada set marca_fonte='REVISAR: codigo nao existe no cadastro nem no Seta'
 where marca is null and status<>'CANCELADO' and coalesce(marca_fonte,'') not like 'REVISAR%';

-- 7. Reprocessamento passa a olhar tambem os REVISAR (menos testes): se o codigo
--    entrar no cadastro depois, a marca e preenchida sozinha.
create or replace function private.ajuste_reprocessar_marcas()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record; n integer := 0;
begin
  for r in
    select e.id, i.marca, i.fonte, i.descricao
      from public.ajuste_estoque_entrada e
      cross join lateral private.ajuste_produto_info(e.codigo_produto, null) i
     where nullif(btrim(e.marca),'') is null
       and coalesce(e.marca_fonte,'') not like 'REVISAR: pedido de teste%'
       and i.marca is not null
       and i.fonte <> 'descricao_1a_palavra'
  loop
    begin
      update public.ajuste_estoque_entrada
         set marca = r.marca,
             marca_fonte = r.fonte,
             descricao_produto = coalesce(descricao_produto, r.descricao)
       where id = r.id;
      n := n + 1;
    exception when others then
      raise warning 'ajuste_reprocessar_marcas: ajuste % nao atualizado: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end $function$;

-- 8. Trava: um novo upload do CADASTRO.CSV nao grava mais item sem marca conhecida
create or replace function private.ajuste_custo_trava_cadastro()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if coalesce(new.fonte,'') ilike '%CADASTRO.CSV%'
     and coalesce((select i.fonte from private.ajuste_produto_info('', new.descricao) i), '') <> 'descricao' then
    return null;
  end if;
  return new;
end $function$;

create or replace trigger trg_custo_trava_cadastro
  before insert or update on public.ajuste_custo_produto
  for each row execute function private.ajuste_custo_trava_cadastro();

-- 9. Pedidos de teste (CPF Ricardo Aqueri), com ERRO e nunca executados no Seta: cancelados
update public.ajuste_estoque_entrada
   set status='CANCELADO', marca_fonte='TESTE: cancelado em 05/10/2026 (pedido de teste do CPF Ricardo Aqueri)'
 where id in (1883,1911,2700,2701,1400) and status='ERRO' and executado_em is null;
