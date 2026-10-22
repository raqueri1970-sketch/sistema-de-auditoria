-- Sistema de Inteligência e Auditoria Financeira da Esposende (revisão de 22/10/2026).
--
-- O que muda (uma base, uma lista de ocorrências, uma caixa de revisão):
--   1. fin_lancamentos / fin_base — TODAS as contas a pagar do Sallamo numa tabela só (antes cada consulta lia "a última
--      carga", que podia ser um recorte de 3 meses e encolhia a base inteira). Cada dia de vencimento vem da carga mais
--      recente que cobre aquele dia. Título que some do Sallamo fica com vigente = false (histórico, não é apagado).
--   2. fin_ocorrencias — os 5 grupos de auditoria (duplicidade, pagamento incorreto, juros e multas, crédito não
--      aproveitado, inconsistência de dados) com as 4 classificações: NORMAL, SOB_ANALISE, IRREGULARIDADE_CONFIRMADA,
--      PREJUIZO_CONFIRMADO. Regra de ouro: o motor automático NUNCA gera PREJUIZO_CONFIRMADO — só uma pessoa, na Caixa
--      de Revisão, confirmando a irregularidade e o impacto. Suspeita fica SOB_ANALISE.
--   3. fin_decisoes — toda decisão com usuário, data, observação e evidências.
--   4. fin_auditar() — Cruzador (cruza Sallamo × comprovantes × banco/OCR) + Auditor (classifica, reduz falso positivo)
--      + Sentinela (pontua e prioriza). Roda sozinho quando chega carga nova do Sallamo (fin_processar, pg_cron a cada 10 min).
--   5. fin_consulta / fin_comparar / fin_resumo / fin_lancamento / fin_ocorrencia — Inteligência e drill-down
--      (do total até o lançamento e a evidência), usados pela tela financeiro/ e pelo Cérebro Executivo.
--
-- Correções de achados da auditoria do próprio sistema:
--   • receitas ("(+) Receitas Financeiras", "Outras Receitas") entravam como despesa;
--   • Renegociado/Cancelado entravam no saldo a pagar (contava a dívida duas vezes);
--   • 38 casos marcados "irregular" pelo robô sem revisão humana voltam para "em_analise";
--   • fin_revisar_duplicidade de 4 parâmetros aceitava qualquer nome de usuário: passa a usar o usuário logado.
--
-- Aplicada em produção em partes (fin_sistema_unificado_1..n). Sem DROP/DELETE/REVOKE: tabelas novas nascem com RLS
-- (leitura só para fin_pode_auditar) e as funções que gravam têm trava própria (fin_exige_servico / fin_pode_auditar).

-- ============================================================================================================
-- 0. Utilidades
-- ============================================================================================================
create or replace function public.fin_norm(p text) returns text language sql immutable set search_path = '' as $$
  select nullif(trim(regexp_replace(translate(upper(coalesce(p, '')),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN'), '[^A-Z0-9]+', ' ', 'g')), '')
$$;

-- Nome do fornecedor sem sufixo societário: "VULCABRAS - BA CALCADOS S.A" e "VULCABRAS BA CALCADOS SA" viram a mesma chave.
create or replace function public.fin_chave_fornecedor(p text) returns text language sql immutable set search_path = '' as $$
  select nullif(trim(regexp_replace(' ' || coalesce(public.fin_norm(p), '') || ' ',
    ' (LTDA|LTD|S A|SA|ME|EPP|EIRELI|CIA|MEI|S S|SS|EI) ', ' ', 'g')), '')
$$;

-- "51.741,88" → 51741.88 (nulo se não for número)
create or replace function public.fin_num_br(p text) returns numeric language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '[0-9]' then return null; end if;
  return replace(replace(regexp_replace(p, '[^0-9,.]', '', 'g'), '.', ''), ',', '.')::numeric;
exception when others then return null;
end $$;

-- "R$ 23.027,20" (independente do locale do banco; nulo vira "—")
create or replace function public.fin_brl(v numeric) returns text language sql immutable set search_path = '' as $$
  select case when v is null then '—' else 'R$ ' || translate(to_char(v, 'FM999,999,999,990.00'), ',.', '.,') end
$$;

-- Funções que gravam na base só rodam pelo serviço (Edge Function / gatilho) ou pelo administrador do banco.
create or replace function public.fin_exige_servico() returns void language plpgsql stable set search_path = '' as $$
declare r text;
begin
  r := nullif(current_setting('request.jwt.claim.role', true), '');
  if r is null then
    begin r := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'; exception when others then r := null; end;
  end if;
  if r = 'service_role' or session_user in ('postgres', 'supabase_admin') then return; end if;
  raise exception 'Operação reservada ao serviço da Auditoria Financeira';
end $$;

-- ============================================================================================================
-- 1. Base única de lançamentos do Sallamo
-- ============================================================================================================
create table if not exists public.fin_lancamentos (
  chave            text primary key,          -- codigo|vencimento|valor_parcela|n  (estável entre cargas)
  codigo           text not null,             -- ID do título no Sallamo
  ordem            integer not null default 1,-- n-ésima linha idêntica (o Sallamo repete linhas)
  fornecedor       text,                      -- nome como está no Sallamo, sem espaços sobrando
  fornecedor_bruto text,                      -- nome exatamente como veio
  fornecedor_chave text,                      -- nome normalizado para agrupar variações
  conta_contabil   text,
  centro_custo     text,
  tipo             text not null check (tipo in ('DESPESA', 'RECEITA')),
  situacao         text,                      -- Pago, A vencer, Vencido, Previsto, Renegociado, Cancelado
  competencia      date,
  vencimento       date,
  data_pagamento   date,
  valor_parcela    numeric(14,2),
  valor_pago       numeric(14,2),
  saldo            numeric(14,2),
  em_aberto        boolean generated always as (situacao in ('A vencer', 'Vencido', 'Previsto')) stored,
  carga_id         bigint,                    -- fin_sallamo_cache.id de onde veio
  carga_em         timestamptz
);
alter table public.fin_lancamentos add column if not exists vigente boolean not null default true;  -- false = sumiu do Sallamo
alter table public.fin_lancamentos add column if not exists versao bigint;
create index if not exists fin_lanc_pag   on public.fin_lancamentos (data_pagamento);
create index if not exists fin_lanc_venc  on public.fin_lancamentos (vencimento);
create index if not exists fin_lanc_comp  on public.fin_lancamentos (competencia);
create index if not exists fin_lanc_forn  on public.fin_lancamentos (fornecedor_chave);
create index if not exists fin_lanc_tit   on public.fin_lancamentos (codigo, vencimento);
alter table public.fin_lancamentos enable row level security;
create policy fin_lancamentos_ler on public.fin_lancamentos for select to authenticated using ((select public.fin_pode_auditar()));

-- O que vale hoje (tudo que lê a base usa esta view)
create or replace view public.fin_base with (security_invoker = true) as
  select * from public.fin_lancamentos where vigente;

-- Comprovantes enviados ao título, com o que está escrito neles (autenticação, valor pago no banco, encargos, favorecido).
create or replace view public.fin_comprovantes_v with (security_invoker = true) as
select k.id, k.codigo, k.vencimento, k.pagamento as data_pagamento, k.valor, k.fornecedor, k.arquivo_path, k.arquivo_nome,
       k.observacao, k.enviado_por, k.enviado_em,
       substring(k.observacao from 'autentica[çc][ãa]o ([A-Z0-9]{8,})')                              as autenticacao,
       substring(k.observacao from 'cód\. barras ([0-9 .]{30,})')                                      as codigo_barras,
       public.fin_num_br(coalesce(substring(k.observacao from '= R\$ ([0-9.]+,[0-9]{2})'),
                                  substring(k.observacao from 'pago [0-9]{2}/[0-9]{2}/[0-9]{4}[^·]*· R\$ ([0-9.]+,[0-9]{2})'))) as valor_banco,
       public.fin_num_br(substring(k.observacao from 'encargos R\$ ([0-9.]+,[0-9]{2})'))               as encargos,
       nullif(trim(substring(k.observacao from 'favorecido no comprovante: ([^·]+)')), '')            as favorecido
from public.fin_comprovantes k
where not k.substituido;

-- Recarrega a base a partir das cargas guardadas. Para cada dia de vencimento usa a carga MAIS RECENTE que cobre o dia.
create or replace function public.fin_recarregar_base() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ini date; v_fim date; v_n integer; v_fora integer; v_versao bigint := txid_current();
begin
  perform fin_exige_servico();
  select min(periodo_inicio), max(periodo_fim) into v_ini, v_fim from fin_sallamo_cache;
  if v_ini is null then return jsonb_build_object('ok', false, 'motivo', 'nenhuma carga do Sallamo'); end if;

  with dias as (
    select d::date as dia from generate_series(v_ini, v_fim, interval '1 day') d
  ), melhor as (
    select dia, (select c.id from fin_sallamo_cache c
                 where dia between c.periodo_inicio and c.periodo_fim
                 order by c.recebido_em desc, c.id desc limit 1) as carga
    from dias
  ), linhas as (
    select c.id as carga, c.recebido_em, e,
           nullif(left(e->>'vencimento', 10), '')::date as venc
    from fin_sallamo_cache c
    cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload) = 'array' then c.payload
                                                 else coalesce(c.payload->'dados', '[]'::jsonb) end) e
    where c.id in (select distinct carga from melhor)
  ), validas as (
    select l.* from linhas l join melhor m on m.dia = l.venc and m.carga = l.carga
  ), num as (
    select v.*, row_number() over (partition by e->>'codigo', venc, (e->>'valorParcela')::numeric order by e::text) as n
    from validas v
  )
  insert into fin_lancamentos as t (chave, codigo, ordem, fornecedor, fornecedor_bruto, fornecedor_chave, conta_contabil, centro_custo,
                               tipo, situacao, competencia, vencimento, data_pagamento, valor_parcela, valor_pago, saldo, carga_id, carga_em,
                               vigente, versao)
  select (e->>'codigo') || '|' || coalesce(venc::text, '') || '|' || coalesce(((e->>'valorParcela')::numeric(14,2))::text, '') || '|' || n,
         e->>'codigo', n,
         nullif(regexp_replace(trim(e->>'fornecedor'), '\s+', ' ', 'g'), ''),
         e->>'fornecedor',
         fin_chave_fornecedor(e->>'fornecedor'),
         nullif(trim(e->>'contaContabil'), ''),
         nullif(trim(e->>'centroCusto'), ''),
         case when e->>'contaContabil' ~ '^\s*\(\+\)' or e->>'contaContabil' ~* 'receita' then 'RECEITA' else 'DESPESA' end,
         e->>'status',
         nullif(left(e->>'competencia', 10), '')::date,
         venc,
         nullif(left(e->>'dataPagamento', 10), '')::date,
         nullif(e->>'valorParcela', '')::numeric,
         coalesce(nullif(e->>'valorPago', '')::numeric, 0),
         nullif(e->>'saldo', '')::numeric,
         carga, recebido_em, true, v_versao
  from num
  on conflict (chave) do update set
    codigo = excluded.codigo, ordem = excluded.ordem, fornecedor = excluded.fornecedor, fornecedor_bruto = excluded.fornecedor_bruto,
    fornecedor_chave = excluded.fornecedor_chave, conta_contabil = excluded.conta_contabil, centro_custo = excluded.centro_custo,
    tipo = excluded.tipo, situacao = excluded.situacao, competencia = excluded.competencia, vencimento = excluded.vencimento,
    data_pagamento = excluded.data_pagamento, valor_parcela = excluded.valor_parcela, valor_pago = excluded.valor_pago,
    saldo = excluded.saldo, carga_id = excluded.carga_id, carga_em = excluded.carga_em, vigente = true, versao = excluded.versao;
  get diagnostics v_n = row_count;

  update fin_lancamentos set vigente = false where vigente and versao is distinct from v_versao;
  get diagnostics v_fora = row_count;
  return jsonb_build_object('ok', true, 'lancamentos', v_n, 'sairam_do_sallamo', v_fora, 'de', v_ini, 'ate', v_fim);
end $$;

-- Carga repetida (mesmo período e mesmo conteúdo da última) não é gravada de novo: só renova a hora da carga.
create or replace function public.fin_cache_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from fin_sallamo_cache c
             where c.periodo_inicio = new.periodo_inicio and c.periodo_fim = new.periodo_fim
               and c.id = (select max(id) from fin_sallamo_cache x where x.periodo_inicio = new.periodo_inicio and x.periodo_fim = new.periodo_fim)
               and md5(c.payload::text) = md5(new.payload::text)) then
    update fin_sallamo_cache set recebido_em = now()
     where id = (select max(id) from fin_sallamo_cache x where x.periodo_inicio = new.periodo_inicio and x.periodo_fim = new.periodo_fim);
    return null;
  end if;
  return new;
end $$;


-- ============================================================================================================
-- 2. Ocorrências, decisões e regras
-- ============================================================================================================
create table if not exists public.fin_ocorrencias (
  id                 bigserial primary key,
  chave              text not null unique,       -- regra:referência (estável entre execuções)
  grupo              text not null check (grupo in ('FIN_DUPLICIDADE', 'FIN_PAGAMENTO_INCORRETO', 'FIN_JUROS_MULTA',
                                                    'FIN_CREDITO_DESCONTO', 'FIN_INCONSISTENCIA_DADOS')),
  regra              text not null,
  titulo             text not null,              -- motivo do alerta, curto
  motivo             text,                       -- explicação em uma frase, com os números
  classificacao      text not null default 'SOB_ANALISE'
                     check (classificacao in ('NORMAL', 'SOB_ANALISE', 'IRREGULARIDADE_CONFIRMADA', 'PREJUIZO_CONFIRMADO')),
  forca              text not null default 'MEDIA' check (forca in ('FORTE', 'MEDIA', 'FRACA')),
  prioridade         text not null default 'MEDIA' check (prioridade in ('ALTA', 'MEDIA', 'BAIXA')),
  pontos             integer not null default 0,
  fornecedor         text,
  fornecedor_chave   text,
  documento          text,                       -- NF / código de barras / CNPJ / autenticação quando existir
  codigo_titulo      text,
  lancamentos        text[] not null default '{}',  -- chaves de fin_lancamentos
  valor_envolvido    numeric(14,2),
  impacto_estimado   numeric(14,2),              -- quanto PODE ser perda (suspeita, não é prejuízo)
  impacto_comprovado numeric(14,2),              -- só com prova (comprovante/contabilidade) ou decisão humana
  valor_recuperado   numeric(14,2),
  data_ref           date,
  evidencias         jsonb not null default '[]',
  status_revisao     text not null default 'ABERTO' check (status_revisao in ('ABERTO', 'REVISAR_DEPOIS', 'DECIDIDO', 'RESOLVIDO')),
  ativo              boolean not null default true, -- false = o motor não encontrou mais (e ninguém decidiu)
  origem_ref         text,                       -- ex.: DUP-23 (fin_duplicidade_comprovantes)
  decidido_por       text,
  decidido_em        timestamptz,
  observacao         text,
  detectado_em       timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
alter table public.fin_ocorrencias add column if not exists visto_em timestamptz;  -- última auditoria que encontrou o caso
create index if not exists fin_oc_grupo on public.fin_ocorrencias (grupo, classificacao) where ativo;
create index if not exists fin_oc_lanc  on public.fin_ocorrencias using gin (lancamentos);
alter table public.fin_ocorrencias enable row level security;
create policy fin_ocorrencias_ler on public.fin_ocorrencias for select to authenticated using ((select public.fin_pode_auditar()));

create table if not exists public.fin_decisoes (
  id                      bigserial primary key,
  ocorrencia_id           bigint not null references public.fin_ocorrencias(id),
  decisao                 text not null check (decisao in ('CONFIRMAR_IRREGULARIDADE', 'NAO_E_IRREGULARIDADE', 'REVISAR_DEPOIS', 'RESOLVIDO')),
  classificacao_anterior  text,
  classificacao_nova      text,
  impacto_comprovado      numeric(14,2),
  valor_recuperado        numeric(14,2),
  observacao              text not null,
  evidencias              jsonb not null default '[]',   -- o que a pessoa viu + o que anexou
  usuario                 text not null,
  em                      timestamptz not null default now()
);
create index if not exists fin_dec_oc on public.fin_decisoes (ocorrencia_id, em);
alter table public.fin_decisoes enable row level security;
create policy fin_decisoes_ler on public.fin_decisoes for select to authenticated using ((select public.fin_pode_auditar()));

-- As 5 regras (grupos) e os 4 agentes, descritos em português simples.
insert into public.fin_regras (codigo, nome, descricao, severidade_padrao, configuracao, ativo, versao) values
 ('FIN_DUPLICIDADE', 'Duplicidade de pagamento',
  'Mesmo título/parcela ou mesmo documento pago mais de uma vez, com identificadores de pagamento diferentes. Fornecedor e valor iguais, sozinhos, nunca confirmam.',
  'critico', '{"chaves_fortes":["documento","fornecedor","titulo_parcela","id_pagamento"]}', true, '3.0'),
 ('FIN_PAGAMENTO_INCORRETO', 'Pagamento incorreto',
  'Valor pago no banco diferente da soma dos títulos baixados; título cancelado ou renegociado com pagamento.', 'alto', '{}', true, '3.0'),
 ('FIN_JUROS_MULTA', 'Juros e multas',
  'Encargos no comprovante, pagamento após o vencimento com acréscimo e despesas lançadas em contas de multa/juros/mora.', 'alto', '{}', true, '3.0'),
 ('FIN_CREDITO_DESCONTO', 'Crédito, desconto ou devolução não aproveitados',
  'Pagou a mais (saldo negativo = crédito com o fornecedor) e não aparece abatimento posterior do mesmo fornecedor.', 'alto', '{}', true, '3.0'),
 ('FIN_INCONSISTENCIA_DADOS', 'Inconsistência de dados',
  'Título pago com saldo em aberto, parcela repetida (paga e/ou a pagar), comprovante repetido, centro de custo vazio, fornecedor com nomes diferentes.', 'atencao', '{}', true, '3.0')
on conflict (codigo) do update set nome = excluded.nome, descricao = excluded.descricao, severidade_padrao = excluded.severidade_padrao,
  versao = excluded.versao, ativo = true, atualizado_em = now();

insert into public.fin_agentes (codigo, nome, funcao, ordem, capacidades, ativo) values
 ('FIN_CRUZADOR', 'Cruzador Financeiro', 'Cruza Sallamo, títulos, fornecedores, valores, datas, comprovantes, boletos, PIX, autenticações, código de barras e OCR e encontra relações e possíveis problemas.', 10, '["fin_auditar"]', true),
 ('FIN_AUDITOR', 'Auditor Financeiro', 'Revisa as evidências, reduz falsos positivos (pagamento fracionado, PIX que paga vários títulos, comprovante repetido) e classifica cada ocorrência. Nunca transforma suspeita em prejuízo.', 20, '["fin_auditar"]', true),
 ('FIN_SENTINELA', 'Sentinela Financeiro', 'Prioriza valores relevantes, reincidências por fornecedor e situações que exigem ação antes do pagamento.', 30, '["fin_auditar"]', true),
 ('FIN_CEREBRO', 'Cérebro Executivo', 'Responde perguntas de gastos com a base inteira e perguntas de erros/perdas com as ocorrências, sempre com origem dos números e caminho até o lançamento.', 40, '["fin_consulta","fin_comparar","fin_resumo"]', true)
on conflict (codigo) do update set nome = excluded.nome, funcao = excluded.funcao, ordem = excluded.ordem,
  capacidades = excluded.capacidades, ativo = true, atualizado_em = now();

-- ============================================================================================================
-- 3. Motor de auditoria: Cruzador → Auditor → Sentinela
-- ============================================================================================================
-- Cada regra é um bloco da consulta abaixo, todos com as mesmas colunas:
--   chave, grupo, regra, titulo, motivo, classificacao, forca, fornecedor, documento, codigo_titulo, lancamentos,
--   valor_envolvido, impacto_estimado, impacto_comprovado, data_ref, evidencias, origem_ref
create or replace function public.fin_auditar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n integer; v_saiu integer; v_total integer;
begin
  perform fin_exige_servico();

  with comp as (select * from fin_comprovantes_v),
  -- ---------- DUPLICIDADE ----------
  -- D1. Banco/OCR: casos já cruzados pelo leitor de comprovantes bancários (código de barras, PIX, autenticação).
  d1 as (
    select 'DUP_BANCO:' || d.id as chave, 'FIN_DUPLICIDADE'::text as grupo, 'DUP_BANCO'::text as regra,
           case when d.nivel = 'PAGO_A_MAIS' then 'Mesmo documento pago ' || d.qtd || ' vezes no banco'
                else 'Pagamentos parecidos no banco — conferir' end as titulo,
           coalesce(d.prova, '') || ' · ' || d.qtd || ' pagamento(s) de ' || fin_brl(d.valor) ||
             case when d.nivel = 'SUSPEITA' then ' · mesmo fornecedor e valor não bastam: falta casar documento/título' else '' end as motivo,
           'SOB_ANALISE'::text as classificacao,
           case when d.nivel = 'PAGO_A_MAIS' then 'FORTE' else 'MEDIA' end as forca,
           d.fornecedor::text as fornecedor, d.documento::text as documento,
           (select string_agg(distinct t->>'codigo', ', ') from jsonb_array_elements(coalesce(d.titulos_sallamo, '[]')) t) as codigo_titulo,
           coalesce((select array_agg(distinct l.chave) from jsonb_array_elements(coalesce(d.titulos_sallamo, '[]')) t
                     join fin_base l on l.codigo = t->>'codigo'
                      and (t->>'pagamento' is null or l.data_pagamento = (t->>'pagamento')::date)), '{}'::text[]) as lancamentos,
           (d.valor * d.qtd)::numeric as valor_envolvido, d.valor_a_mais::numeric as impacto_estimado, null::numeric as impacto_comprovado,
           (select min(x) from unnest(d.datas) x) as data_ref,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'tipo', 'pagamento', 'lado', chr(65 + (p.ord - 1)::int), 'rotulo', 'Pagamento ' || chr(65 + (p.ord - 1)::int),
                       'forma', p.v->>'tipo', 'data', p.v->>'data', 'valor', (p.v->>'valor')::numeric,
                       'id_pagamento', coalesce(p.v->>'id_pix', p.v->'autenticacoes'->>0),
                       'codigo_barras', p.v->>'codigo_barras', 'favorecido', p.v->>'favorecido',
                       'arquivo_banco', p.v->>'arquivo', 'pagina', p.v->>'pagina',
                       'comprovante', coalesce((select jsonb_build_object('bucket', 'fin-comprovantes', 'path', c.arquivo_path, 'codigo', c.codigo, 'id', c.id)
                                       from comp c where c.autenticacao = any (select jsonb_array_elements_text(coalesce(p.v->'autenticacoes', '[]')))
                                          or (p.v->>'id_pix' is not null and c.observacao like '%' || (p.v->>'id_pix') || '%') limit 1),
                                       -- senão, a página do PDF do banco (S:) enviada por fin-evidencias-banco para este lado
                                       (select jsonb_build_object('bucket', e.storage_bucket, 'path', e.arquivo_path, 'origem', 'PDF do banco')
                                        from fin_evidencias e where e.ocorrencia_id = 'DUP-' || d.id and e.lado = chr(65 + (p.ord - 1)::int)
                                          and e.arquivo_path like 'banco/%' order by e.arquivo_path limit 1))
                     ) order by p.ord)
                     from jsonb_array_elements(coalesce(d.pagamentos, '[]')) with ordinality p(v, ord)), '[]'::jsonb)
           || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'comprovante', 'lado', e.lado, 'rotulo', 'Comprovante ' || e.lado,
                         'comprovante', jsonb_build_object('bucket', e.storage_bucket, 'path', e.arquivo_path), 'referencia', e.referencia))
                        from fin_evidencias e where e.ocorrencia_id = 'DUP-' || d.id and e.storage_bucket is not null
                          and e.arquivo_path not like 'banco/%'), '[]'::jsonb) as evidencias,
           ('DUP-' || d.id)::text as origem_ref
    from fin_duplicidade_comprovantes d
    where d.nivel in ('PAGO_A_MAIS', 'SUSPEITA')
  ),
  -- D2. Sallamo: a mesma parcela (título + vencimento + valor) aparece repetida.
  --     2+ pagas e 2+ autenticações (ou nenhum comprovante) = possível pagamento em dobro; senão é lançamento repetido.
  g2 as (
    select l.codigo, l.vencimento, l.valor_parcela, l.fornecedor_chave, min(l.fornecedor) fornecedor,
           array_agg(l.chave order by l.ordem) chaves, count(*) n,
           count(*) filter (where l.valor_pago > 0) pagas, count(*) filter (where l.em_aberto) abertas,
           min(l.data_pagamento) dt
    from fin_base l where l.situacao not in ('Cancelado', 'Renegociado')
    group by 1, 2, 3, 4 having count(*) > 1
  ),
  c2 as (
    select g.*, x.auts, case when g.pagas >= 2 and x.auts <> 1 then 'DUP_SALLAMO' else 'INC_PARCELA_REPETIDA' end as regra
    from g2 g cross join lateral (select count(distinct k.autenticacao) auts from comp k
                                  where k.codigo = g.codigo and k.vencimento = g.vencimento and abs(k.valor - g.valor_parcela) <= 0.01) x
  ),
  d2 as (
    select regra || ':' || codigo || '|' || vencimento || '|' || valor_parcela as chave,
           case when regra = 'DUP_SALLAMO' then 'FIN_DUPLICIDADE' else 'FIN_INCONSISTENCIA_DADOS' end as grupo,
           regra,
           case when pagas >= 2 and auts >= 2 then 'Mesma parcela paga ' || pagas || ' vezes (' || auts || ' autenticações diferentes)'
                when pagas >= 2 and auts = 0 then 'Mesma parcela paga ' || pagas || ' vezes no Sallamo, sem comprovante'
                when pagas >= 2 then 'Parcela lançada ' || n || ' vezes, só 1 pagamento comprovado'
                when pagas = 1 then 'Parcela repetida: uma paga e outra em aberto — risco de pagar de novo'
                else 'Parcela repetida em aberto — risco de pagar duas vezes' end as titulo,
           'Título ' || codigo || ', vencimento ' || to_char(vencimento, 'DD/MM/YYYY') || ', valor ' || fin_brl(valor_parcela) ||
             ' aparece ' || n || 'x no Sallamo (' || pagas || ' paga(s), ' || abertas || ' em aberto); comprovantes com autenticações distintas: ' || auts || '.' as motivo,
           'SOB_ANALISE'::text as classificacao,
           case when pagas >= 2 and auts >= 2 then 'FORTE' when pagas >= 2 and auts = 0 then 'MEDIA' when abertas > 0 then 'MEDIA' else 'FRACA' end as forca,
           fornecedor, null::text as documento, codigo as codigo_titulo, chaves as lancamentos, (valor_parcela * n)::numeric as valor_envolvido,
           case when regra = 'DUP_SALLAMO' then valor_parcela * (pagas - 1) end::numeric as impacto_estimado, null::numeric as impacto_comprovado,
           coalesce(dt, vencimento) as data_ref,
           coalesce((select jsonb_agg(jsonb_build_object('tipo', 'comprovante', 'rotulo', 'Comprovante ' || to_char(k.data_pagamento, 'DD/MM/YYYY'),
                       'data', k.data_pagamento, 'valor', k.valor, 'id_pagamento', k.autenticacao, 'favorecido', k.favorecido,
                       'comprovante', jsonb_build_object('bucket', 'fin-comprovantes', 'path', k.arquivo_path, 'id', k.id)) order by k.data_pagamento, k.id)
                     from comp k where k.codigo = c2.codigo and k.vencimento = c2.vencimento), '[]'::jsonb) as evidencias,
           null::text as origem_ref
    from c2
  ),
  -- D3. Comprovantes: para o mesmo título, a soma dos pagamentos comprovados passa do que o Sallamo diz que foi pago.
  k3 as (
    select codigo, vencimento, sum(valor) soma, count(*) qtd, min(fornecedor) fornecedor,
           jsonb_agg(jsonb_build_object('tipo', 'comprovante', 'rotulo', 'Comprovante ' || to_char(data_pagamento, 'DD/MM/YYYY'),
                     'data', data_pagamento, 'valor', valor, 'id_pagamento', autenticacao, 'favorecido', favorecido,
                     'comprovante', jsonb_build_object('bucket', 'fin-comprovantes', 'path', arquivo_path, 'id', id)) order by data_pagamento, id) ev
    from (select distinct on (codigo, vencimento, coalesce(autenticacao, id::text)) * from comp
          order by codigo, vencimento, coalesce(autenticacao, id::text), id) u
    group by 1, 2 having count(*) > 1
  ),
  s3 as (select codigo, vencimento, sum(valor_pago) pago, array_agg(chave) chaves from fin_base group by 1, 2),
  d3 as (
    select 'DUP_COMPROVANTE:' || k.codigo || '|' || k.vencimento, 'FIN_DUPLICIDADE', 'DUP_COMPROVANTE',
           k.qtd || ' pagamentos comprovados para o mesmo título',
           'Comprovantes somam ' || fin_brl(k.soma) || ' com autenticações diferentes; o Sallamo registra ' ||
             fin_brl(s.pago) || ' pago para o título ' || k.codigo || '.',
           'SOB_ANALISE', 'FORTE', k.fornecedor::text, null::text, k.codigo::text, s.chaves, k.soma::numeric, (k.soma - s.pago)::numeric, null::numeric,
           k.vencimento, k.ev, null::text
    from k3 k join s3 s using (codigo, vencimento)
    where k.soma > s.pago + 0.01
      and not exists (select 1 from d2 where d2.regra = 'DUP_SALLAMO' and d2.codigo_titulo = k.codigo)
  ),
  -- ---------- PAGAMENTO INCORRETO ----------
  -- P1. Um pagamento no banco (autenticação) baixou títulos que somam valor diferente do que saiu da conta.
  a1 as (
    select autenticacao, max(valor_banco) banco, sum(valor) titulos, count(*) n, min(fornecedor) fornecedor,
           min(data_pagamento) dt, array_agg(distinct codigo) codigos,
           jsonb_agg(jsonb_build_object('tipo', 'comprovante', 'rotulo', 'Título ' || codigo, 'valor', valor, 'id_pagamento', autenticacao,
                     'comprovante', jsonb_build_object('bucket', 'fin-comprovantes', 'path', arquivo_path, 'id', id))) ev
    from (select distinct on (autenticacao, codigo, vencimento) * from comp where autenticacao is not null
          order by autenticacao, codigo, vencimento, id) u
    group by 1 having max(valor_banco) is not null
  ),
  p1 as (
    select 'PAG_LOTE:' || autenticacao, 'FIN_PAGAMENTO_INCORRETO', 'PAG_LOTE',
           case when banco > titulos then 'Banco pagou mais do que os títulos baixados' else 'Títulos baixados somam mais do que o pagamento' end,
           'Autenticação ' || autenticacao || ': saiu ' || fin_brl(banco) || ' do banco e os ' || n ||
             ' título(s) ligados somam ' || fin_brl(titulos) || ' (diferença ' || fin_brl(abs(banco - titulos)) || ').',
           'SOB_ANALISE', 'MEDIA', fornecedor::text, autenticacao::text, array_to_string(codigos, ', '),
           coalesce((select array_agg(l.chave) from fin_base l where l.codigo = any (codigos)), '{}'::text[]),
           greatest(banco, titulos)::numeric, case when banco > titulos then banco - titulos end::numeric, null::numeric, dt, ev, null::text
    from a1 where abs(banco - titulos) > 0.05
  ),
  -- P2. Título cancelado ou renegociado que mesmo assim tem pagamento.
  p2 as (
    select 'PAG_SITUACAO:' || l.chave, 'FIN_PAGAMENTO_INCORRETO', 'PAG_SITUACAO',
           'Título ' || lower(l.situacao) || ' com pagamento',
           'Título ' || l.codigo || ' está "' || l.situacao || '" no Sallamo, mas tem ' || fin_brl(l.valor_pago) ||
             ' pago' || case when l.situacao = 'Renegociado' then ' (pode ser a entrada do acordo — conferir).' else '.' end,
           'SOB_ANALISE', case when l.situacao = 'Cancelado' then 'MEDIA' else 'FRACA' end,
           l.fornecedor, null::text, l.codigo, array[l.chave], l.valor_pago::numeric,
           case when l.situacao = 'Cancelado' then l.valor_pago end::numeric, null::numeric, coalesce(l.data_pagamento, l.vencimento), '[]'::jsonb, null::text
    from fin_base l where l.situacao in ('Cancelado', 'Renegociado') and l.valor_pago > 0
  ),
  -- ---------- JUROS E MULTAS ----------
  -- J1. O comprovante do banco mostra encargos: fato comprovado (irregularidade confirmada; prejuízo só com decisão humana).
  j1 as (
    select 'JUROS_COMPROVANTE:' || c.id, 'FIN_JUROS_MULTA', 'JUROS_COMPROVANTE', 'Encargos pagos (comprovante bancário)',
           'O comprovante do título ' || c.codigo || ' mostra encargos de ' || fin_brl(c.encargos) || '.',
           'IRREGULARIDADE_CONFIRMADA', 'FORTE', c.fornecedor::text, c.codigo_barras, c.codigo::text,
           coalesce((select array_agg(l.chave) from fin_base l where l.codigo = c.codigo and l.vencimento = c.vencimento), '{}'::text[]) as lancamentos,
           c.valor::numeric, c.encargos, c.encargos, c.data_pagamento,
           jsonb_build_array(jsonb_build_object('tipo', 'comprovante', 'rotulo', 'Comprovante', 'valor', c.valor, 'id_pagamento', c.autenticacao,
             'comprovante', jsonb_build_object('bucket', 'fin-comprovantes', 'path', c.arquivo_path, 'id', c.id))), null::text
    from comp c where c.encargos > 0
  ),
  -- J2. Pago depois do vencimento e a mais: provável juros/multa (sem comprovante dizendo, fica sob análise).
  j2 as (
    select 'JUROS_ATRASO:' || l.chave, 'FIN_JUROS_MULTA', 'JUROS_ATRASO', 'Pago com atraso e com acréscimo',
           'Venceu em ' || to_char(l.vencimento, 'DD/MM/YYYY') || ', pago em ' || to_char(l.data_pagamento, 'DD/MM/YYYY') ||
             ' (' || (l.data_pagamento - l.vencimento) || ' dias depois): parcela ' || fin_brl(l.valor_parcela) ||
             ', pago ' || fin_brl(l.valor_pago) || '.',
           'SOB_ANALISE', 'MEDIA', l.fornecedor, null::text, l.codigo, array[l.chave], l.valor_pago::numeric, (l.valor_pago - l.valor_parcela)::numeric,
           null::numeric, l.data_pagamento, '[]'::jsonb, null::text
    from fin_base l
    where l.tipo = 'DESPESA' and l.valor_pago > l.valor_parcela + 1 and l.data_pagamento > l.vencimento
      and not exists (select 1 from j1 where l.chave = any (j1.lancamentos))
  ),
  -- J3. A própria contabilidade classifica como multa/juros/mora: despesa confirmada pelo lançamento.
  --     "FGTS - Multa Rescisória" fica fora: é obrigação legal na demissão, não penalidade por atraso/erro.
  j3 as (
    select 'JUROS_CONTA:' || l.chave, 'FIN_JUROS_MULTA', 'JUROS_CONTA', 'Despesa lançada como multa/juros',
           'Lançado na conta "' || l.conta_contabil || '": ' || fin_brl(l.valor_pago) || ' pago.',
           'IRREGULARIDADE_CONFIRMADA', 'FORTE', l.fornecedor, null::text, l.codigo, array[l.chave], l.valor_pago::numeric, l.valor_pago::numeric,
           l.valor_pago::numeric, l.data_pagamento, '[]'::jsonb, null::text
    from fin_base l
    where l.tipo = 'DESPESA' and l.valor_pago > 0 and fin_norm(l.conta_contabil) ~ '(^| )(MULTAS?|JUROS|MORAS?)( |$)'
      and fin_norm(l.conta_contabil) !~ '(FGTS|RECIS)'
  ),
  -- ---------- CRÉDITO / DESCONTO / DEVOLUÇÃO NÃO APROVEITADOS ----------
  -- C1. Pagou a mais em dia (saldo negativo = crédito com o fornecedor) e não houve abatimento depois.
  cred as (
    select l.*, l.valor_pago - l.valor_parcela as credito from fin_base l
    where l.tipo = 'DESPESA' and l.valor_pago > l.valor_parcela + 1 and (l.data_pagamento is null or l.data_pagamento <= l.vencimento)
  ),
  ab as (
    select c.chave, coalesce(sum(o.valor_parcela - o.valor_pago), 0) abatido
    from cred c left join fin_base o
      on o.fornecedor_chave = c.fornecedor_chave and o.situacao = 'Pago' and o.valor_pago < o.valor_parcela - 0.01
     and o.data_pagamento >= coalesce(c.data_pagamento, c.vencimento)
    group by c.chave
  ),
  c1 as (
    select 'CREDITO:' || c.chave, 'FIN_CREDITO_DESCONTO', 'CREDITO_NAO_USADO', 'Pago a mais sem abatimento posterior',
           'Parcela ' || fin_brl(c.valor_parcela) || ', pago ' || fin_brl(c.valor_pago) ||
             ' (crédito de ' || fin_brl(c.credito) || '); abatimentos posteriores do mesmo fornecedor: ' ||
             fin_brl(ab.abatido) || '.',
           'SOB_ANALISE', 'MEDIA', c.fornecedor, null::text, c.codigo, array[c.chave], c.valor_pago::numeric, (c.credito - ab.abatido)::numeric,
           null::numeric, coalesce(c.data_pagamento, c.vencimento), '[]'::jsonb, null::text
    from cred c join ab using (chave) where c.credito - ab.abatido > 1
  ),
  -- ---------- INCONSISTÊNCIA DE DADOS ----------
  -- Pago com até metade da parcela em aberto é desconto/abatimento (bom para a empresa), não erro: só sinaliza abaixo de 50%.
  i1 as (
    select 'INC_PAGO_COM_SALDO:' || l.chave, 'FIN_INCONSISTENCIA_DADOS', 'INC_PAGO_COM_SALDO', 'Título "Pago" com saldo em aberto',
           'Status Pago, mas parcela ' || fin_brl(l.valor_parcela) || ' e pago ' || fin_brl(l.valor_pago) ||
             ': saldo de ' || fin_brl(l.saldo) || ' sem explicação.',
           'SOB_ANALISE', 'MEDIA', l.fornecedor, null::text, l.codigo, array[l.chave], l.saldo::numeric, null::numeric, null::numeric,
           coalesce(l.data_pagamento, l.vencimento), '[]'::jsonb, null::text
    from fin_base l where l.situacao = 'Pago' and l.saldo > 1 and l.valor_pago < l.valor_parcela * 0.5
  ),
  i2 as (
    select 'INC_SEM_CENTRO:' || l.chave, 'FIN_INCONSISTENCIA_DADOS', 'INC_SEM_CENTRO', 'Lançamento sem centro de custo',
           'Título ' || l.codigo || ' sem centro de custo: o gasto não aparece em nenhuma loja/área.',
           'SOB_ANALISE', 'FRACA', l.fornecedor, null::text, l.codigo, array[l.chave], coalesce(nullif(l.valor_pago, 0), l.valor_parcela)::numeric,
           null::numeric, null::numeric, coalesce(l.data_pagamento, l.vencimento), '[]'::jsonb, null::text
    from fin_base l where l.centro_custo is null
  ),
  i3 as (
    select 'INC_COMPROVANTE_REPETIDO:' || codigo || '|' || vencimento || '|' || autenticacao, 'FIN_INCONSISTENCIA_DADOS', 'INC_COMPROVANTE_REPETIDO',
           'Mesmo comprovante enviado ' || count(*) || ' vezes',
           'Autenticação ' || autenticacao || ' anexada ' || count(*) || 'x ao título ' || codigo || ' (não é pagamento em dobro).',
           'SOB_ANALISE', 'FRACA', min(fornecedor)::text, autenticacao, codigo::text,
           coalesce((select array_agg(l.chave) from fin_base l where l.codigo = c.codigo and l.vencimento = c.vencimento), '{}'::text[]),
           min(valor)::numeric, null::numeric, null::numeric, vencimento, '[]'::jsonb, null::text
    from comp c where autenticacao is not null group by codigo, vencimento, autenticacao having count(*) > 1
  ),
  i4 as (
    select 'INC_FORNECEDOR_NOMES:' || fornecedor_chave, 'FIN_INCONSISTENCIA_DADOS', 'INC_FORNECEDOR_NOMES',
           'Mesmo fornecedor com ' || count(distinct fornecedor) || ' nomes',
           'Nomes: ' || string_agg(distinct fornecedor, ' | ') || '. Atrapalha somar o gasto por fornecedor e esconder duplicidade.',
           'SOB_ANALISE', 'FRACA', min(fornecedor), null::text, null::text, '{}'::text[], sum(valor_pago)::numeric, null::numeric, null::numeric,
           max(data_pagamento), '[]'::jsonb, null::text
    from fin_base where fornecedor_chave is not null group by fornecedor_chave having count(distinct fornecedor) > 1
  ),
  ach as (
    select * from d1 union all select * from d2 union all select * from d3 union all select * from p1 union all select * from p2
    union all select * from j1 union all select * from j2 union all select * from j3 union all select * from c1
    union all select * from i1 union all select * from i2 union all select * from i3 union all select * from i4
  ),
  -- ---------- AUDITOR: grava sem nunca desfazer decisão humana ----------
  gravado as (
    insert into fin_ocorrencias as o (chave, grupo, regra, titulo, motivo, classificacao, forca, fornecedor, fornecedor_chave, documento,
                                      codigo_titulo, lancamentos, valor_envolvido, impacto_estimado, impacto_comprovado, data_ref, evidencias,
                                      origem_ref, ativo, visto_em, atualizado_em)
    select a.chave, a.grupo, a.regra, a.titulo, a.motivo, a.classificacao, a.forca, a.fornecedor, fin_chave_fornecedor(a.fornecedor), a.documento,
           a.codigo_titulo, coalesce(a.lancamentos, '{}'), round(a.valor_envolvido, 2), round(a.impacto_estimado, 2), round(a.impacto_comprovado, 2),
           a.data_ref, coalesce(a.evidencias, '[]'), a.origem_ref, true, now(), now()
    from (select distinct on (chave) * from ach order by chave) a
    on conflict (chave) do update set
      grupo = excluded.grupo, regra = excluded.regra, titulo = excluded.titulo, motivo = excluded.motivo, forca = excluded.forca,
      fornecedor = excluded.fornecedor, fornecedor_chave = excluded.fornecedor_chave, documento = excluded.documento,
      codigo_titulo = excluded.codigo_titulo, lancamentos = excluded.lancamentos, valor_envolvido = excluded.valor_envolvido,
      impacto_estimado = excluded.impacto_estimado, data_ref = excluded.data_ref, evidencias = excluded.evidencias, origem_ref = excluded.origem_ref,
      ativo = true, visto_em = now(), atualizado_em = now(),
      -- classificação e impacto comprovado só mudam pelo motor enquanto ninguém decidiu
      classificacao = case when o.status_revisao in ('DECIDIDO', 'RESOLVIDO') then o.classificacao else excluded.classificacao end,
      impacto_comprovado = case when o.status_revisao in ('DECIDIDO', 'RESOLVIDO') then o.impacto_comprovado else excluded.impacto_comprovado end
    returning 1
  )
  select count(*) into v_n from gravado;

  -- O que o motor não encontrou mais e ninguém decidiu sai da Caixa de Revisão (fica no histórico, ativo = false).
  update fin_ocorrencias o set ativo = false, atualizado_em = now()
   where o.ativo and o.status_revisao in ('ABERTO', 'REVISAR_DEPOIS') and o.visto_em is distinct from now();
  get diagnostics v_saiu = row_count;

  -- ---------- SENTINELA: pontua e prioriza ----------
  -- Valor pesa mais que tudo: encargo de R$ 18 confirmado não passa na frente de duplicidade de R$ 23 mil.
  with r as (select fornecedor_chave, count(*) n from fin_ocorrencias where ativo and fornecedor_chave is not null
             and classificacao <> 'NORMAL' group by 1)
  update fin_ocorrencias o set
    pontos = p.pts,
    prioridade = case when p.pts >= 60 then 'ALTA' when p.pts >= 35 then 'MEDIA' else 'BAIXA' end
  from (
    select o2.id,
      (case when v >= 50000 then 45 when v >= 10000 then 35 when v >= 1000 then 20 when v > 0 then 5 else 0 end)
      + (case o2.forca when 'FORTE' then 25 when 'MEDIA' then 10 else 0 end)
      + (case when coalesce(r.n, 0) >= 3 then 15 else 0 end)
      -- exige ação antes de pagar: título repetido ainda em aberto
      + (case when o2.regra = 'INC_PARCELA_REPETIDA' and exists (select 1 from fin_base l where l.chave = any (o2.lancamentos) and l.em_aberto) then 30 else 0 end)
      as pts
    -- cadastro (nome de fornecedor, centro de custo) não põe dinheiro em risco: não pontua por valor
    from (select o3.*, case when o3.regra in ('INC_FORNECEDOR_NOMES', 'INC_SEM_CENTRO') then 0
                            else coalesce(o3.impacto_comprovado, o3.impacto_estimado, o3.valor_envolvido, 0) end v
          from fin_ocorrencias o3 where o3.ativo) o2
    left join r on r.fornecedor_chave = o2.fornecedor_chave
  ) p where p.id = o.id;

  select count(*) into v_total from fin_ocorrencias where ativo;
  return jsonb_build_object('ok', true, 'ocorrencias_ativas', v_total, 'encontradas', v_n, 'sairam', v_saiu, 'em', now());
