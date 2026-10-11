-- Painel da RL no Portal lido do espelho no Supabase (rl_*), sem depender do PC/porta 3456 (bloqueada em https e no celular).
-- Mesma regra do /api/dashboard do bot_v3.js. SECURITY INVOKER: valem as políticas staff_all das tabelas rl_*.
-- As datas da RL são gravadas em hora local marcada como UTC, por isso "at time zone 'UTC'". Aplicada em 11/10/2026.
create or replace function public.rl_painel(p_limite int default 400)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare
  tipos text[] := array['comprovante_pix','comprovante_ted','comprovante_boleto'];
  si record; dep_tot numeric; dep_n int; dep_ativos int; des_tot numeric; des_n int; sem_dep int;
  aj_tot numeric; aj_n int; apos numeric; apos_n int; aneg numeric; aneg_n int; saldo numeric; ini text;
  ult timestamptz;
begin
  select coalesce(sum(valor),0), count(*), count(*) filter (where status='ativo') into dep_tot, dep_n, dep_ativos from rl_depositos;
  select coalesce(sum(valor),0), count(*), count(*) filter (where deposito_id is null) into des_tot, des_n, sem_dep
    from rl_despesas where status <> 'cancelado' and tipo_doc = any(tipos);
  select coalesce(sum(valor),0), count(*) into aj_tot, aj_n from rl_ajustes;
  select coalesce(sum(valor),0), count(*) into apos, apos_n from rl_ajustes where valor > 0;
  select coalesce(sum(abs(valor)),0), count(*) into aneg, aneg_n from rl_ajustes where valor < 0;
  select * into si from rl_saldo_inicial where id = 1;
  if found then
    ini := to_char((si.data at time zone 'UTC')::date, 'YYYY-MM-DD');
    saldo := si.valor
      + (select coalesce(sum(valor),0) from rl_depositos where coalesce(nullif(data_documento,''), to_char((data at time zone 'UTC')::date,'YYYY-MM-DD')) >= ini)
      + (select coalesce(sum(valor),0) from rl_ajustes where valor > 0 and to_char((data at time zone 'UTC')::date,'YYYY-MM-DD') >= ini)
      - (select coalesce(sum(valor),0) from rl_despesas where status <> 'cancelado' and tipo_doc = any(tipos)
           and coalesce(nullif(data_documento,''), to_char((data at time zone 'UTC')::date,'YYYY-MM-DD')) >= ini)
      - (select coalesce(sum(abs(valor)),0) from rl_ajustes where valor < 0 and to_char((data at time zone 'UTC')::date,'YYYY-MM-DD') >= ini);
  else
    saldo := dep_tot + apos - des_tot - aneg;
  end if;
  select greatest((select max(created_at) from rl_despesas), (select max(created_at) from rl_depositos), (select max(created_at) from rl_ajustes)) into ult;
  return jsonb_build_object(
    'dashboard', jsonb_build_object('total_depositos', dep_tot + apos, 'qtd_depositos', dep_n + apos_n, 'depositos_ativos', dep_ativos,
       'total_despesas', des_tot + aneg, 'qtd_despesas', des_n + aneg_n, 'sem_deposito', sem_dep, 'total_ajustes', aj_tot, 'qtd_ajustes', aj_n,
       'saldo_inicial', case when si.id is null then null else jsonb_build_object('valor', si.valor, 'data', ini, 'descricao', si.descricao) end,
       'saldo_disponivel', round(saldo, 2), 'ultima_atualizacao', ult),
    'despesas', coalesce((select jsonb_agg(x) from (select id, to_char(data at time zone 'UTC','YYYY-MM-DD HH24:MI') data, data_documento, valor, fornecedor,
        servico, placa, descricao, tipo_doc, status, arquivo, deposito_id, remetente from rl_despesas order by data desc, id desc limit p_limite) x), '[]'::jsonb),
    'depositos', coalesce((select jsonb_agg(x) from (select id, to_char(data at time zone 'UTC','YYYY-MM-DD HH24:MI') data, data_documento, valor, saldo_restante, status,
        remetente, descricao, arquivo from rl_depositos order by data desc, id desc limit 60) x), '[]'::jsonb),
    'gastos_placa', coalesce((select jsonb_agg(x) from (select coalesce(placa,'Sem placa') placa, count(*) total_servicos, sum(valor) total_gasto, max(data) ultimo_servico
        from rl_despesas where status <> 'cancelado' and tipo_doc = any(tipos) group by 1 order by 3 desc) x), '[]'::jsonb));
end $$;
revoke all on function public.rl_painel(int) from public, anon;
grant execute on function public.rl_painel(int) to authenticated;
