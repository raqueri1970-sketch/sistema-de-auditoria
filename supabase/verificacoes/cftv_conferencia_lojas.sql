-- Conferência das migrações 20261113c e 20261113d do CFTV (aplicadas pela gestão no SQL Editor do Supabase em 13/11/2026).
-- Só leitura. Esperado: TOTAL 728.426,58; Sem loja, Estimado, Notas sem loja e Alertas sem_loja ativos = 0;
-- loja 925 (Conde da Boa Vista, fechada) com as NF 167/175/214/202/203/258; loja 964 (River) com as NF 117/208/209/257;
-- loja 934 (Mix Mateus Petrolina) com as NF 103/172; CD (0) e 908 (Shopping Boa Vista) menores que antes.
with p as (select public.cftv_patrimonio(null) j),
pl as (select x->>'loja_codigo' loja, (x->>'valor')::numeric valor, (x->>'compras_2026')::numeric nf2026
       from p, jsonb_array_elements(j->'por_loja') x)
select 'TOTAL' item, (select (j->>'total')::numeric from p) valor, null::numeric nf2026
union all select 'Sem loja', (select (j->>'sem_loja')::numeric from p), null
union all select 'Estimado', (select (j->>'total_estimado')::numeric from p), null
union all select 'Notas sem loja (qtd)', (select count(*) from cftv_documentos where loja_codigo is null), null
union all select 'Alertas sem_loja ativos', (select count(*) from cftv_ocorrencias where regra = 'sem_loja' and ativo), null
union all select 'Loja ' || loja, valor, nf2026 from pl where loja in ('925', '934', '964', '929', '937', '920', '919', '951', '908', '0')
order by 1;