end $$;

-- Processamento: carga nova do Sallamo → base + auditoria. Roda a cada 10 minutos pelo pg_cron, fora da gravação da
-- Edge Function (a recarga leva ~30 s com a base real; dentro do insert travaria a Edge Function).
create table if not exists public.fin_processamento (
  id smallint primary key default 1 check (id = 1),
  ultima_carga timestamptz, processado_em timestamptz, resultado jsonb
);
alter table public.fin_processamento enable row level security;
create policy fin_processamento_ler on public.fin_processamento for select to authenticated using ((select public.fin_pode_auditar()));

create or replace function public.fin_processar(p_forcar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_carga timestamptz; v_ult timestamptz; r1 jsonb; r2 jsonb;
begin
  perform fin_exige_servico();
  select max(recebido_em) into v_carga from fin_sallamo_cache;
  select ultima_carga into v_ult from fin_processamento where id = 1;
  if not p_forcar and v_carga is not distinct from v_ult then
    return jsonb_build_object('ok', true, 'nada_novo', true, 'ultima_carga', v_ult);
  end if;
  r1 := fin_recarregar_base();
  r2 := fin_auditar();
  insert into fin_processamento (id, ultima_carga, processado_em, resultado) values (1, v_carga, now(), jsonb_build_object('base', r1, 'auditoria', r2))
  on conflict (id) do update set ultima_carga = excluded.ultima_carga, processado_em = excluded.processado_em, resultado = excluded.resultado;
  return jsonb_build_object('ok', true, 'base', r1, 'auditoria', r2);
end $$;

create or replace trigger fin_cache_antes before insert on public.fin_sallamo_cache for each row execute function public.fin_cache_antes();
select cron.schedule('fin-processar', '*/10 * * * *', 'select public.fin_processar()');

-- ============================================================================================================
-- 4. Caixa de Revisão: decisão humana
-- ============================================================================================================
create or replace function public.fin_decidir(p_id bigint, p_decisao text, p_observacao text,
                                              p_valor numeric default null, p_evidencias jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare o fin_ocorrencias; v_user text; v_dec text := upper(trim(coalesce(p_decisao, ''))); v_nova text; v_status text; v_imp numeric; v_rec numeric;
begin
  if not fin_pode_auditar() then raise exception 'Sem permissão para decidir na Auditoria Financeira'; end if;
  if v_dec not in ('CONFIRMAR_IRREGULARIDADE', 'NAO_E_IRREGULARIDADE', 'REVISAR_DEPOIS', 'RESOLVIDO') then
    raise exception 'Decisão inválida: use CONFIRMAR_IRREGULARIDADE, NAO_E_IRREGULARIDADE, REVISAR_DEPOIS ou RESOLVIDO';
  end if;
  if length(trim(coalesce(p_observacao, ''))) < 5 then raise exception 'Escreva uma observação explicando a decisão'; end if;
  select coalesce(email, id::text) into v_user from auth.users where id = auth.uid();
  if v_user is null then raise exception 'Usuário não identificado'; end if;
  select * into o from fin_ocorrencias where id = p_id for update;
  if not found then raise exception 'Ocorrência % não encontrada', p_id; end if;

  v_imp := o.impacto_comprovado; v_rec := o.valor_recuperado;
  if v_dec = 'CONFIRMAR_IRREGULARIDADE' then
    -- Prejuízo = irregularidade confirmada + impacto financeiro comprovado pela pessoa que decidiu.
    v_imp := coalesce(p_valor, o.impacto_comprovado);
    if v_imp is not null and v_imp < 0 then raise exception 'Impacto não pode ser negativo'; end if;
    v_nova := case when coalesce(v_imp, 0) > 0 then 'PREJUIZO_CONFIRMADO' else 'IRREGULARIDADE_CONFIRMADA' end;
    v_status := 'DECIDIDO';
  elsif v_dec = 'NAO_E_IRREGULARIDADE' then v_nova := 'NORMAL'; v_status := 'DECIDIDO'; v_imp := null;
  elsif v_dec = 'REVISAR_DEPOIS' then v_nova := o.classificacao; v_status := 'REVISAR_DEPOIS';
  else v_nova := o.classificacao; v_status := 'RESOLVIDO'; v_rec := coalesce(p_valor, o.valor_recuperado);
  end if;

  update fin_ocorrencias set classificacao = v_nova, status_revisao = v_status, impacto_comprovado = v_imp, valor_recuperado = v_rec,
         decidido_por = v_user, decidido_em = now(), observacao = trim(p_observacao), atualizado_em = now()
   where id = p_id;

  insert into fin_decisoes (ocorrencia_id, decisao, classificacao_anterior, classificacao_nova, impacto_comprovado, valor_recuperado,
                            observacao, evidencias, usuario)
  values (p_id, v_dec, o.classificacao, v_nova, v_imp, v_rec, trim(p_observacao),
          jsonb_build_object('vistas', o.evidencias, 'anexadas', coalesce(p_evidencias, '[]'), 'motivo', o.motivo,
                             'valor_envolvido', o.valor_envolvido, 'impacto_estimado', o.impacto_estimado), v_user);

  -- Mantém a tela antiga de duplicidades coerente
  if o.origem_ref like 'DUP-%' and v_dec <> 'REVISAR_DEPOIS' then
    update fin_duplicidade_comprovantes set
      revisao_status = case v_dec when 'CONFIRMAR_IRREGULARIDADE' then 'confirmada' when 'NAO_E_IRREGULARIDADE' then 'nao_duplicidade' else 'resolvido' end,
      revisao_observacao = trim(p_observacao), revisado_por = v_user, revisado_em = now()
     where id = substring(o.origem_ref from 5)::bigint;
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'classificacao', v_nova, 'status', v_status, 'por', v_user);
end $$;

-- ============================================================================================================
-- 5. Inteligência financeira (consultas com drill-down). Funções SECURITY INVOKER: o RLS vale para quem chama.
-- ============================================================================================================
create or replace function public.fin_cobertura() returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'lancamentos', count(*),
    'vencimento_de', min(vencimento), 'vencimento_ate', max(vencimento),
    'pagamento_de', min(data_pagamento), 'pagamento_ate', max(data_pagamento),
    'carga_em', max(carga_em), 'cargas', (select jsonb_agg(distinct carga_id) from fin_base),
    'comprovantes', (select count(*) from fin_comprovantes where not substituido),
    'pagos_com_comprovante', (select count(*) from fin_base l where l.valor_pago > 0
                              and exists (select 1 from fin_comprovantes k where not k.substituido and k.codigo = l.codigo and k.vencimento = l.vencimento)),
    'pagos', count(*) filter (where valor_pago > 0),
    'base_completa_desde', (select min(m)::date from (select date_trunc('month', vencimento) m, count(*) n from fin_base group by 1) x where n >= 1000),
    'aviso', 'Pagamentos só existem na base a partir de ' || coalesce(to_char(min(data_pagamento), 'DD/MM/YYYY'), '—') ||
             ' e até ' || coalesce(to_char(max(data_pagamento), 'DD/MM/YYYY'), '—') || '. Fora disso não há dado (não é zero).' ||
             coalesce(' Por vencimento, a base é completa a partir de ' ||
               (select to_char(min(m), 'MM/YYYY') from (select date_trunc('month', vencimento) m, count(*) n from fin_base group by 1) x
                where n >= 1000) || '; antes disso há só alguns títulos.', '')
  ) from fin_base
