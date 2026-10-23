-- Auditoria de Desconto em Folha do Crediário (23/10/2026).
--
-- Todo mês o usuário alimenta a tela desconto-folha/ com:
--   compras no crediário ("COMPRA EM LOJA"), cadastro de funcionários, descontos da folha (evento 1260 "Compra Loja")
--   e, se quiser, as baixas do crediário. Cada arquivo vira um registro em cred_arquivos (o mesmo arquivo — mesmo hash —
--   não entra duas vezes) e as linhas vão para cred_parcelas / cred_funcionarios / cred_folha / cred_baixas.
-- O cruzamento (devido × descontado por funcionário e competência, duplicidades e faltas graves) roda na tela, a partir
-- destas tabelas; as decisões do auditor ficam em cred_tratativas e o fechamento do mês em cred_fechamentos.
--
-- Acesso: só administrador, controladoria e diretoria (orc_perfis), igual ao Financeiro. Sem DROP/DELETE de dados.

create or replace function public.cred_pode_auditar() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.orc_perfis p
                 where p.user_id = (select auth.uid()) and p.ativo and p.perfil in ('administrador', 'controladoria', 'diretoria'))
$$;
revoke execute on function public.cred_pode_auditar() from public, anon;
grant execute on function public.cred_pode_auditar() to authenticated;

-- Arquivos importados (um por upload). hash = SHA-256 do arquivo: o mesmo arquivo não é importado duas vezes.
create table if not exists public.cred_arquivos (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('compras', 'cadastro', 'folha', 'baixas')),
  nome text not null,
  hash text not null,
  linhas int not null default 0,
  total numeric(14, 2),
  rodape numeric(14, 2),             -- total impresso no fim do relatório (compras), para conferir se veio inteiro
  competencias text[],               -- folha: competências (AAAA-MM) presentes no arquivo
  eventos text[],                    -- folha: eventos considerados como desconto do crediário
  importado_por text default (auth.jwt() ->> 'email'),
  importado_em timestamptz not null default now(),
  unique (tipo, hash)
);

-- Parcelas do crediário. chave = cpf|documento|parcela|lançamento|vencimento (a mesma parcela em dois relatórios vira uma).
create table if not exists public.cred_parcelas (
  chave text primary key,
  cpf text not null,
  nome text,
  documento text not null,
  contrato text,
  parcela int not null,
  n_parcelas int,
  lancamento date,
  vencimento date not null,
  valor numeric(12, 2) not null,
  valor_anterior numeric(12, 2),     -- preenchido quando um relatório mais novo trouxe outro valor para a mesma parcela
  alterado_em timestamptz,
  arquivo_id bigint not null references public.cred_arquivos(id) on delete cascade,
  ultimo_arquivo_id bigint
);
create index if not exists cred_parcelas_cpf on public.cred_parcelas (cpf);
create index if not exists cred_parcelas_arquivo on public.cred_parcelas (arquivo_id);

-- Cadastro de funcionários: a carga mais recente atualiza cada CPF; quem não veio no último cadastro saiu da empresa
-- (ou mudou de CPF) e a tela trata como "fora do cadastro".
create table if not exists public.cred_funcionarios (
  cpf text primary key,
  matricula text,
  nome text,
  loja text,
  cidade text,
  funcao text,
  admissao date,
  situacao text,
  arquivo_id bigint references public.cred_arquivos(id) on delete set null,
  atualizado_em timestamptz not null default now()
);
create index if not exists cred_funcionarios_matricula on public.cred_funcionarios (matricula);

-- Descontos lançados na folha (só os eventos do crediário). Linhas repetidas são guardadas de propósito: a tela aponta
-- desconto em duplicidade.
create table if not exists public.cred_folha (
  id bigint generated always as identity primary key,
  cpf text,
  matricula text,
  nome text,
  competencia text not null check (competencia ~ '^\d{4}-\d{2}$'),
  evento text,
  valor numeric(12, 2) not null,
  data_pagamento date,
  arquivo_id bigint not null references public.cred_arquivos(id) on delete cascade
);
create index if not exists cred_folha_comp on public.cred_folha (competencia, cpf);
create index if not exists cred_folha_arquivo on public.cred_folha (arquivo_id);

-- Baixas (recebimentos) do crediário. chave = documento|parcela|cpf|data|valor: duas baixas diferentes da mesma parcela
-- ficam as duas (a tela aponta baixa em duplicidade).
create table if not exists public.cred_baixas (
  chave text primary key,
  documento text not null,
  parcela int,
  cpf text,
  data_baixa date,
  valor numeric(12, 2),
  arquivo_id bigint not null references public.cred_arquivos(id) on delete cascade
);
create index if not exists cred_baixas_doc on public.cred_baixas (documento, parcela);
create index if not exists cred_baixas_arquivo on public.cred_baixas (arquivo_id);

