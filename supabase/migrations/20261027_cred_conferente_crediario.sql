-- 27/10/2026: Conferente de Crediário (cards "Parcelas a descontar em <mês>" do Portal).
--   As views já existiam no banco, criadas fora das migrations; ficam versionadas aqui, com três correções:
--   * "Compras novas" = 1ª parcela da compra caindo na competência (antes era compra lançada dentro do próprio mês do
--     vencimento, que na próxima folha dá sempre zero: em novembro/2026 mostrava R$ 0,00 com R$ 23.593,82 de
--     1ª parcela de compras de outubro). "Herdado" = 2ª parcela em diante de compras anteriores.
--   * Relatório Diretoria (PJ / fora do cadastro): saldo real em aberto desconta o que já foi baixado (cred_baixas).
--   * cred_conferente_auditoria passa a respeitar as RLS (security_invoker).
--   Todas com security_invoker (valem as RLS das tabelas cred_*: só quem pode auditar enxerga) e só leitura.

-- Parcelas reais do relatório + projeção das que faltam até o total do contrato (relatório traz só a janela em aberto)
create or replace view public.cred_parcelas_projetadas with (security_invoker = true) as
with base as (
  select cpf, max(nome) as nome, contrato, max(n_parcelas) as n_parcelas, max(parcela) as max_parcela,
         max(vencimento) as max_vencimento, (array_agg(valor order by parcela desc))[1] as valor, min(lancamento) as lancamento
    from public.cred_parcelas
   where contrato is not null and n_parcelas is not null and parcela is not null and vencimento is not null and valor is not null
   group by cpf, contrato
)
select b.cpf, b.nome, b.contrato, g.g as parcela, b.n_parcelas, b.lancamento,
       (b.max_vencimento + ((g.g - b.max_parcela)::text || ' months')::interval)::date as vencimento,
       b.valor, 'PROJETADA'::text as origem
  from base b
 cross join lateral generate_series(b.max_parcela + 1, b.n_parcelas) g(g)
 where b.max_parcela < b.n_parcelas;

create or replace view public.cred_parcelas_carteira with (security_invoker = true) as
select cpf, nome, contrato, parcela, n_parcelas, lancamento, vencimento, valor, 'REAL'::text as origem from public.cred_parcelas
union all
select cpf, nome, contrato, parcela, n_parcelas, lancamento, vencimento, valor, origem from public.cred_parcelas_projetadas;

-- Por competência (mês do vencimento) e CPF
create or replace view public.cred_conferente_competencia with (security_invoker = true) as
select to_char(date_trunc('month', vencimento), 'YYYY-MM') as competencia,
       cpf,
       max(nome) as nome,
       count(*) as qtd_parcelas,
       sum(valor)::numeric(14,2) as valor_previsto,
       sum(case when parcela = 1 then 0 else valor end)::numeric(14,2) as valor_herdado,
       sum(case when parcela = 1 then valor else 0 end)::numeric(14,2) as valor_novo
  from public.cred_parcelas_carteira
 where vencimento is not null and cpf is not null and valor is not null
 group by 1, cpf;

create or replace view public.cred_conferente_resumo with (security_invoker = true) as
select competencia,
       count(*) as qtd_funcionarios,
       sum(qtd_parcelas)::bigint as qtd_parcelas,
       sum(valor_previsto)::numeric(14,2) as valor_previsto,
       sum(valor_herdado)::numeric(14,2) as valor_herdado,
       sum(valor_novo)::numeric(14,2) as valor_novo
  from public.cred_conferente_competencia
 group by competencia;

-- Por colaborador: ativo (folha), ex-funcionário (rescisão) ou fora do cadastro/PJ (Diretoria)
create or replace view public.cred_fluxo_colaborador with (security_invoker = true) as
with c as (
  select p.cpf, max(p.nome) as nome,
         case when f.cpf is not null then 'FUNCIONARIO' when d.cpf is not null then 'EX_FUNCIONARIO' else 'FORA_CADASTRO_PJ' end as tipo,
         count(*) as parcelas_carteira,
         sum(p.valor)::numeric(14,2) as total_carteira,
         sum(case when p.origem = 'REAL' then p.valor else 0 end)::numeric(14,2) as saldo_real,
         sum(case when p.origem = 'PROJETADA' then p.valor else 0 end)::numeric(14,2) as saldo_projetado,
         min(p.vencimento) as proximo_vencimento,
         max(p.vencimento) as ultimo_vencimento
    from public.cred_parcelas_carteira p
    left join (select distinct cpf from public.cred_funcionarios where cpf is not null) f on f.cpf = p.cpf
    left join (select distinct cpf from public.cred_desligados where cpf is not null) d on d.cpf = p.cpf
   group by p.cpf, 3
), b as (
  select cpf, sum(valor)::numeric(14,2) as valor_baixado from public.cred_baixas group by cpf
)
select c.cpf, c.nome, c.tipo, c.parcelas_carteira, c.total_carteira, c.saldo_real, c.saldo_projetado,
       c.proximo_vencimento, c.ultimo_vencimento, coalesce(b.valor_baixado, 0)::numeric(14,2) as valor_baixado
  from c left join b using (cpf);

create or replace view public.cred_relatorio_diretoria_fora_cadastro with (security_invoker = true) as
select cpf, nome, parcelas_carteira, total_carteira,
       greatest(saldo_real - valor_baixado, 0)::numeric(14,2) as saldo_real,
       saldo_projetado, valor_baixado, proximo_vencimento, ultimo_vencimento,
       case when saldo_real - valor_baixado > 0 then 'DESCONTO POR FORA / DIRETORIA' else 'SEM SALDO REAL' end as encaminhamento
  from public.cred_fluxo_colaborador
 where tipo = 'FORA_CADASTRO_PJ';

-- Conferência previsto × descontado na folha: criada sem security_invoker (rodava como dono e ignorava as RLS)
alter view public.cred_conferente_auditoria set (security_invoker = true);

revoke all on public.cred_conferente_auditoria, public.cred_parcelas_projetadas, public.cred_parcelas_carteira, public.cred_conferente_competencia,
              public.cred_conferente_resumo, public.cred_fluxo_colaborador, public.cred_relatorio_diretoria_fora_cadastro
  from anon, authenticated;
grant select on public.cred_conferente_auditoria, public.cred_parcelas_projetadas, public.cred_parcelas_carteira, public.cred_conferente_competencia,
               public.cred_conferente_resumo, public.cred_fluxo_colaborador, public.cred_relatorio_diretoria_fora_cadastro
  to authenticated;
