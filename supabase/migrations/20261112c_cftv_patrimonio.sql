-- Segurança Patrimonial e CFTV — patrimônio a preço de reposição e regra "compra = instalada" (12/11/2026).
-- Regras definidas pela gestão: tudo o que foi comprado em 2026 está instalado (sem instalação pendente) e a câmera vale R$ 180,00.
-- A planilha "câmeras por loja" mostra a situação de hoje (ex.: Juazeiro tem 15 canais ocupados = as 15 câmeras compradas em março),
-- então as compras são descontadas dela para não contar o mesmo equipamento duas vezes (cftv_reconciliar).

alter table public.cftv_equipamentos alter column loja_codigo drop not null;  -- compra ainda sem loja confirmada

insert into public.cftv_premissas (chave, valor, unidade, descricao, fonte, validada) values
  ('compras_consideradas_instaladas', 1, 'sim/não', 'Toda compra de equipamento de 2026 é considerada instalada na loja da nota', 'Regra definida pela gestão em 12/11/2026', true)
on conflict (chave) do update set valor = 1, fonte = excluded.fonte, atualizado_em = now();
update public.cftv_premissas set valor = 180, fonte = 'Valor definido pela gestão em 12/11/2026 (orçamento KGMlan 26/10/2026: R$ 211,46)', validada = true,
  atualizado_em = now(), atualizado_por = null where chave = 'preco_camera';

-- Origem do preço: orçamento original ou valor ajustado no Portal (quem e quando)
create or replace function public.cftv_fonte_premissa(p_chave text) returns text language sql stable security definer set search_path = public as $$
  select case when atualizado_por is null then fonte
              else 'Preço ajustado no Portal por ' || atualizado_por || ' em ' || to_char(atualizado_em at time zone 'America/Recife', 'DD/MM/YYYY') || ' (origem: ' || fonte || ')' end
  from public.cftv_premissas where chave = p_chave
$$;

-- Canais de um gravador pela descrição ("32 CANAIS", "MHDX 1116", "NVD 1416", "Gravador 8 canais")
create or replace function public.cftv_canais(p text) returns int language sql immutable as $$
  select coalesce((regexp_match(p, '(\d+)\s*CANAIS', 'i'))[1]::int,
                  (regexp_match(p, '(?:MHDX|NVD|XVR|NVR|MHDX)\s*\d{2}(\d{2})', 'i'))[1]::int, 16)
$$;

-- Notas sem loja com evidência pelo CNPJ da filial (mesmo CNPJ de outra nota daquela loja)
update public.cftv_documentos d set loja_codigo = v.loja, loja_confianca = 'media',
  loja_motivo = 'CNPJ ' || d.destinatario_cnpj || ' é o mesmo da ' || v.ref || ' (' || v.nome || ').', atualizado_em = now()
from (values (4, 929, 'NF 73', 'Caruaru 2'), (101, 919, 'NF 127', 'Prazeres'), (138, 919, 'NF 127', 'Prazeres'),
             (29, 937, 'NF 118', 'Juazeiro'), (42, 920, 'NF 81/82', 'Rua da Palma')) v(id, loja, ref, nome)
where d.id = v.id and d.loja_codigo is null;
update public.cftv_documento_itens i set loja_codigo = d.loja_codigo from public.cftv_documentos d where d.id = i.documento_id and i.loja_codigo is distinct from d.loja_codigo;

