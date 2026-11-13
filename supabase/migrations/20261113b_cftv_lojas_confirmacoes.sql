-- CFTV · 13/11/2026 (b) — lojas das notas faturadas sem loja, pelo CNPJ/endereço do destinatário e pela descrição da nota,
-- e quantidades estimadas do parque anterior confirmadas pela gestão (câmeras e HDs existentes).
with m(id, loja, motivo) as (values
  (144, 934, 'CNPJ 44.616.854/0069-60 · Av. Dr. Ulisses Guimarães, 501, Distrito Industrial, Petrolina (Mix Mateus)'),
  (92,  934, 'CNPJ 44.616.854/0069-60 · Petrolina, Distrito Industrial (Mix Mateus)'),
  (94,  934, 'CNPJ 44.616.854/0069-60 · Petrolina, Distrito Industrial (Mix Mateus)'),
  (27,  934, 'CNPJ 44.616.854/0069-60 · Petrolina, Distrito Industrial (Mix Mateus)'),
  (22,  934, 'Nota da matriz com "Petrolina": gravador 16 canais + 16 câmeras = sistema da Mix Mateus Petrolina (16 canais)'),
  (66,  934, 'Nota da matriz "referente loja de Petrolina": 16 pontos = sistema da Mix Mateus Petrolina (16 canais)'),
  (63,  950, 'Nota da matriz "CD Manaíra": gravador 32 canais + 8 canais = sistema do Shopping Manaíra (48 canais)'),
  (124, 951, 'CNPJ 44.616.854/0073-47 · Rua do Comércio, 244, Centro, Maceió (Maceió Centro)'),
  (132, 951, 'Nota da matriz "Maceió" (out/26, junto com a infraestrutura da Rua do Comércio) · Maceió Centro'),
  (75,  951, 'Nota da matriz "Maceió" · implantação da loja Maceió Centro (sem sistema anterior no levantamento)'),
  (76,  951, 'Nota da matriz "Maceió" · implantação da loja Maceió Centro (sem sistema anterior no levantamento)'),
  (73,  951, 'Nota da matriz "Maceió" · alarme da loja Maceió Centro'),
  (54,  951, 'Nota da matriz "Maceió" · implantação da loja Maceió Centro'),
  (126, 948, 'Nota da matriz "Maceió Shopping" · Esposende Shopping Pátio Maceió'),
  (62,  908, 'CNPJ 44.616.854/0063-75 · Av. Conde da Boa Vista, 88 (Shopping Boa Vista); gravador 16 canais substitui o de 8'),
  (67,  908, 'CNPJ 44.616.854/0063-75 · Av. Conde da Boa Vista, 88 (Shopping Boa Vista)'),
  (103, 908, 'CNPJ 44.616.854/0063-75 · Av. Conde da Boa Vista, 88 (Shopping Boa Vista)'),
  (93,  945, 'CNPJ 44.616.854/0012-25 · Praça N. Sra. do Rosário, 532, Jaboatão Centro (Jaboatão Velho)'),
  (37,  927, 'CNPJ 44.616.854/0065-37 · Rua Josefa Taveira, 354, Mangabeira (loja de rua)'),
  (134, 927, 'CNPJ 44.616.854/0065-37 · Rua Josefa Taveira, 354, Mangabeira (loja de rua)'),
  (81,  941, 'CNPJ 44.616.854/0019-00 · Av. Mariana Amália, 143, Vitória de Santo Antão (loja de rua)')
), d as (
  update public.cftv_documentos x set loja_codigo = m.loja, loja_confianca = 'media',
         loja_motivo = 'Definida pela nota (13/11/2026): ' || m.motivo, atualizado_em = now()
    from m where x.id = m.id and x.loja_codigo is null returning x.id, x.loja_codigo)
update public.cftv_equipamentos e set loja_codigo = d.loja_codigo
  from d, public.cftv_documento_itens i where i.documento_id = d.id and e.documento_item_id = i.id and e.loja_codigo is null;

-- nota duplicada da NF 168 acompanha a original
update public.cftv_documentos set loja_codigo = 950, loja_confianca = 'media', loja_motivo = 'Duplicada da NF 168 (Shopping Manaíra)'
 where status = 'duplicado' and numero = '168' and loja_codigo is null;
-- manutenção gerada pela nota de Vitória
update public.cftv_manutencoes mm set loja_codigo = 941 where mm.loja_codigo is null and mm.documento_id = 81;

