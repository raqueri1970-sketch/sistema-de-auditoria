-- =====================================================================
-- RELATÓRIO INFORMATIVO DE AUDITORIA DOS AJUSTES DE ESTOQUE
-- Somente leitura (SELECT). Não bloqueia, não aprova e não altera ajustes.
-- Módulos cruzados: Acerto de Estoque | Estoque por Loja | Inventário
--
-- Regra do código: 2 últimos dígitos = numeração; anteriores = modelo/linha.
--   Ex.: 125436 -> modelo 1254, numeração 36.
-- Código completo: prioriza o produto do acerto SETA vinculado ao ajuste
-- (ajuste_seta_importados.ajuste_id); sem vínculo, usa codigo_produto.
-- Códigos de 4-5 dígitos (ou 6 iniciando em 0) sem acerto SETA vinculado
-- são código de modelo sem numeração -> "numeração não identificada".
--
-- Saída: um JSON (array) com uma linha por ajuste, consumido por
-- gerar_relatorio_ajustes.py. Chaves curtas para reduzir o volume:
--   id, l (loja), ln (nome loja), m (marca), d (descrição), cp (código
--   informado), cc (código completo), mo (modelo), nu (numeração), q (qtd),
--   fi (finalidade), st (status), so (solicitante), cpf (CPF mascarado),
--   ca (cargo), dt (data do ajuste), ac (acerto SETA),
--   el (linhas no Estoque por Loja p/ o modelo), es (saldo por numeração),
--   eo (qtd nas outras numerações), ex (outras numerações c/ saldo),
--   et (total da linha), ea (saldo da numeração ajustada),
--   ii (inventário), id_ (data inventário), iq (qtd contada),
--   ia (qtd sistema antes), is (status), ip (inventário posterior ao ajuste),
--   il (datas de inventário da loja), an (ajustes anteriores).
-- =====================================================================
select json_agg(json_strip_nulls(row_to_json(r)) order by r.id) from (
with aj as (
  select e.id, e.loja_normalizada as loja, e.solicitante, e.solicitante_cpf_mask, e.cargo_seta,
         e.codigo_produto, e.quantidade, e.finalidade, e.status, e.criado_em, e.data_acerto,
         coalesce(nullif(e.marca,''), s.marca) as marca,
         coalesce(nullif(e.descricao_produto,''), s.descricao) as descricao,
         s.acerto_id,
         case when s.produto is not null then ltrim(s.produto,'0')
              when length(e.codigo_produto)=8 and left(e.codigo_produto,1)='0' then substr(e.codigo_produto,2)
              when length(e.codigo_produto)>=6 and left(e.codigo_produto,1)<>'0' then e.codigo_produto
              else null end as codigo_completo
  from ajuste_estoque_entrada e
  left join lateral (
    select * from ajuste_seta_importados si where si.ajuste_id = e.id order by si.acerto_id limit 1
  ) s on true
),
aj2 as (
  select a.*,
         coalesce(left(a.codigo_completo, length(a.codigo_completo)-2), ltrim(a.codigo_produto,'0')) as modelo,
         right(a.codigo_completo,2) as numeracao,
         coalesce(a.data_acerto, (a.criado_em at time zone 'America/Recife')::date) as data_ajuste
  from aj a
),
-- Estoque por Loja: todas as numerações do mesmo modelo na mesma loja
est as (
  select a.id,
         count(se.id) as linhas,
         string_agg(se.numeracao::text||': '||trim(to_char(se.total_estoque,'FM9999990')), ' | ' order by se.numeracao) as saldo_txt,
         coalesce(sum(se.total_estoque) filter (where se.numeracao::text is distinct from a.numeracao),0) as outras_qtd,
         string_agg(se.numeracao::text||': '||trim(to_char(se.total_estoque,'FM9999990')), ' | ' order by se.numeracao)
           filter (where se.numeracao::text is distinct from a.numeracao and se.total_estoque > 0) as outras_txt,
         coalesce(sum(se.total_estoque),0) as total_linha,
         sum(se.total_estoque) filter (where se.numeracao::text = a.numeracao) as saldo_ajustada
  from aj2 a
  left join ajuste_saldo_estoque_loja se on se.loja = a.loja and se.modelo::text = ltrim(a.modelo,'0')
  group by a.id
),
-- Inventário: mesmo produto (modelo), mesma numeração, mesma loja
invs as (
  select a.id, i.id as inv_id, i.data::date as inv_data,
         d.qtd_antes, coalesce(d.qtd_cont, f.qtd_cont) as qtd_cont,
         case when d.id is not null then 'DIVERGENTE NA CONTAGEM'
              else 'CONTADO SEM DIVERGÊNCIA' end as inv_status,
         row_number() over (partition by a.id order by (i.data::date <= a.data_ajuste) desc, i.data::date desc) as rn,
         a.data_ajuste
  from aj2 a
  join inv_inventarios i on i.loja = a.loja::text
  left join inv_detalhe d on d.inventario_id = i.id and ltrim(d.cd_prod,'0') = ltrim(a.modelo,'0') and d.tam = a.numeracao
  left join inv_estoque_final f on d.id is null and f.inventario_id = i.id and ltrim(f.cd_prod,'0') = ltrim(a.modelo,'0') and f.tam = a.numeracao
  where a.numeracao is not null and (d.id is not null or f.id is not null)
),
lojainv as (
  select a.id, string_agg(to_char(i.data::date,'DD/MM/YYYY'), ', ' order by i.data) as datas
  from aj2 a join inv_inventarios i on i.loja = a.loja::text group by a.id
),
-- Histórico de Acerto de Estoque: mesma loja, mesmo modelo, mesma numeração, antes do ajuste atual
hist as (
  select a.id, string_agg(h.txt, ' ; ' order by h.dt desc) as anteriores
  from aj2 a
  join lateral (
    select b.data_ajuste as dt,
           to_char(b.data_ajuste,'DD/MM/YYYY')||' — '||b.quantidade||' un. — '||coalesce(b.finalidade,'')||
           ' — ajuste #'||b.id||' ('||b.status||')' as txt
    from aj2 b
    where b.loja = a.loja and b.id <> a.id and b.numeracao is not null and b.numeracao = a.numeracao
      and ltrim(b.modelo,'0') = ltrim(a.modelo,'0') and b.criado_em < a.criado_em
    union all
    select si.data_acerto,
           to_char(si.data_acerto,'DD/MM/YYYY')||' — '||si.qtd||' un. ('||si.mv||') — '||coalesce(si.classe,'')||': '||
           coalesce(si.obs,'')||' — acerto SETA '||si.acerto_id
    from ajuste_seta_importados si
    where si.loja = a.loja and si.ajuste_id is null and a.numeracao is not null
      and ltrim(si.produto,'0') = a.codigo_completo and si.data_acerto <= a.data_ajuste
  ) h on true
  group by a.id
)
select a.id, a.loja as l, lj.nome_seta as ln, a.marca as m, a.descricao as d, a.codigo_produto as cp,
       a.codigo_completo as cc, ltrim(a.modelo,'0') as mo, a.numeracao as nu, a.quantidade as q,
       a.finalidade as fi, a.status as st, a.solicitante as so, a.solicitante_cpf_mask as cpf, a.cargo_seta as ca,
       to_char(a.criado_em at time zone 'America/Recife','DD/MM/YYYY HH24:MI') as dt, a.acerto_id as ac,
       est.linhas as el, est.saldo_txt as es, est.outras_qtd as eo, est.outras_txt as ex, est.total_linha as et,
       est.saldo_ajustada as ea,
       iv.inv_id as ii, to_char(iv.inv_data,'DD/MM/YYYY') as id_, iv.qtd_cont as iq, iv.qtd_antes as ia,
       iv.inv_status as "is", (iv.inv_data > iv.data_ajuste) as ip,
       li.datas as il, h.anteriores as an
from aj2 a
left join entrada_estoque_lojas lj on lj.loja_normalizada = a.loja
left join est on est.id = a.id
left join invs iv on iv.id = a.id and iv.rn = 1
left join lojainv li on li.id = a.id
left join hist h on h.id = a.id
) r;