-- Reconciliação do inventário com as compras (rodada após cada importação e conferência pela tela)
create or replace function public.cftv_reconciliar() returns jsonb language plpgsql security definer set search_path = public as $$
declare n_ins int := 0; n_cam int := 0; n_grav int := 0;
begin
  if not public.cftv_pode_editar() then raise exception 'Sem permissão' using errcode = '42501'; end if;
  -- loja da compra acompanha a conferência da nota
  update cftv_equipamentos e set loja_codigo = d.loja_codigo, atualizado_em = now()
  from cftv_documento_itens i join cftv_documentos d on d.id = i.documento_id
  where e.documento_item_id = i.id and e.loja_codigo is distinct from d.loja_codigo;
  -- 1. compras de equipamento = instaladas
  if coalesce((select valor from cftv_premissas where chave = 'compras_consideradas_instaladas'), 0) = 1 then
    insert into cftv_equipamentos (loja_codigo, categoria, descricao, quantidade, custo_unit, data_aquisicao, origem, situacao, documento_item_id, fonte, observacao)
    select d.loja_codigo, case when i.categoria = 'conector_acessorio' then 'conector_acessorio' else i.categoria end, i.descricao,
      greatest(1, ceil(i.quantidade - coalesce((select sum(e.quantidade) from cftv_equipamentos e where e.documento_item_id = i.id), 0)))::int,
      i.valor_unit, d.emissao, 'aquisicao_2026', 'instalado', i.id, 'NF ' || d.numero, 'Compra de 2026 considerada instalada (regra da gestão).'
    from cftv_documento_itens i join cftv_documentos d on d.id = i.documento_id and d.status in ('ok', 'conferir') and d.natureza = 'aquisicao'
    where (i.categoria in ('camera', 'dvr_nvr', 'hd', 'alarme_sensor', 'perimetro', 'incendio', 'rede_rack', 'fonte_energia')
           or (i.categoria = 'conector_acessorio' and i.descricao ~* 'POWER BALUN|VB ?10(16|08)'))
      and i.quantidade - coalesce((select sum(e.quantidade) from cftv_equipamentos e where e.documento_item_id = i.id), 0) >= 0.5;
    get diagnostics n_ins = row_count;
    -- equipamento de nota descartada/duplicada sai do inventário
    update cftv_equipamentos e set situacao = 'baixado', observacao = coalesce(e.observacao, '') || ' Nota descartada.', atualizado_em = now()
    from cftv_documento_itens i join cftv_documentos d on d.id = i.documento_id
    where e.documento_item_id = i.id and d.status not in ('ok', 'conferir') and e.situacao <> 'baixado';
  end if;
  -- 2. câmeras da planilha = situação atual: "anterior a 2026" é o que sobra depois das câmeras compradas para a loja
  with r as (
    select e.id, l.capacidade_canais - l.canais_analog_livres ocupados,
      coalesce((select sum(x.quantidade) from cftv_equipamentos x where x.loja_codigo = e.loja_codigo and x.categoria = 'camera' and x.origem = 'aquisicao_2026'
                and x.situacao in ('instalado', 'defeito', 'fora_operacao')), 0) compradas
    from cftv_equipamentos e join cftv_lojas l on l.codigo = e.loja_codigo
    where e.fonte_chave = 'planilha:cameras:' || e.loja_codigo and l.canais_analog_livres is not null)
  update cftv_equipamentos e set
    quantidade = greatest(r.ocupados - r.compradas, 1),
    situacao = case when r.ocupados - r.compradas <= 0 then 'substituido' else 'instalado' end,
    observacao = 'Planilha: ' || r.ocupados || ' câmeras ligadas hoje; ' || r.compradas || ' compradas em 2026; anteriores a 2026 = ' || greatest(r.ocupados - r.compradas, 0) || ' (estimativa).',
    atualizado_em = now()
  from r where e.id = r.id;
  get diagnostics n_cam = row_count;
  -- 3. gravador da planilha: desconta os canais dos gravadores comprados em 2026 para a loja
  with g as (
    select e.id, l.capacidade_canais cap,
      coalesce((select sum(cftv_canais(x.descricao) * x.quantidade) from cftv_equipamentos x where x.loja_codigo = e.loja_codigo and x.categoria = 'dvr_nvr' and x.origem = 'aquisicao_2026'
                and x.situacao in ('instalado', 'defeito', 'fora_operacao')), 0) novos
    from cftv_equipamentos e join cftv_lojas l on l.codigo = e.loja_codigo
    where e.fonte_chave = 'planilha:gravador:' || e.loja_codigo and l.capacidade_canais is not null)
  update cftv_equipamentos e set
    descricao = 'Gravador ' || greatest(g.cap - g.novos, 0) || ' canais',
    situacao = case when g.cap - g.novos <= 0 then 'substituido' else 'instalado' end,
    observacao = 'Planilha: ' || g.cap || ' canais hoje; ' || g.novos || ' canais em gravadores comprados em 2026; anterior a 2026 = ' || greatest(g.cap - g.novos, 0) || ' canais.',
    atualizado_em = now()
  from g where e.id = g.id;
  get diagnostics n_grav = row_count;
  return jsonb_build_object('compras_instaladas', n_ins, 'cameras_ajustadas', n_cam, 'gravadores_ajustados', n_grav);
