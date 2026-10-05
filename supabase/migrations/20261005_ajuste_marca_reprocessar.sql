-- Acerto de Estoque Lojas: corrige o grupo "(SEM MARCA)" do painel.
--
-- Causa: o trigger trg_ajuste_marca so preenche a marca no INSERT (ou quando o
-- codigo muda). Quando o cadastro de produtos (ajuste_custo_produto) e carregado
-- depois do ajuste, o ajuste antigo nunca era reprocessado e ficava sem marca.
--
-- Esta migration:
--   1. cria apelidos de marca (G. KIDS = GRENDENE KIDS, PAR MEIA HOAHI = HOAHI);
--   2. ensina ajuste_produto_info a usar esses apelidos;
--   3. cria private.ajuste_reprocessar_marcas(), que preenche a marca dos ajustes
--      que ainda estao sem marca;
--   4. roda esse reprocessamento automaticamente sempre que o cadastro de
--      produtos, o inventario ou a lista de marcas mudar;
--   5. reprocessa os ajustes atuais.
-- Ajustes com marca_fonte 'REVISAR...' (codigo que coincide com material de
-- construcao) nao sao tocados.

-- 1. apelidos ------------------------------------------------------------------
create table if not exists private.ajuste_marca_alias (
  padrao text primary key,   -- regex aplicada na descricao em maiusculas
  troca  text not null
);
revoke all on private.ajuste_marca_alias from anon, authenticated;

insert into private.ajuste_marca_alias (padrao, troca) values
  ('^G\. ?KIDS\M', 'GRENDENE KIDS'),
  ('^PAR (DE )?MEIAS? ', '')
on conflict (padrao) do nothing;

insert into private.ajuste_marcas (nome) values ('TRITON')
on conflict (nome) do nothing;

-- 2. resolucao de marca com apelidos --------------------------------------------
create or replace function private.ajuste_produto_info(p_produto text, p_desc text)
 returns table(descricao text, marca text, fonte text)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare v_p text := ltrim(coalesce(p_produto,''),'0'); v_b text; v_d text := regexp_replace(btrim(coalesce(p_desc,'')),'\s+',' ','g'); v_u text; v_a text; r record; m text;
begin
  v_b := case when length(v_p) >= 6 then left(v_p, length(v_p)-2) else v_p end;
  if v_d = '' then
    select c.descricao into v_d from public.ajuste_custo_produto c where c.descricao is not null and c.produto in (v_p, v_b) order by (c.produto = v_p) desc limit 1;
    if v_d is null then select i.descricao into v_d from private.ajuste_inv_info i where i.codigo in (v_p, v_b) order by (i.codigo = v_p) desc limit 1; end if;
    v_d := coalesce(v_d, '');
  end if;
  descricao := nullif(v_d, '');
  select i.marca into m from private.ajuste_inv_info i where i.codigo in (v_p, v_b) and i.marca is not null order by (i.codigo = v_p) desc limit 1;
  if m is not null then marca := m; fonte := 'inventario'; return next; return; end if;
  v_u := upper(regexp_replace(btrim(v_d),'\s+',' ','g'));
  if v_u <> '' then
    select k.nome into m from private.ajuste_marcas k where v_u = k.nome or v_u like k.nome || ' %' order by length(k.nome) desc limit 1;
    if m is null then
      -- apelidos do cadastro (ex.: "G. KIDS ..." = GRENDENE KIDS, "PAR MEIA HOAHI ..." = HOAHI)
      select regexp_replace(v_u, a.padrao, a.troca) into v_a from private.ajuste_marca_alias a where v_u ~ a.padrao order by length(a.padrao) desc limit 1;
      if v_a is not null then
        select k.nome into m from private.ajuste_marcas k where v_a = k.nome or v_a like k.nome || ' %' order by length(k.nome) desc limit 1;
      end if;
    end if;
    if m is not null then marca := m; fonte := 'descricao'; return next; return; end if;
    marca := split_part(v_u, ' ', 1); fonte := 'descricao_1a_palavra'; return next; return;
  end if;
  marca := null; fonte := null; return next; return;
end $function$;

-- marca vazia ('') tambem conta como sem marca no trigger de insert
create or replace function private.ajuste_preencher_marca()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare i record; v_desc_seta text;
begin
  -- descricao lida pelo robo direto no Seta (seta_retorno.produto.descricao) quando a base de produtos nao tem o codigo
  if new.descricao_produto is null and coalesce(new.seta_retorno,'') like '{%' then
    begin v_desc_seta := nullif(btrim(new.seta_retorno::jsonb->'produto'->>'descricao'), ''); exception when others then v_desc_seta := null; end;
    if v_desc_seta is not null then new.descricao_produto := v_desc_seta; end if;
  end if;
  if nullif(btrim(new.marca),'') is null or new.descricao_produto is null then
    select * into i from private.ajuste_produto_info(new.codigo_produto, new.descricao_produto);
    if new.descricao_produto is null then new.descricao_produto := i.descricao; end if;
    if nullif(btrim(new.marca),'') is null then new.marca := i.marca; new.marca_fonte := i.fonte; end if;
  end if;
  return new;
end $function$;

-- 3. reprocessamento -----------------------------------------------------------
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
      cross join lateral private.ajuste_produto_info(e.codigo_produto, e.descricao_produto) i
     where nullif(btrim(e.marca),'') is null
       and coalesce(e.marca_fonte,'') not like 'REVISAR%'
       and i.marca is not null
       and i.fonte <> 'descricao_1a_palavra'   -- no reprocesso so aceita marca reconhecida
  loop
    begin
      update public.ajuste_estoque_entrada
         set marca = r.marca,
             marca_fonte = r.fonte,
             descricao_produto = coalesce(descricao_produto, r.descricao)
       where id = r.id;
      n := n + 1;
    exception when others then
      -- nunca derruba quem disparou (ex.: upload do cadastro); so registra
      raise warning 'ajuste_reprocessar_marcas: ajuste % nao atualizado: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end $function$;

revoke all on function private.ajuste_reprocessar_marcas() from public, anon, authenticated;

-- 4. dispara quando a base de produtos / marcas muda ------------------------------
create or replace function private.trg_ajuste_reprocessar_marcas()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform private.ajuste_reprocessar_marcas();
  return null;
end $function$;

create or replace trigger trg_reprocessar_marcas
  after insert or update on public.ajuste_custo_produto
  for each statement execute function private.trg_ajuste_reprocessar_marcas();

create or replace trigger trg_reprocessar_marcas
  after insert or update on private.ajuste_inv_info
  for each statement execute function private.trg_ajuste_reprocessar_marcas();

create or replace trigger trg_reprocessar_marcas
  after insert or update on private.ajuste_marcas
  for each statement execute function private.trg_ajuste_reprocessar_marcas();

create or replace trigger trg_reprocessar_marcas
  after insert or update on private.ajuste_marca_alias
  for each statement execute function private.trg_ajuste_reprocessar_marcas();

-- 5. corrige os ajustes atuais ---------------------------------------------------
-- Aplicado em 05/10/2026: 114 ajustes receberam marca.
select private.ajuste_reprocessar_marcas();