-- parque anterior: quantidades estimadas passam a confirmadas (decisão da gestão: são câmeras/HDs já existentes)
update public.cftv_equipamentos set estimado = false where estimado;

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
  -- parque anterior a 2026 (planilha por loja), sem cabos/outros
  eq_ant as (select e.* from cftv_equipamentos e
         where e.origem = 'anterior_2026' and e.situacao in ('instalado', 'defeito', 'fora_operacao', 'em_estoque') and e.categoria not in ('cabeamento', 'outro')
           and (e.categoria <> 'conector_acessorio' or e.descricao ~* 'POWER BALUN|VB ?10(16|08)')),
  -- tudo que está instalado hoje (para estimar HD faltante por gravador)
  eq_all as (select e.* from cftv_equipamentos e where e.situacao in ('instalado', 'defeito', 'fora_operacao', 'em_estoque')),
  docs as (select d.*, coalesce((select sum(i.valor_total) from cftv_documento_itens i where i.documento_id = d.id), 0) itens_soma
           from cftv_documentos d where d.status = 'ok' and d.natureza in ('aquisicao', 'instalacao')),
  linhas as (
    -- compras de 2026: item a item pelo custo da nota (frete e desconto rateados para bater com o total da nota)
    select d.loja_codigo, case when d.natureza = 'instalacao' then 'instalacao' else coalesce(i.categoria, 'outro') end categoria,
      i.descricao item, coalesce(i.quantidade, 1)::numeric qtd,
      round(i.valor_total * d.valor_total / nullif(d.itens_soma, 0) / nullif(coalesce(i.quantidade, 1), 0), 4) preco,
      'Custo real: NF ' || coalesce(d.numero, '?') || ' de ' || to_char(d.emissao, 'DD/MM/YYYY') fonte, false estimado, 'compras_2026' base
    from docs d join cftv_documento_itens i on i.documento_id = d.id
    where d.itens_soma > 0
    union all
    select d.loja_codigo, case when d.natureza = 'instalacao' then 'instalacao' else 'outro' end, coalesce(d.descricao, 'Nota sem itens lidos'), 1, d.valor_total,
      'Custo real: NF ' || coalesce(d.numero, '?') || ' de ' || to_char(d.emissao, 'DD/MM/YYYY'), false, 'compras_2026'
    from docs d where d.itens_soma = 0
    union all
    -- parque anterior a 2026 a preço de reposição de hoje
    select e.loja_codigo, e.categoria,
      case e.categoria when 'camera' then 'Câmeras' when 'dvr_nvr' then 'Gravador ' || cftv_canais(e.descricao) || ' canais' else e.descricao end,
      e.quantidade::numeric,
      case when e.categoria = 'camera' then v_cam
           when e.categoria = 'dvr_nvr' then ceil(cftv_canais(e.descricao) / 16.0) * v_g16
           when e.categoria = 'hd' then v_hd
           when e.descricao ~* 'POWER BALUN|VB ?10(16|08)' then v_bal
           when e.descricao ~* '\m5U\M' and e.descricao ~* 'RACK' then v_rack
           else e.custo_unit end,
      case when e.categoria = 'camera' then f_cam
           when e.categoria = 'dvr_nvr' then ceil(cftv_canais(e.descricao) / 16.0)::int || ' × gravador de 16 canais · ' || f_g16
           when e.categoria = 'hd' then f_hd
           when e.descricao ~* 'POWER BALUN|VB ?10(16|08)' then f_bal
           when e.descricao ~* '\m5U\M' and e.descricao ~* 'RACK' then f_rack
           else 'Custo de aquisição cadastrado' end,
      e.estimado, 'anterior_2026'
    from eq_ant e
    union all
    -- lojas com gravador e sem câmeras informadas na planilha nem compradas: ocupação média da rede
    select l.codigo, 'camera', 'Câmeras existentes (quantidade confirmada pela gestão)', round(l.capacidade_canais * v_ocup), v_cam,
      f_cam || '; quantidade = ' || l.capacidade_canais || ' canais × ' || round(v_ocup * 100) || '% de ocupação · confirmada pela gestão em 13/11/2026', false, 'anterior_2026'
    from cftv_lojas l where l.capacidade_canais is not null and l.canais_analog_livres is null
      and not exists (select 1 from eq_all e where e.loja_codigo = l.codigo and e.categoria = 'camera')
    union all
    -- HD dos gravadores que não têm HD no inventário (1 por gravador)
    select x.loja_codigo, 'hd', 'HD de gravação existente (1 por gravador, confirmado pela gestão)', x.falta, v_hd, f_hd || ' · confirmado pela gestão em 13/11/2026', false, 'anterior_2026'
    from (select loja_codigo, sum(quantidade) filter (where categoria = 'dvr_nvr') - coalesce(sum(quantidade) filter (where categoria = 'hd'), 0) falta
          from eq_all where categoria in ('dvr_nvr', 'hd') group by loja_codigo) x where x.falta > 0
  ),
  l2 as (select * from linhas where qtd > 0 and (p_loja is null or loja_codigo = p_loja)
           and (loja_codigo is null or loja_codigo = 0 or loja_codigo in (select codigo from ativas) or base = 'compras_2026'))
  select jsonb_build_object(
    'data_base', current_date,
    'regra', 'Compras de 2026 pelo custo real das notas fiscais emitidas (equipamento, cabo, acessórios e instalação; todas conferidas e executadas) + parque anterior a 2026 (quantidades confirmadas pela gestão) a preço de reposição de hoje. Orçamento só entra no projeto em aberto de câmeras do estoque.',
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
    'precos', (select coalesce(jsonb_agg(distinct jsonb_build_object('categoria', categoria, 'preco', preco, 'fonte', fonte)), '[]') from l2 where base <> 'compras_2026' and categoria in ('camera', 'dvr_nvr', 'hd')),
    'linhas', (select coalesce(jsonb_agg(jsonb_build_object('loja', loja_codigo, 'categoria', categoria, 'item', item, 'qtd', qtd, 'preco', round(preco, 2), 'valor', round(qtd * preco, 2),
        'fonte', fonte, 'estimado', estimado, 'base', base) order by loja_codigo, categoria), '[]') from l2)
  ) into res;
  return res;
end $$;