end $$;
grant execute on function public.cftv_reconciliar(), public.cftv_canais(text), public.cftv_fonte_premissa(text) to authenticated;

-- Patrimônio de equipamentos a preço de reposição de hoje
create or replace function public.cftv_patrimonio(p_loja int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; v_cam numeric; v_g16 numeric; v_hd numeric; v_bal numeric; v_rack numeric; v_ocup numeric;
  f_cam text := public.cftv_fonte_premissa('preco_camera'); f_g16 text := public.cftv_fonte_premissa('preco_gravador_16');
  f_hd text := public.cftv_fonte_premissa('preco_hd_2tb'); f_bal text := public.cftv_fonte_premissa('preco_power_balun_16'); f_rack text := public.cftv_fonte_premissa('preco_rack_5u');
begin
  if not public.cftv_pode_ver() then raise exception 'Sem acesso ao módulo Segurança Patrimonial e CFTV' using errcode = '42501'; end if;
  select valor into v_cam from cftv_premissas where chave = 'preco_camera';
  select valor into v_g16 from cftv_premissas where chave = 'preco_gravador_16';
  select valor into v_hd from cftv_premissas where chave = 'preco_hd_2tb';
  select valor into v_bal from cftv_premissas where chave = 'preco_power_balun_16';
  select valor into v_rack from cftv_premissas where chave = 'preco_rack_5u';
  select sum(capacidade_canais - canais_analog_livres)::numeric / nullif(sum(capacidade_canais), 0) into v_ocup
    from cftv_lojas where capacidade_canais is not null and canais_analog_livres is not null;

  with ativas as (select codigo from portal_lojas where ativo),
  eq as (select e.*, i.codigo item_codigo from cftv_equipamentos e left join cftv_documento_itens i on i.id = e.documento_item_id
         where e.situacao in ('instalado', 'defeito', 'fora_operacao', 'em_estoque') and e.categoria not in ('cabeamento', 'outro')
           and (e.categoria <> 'conector_acessorio' or e.descricao ~* 'POWER BALUN|VB ?10(16|08)')),
  ult as (
    select distinct on (i.codigo, i.categoria) i.codigo, i.categoria, i.valor_unit, d.numero, d.emissao
    from cftv_documento_itens i join cftv_documentos d on d.id = i.documento_id and d.status in ('ok', 'conferir')
    where i.valor_unit > 0 order by i.codigo, i.categoria, d.emissao desc, i.id desc),
  linhas as (
    select e.loja_codigo, e.categoria,
      case e.categoria when 'camera' then 'Câmeras' when 'dvr_nvr' then 'Gravador ' || cftv_canais(e.descricao) || ' canais' else e.descricao end item,
      e.quantidade::numeric qtd,
      case when e.categoria = 'camera' then v_cam
           when e.categoria = 'dvr_nvr' then ceil(cftv_canais(e.descricao) / 16.0) * v_g16
           when e.categoria = 'hd' then v_hd
           when e.descricao ~* 'POWER BALUN|VB ?10(16|08)' then v_bal
           when e.descricao ~* '\m5U\M' and e.descricao ~* 'RACK' then v_rack
           else coalesce(u.valor_unit, e.custo_unit) end preco,
      case when e.categoria = 'camera' then f_cam
           when e.categoria = 'dvr_nvr' then ceil(cftv_canais(e.descricao) / 16.0)::int || ' × gravador de 16 canais · ' || f_g16
           when e.categoria = 'hd' then f_hd
           when e.descricao ~* 'POWER BALUN|VB ?10(16|08)' then f_bal
           when e.descricao ~* '\m5U\M' and e.descricao ~* 'RACK' then f_rack
           when u.valor_unit is not null then 'Último preço pago: NF ' || u.numero || ' de ' || to_char(u.emissao, 'DD/MM/YYYY')
           else 'Custo de aquisição cadastrado' end fonte,
      e.estimado, case when e.origem = 'anterior_2026' then 'anterior_2026' else 'compras_2026' end base
    from eq e left join ult u on u.codigo = e.item_codigo and u.categoria = e.categoria
    union all
    -- lojas com gravador e sem câmeras informadas na planilha nem compradas: ocupação média da rede
    select l.codigo, 'camera', 'Câmeras (estimadas pela ocupação média da rede)', round(l.capacidade_canais * v_ocup), v_cam,
      f_cam || '; quantidade = ' || l.capacidade_canais || ' canais × ' || round(v_ocup * 100) || '% de ocupação média', true, 'estimativa'
    from cftv_lojas l where l.capacidade_canais is not null and l.canais_analog_livres is null
      and not exists (select 1 from eq e where e.loja_codigo = l.codigo and e.categoria = 'camera')
    union all
    -- HD dos gravadores que não têm HD no inventário (1 por gravador)
    select x.loja_codigo, 'hd', 'HD de gravação (1 por gravador sem HD cadastrado)', x.falta, v_hd, f_hd, true, 'estimativa'
    from (select loja_codigo, sum(quantidade) filter (where categoria = 'dvr_nvr') - coalesce(sum(quantidade) filter (where categoria = 'hd'), 0) falta
          from eq group by loja_codigo) x where x.falta > 0
  ),
  l2 as (select * from linhas where (p_loja is null or loja_codigo = p_loja) and (loja_codigo is null or loja_codigo = 0 or loja_codigo in (select codigo from ativas) or base = 'compras_2026'))
  select jsonb_build_object(
    'data_base', current_date,
    'regra', 'Inventário de hoje: planilha por loja + compras de 2026 (consideradas instaladas), sem contar duas vezes; preços de reposição de hoje.',
    'total', (select round(coalesce(sum(qtd * preco), 0), 2) from l2),
    'total_estimado', (select round(coalesce(sum(qtd * preco) filter (where estimado), 0), 2) from l2),
    'sem_loja', (select round(coalesce(sum(qtd * preco), 0), 2) from l2 where loja_codigo is null),
    'ocupacao_media', round(v_ocup * 100, 1),
    'lojas_cameras_estimadas', (select count(distinct loja_codigo) from l2 where base = 'estimativa' and categoria = 'camera'),
    'por_base', (select jsonb_object_agg(base, v) from (select base, round(sum(qtd * preco), 2) v from l2 group by 1) x),
    'por_categoria', (select coalesce(jsonb_agg(x order by valor desc), '[]') from (select categoria, sum(qtd) quantidade, round(sum(qtd * preco), 2) valor,
        round(coalesce(sum(qtd * preco) filter (where estimado), 0), 2) valor_estimado from l2 group by 1) x),
    'por_loja', (select coalesce(jsonb_agg(x order by valor desc), '[]') from (select loja_codigo, round(sum(qtd * preco), 2) valor,
        round(sum(qtd * preco) filter (where base = 'anterior_2026' or base = 'estimativa'), 2) anterior, round(sum(qtd * preco) filter (where base = 'compras_2026'), 2) compras_2026,
        sum(qtd) filter (where categoria = 'camera') cameras, sum(qtd) filter (where categoria = 'dvr_nvr') gravadores from l2 group by 1) x),
    'precos', (select coalesce(jsonb_agg(distinct jsonb_build_object('categoria', categoria, 'preco', preco, 'fonte', fonte)), '[]') from l2 where categoria in ('camera', 'dvr_nvr', 'hd')),
    'linhas', (select coalesce(jsonb_agg(jsonb_build_object('loja', loja_codigo, 'categoria', categoria, 'item', item, 'qtd', qtd, 'preco', preco, 'valor', round(qtd * preco, 2),
        'fonte', fonte, 'estimado', estimado, 'base', base) order by loja_codigo, categoria), '[]') from l2)
  ) into res;
  return res;
end $$;
grant execute on function public.cftv_patrimonio(int) to authenticated;

select public.cftv_reconciliar();
select public.cftv_estimar_plano();
