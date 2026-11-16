-- CFTV · Plano: gravador novo pela base definida pela gestão em 16/11/2026
--   gravador MHDX 1216-C com HD 2TB (R$ 2.341,85) + power balun 16 canais (R$ 1.549,90) = R$ 3.891,75 por gravador.
--   Antes: gravador sem HD (R$ 1.168,55) + HD avulso (R$ 1.300,00) + power balun = R$ 4.018,45.
--   Câmera: R$ 180,00 (preco_camera, já vigente). Valores pagos nas notas não mudam.
update cftv_premissas set fonte = 'Base definida pela gestão em 16/11/2026 (proposta KGMlan 1011040400, item 5)', validada = true, atualizado_em = now(), atualizado_por = 'gestão 16/11/2026'
  where chave = 'preco_gravador_16_com_hd';
update cftv_premissas set fonte = 'Base definida pela gestão em 16/11/2026 (proposta KGMlan 1011040400, item 7)', validada = true, atualizado_em = now(), atualizado_por = 'gestão 16/11/2026'
  where chave = 'preco_power_balun_16';

create or replace function public.cftv_estimar_plano()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare l record; p_cam numeric; p_cabo numeric; p_m numeric; p_con numeric; p_mo numeric; p_dvr_hd numeric; p_bal numeric;
  v_livres int; v_extra int; v_grav int; v_eq numeric; v_cab numeric; v_mo numeric; n int := 0;
begin
  select valor into p_cam from cftv_premissas where chave = 'preco_camera';
  select valor into p_cabo from cftv_premissas where chave = 'preco_cabo_metro';
  select valor into p_m from cftv_premissas where chave = 'metros_cabo_por_camera';
  select valor into p_con from cftv_premissas where chave = 'preco_conector';
  select valor into p_mo from cftv_premissas where chave = 'mao_obra_por_ponto';
  select valor into p_dvr_hd from cftv_premissas where chave = 'preco_gravador_16_com_hd';
  select valor into p_bal from cftv_premissas where chave = 'preco_power_balun_16';
  for l in select * from cftv_lojas where coalesce(necessidade_cameras, 0) > 0 and coalesce(situacao_cftv, '') not ilike '%DESATIVADA%' loop
    v_livres := case when l.canais_analog_livres is null and l.canais_ip_livres is null then null else coalesce(l.canais_analog_livres, 0) + coalesce(l.canais_ip_livres, 0) end;
    v_extra := greatest(0, l.necessidade_cameras - coalesce(v_livres, 0));
    v_grav := ceil(v_extra / 16.0);
    v_eq := round(l.necessidade_cameras * (p_cam + 2 * p_con) + v_grav * (p_dvr_hd + p_bal), 2);
    v_cab := round(l.necessidade_cameras * p_m * p_cabo, 2);
    v_mo := round(l.necessidade_cameras * p_mo, 2);
    insert into cftv_plano (loja_codigo, descricao, cameras, gravadores, valor_estimado, memoria_calculo, fonte, fonte_chave)
    values (l.codigo, 'Completar cobertura conforme levantamento: ' || coalesce(l.necessidade_texto, ''), l.necessidade_cameras, v_grav, v_eq + v_cab + v_mo,
      jsonb_build_object('cameras', l.necessidade_cameras, 'canais_livres', v_livres, 'canais_livres_informados', v_livres is not null,
        'gravadores_16_canais', v_grav, 'equipamento_orcamento', v_eq, 'cabeamento', v_cab, 'mao_obra', v_mo,
        'preco_camera', p_cam, 'preco_gravador_com_hd', p_dvr_hd, 'preco_power_balun', p_bal,
        'cameras_valor', round(l.necessidade_cameras * p_cam, 2), 'conectores_valor', round(l.necessidade_cameras * 2 * p_con, 2),
        'gravador_hd_valor', round(v_grav * p_dvr_hd, 2), 'power_balun_valor', round(v_grav * p_bal, 2),
        'gravadores_valor', round(v_grav * (p_dvr_hd + p_bal), 2), 'orcamento', 'KGMlan 1011040400 (26/10/2026) · base da gestão 16/11/2026'),
      'levantamento', 'levantamento:' || l.codigo)
    on conflict (fonte_chave) do update set descricao = excluded.descricao, cameras = excluded.cameras, gravadores = excluded.gravadores,
      valor_estimado = excluded.valor_estimado, memoria_calculo = excluded.memoria_calculo, atualizado_em = now()
      where cftv_plano.situacao = 'planejado';
    n := n + 1;
  end loop;
  return n;
end $function$;

select public.cftv_estimar_plano();