$$;

-- Filtro comum. p: {de, ate, base: pagamento|vencimento|competencia, fornecedor, conta, centro, situacao, busca, tipo, codigo}
create or replace function public.fin_filtrar(p jsonb) returns setof public.fin_lancamentos language sql stable set search_path = public as $$
  select l.* from fin_base l
  where l.tipo = coalesce(nullif(upper(p->>'tipo'), ''), 'DESPESA')
    and (coalesce(p->>'base', 'pagamento') <> 'pagamento' or l.valor_pago > 0)
    and (nullif(p->>'de', '') is null or
         (case coalesce(p->>'base', 'pagamento') when 'vencimento' then l.vencimento when 'competencia' then l.competencia else l.data_pagamento end) >= (p->>'de')::date)
    and (nullif(p->>'ate', '') is null or
         (case coalesce(p->>'base', 'pagamento') when 'vencimento' then l.vencimento when 'competencia' then l.competencia else l.data_pagamento end) <= (p->>'ate')::date)
    and (nullif(p->>'fornecedor', '') is null or fin_norm(l.fornecedor) like '%' || fin_norm(p->>'fornecedor') || '%')
    and (nullif(p->>'conta', '') is null or fin_norm(l.conta_contabil) like '%' || fin_norm(p->>'conta') || '%')
    and (nullif(p->>'centro', '') is null or fin_norm(l.centro_custo) like '%' || fin_norm(p->>'centro') || '%')
    and (nullif(p->>'situacao', '') is null or fin_norm(l.situacao) = fin_norm(p->>'situacao'))
    and (nullif(p->>'codigo', '') is null or l.codigo = p->>'codigo')
    -- drill-down da tela: valor exato do grupo clicado ("" = vazio)
    and (not p ? 'fornecedor_exato' or coalesce(l.fornecedor, '') = p->>'fornecedor_exato')
    and (not p ? 'conta_exata' or coalesce(l.conta_contabil, '') = p->>'conta_exata')
    and (not p ? 'centro_exato' or coalesce(l.centro_custo, '') = p->>'centro_exato')
    and (nullif(p->>'busca', '') is null or not exists (
           select 1 from regexp_split_to_table(fin_norm(p->>'busca'), ' ') w
           where length(w) > 1 and fin_norm(concat_ws(' ', l.fornecedor, l.conta_contabil, l.centro_custo, l.codigo)) !~ ('(^| )' || w)))
