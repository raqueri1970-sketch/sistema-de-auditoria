-- 26/10/2026: "COMPRA EM LOJA" do RH (o que vai ser descontado na folha, parcela a parcela) × crediário da loja.
--   * cred_arquivos.origem = 'rh' marca o relatório do RH (os de compras do crediário ficam sem origem).
--   * cred_parcelas.arquivos = todos os arquivos em que a parcela apareceu (a mesma parcela no RH e no crediário vira uma
--     linha só; a lista diz em quais relatórios ela está — e acusa parcela em dois relatórios do RH).
alter table public.cred_arquivos add column if not exists origem text;
alter table public.cred_parcelas add column if not exists arquivos bigint[];
update public.cred_arquivos set origem = 'rh' where tipo = 'compras' and nome ilike 'COMPRA EM LOJA%' and origem is null;
update public.cred_parcelas set arquivos = array_remove(array[arquivo_id, case when ultimo_arquivo_id is distinct from arquivo_id then ultimo_arquivo_id end], null) where arquivos is null;

create or replace function public.cred_importar(p_arquivo jsonb, p_linhas jsonb) returns jsonb
language plpgsql security invoker set search_path to 'public' as $$
declare
  v_tipo text := p_arquivo ->> 'tipo';
  v_id bigint;
  v_ant record;
  v_novas int := 0; v_atual int := 0; v_alt int := 0; v_ign int := 0;
begin
  if not public.cred_pode_auditar() then raise exception 'Sem permissão para a Auditoria de Desconto em Folha'; end if;
  select a.importado_em, a.importado_por, a.nome into v_ant from public.cred_arquivos a where a.tipo = v_tipo and a.hash = p_arquivo ->> 'hash';
  if found then
    raise exception 'Este arquivo já foi importado em % por % (como "%")', to_char(v_ant.importado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), coalesce(v_ant.importado_por, '?'), v_ant.nome;
  end if;
  insert into public.cred_arquivos (tipo, origem, nome, hash, linhas, total, rodape, competencias, eventos)
  values (v_tipo, nullif(p_arquivo ->> 'origem', ''), p_arquivo ->> 'nome', p_arquivo ->> 'hash', jsonb_array_length(p_linhas), nullif(p_arquivo ->> 'total', '')::numeric,
          nullif(p_arquivo ->> 'rodape', '')::numeric,
          (select array_agg(x) from jsonb_array_elements_text(coalesce(p_arquivo -> 'competencias', '[]')) x),
          (select array_agg(x) from jsonb_array_elements_text(coalesce(p_arquivo -> 'eventos', '[]')) x))
  returning id into v_id;

  if v_tipo = 'compras' then
    with l as (
      select * from jsonb_to_recordset(p_linhas) as x(chave text, cpf text, nome text, documento text, contrato text, parcela int, n_parcelas int, lancamento date, vencimento date, valor numeric)
    ), up as (
      insert into public.cred_parcelas as p (chave, cpf, nome, documento, contrato, parcela, n_parcelas, lancamento, vencimento, valor, arquivo_id, ultimo_arquivo_id, arquivos)
      select distinct on (chave) chave, cpf, nome, documento, contrato, parcela, n_parcelas, lancamento, vencimento, valor, v_id, v_id, array[v_id] from l
      on conflict (chave) do update set
        valor_anterior = case when p.valor <> excluded.valor then p.valor else p.valor_anterior end,
        alterado_em = case when p.valor <> excluded.valor then now() else p.alterado_em end,
        valor = excluded.valor, nome = excluded.nome, ultimo_arquivo_id = excluded.ultimo_arquivo_id,
        arquivos = case when v_id = any(coalesce(p.arquivos, array[p.arquivo_id])) then p.arquivos else coalesce(p.arquivos, array[p.arquivo_id]) || v_id end
      returning (xmax = 0) as nova, coalesce(p.alterado_em = now(), false) as alterada
    )
    select count(*) filter (where nova), count(*) filter (where not nova), count(*) filter (where alterada) into v_novas, v_atual, v_alt from up;

  elsif v_tipo = 'cadastro' then
    with l as (
      select * from jsonb_to_recordset(p_linhas) as x(cpf text, matricula text, nome text, loja text, cidade text, funcao text, admissao date, situacao text)
    ), up as (
      insert into public.cred_funcionarios as f (cpf, matricula, nome, loja, cidade, funcao, admissao, situacao, arquivo_id, atualizado_em)
      select distinct on (cpf) cpf, matricula, nome, loja, cidade, funcao, admissao, situacao, v_id, now() from l where cpf is not null
      on conflict (cpf) do update set matricula = excluded.matricula, nome = excluded.nome, loja = excluded.loja, cidade = excluded.cidade,
        funcao = excluded.funcao, admissao = excluded.admissao, situacao = excluded.situacao, arquivo_id = excluded.arquivo_id, atualizado_em = now()
      returning (xmax = 0) as nova
    )
    select count(*) filter (where nova), count(*) filter (where not nova) into v_novas, v_atual from up;

  elsif v_tipo = 'desligados' then
    with l as (
      select * from jsonb_to_recordset(p_linhas) as x(cpf text, matricula text, nome text, estab text, cargo text, admissao date, saida date, natureza text)
    ), up as (
      insert into public.cred_desligados as d (cpf, matricula, nome, estab, cargo, admissao, saida, natureza, arquivo_id, atualizado_em)
      select distinct on (cpf, saida) cpf, matricula, nome, estab, cargo, admissao, saida, natureza, v_id, now() from l where cpf is not null and saida is not null
      on conflict (cpf, saida) do update set matricula = excluded.matricula, nome = excluded.nome, estab = excluded.estab, cargo = excluded.cargo,
        admissao = excluded.admissao, natureza = excluded.natureza, arquivo_id = excluded.arquivo_id, atualizado_em = now()
      returning (xmax = 0) as nova
    )
    select count(*) filter (where nova), count(*) filter (where not nova) into v_novas, v_atual from up;

  elsif v_tipo = 'folha' then
    insert into public.cred_folha (cpf, matricula, nome, competencia, evento, valor, data_pagamento, documento, parcela, vencimento, arquivo_id)
    select cpf, matricula, nome, competencia, evento, valor, data_pagamento, documento, parcela, vencimento, v_id
    from jsonb_to_recordset(p_linhas) as x(cpf text, matricula text, nome text, competencia text, evento text, valor numeric, data_pagamento date, documento text, parcela int, vencimento date);
    get diagnostics v_novas = row_count;

  elsif v_tipo = 'baixas' then
    with l as (
      select * from jsonb_to_recordset(p_linhas) as x(chave text, documento text, parcela int, cpf text, data_baixa date, valor numeric)
    ), ins as (
      insert into public.cred_baixas (chave, documento, parcela, cpf, data_baixa, valor, arquivo_id)
      select distinct on (chave) chave, documento, parcela, cpf, data_baixa, valor, v_id from l
      on conflict (chave) do nothing returning 1
    )
    select count(*) into v_novas from ins;
    v_ign := jsonb_array_length(p_linhas) - v_novas;
  else
    raise exception 'Tipo de arquivo desconhecido: %', v_tipo;
  end if;

  return jsonb_build_object('arquivo_id', v_id, 'novas', v_novas, 'atualizadas', v_atual, 'alteradas', v_alt, 'ignoradas', v_ign);
end $$;
revoke execute on function public.cred_importar(jsonb, jsonb) from public, anon;
grant execute on function public.cred_importar(jsonb, jsonb) to authenticated;
