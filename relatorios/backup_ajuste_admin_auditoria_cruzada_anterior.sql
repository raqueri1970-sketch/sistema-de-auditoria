-- Backup da versão de public.ajuste_admin_auditoria_cruzada() em produção antes
-- da correção de 24/09/2026 (para restaurar, basta executar este arquivo).
CREATE OR REPLACE FUNCTION public.ajuste_admin_auditoria_cruzada()
 RETURNS TABLE(ajuste_id bigint, loja integer, loja_nome text, marca text, descricao_produto text, codigo_produto text, modelo bigint, numeracao integer, quantidade integer, solicitante text, data_ajuste timestamp with time zone, origem text, saldo_por_numeracao jsonb, situacao_linha text, ultima_entrada_produto date, inventario_encontrado boolean, inventario_data text, inventario_qtd_cont numeric, inventario_qtd_antes numeric, inventario_status text, ajuste_anterior_id bigint, ajuste_anterior_data timestamp with time zone, ajuste_anterior_qtd integer, ajuste_anterior_motivo text, ajuste_anterior_solicitante text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_lote text;
begin
  if not public.orc_is_admin() then raise exception 'acesso negado'; end if;
  set local statement_timeout = '60s';
  select lote into v_lote
  from public.ajuste_saldo_estoque_loja
  group by lote
  order by max(importado_em) desc
  limit 1;

  return query
  with base as (
    select
      a.id as ajuste_id,
      a.loja_normalizada as loja,
      a.marca,
      a.descricao_produto,
      a.codigo_produto,
      (a.codigo_produto::bigint / 100) as modelo,
      (a.codigo_produto::bigint % 100)::integer as num,
      a.quantidade,
      a.solicitante,
      coalesce(a.executado_em, a.criado_em) as data_ajuste,
      a.origem,
      a.criado_em
    from public.ajuste_estoque_entrada a
    where (a.status = 'CONCLUIDO' or a.executado_em is not null)
      and a.codigo_produto ~ '^[0-9]+$'
      and a.loja_normalizada is not null
  ),
  saldo as (
    select
      b.ajuste_id,
      jsonb_agg(jsonb_build_object('numeracao', s.numeracao, 'total_estoque', s.total_estoque) order by s.numeracao) as saldo_json,
      count(*) filter (where s.total_estoque > 0) as n_com_saldo,
      max(s.ultima_entrada) filter (where s.numeracao = b.num) as ultima_entrada_produto
    from base b
    join public.ajuste_saldo_estoque_loja s on s.loja = b.loja and s.modelo = b.modelo and s.lote = v_lote
    group by b.ajuste_id
  )
  select
    b.ajuste_id, b.loja, l.nome_seta, b.marca, b.descricao_produto, b.codigo_produto, b.modelo, b.num,
    b.quantidade, b.solicitante, b.data_ajuste, b.origem,
    coalesce(sd.saldo_json, '[]'::jsonb),
    case
      when sd.saldo_json is null then 'SEM_SALDO_NA_LINHA'
      when sd.n_com_saldo <= 1 then 'ULTIMO_PAR_DA_LINHA'
      else 'HA_OUTRAS_NUMERACOES'
    end,
    sd.ultima_entrada_produto,
    inv.encontrado, inv.data_inv, inv.qtd_cont, inv.qtd_antes,
    case
      when inv.encontrado is not true then 'SEM_INVENTARIO_LOCALIZADO'
      when inv.qtd_cont = 0 then 'INVENTARIO_ZERO_COMPATIVEL'
      when inv.qtd_cont > 0 then 'INVENTARIO_COM_SALDO_CONFERIR'
      else null
    end,
    ant.id, ant.criado_em, ant.quantidade, ant.motivo, ant.solicitante
  from base b
  left join public.entrada_estoque_lojas l on l.loja_normalizada = b.loja
  left join saldo sd on sd.ajuste_id = b.ajuste_id
  left join lateral (
    select true as encontrado, iv.data as data_inv, d.qtd_cont, d.qtd_antes
    from public.inv_detalhe d
    join public.inv_inventarios iv on iv.id = d.inventario_id
    where iv.loja ~ '^[0-9]+$' and iv.loja::integer = b.loja
      and d.cd_prod = lpad(b.modelo::text, 6, '0')
      and d.tam = lpad(b.num::text, 2, '0')
    order by iv.data desc
    limit 1
  ) inv on true
  left join lateral (
    select a2.id, a2.criado_em, a2.quantidade, a2.motivo, a2.solicitante
    from public.ajuste_estoque_entrada a2
    where a2.loja_normalizada = b.loja
      and a2.codigo_produto = b.codigo_produto
      and a2.id <> b.ajuste_id
      and (a2.status = 'CONCLUIDO' or a2.executado_em is not null)
      and a2.criado_em < b.criado_em
    order by a2.criado_em desc
    limit 1
  ) ant on true
  order by b.data_ajuste desc;
end;
$function$;