-- Parâmetros (uma linha)
create table if not exists public.cred_config (
  id int primary key default 1 check (id = 1),
  regra text not null default 'ciclo' check (regra in ('ciclo', 'venc')),
  corte int not null default 20 check (corte between 1 and 31),
  tolerancia numeric(8, 2) not null default 0.05 check (tolerancia >= 0),
  atualizado_por text default (auth.jwt() ->> 'email'),
  atualizado_em timestamptz not null default now()
);
insert into public.cred_config (id) values (1) on conflict do nothing;

-- Tratativa de cada pendência (histórico: a mais recente vale). pendencia = tipo|cpf|competência.
create table if not exists public.cred_tratativas (
  id bigint generated always as identity primary key,
  pendencia text not null,
  cpf text,
  competencia text,
  status text not null check (status in ('pendente', 'justificado', 'cobrar', 'devolver', 'resolvido')),
  observacao text,
  valor numeric(12, 2),
  usuario text default (auth.jwt() ->> 'email'),
  criado_em timestamptz not null default now()
);
create index if not exists cred_tratativas_pend on public.cred_tratativas (pendencia, criado_em desc);

-- Fechamento mensal: foto dos números no dia em que o auditor fechou a competência.
create table if not exists public.cred_fechamentos (
  competencia text primary key check (competencia ~ '^\d{4}-\d{2}$'),
  status text not null default 'fechada' check (status in ('fechada', 'reaberta')),
  devido numeric(14, 2),
  descontado numeric(14, 2),
  a_menos numeric(14, 2),
  a_mais numeric(14, 2),
  pendencias int,
  resumo jsonb,
  observacao text,
  fechado_por text default (auth.jwt() ->> 'email'),
  fechado_em timestamptz not null default now()
);

-- RLS: tudo só para quem pode auditar
do $$
declare t text;
begin
  foreach t in array array['cred_arquivos', 'cred_parcelas', 'cred_funcionarios', 'cred_folha', 'cred_baixas', 'cred_config', 'cred_tratativas', 'cred_fechamentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_auditor', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.cred_pode_auditar())) with check ((select public.cred_pode_auditar()))', t || '_auditor', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Importa um arquivo inteiro numa transação só (ou entra tudo, ou nada).
-- p_arquivo = {tipo, nome, hash, total, rodape, competencias, eventos}; p_linhas = linhas já lidas e normalizadas pela tela.
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
  insert into public.cred_arquivos (tipo, nome, hash, linhas, total, rodape, competencias, eventos)
  values (v_tipo, p_arquivo ->> 'nome', p_arquivo ->> 'hash', jsonb_array_length(p_linhas), nullif(p_arquivo ->> 'total', '')::numeric,
          nullif(p_arquivo ->> 'rodape', '')::numeric,
          (select array_agg(x) from jsonb_array_elements_text(coalesce(p_arquivo -> 'competencias', '[]')) x),
          (select array_agg(x) from jsonb_array_elements_text(coalesce(p_arquivo -> 'eventos', '[]')) x))
  returning id into v_id;

  if v_tipo = 'compras' then
    with l as (
      select * from jsonb_to_recordset(p_linhas) as x(chave text, cpf text, nome text, documento text, contrato text, parcela int, n_parcelas int, lancamento date, vencimento date, valor numeric)
    ), up as (
      insert into public.cred_parcelas as p (chave, cpf, nome, documento, contrato, parcela, n_parcelas, lancamento, vencimento, valor, arquivo_id, ultimo_arquivo_id)
      select distinct on (chave) chave, cpf, nome, documento, contrato, parcela, n_parcelas, lancamento, vencimento, valor, v_id, v_id from l
      on conflict (chave) do update set
        valor_anterior = case when p.valor <> excluded.valor then p.valor else p.valor_anterior end,
        alterado_em = case when p.valor <> excluded.valor then now() else p.alterado_em end,
        valor = excluded.valor, nome = excluded.nome, ultimo_arquivo_id = excluded.ultimo_arquivo_id
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

  elsif v_tipo = 'folha' then
    insert into public.cred_folha (cpf, matricula, nome, competencia, evento, valor, data_pagamento, arquivo_id)
    select cpf, matricula, nome, competencia, evento, valor, data_pagamento, v_id
    from jsonb_to_recordset(p_linhas) as x(cpf text, matricula text, nome text, competencia text, evento text, valor numeric, data_pagamento date);
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
