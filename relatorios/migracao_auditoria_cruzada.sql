-- Corrige public.ajuste_admin_auditoria_cruzada() (mesma assinatura) e cria
-- public.ajuste_admin_auditoria_relatorio() com o texto do relatório por ajuste.
-- Somente leitura: nenhuma das funções altera ajustes.
--
-- Correções em relação à versão anterior:
--  * Código completo: usa o produto do acerto SETA vinculado ao ajuste; códigos de
--    4-5 dígitos (ou 6 iniciando em 0) sem acerto vinculado são só o modelo, e a
--    numeração fica NULL (antes 18729 virava modelo 187 / numeração 29).
--  * Inventário: procura em inv_detalhe (divergentes) e em inv_estoque_final
--    (contados); prioriza o inventário mais recente até a data do ajuste.
--  * Situação da linha: ÚLTIMO PAR só quando a numeração ajustada é a única com
--    saldo; SEM SALDO quando nenhuma tem saldo; NAO_CLASSIFICADA quando a base
--    Estoque por Loja está vazia (ausência de base não é zero).
--  * Ajuste anterior: mesma loja + modelo + numeração, no Acerto de Estoque do
--    portal e nos acertos importados do SETA.

create or replace function public.ajuste_admin_auditoria_cruzada()
returns table(
  ajuste_id bigint, loja integer, loja_nome text, marca text, descricao_produto text,
  codigo_produto text, modelo bigint, numeracao integer, quantidade integer, solicitante text,
  data_ajuste timestamp with time zone, origem text, saldo_por_numeracao jsonb, situacao_linha text,
  ultima_entrada_produto date, inventario_encontrado boolean, inventario_data text,
  inventario_qtd_cont numeric, inventario_qtd_antes numeric, inventario_status text,
  ajuste_anterior_id bigint, ajuste_anterior_data timestamp with time zone, ajuste_anterior_qtd integer,
  ajuste_anterior_motivo text, ajuste_anterior_solicitante text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_lote text;
  v_tem_base boolean;
begin
  if not public.orc_is_admin() then raise exception 'acesso negado'; end if;
  set local statement_timeout = '60s';

  select s.lote into v_lote
  from public.ajuste_saldo_estoque_loja s
  group by s.lote
  order by max(s.importado_em) desc
  limit 1;
  v_tem_base := v_lote is not null;

  return query
  with aj as (
    select a.id, a.loja_normalizada as lj, a.marca as mc, a.descricao_produto as ds, a.codigo_produto as cp,
           a.quantidade as qt, a.solicitante as so, coalesce(a.executado_em, a.criado_em) as dt,
           a.origem as og, a.criado_em,
           coalesce(a.data_acerto, (coalesce(a.executado_em, a.criado_em) at time zone 'America/Recife')::date) as dia,
           case when s.produto is not null then ltrim(s.produto, '0')
                when length(a.codigo_produto) = 8 and left(a.codigo_produto, 1) = '0' then substr(a.codigo_produto, 2)
                when length(a.codigo_produto) >= 6 and left(a.codigo_produto, 1) <> '0' then a.codigo_produto
           end as cc
    from public.ajuste_estoque_entrada a
    left join lateral (
      select si.produto from public.ajuste_seta_importados si
      where si.ajuste_id = a.id and si.produto ~ '^[0-9]+$'
      order by si.acerto_id limit 1
    ) s on true
    where (a.status = 'CONCLUIDO' or a.executado_em is not null)
      and a.codigo_produto ~ '^[0-9]+$'
      and a.loja_normalizada is not null
  ),
  base as (
    select aj.*,
           coalesce(left(aj.cc, length(aj.cc) - 2), nullif(ltrim(aj.cp, '0'), ''))::bigint as mod,
           right(aj.cc, 2)::integer as num
    from aj
  ),
  saldo as (
    select b.id,
           jsonb_agg(jsonb_build_object('numeracao', s.numeracao, 'total_estoque', s.total_estoque) order by s.numeracao) as saldo_json,
           coalesce(sum(s.total_estoque), 0) as total,
           coalesce(sum(s.total_estoque) filter (where s.numeracao is distinct from b.num), 0) as outras,
           max(s.ultima_entrada) filter (where s.numeracao = b.num) as ult
    from base b
    join public.ajuste_saldo_estoque_loja s on s.loja = b.lj and s.modelo = b.mod and s.lote = v_lote
    group by b.id
  ),
  inv_itens as (
    select iv.loja::integer as lj, iv.id as inv_id, iv.data, ltrim(d.cd_prod, '0') as cd, d.tam,
           d.qtd_cont, d.qtd_antes, 1 as pri
    from public.inv_detalhe d join public.inv_inventarios iv on iv.id = d.inventario_id
    where iv.loja ~ '^[0-9]+$'
    union all
    select iv.loja::integer, iv.id, iv.data, ltrim(f.cd_prod, '0'), f.tam, f.qtd_cont, null::numeric, 2
    from public.inv_estoque_final f join public.inv_inventarios iv on iv.id = f.inventario_id
    where iv.loja ~ '^[0-9]+$'
  ),
  inv as (
    select distinct on (b.id) b.id, i.data, i.qtd_cont, i.qtd_antes
    from base b
    join inv_itens i on i.lj = b.lj and i.cd = b.mod::text and i.tam = lpad(b.num::text, 2, '0')
    where b.num is not null
    order by b.id, (i.data::date <= b.dia) desc, i.data desc, i.pri
  ),
  ant_cand as (
    select b.id, a2.id as ant_id, a2.criado_em as ant_dt, a2.quantidade as ant_q,
           coalesce(a2.motivo, a2.finalidade) as ant_mot, a2.solicitante as ant_so
    from base b
    join base b2 on b2.lj = b.lj and b2.mod = b.mod and b2.num = b.num and b2.id <> b.id and b2.criado_em < b.criado_em
    join public.ajuste_estoque_entrada a2 on a2.id = b2.id
    where b.num is not null
    union all
    select b.id, si.acerto_id, si.data_acerto::timestamptz, si.qtd,
           'SETA ' || coalesce(si.mv, '') || ' · ' || coalesce(si.classe, '') || ': ' || coalesce(si.obs, ''),
           si.operador_nome
    from base b
    join public.ajuste_seta_importados si
      on si.loja = b.lj and si.ajuste_id is null and ltrim(si.produto, '0') = b.cc and si.data_acerto <= b.dia
    where b.num is not null
  ),
  ant as (
    select distinct on (c.id) c.* from ant_cand c order by c.id, c.ant_dt desc
  )
  select
    b.id, b.lj, l.nome_seta, b.mc, b.ds, coalesce(b.cc, b.cp), b.mod, b.num,
    b.qt, b.so, b.dt, b.og,
    coalesce(sd.saldo_json, '[]'::jsonb),
    case
      when not v_tem_base then 'NAO_CLASSIFICADA_SEM_BASE_ESTOQUE'
      when sd.id is null or sd.total <= 0 then 'SEM_SALDO_NA_LINHA'
      when b.num is null or sd.outras > 0 then 'HA_OUTRAS_NUMERACOES'
      else 'ULTIMO_PAR_DA_LINHA'
    end,
    sd.ult,
    (inv.id is not null), to_char(inv.data::date, 'DD/MM/YYYY'), inv.qtd_cont, inv.qtd_antes,
    case
      when inv.id is null then 'SEM_INVENTARIO_LOCALIZADO'
      when inv.qtd_cont <= 0 then 'INVENTARIO_ZERO_COMPATIVEL'
      else 'INVENTARIO_COM_SALDO_CONFERIR'
    end,
    ant.ant_id, ant.ant_dt, ant.ant_q, ant.ant_mot, ant.ant_so
  from base b
  left join public.entrada_estoque_lojas l on l.loja_normalizada = b.lj
  left join saldo sd on sd.id = b.id
  left join inv on inv.id = b.id
  left join ant on ant.id = b.id
  order by b.dt desc;
end;
$function$;

-- Relatório em texto, um item por ajuste, no formato pedido pela auditoria.
create or replace function public.ajuste_admin_auditoria_relatorio()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v jsonb;
begin
  if not public.orc_is_admin() then raise exception 'acesso negado'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'ajuste_id', r.ajuste_id,
    'loja', lpad(r.loja::text, 3, '0') || ' - ' || coalesce(r.loja_nome, ''),
    'marca', coalesce(r.marca, 'Não informada'),
    'produto', coalesce(r.descricao_produto, 'Não informada'),
    'codigo_modelo_numeracao', r.codigo_produto || ' / ' || r.modelo || ' / ' || coalesce(lpad(r.numeracao::text, 2, '0'), 'não identificada'),
    'ajuste_atual', r.quantidade || ' un. — ' || coalesce(r.solicitante, 'não informado') || ' — ' ||
                    to_char(r.data_ajuste at time zone 'America/Recife', 'DD/MM/YYYY HH24:MI'),
    'saldo_por_numeracao', case
        when r.situacao_linha = 'NAO_CLASSIFICADA_SEM_BASE_ESTOQUE' then 'Estoque por Loja sem registros carregados'
        when jsonb_array_length(r.saldo_por_numeracao) = 0 then 'modelo não localizado no Estoque por Loja'
        else (select string_agg((e->>'numeracao') || ': ' || trim(to_char((e->>'total_estoque')::numeric, 'FM9999990')), ' | ')
              from jsonb_array_elements(r.saldo_por_numeracao) e) end,
    'situacao_linha', case r.situacao_linha
        when 'ULTIMO_PAR_DA_LINHA' then 'Último par da linha'
        when 'HA_OUTRAS_NUMERACOES' then 'Há outras numerações'
        when 'SEM_SALDO_NA_LINHA' then 'Sem saldo na linha'
        else 'Não classificada (Estoque por Loja sem registros)' end,
    'inventario', case when r.inventario_encontrado
        then r.inventario_data || ' — quantidade encontrada ' || trim(to_char(r.inventario_qtd_cont, 'FM9999990')) ||
             coalesce(' (sistema antes ' || trim(to_char(r.inventario_qtd_antes, 'FM9999990')) || ')', '')
        when r.numeracao is null then 'Não localizado — numeração não identificada no código'
        else 'Não localizado' end,
    'ajuste_anterior', case when r.ajuste_anterior_id is null then 'Não localizado'
        else to_char(r.ajuste_anterior_data at time zone 'America/Recife', 'DD/MM/YYYY') || ' — ' ||
             r.ajuste_anterior_qtd || ' un. — ' || coalesce(r.ajuste_anterior_motivo, '') end,
    'apontamento', case r.inventario_status
        when 'INVENTARIO_ZERO_COMPATIVEL' then 'INVENTÁRIO JÁ APONTOU ESTA NUMERAÇÃO COMO ZERO — ajuste atual compatível com a contagem anterior.'
        when 'INVENTARIO_COM_SALDO_CONFERIR' then 'ATENÇÃO: inventário registrou saldo nesta numeração; conferir a divergência.'
        else 'SEM INVENTÁRIO LOCALIZADO PARA ESTE ITEM E NUMERAÇÃO NESTA LOJA.' end
      || case when r.inventario_status <> 'INVENTARIO_ZERO_COMPATIVEL' and r.ajuste_anterior_id is not null
              then ' A mesma numeração já teve ajuste anterior nesta loja.' else '' end,
    'situacao_codigo', r.situacao_linha,
    'inventario_codigo', r.inventario_status
  ) order by r.loja, r.data_ajuste), '[]'::jsonb)
  into v
  from public.ajuste_admin_auditoria_cruzada() r;
  return v;
end;
$function$;

revoke all on function public.ajuste_admin_auditoria_relatorio() from public, anon;
grant execute on function public.ajuste_admin_auditoria_relatorio() to authenticated, service_role;