$$;

-- Total → grupos → lançamentos. Situação de auditoria de cada lançamento = pior classificação das ocorrências ativas.
create or replace function public.fin_consulta(p jsonb default '{}') returns jsonb language plpgsql stable set search_path = public as $$
declare v_base text := coalesce(nullif(p->>'base', ''), 'pagamento'); v_dim text := coalesce(nullif(p->>'agrupar', ''), 'fornecedor');
        v_lim int := least(coalesce((p->>'limite')::int, 50), 500); r jsonb;
begin
  if v_dim not in ('fornecedor', 'conta', 'centro', 'situacao', 'mes', 'dia', 'nenhum') then v_dim := 'fornecedor'; end if;
  with f as (select * from fin_filtrar(p)),
  val as (select f.*, case when v_base = 'pagamento' then f.valor_pago else f.valor_parcela end as valor,
                 case v_base when 'vencimento' then f.vencimento when 'competencia' then f.competencia else f.data_pagamento end as dref from f),
  tot as (select count(*) n, sum(valor) valor, sum(valor_pago) pago, sum(valor_parcela) parcela,
                 sum(saldo) filter (where em_aberto) aberto, sum(saldo) filter (where situacao = 'Vencido') vencido,
                 count(distinct fornecedor_chave) fornecedores from val),
  g as (select case v_dim when 'fornecedor' then fornecedor when 'conta' then conta_contabil when 'centro' then centro_custo
                          when 'situacao' then situacao when 'mes' then to_char(dref, 'YYYY-MM') when 'dia' then dref::text else 'Total' end as grupo,
               count(*) n, sum(valor) valor, sum(valor_pago) pago, sum(saldo) filter (where em_aberto) aberto
        from val group by 1),
  oc as (select unnest(lancamentos) chave, classificacao from fin_ocorrencias where ativo and classificacao <> 'NORMAL'),
  ocl as (select chave, (array_agg(classificacao order by case classificacao when 'PREJUIZO_CONFIRMADO' then 1
            when 'IRREGULARIDADE_CONFIRMADA' then 2 else 3 end))[1] classificacao, count(*) n from oc group by chave)
  select jsonb_build_object(
    'pergunta_entendida', jsonb_build_object('base', v_base, 'agrupar', v_dim, 'filtros', p - 'limite' - 'agrupar' - 'base'),
    'definicao', case v_base when 'pagamento' then 'Valor pago, pela data do pagamento (caixa).'
                             when 'vencimento' then 'Valor da parcela, pela data de vencimento (inclui pago e a pagar).'
                             else 'Valor da parcela, pela competência.' end
                 || ' Só despesas: receitas ficam fora. Renegociado/Cancelado não entram no saldo a pagar.',
    'totais', (select jsonb_build_object('lancamentos', n, 'valor', coalesce(valor, 0), 'valor_pago', coalesce(pago, 0),
                 'valor_parcela', coalesce(parcela, 0), 'saldo_em_aberto', coalesce(aberto, 0), 'vencido_em_aberto', coalesce(vencido, 0),
                 'fornecedores', fornecedores) from tot),
    'grupos', coalesce((select jsonb_agg(jsonb_build_object('grupo', coalesce(grupo, '(vazio)'), 'lancamentos', n, 'valor', valor,
                 'valor_pago', pago, 'saldo_em_aberto', coalesce(aberto, 0),
                 'pct', case when (select valor from tot) > 0 then round(100 * valor / (select valor from tot), 1) end)
                 order by case when v_dim in ('mes', 'dia') then null else valor end desc nulls last, grupo)
               from (select * from g order by case when v_dim in ('mes', 'dia') then null else valor end desc nulls last, grupo limit v_lim) g2), '[]'),
    'lancamentos', coalesce((select jsonb_agg(jsonb_build_object('chave', v.chave, 'codigo', v.codigo, 'fornecedor', v.fornecedor,
                 'conta', v.conta_contabil, 'centro', v.centro_custo, 'competencia', v.competencia, 'vencimento', v.vencimento,
                 'data_pagamento', v.data_pagamento, 'valor_parcela', v.valor_parcela, 'valor_pago', v.valor_pago, 'saldo', v.saldo,
                 'situacao', v.situacao, 'auditoria', coalesce(o.classificacao, 'NORMAL'), 'ocorrencias', coalesce(o.n, 0)) order by v.valor desc, v.chave)
               from (select * from val order by valor desc, chave limit least(coalesce((p->>'limite_lancamentos')::int, 100), 1000)) v
               left join ocl o on o.chave = v.chave), '[]'),
    'cobertura', fin_cobertura(),
    'origem', 'Sallamo · contas a pagar (fin_lancamentos), carga de ' ||
              coalesce((select to_char(max(carga_em) at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') from fin_base), '—')
  ) into r;
  return r;
end $$;

-- Comparação de períodos: aumentos anormais, novos, concentração. p: {a_de, a_ate, b_de, b_ate, base, agrupar, + filtros}
create or replace function public.fin_comparar(p jsonb default '{}') returns jsonb language plpgsql stable set search_path = public as $$
declare v_b_ate date := coalesce(nullif(p->>'b_ate', '')::date, (date_trunc('month', current_date) - interval '1 day')::date);
        v_b_de date := coalesce(nullif(p->>'b_de', '')::date, date_trunc('month', v_b_ate)::date);
        v_a_ate date := coalesce(nullif(p->>'a_ate', '')::date, (v_b_de - 1));
        v_a_de date := coalesce(nullif(p->>'a_de', '')::date, date_trunc('month', v_a_ate)::date);
        v_dim text := coalesce(nullif(p->>'agrupar', ''), 'fornecedor'); r jsonb;
begin
  if v_dim not in ('fornecedor', 'conta', 'centro') then v_dim := 'fornecedor'; end if;
  with a as (select coalesce(case v_dim when 'fornecedor' then fornecedor when 'conta' then conta_contabil else centro_custo end, '(vazio)') g,
                    sum(case when coalesce(p->>'base', 'pagamento') = 'pagamento' then valor_pago else valor_parcela end) v
             from fin_filtrar(p || jsonb_build_object('de', v_a_de, 'ate', v_a_ate)) group by 1),
       b as (select coalesce(case v_dim when 'fornecedor' then fornecedor when 'conta' then conta_contabil else centro_custo end, '(vazio)') g,
                    sum(case when coalesce(p->>'base', 'pagamento') = 'pagamento' then valor_pago else valor_parcela end) v
             from fin_filtrar(p || jsonb_build_object('de', v_b_de, 'ate', v_b_ate)) group by 1),
       j as (select coalesce(a.g, b.g) g, coalesce(a.v, 0) va, coalesce(b.v, 0) vb from a full join b on a.g = b.g),
       t as (select sum(va) ta, sum(vb) tb from j),
       k as (select j.*, vb - va dif, case when va > 0 then round(100 * (vb - va) / va, 1) end pct,
                    case when va = 0 and vb >= 10000 then 'NOVO' when vb = 0 and va >= 10000 then 'SUMIU'
                         when va > 0 and vb >= va * 1.5 and vb - va >= 10000 then 'AUMENTO_ANORMAL'
                         when va > 0 and vb <= va * 0.5 and va - vb >= 10000 then 'QUEDA_FORTE' end alerta
             from j)
  select jsonb_build_object(
    'periodo_a', jsonb_build_object('de', v_a_de, 'ate', v_a_ate, 'total', (select ta from t)),
    'periodo_b', jsonb_build_object('de', v_b_de, 'ate', v_b_ate, 'total', (select tb from t)),
    'variacao', (select tb - ta from t), 'variacao_pct', (select case when ta > 0 then round(100 * (tb - ta) / ta, 1) end from t),
    'agrupar', v_dim,
    'alertas', coalesce((select jsonb_agg(jsonb_build_object('grupo', g, 'a', va, 'b', vb, 'diferenca', dif, 'pct', pct, 'alerta', alerta) order by abs(dif) desc)
                         from k where alerta is not null), '[]'),
    'maiores_variacoes', coalesce((select jsonb_agg(x order by abs((x->>'diferenca')::numeric) desc) from (select jsonb_build_object('grupo', g, 'a', va, 'b', vb,
                         'diferenca', dif, 'pct', pct) x from k order by abs(dif) desc limit 20) y), '[]'),
    'concentracao_top5_pct', (select round(100 * sum(vb) / nullif((select tb from t), 0), 1) from (select vb from k order by vb desc limit 5) z),
    'cobertura', fin_cobertura(),
    'origem', 'Sallamo · contas a pagar (fin_lancamentos)'
  ) into r;
  return r;
end $$;

-- Resumo executivo: gasto, a pagar, auditoria (separando suspeita de fato) e prioridades da Sentinela.
create or replace function public.fin_resumo() returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'gasto', (select jsonb_build_object(
        'mes_atual', sum(valor_pago) filter (where data_pagamento >= date_trunc('month', current_date)),
        'mes_anterior', sum(valor_pago) filter (where data_pagamento >= date_trunc('month', current_date) - interval '1 month'
                                                  and data_pagamento < date_trunc('month', current_date)),
        'ultimos_12_meses', sum(valor_pago) filter (where data_pagamento >= current_date - interval '12 months'),
        'em_aberto', sum(saldo) filter (where em_aberto), 'vencido', sum(saldo) filter (where situacao = 'Vencido'),
        'vencidos_qtd', count(*) filter (where situacao = 'Vencido' and saldo > 0))
      from fin_base where tipo = 'DESPESA'),
    'auditoria', (select jsonb_build_object(
        'prejuizo_confirmado', coalesce(sum(impacto_comprovado) filter (where classificacao = 'PREJUIZO_CONFIRMADO'), 0),
        'prejuizo_confirmado_qtd', count(*) filter (where classificacao = 'PREJUIZO_CONFIRMADO'),
        'irregularidade_confirmada_qtd', count(*) filter (where classificacao = 'IRREGULARIDADE_CONFIRMADA'),
        'irregularidade_confirmada_impacto', coalesce(sum(impacto_comprovado) filter (where classificacao = 'IRREGULARIDADE_CONFIRMADA'), 0),
        'sob_analise_qtd', count(*) filter (where classificacao = 'SOB_ANALISE'),
        'sob_analise_valor_em_risco', coalesce(sum(impacto_estimado) filter (where classificacao = 'SOB_ANALISE'), 0),
        'caixa_revisao', count(*) filter (where classificacao = 'SOB_ANALISE' and status_revisao in ('ABERTO', 'REVISAR_DEPOIS')),
        'recuperado', coalesce(sum(valor_recuperado), 0),
        'por_grupo', (select jsonb_object_agg(grupo, x) from (select grupo, jsonb_build_object(
             'NORMAL', count(*) filter (where classificacao = 'NORMAL'),
             'SOB_ANALISE', count(*) filter (where classificacao = 'SOB_ANALISE'),
             'IRREGULARIDADE_CONFIRMADA', count(*) filter (where classificacao = 'IRREGULARIDADE_CONFIRMADA'),
             'PREJUIZO_CONFIRMADO', count(*) filter (where classificacao = 'PREJUIZO_CONFIRMADO'),
             'valor_em_risco', coalesce(sum(impacto_estimado) filter (where classificacao = 'SOB_ANALISE'), 0),
             'impacto_comprovado', coalesce(sum(impacto_comprovado) filter (where classificacao in ('IRREGULARIDADE_CONFIRMADA', 'PREJUIZO_CONFIRMADO')), 0),
             'prejuizo', coalesce(sum(impacto_comprovado) filter (where classificacao = 'PREJUIZO_CONFIRMADO'), 0)) x
           from fin_ocorrencias where ativo or status_revisao in ('DECIDIDO', 'RESOLVIDO') group by grupo) g))
      from fin_ocorrencias where ativo or status_revisao in ('DECIDIDO', 'RESOLVIDO')),
    'sentinela', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'grupo', grupo, 'titulo', titulo, 'fornecedor', fornecedor,
        'valor', coalesce(impacto_comprovado, impacto_estimado, valor_envolvido), 'classificacao', classificacao, 'prioridade', prioridade,
        'forca', forca, 'pontos', pontos) order by pontos desc, coalesce(impacto_comprovado, impacto_estimado, valor_envolvido) desc nulls last)
      from (select * from fin_ocorrencias where ativo and classificacao <> 'NORMAL' and status_revisao <> 'RESOLVIDO'
            order by pontos desc, coalesce(impacto_comprovado, impacto_estimado, valor_envolvido) desc nulls last limit 15) s), '[]'),
    'cobertura', fin_cobertura(),
    'regras', 'Suspeita fica SOB_ANALISE e não soma prejuízo. Prejuízo confirmado só existe depois de decisão na Caixa de Revisão. Ausência de dado não é zero.'
  )
$$;

-- Drill-down: um lançamento com comprovantes, outras parcelas do título e ocorrências.
create or replace function public.fin_lancamento(p_chave text) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'lancamento', to_jsonb(l),
    'parcelas_do_titulo', (select jsonb_agg(jsonb_build_object('chave', x.chave, 'vencimento', x.vencimento, 'valor_parcela', x.valor_parcela,
                            'valor_pago', x.valor_pago, 'data_pagamento', x.data_pagamento, 'situacao', x.situacao, 'vigente', x.vigente) order by x.vencimento)
                           from fin_lancamentos x where x.codigo = l.codigo),
    'comprovantes', (select jsonb_agg(to_jsonb(c) order by c.data_pagamento) from fin_comprovantes_v c where c.codigo = l.codigo and c.vencimento = l.vencimento),
    'ocorrencias', (select jsonb_agg(jsonb_build_object('id', o.id, 'grupo', o.grupo, 'titulo', o.titulo, 'classificacao', o.classificacao,
                     'status_revisao', o.status_revisao, 'valor', coalesce(o.impacto_comprovado, o.impacto_estimado)))
                    from fin_ocorrencias o where l.chave = any (o.lancamentos) and (o.ativo or o.status_revisao <> 'ABERTO')),
    'origem', 'Sallamo · carga #' || l.carga_id || ' de ' || to_char(l.carga_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'))
  from fin_lancamentos l where l.chave = p_chave
$$;

-- Caso completo para a Caixa de Revisão.
create or replace function public.fin_ocorrencia(p_id bigint) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'ocorrencia', to_jsonb(o),
    'lancamentos', (select jsonb_agg(to_jsonb(l) order by l.vencimento) from fin_lancamentos l where l.chave = any (o.lancamentos)),
    'comprovantes', (select jsonb_agg(to_jsonb(c) order by c.data_pagamento) from fin_comprovantes_v c
                     where exists (select 1 from fin_lancamentos l where l.chave = any (o.lancamentos) and l.codigo = c.codigo and l.vencimento = c.vencimento)),
    'decisoes', (select jsonb_agg(jsonb_build_object('decisao', d.decisao, 'de', d.classificacao_anterior, 'para', d.classificacao_nova,
                  'impacto', d.impacto_comprovado, 'recuperado', d.valor_recuperado, 'observacao', d.observacao, 'usuario', d.usuario, 'em', d.em,
                  'anexadas', d.evidencias->'anexadas') order by d.em desc) from fin_decisoes d where d.ocorrencia_id = o.id))
  from fin_ocorrencias o where o.id = p_id
$$;

-- ============================================================================================================
-- 6. Correções no legado
-- ============================================================================================================
-- A versão de 4 parâmetros aceitava qualquer nome em p_usuario. Agora repassa para a versão segura (usuário logado).
create or replace function public.fin_revisar_duplicidade(p_id bigint, p_decisao text, p_observacao text default null, p_usuario text default 'auditoria')
returns jsonb language sql security invoker set search_path = public as $$
  select public.fin_revisar_duplicidade(p_id => p_id,
    p_acao => case lower(trim(p_decisao)) when 'justificada' then 'nao_duplicidade' else lower(trim(p_decisao)) end, p_observacao => p_observacao)
$$;

-- 38 casos foram gravados como "irregular" pelo robô (atualizado_por = 'auditoria financeira 2.0'), sem revisão humana.
-- Suspeita não é irregularidade: voltam para em_analise (o gatilho de fin_analises registra no histórico).
update public.fin_analises set situacao = 'em_analise',
       comentario = 'Reclassificado em 22/10/2026: marcado como irregular pelo robô sem revisão humana. Aguarda a Caixa de Revisão.',
       atualizado_por = 'revisao sistema 22/10/2026', impacto_financeiro = 0
 where situacao = 'irregular' and atualizado_por = 'auditoria financeira 2.0';

-- Carga inicial (rodar depois da migração; ~40 s com a base real):
--   select public.fin_processar(true);
