-- =====================================================================================================
-- OBRAS & REFORMAS — Pagamento POR DESPESA, parcial, com saldo devedor acumulado por prestador (09/10/2026)
-- O Presidente vê todas as despesas em aberto (de todas as semanas), marca quais paga e quanto de cada uma.
-- O que for pago sai como pago em todo o sistema; o resto continua em aberto e acumula com as outras semanas.
-- Duas opções: "Já paguei" (o Presidente pagou) ou "Enviar ao Financeiro" (o Financeiro paga e anexa o comprovante).
-- Só acréscimos. Substitui o fluxo por semana (obras_presidente_decidir / obras_financeiro_pagar), que fica sem uso.
-- =====================================================================================================

-- ---------- 1) Situação "recusado" (despesa que o Presidente não reconhece) ----------
alter table public.obras_comprovantes drop constraint if exists obras_comprovantes_situacao_pagamento_check;
alter table public.obras_comprovantes add constraint obras_comprovantes_situacao_pagamento_check
  check (situacao_pagamento in ('a_pagar', 'pago', 'recusado'));
alter table public.obras_comprovantes
  add column if not exists recusado_motivo text, add column if not exists recusado_por text, add column if not exists recusado_em timestamptz;

-- ---------- 2) Pagamentos (lotes), itens, adiantamentos e histórico ----------
create table if not exists public.obras_pagamentos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  prestador text not null,
  status text not null check (status in ('aprovado', 'pago', 'auditado', 'pendencia', 'cancelado')),
  valor_itens numeric not null check (valor_itens > 0),
  valor_abatido numeric not null default 0 check (valor_abatido >= 0),
  valor_aprovado numeric not null check (valor_aprovado >= 0),
  valor_pago numeric,
  aprovado_por text, aprovado_em timestamptz,
  pago_por text, pago_em timestamptz, forma_pagamento text,
  comprovante_path text,
  favorecido text, pix_tipo text, pix_chave text, banco text, agencia text, conta text,
  observacao text, motivo_cancelamento text,
  auditada_em timestamptz, auditoria_resultado text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists obras_pagamentos_prest_ix on public.obras_pagamentos (prestador, status);

create table if not exists public.obras_pagamento_itens (
  id uuid primary key default gen_random_uuid(),
  pagamento_id uuid not null references public.obras_pagamentos(id) on delete cascade,
  comprovante_id uuid not null references public.obras_comprovantes(id) on delete restrict,
  valor numeric not null check (valor > 0),
  created_at timestamptz not null default now(),
  unique (pagamento_id, comprovante_id)
);
create index if not exists obras_pagamento_itens_comp_ix on public.obras_pagamento_itens (comprovante_id);

create table if not exists public.obras_adiantamentos (
  id uuid primary key default gen_random_uuid(),
  prestador text not null, valor numeric not null check (valor > 0), data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  observacao text, comprovante_path text, registrado_por text, cancelado boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.obras_pagamento_eventos (
  id uuid primary key default gen_random_uuid(),
  pagamento_id uuid references public.obras_pagamentos(id) on delete cascade,
  comprovante_id uuid references public.obras_comprovantes(id) on delete cascade,
  prestador text, evento text not null, usuario text, detalhes jsonb, created_at timestamptz not null default now()
);
create index if not exists obras_pag_eventos_ix on public.obras_pagamento_eventos (pagamento_id, created_at);

alter table public.obras_pagamentos enable row level security;
alter table public.obras_pagamento_itens enable row level security;
alter table public.obras_adiantamentos enable row level security;
alter table public.obras_pagamento_eventos enable row level security;
-- Leitura para quem participa do fluxo. Escrita só pelas funções abaixo (security definer, com checagem de papel).
create policy "obras pagamentos leitura" on public.obras_pagamentos for select to authenticated using ((select public.obras_pode_ver_fluxo()));
create policy "obras pagamento itens leitura" on public.obras_pagamento_itens for select to authenticated using ((select public.obras_pode_ver_fluxo()));
create policy "obras adiantamentos leitura" on public.obras_adiantamentos for select to authenticated using ((select public.obras_pode_ver_fluxo()));
create policy "obras pagamento eventos leitura" on public.obras_pagamento_eventos for select to authenticated using ((select public.obras_pode_ver_fluxo()));
revoke all on public.obras_pagamentos, public.obras_pagamento_itens, public.obras_adiantamentos, public.obras_pagamento_eventos from anon;
grant select on public.obras_pagamentos, public.obras_pagamento_itens, public.obras_adiantamentos, public.obras_pagamento_eventos to authenticated;

-- O Presidente também anexa comprovante quando ele mesmo paga
create policy "obras pagamentos presidente inserir" on storage.objects for insert to authenticated
  with check (bucket_id = 'obras-comprovantes' and name like 'pagamentos/%' and (select public.obras_tem_papel('presidente')));

-- ---------- 3) Quanto já foi pago / reservado de cada despesa ----------
-- pago      = itens de pagamentos efetivados (pago, auditado, pendencia) — ou a despesa inteira se veio marcada "pago" antes deste fluxo
-- reservado = itens de pagamentos aprovados aguardando o Financeiro
create or replace view public.obras_despesas_pagamento with (security_invoker = true) as
with it as (
  select i.comprovante_id,
         sum(i.valor) filter (where p.status in ('pago', 'auditado', 'pendencia')) as pago,
         sum(i.valor) filter (where p.status = 'aprovado') as reservado,
         max(p.pago_em) filter (where p.status in ('pago', 'auditado', 'pendencia')) as ultimo_pagamento_em,
         (array_agg(p.numero order by p.created_at desc))[1] as ultimo_pagamento_numero
  from public.obras_pagamento_itens i join public.obras_pagamentos p on p.id = i.pagamento_id
  where p.status <> 'cancelado' group by 1
),
ach as (
  select comprovante_id, count(*) filter (where nivel = 'critico') as criticos, count(*) filter (where nivel = 'atencao') as atencoes,
         jsonb_agg(jsonb_build_object('id', id, 'nivel', nivel, 'mensagem', mensagem) order by nivel desc) as achados
  from public.obras_auditoria_achados where not resolvido and comprovante_id is not null group by 1
)
select c.id, c.responsavel as prestador, c.semana_ref as semana, c.semana_ref + 6 as semana_fim, c.data_despesa, c.hora_documento,
       c.fornecedor, c.categoria, c.descricao, c.tipo_doc, c.forma_pagamento, c.valor, c.status, c.situacao_pagamento,
       c.arquivo_path, c.remetente, c.remetente_numero, c.obra_id, o.nome as obra, c.confianca_ocr, c.wa_data, c.legenda,
       c.recusado_motivo, c.recusado_por, c.recusado_em,
       case when c.situacao_pagamento = 'pago' and coalesce(it.pago, 0) = 0 then c.valor else coalesce(it.pago, 0) end as valor_pago,
       coalesce(it.reservado, 0) as valor_reservado,
       case when c.status <> 'lancado' or c.situacao_pagamento in ('pago', 'recusado') then 0
            else greatest(c.valor - coalesce(it.pago, 0) - coalesce(it.reservado, 0), 0) end as saldo,
       case when c.status = 'orcamento' then 'orcamento'
            when c.status <> 'lancado' then c.status
            when c.situacao_pagamento = 'recusado' then 'recusado'
            when c.situacao_pagamento = 'pago' then 'pago'
            when coalesce(it.reservado, 0) > 0 then 'com_financeiro'
            when coalesce(it.pago, 0) > 0 then 'parcial'
            else 'a_pagar' end as situacao,
       coalesce(ach.criticos, 0) as criticos, coalesce(ach.atencoes, 0) as atencoes, coalesce(ach.achados, '[]'::jsonb) as achados,
       coalesce(it.ultimo_pagamento_em, c.pago_em) as pago_em, it.ultimo_pagamento_numero
from public.obras_comprovantes c
left join it on it.comprovante_id = c.id
left join ach on ach.comprovante_id = c.id
left join public.obras o on o.id = c.obra_id;

-- ---------- 4) Saldo devedor por prestador (acumula todas as semanas) ----------
create or replace view public.obras_saldo_prestador with (security_invoker = true) as
with d as (
  select prestador,
         count(*) filter (where saldo > 0) as itens_abertos,
         coalesce(sum(saldo), 0) as em_aberto,
         count(*) filter (where situacao = 'parcial') as itens_parciais,
         coalesce(sum(valor_reservado), 0) as com_financeiro,
         min(semana) filter (where saldo > 0) as semana_mais_antiga,
         count(distinct semana) filter (where saldo > 0) as semanas_abertas,
         coalesce(sum(criticos) filter (where saldo > 0), 0) as criticos, coalesce(sum(atencoes) filter (where saldo > 0), 0) as atencoes,
         coalesce(sum(valor) filter (where status = 'lancado' and situacao <> 'recusado'), 0) as total_despesas,
         coalesce(sum(valor_pago) filter (where status = 'lancado'), 0) as total_pago_despesas,
         count(*) filter (where status = 'pendente_leitura') as pendentes_leitura
  from public.obras_despesas_pagamento where prestador is not null group by 1
),
a as (select prestador, sum(valor) as adiantado from public.obras_adiantamentos where not cancelado group by 1),
p as (select prestador, sum(valor_abatido) as abatido, max(pago_em) as ultimo_pagamento,
             sum(valor_pago) filter (where status in ('pago', 'auditado', 'pendencia')) as pago_em_lotes,
             count(*) filter (where status = 'pendencia') as pagamentos_pendencia
      from public.obras_pagamentos where status <> 'cancelado' group by 1),
r as (select distinct on (nome) nome, pix_tipo, pix_chave, titular, banco, agencia, conta from public.obras_remetentes where ativo order by nome, (pix_chave is not null) desc)
select coalesce(d.prestador, a.prestador) as prestador,
       coalesce(d.itens_abertos, 0) as itens_abertos, coalesce(d.em_aberto, 0) as em_aberto, coalesce(d.itens_parciais, 0) as itens_parciais,
       coalesce(d.com_financeiro, 0) as com_financeiro, d.semana_mais_antiga, coalesce(d.semanas_abertas, 0) as semanas_abertas,
       greatest(coalesce(a.adiantado, 0) - coalesce(p.abatido, 0), 0) as adiantamento_disponivel,
       greatest(coalesce(d.em_aberto, 0) - greatest(coalesce(a.adiantado, 0) - coalesce(p.abatido, 0), 0), 0) as saldo_devedor,
       coalesce(d.criticos, 0) as criticos, coalesce(d.atencoes, 0) as atencoes, coalesce(d.pendentes_leitura, 0) as pendentes_leitura,
       case when coalesce(d.criticos, 0) > 0 or coalesce(p.pagamentos_pendencia, 0) > 0 then 'critico'
            when coalesce(d.atencoes, 0) > 0 or coalesce(d.pendentes_leitura, 0) > 0 then 'atencao' else 'normal' end as risco,
       coalesce(d.total_despesas, 0) as total_despesas, coalesce(d.total_pago_despesas, 0) as total_pago,
       coalesce(a.adiantado, 0) as total_adiantado, p.ultimo_pagamento, coalesce(p.pagamentos_pendencia, 0) as pagamentos_pendencia,
       r.titular, r.pix_tipo, r.pix_chave, r.banco, r.agencia, r.conta
from d full join a on a.prestador = d.prestador
left join p on p.prestador = coalesce(d.prestador, a.prestador)
left join r on r.nome = coalesce(d.prestador, a.prestador);

-- ---------- 5) Fluxo de caixa semanal por prestador ----------
-- entrada = despesas lançadas na semana (o que a empresa passou a dever); saída = pagamentos e adiantamentos feitos na semana.
-- Despesas que já vieram "pago" antes deste fluxo contam como pagas na própria semana.
create or replace view public.obras_fluxo_semanal with (security_invoker = true) as
with mov as (
  select prestador, semana, valor as despesas, 0::numeric as pago_legado, 0::numeric as pagamentos, 0::numeric as adiantamentos, 0::numeric as recusado
    from public.obras_despesas_pagamento where status = 'lancado' and situacao <> 'recusado' and semana is not null
  union all
  select prestador, semana, 0, valor, 0, 0, 0 from public.obras_despesas_pagamento d
   where status = 'lancado' and situacao_pagamento = 'pago' and semana is not null
     and not exists (select 1 from public.obras_pagamento_itens i join public.obras_pagamentos p on p.id = i.pagamento_id
                      where i.comprovante_id = d.id and p.status <> 'cancelado')
  union all
  select prestador, date_trunc('week', (pago_em at time zone 'America/Sao_Paulo'))::date, 0, 0, valor_pago, 0, 0
    from public.obras_pagamentos where status in ('pago', 'auditado', 'pendencia') and pago_em is not null
  union all
  select prestador, date_trunc('week', data::timestamp)::date, 0, 0, 0, valor, 0 from public.obras_adiantamentos where not cancelado
  union all
  select prestador, semana, 0, 0, 0, 0, valor from public.obras_despesas_pagamento where status = 'lancado' and situacao = 'recusado' and semana is not null
),
s as (select prestador, semana, sum(despesas) despesas, sum(pago_legado) pago_legado, sum(pagamentos) pagamentos, sum(adiantamentos) adiantamentos, sum(recusado) recusado
      from mov where prestador is not null group by 1, 2)
select prestador, semana, semana + 6 as semana_fim, despesas, recusado, pago_legado, pagamentos, adiantamentos,
       pago_legado + pagamentos + adiantamentos as total_saidas,
       sum(despesas - pago_legado - pagamentos - adiantamentos) over (partition by prestador order by semana) as saldo_acumulado
from s;

-- ---------- 6) Funções do fluxo ----------
create or replace function public.obras_pag_evento(p_pag uuid, p_comp uuid, p_prest text, p_evento text, p_usuario text, p_det jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.obras_pagamento_eventos (pagamento_id, comprovante_id, prestador, evento, usuario, detalhes) values (p_pag, p_comp, p_prest, p_evento, p_usuario, p_det)
$$;

-- Atualiza a situação da despesa (pago quando o total efetivamente pago cobre o valor)
create or replace function public.obras_atualizar_situacao(p_comp uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pago numeric; v_valor numeric; v_sit text; v_ult timestamptz;
begin
  select c.valor, c.situacao_pagamento into v_valor, v_sit from public.obras_comprovantes c where c.id = p_comp;
  if v_sit = 'recusado' then return; end if;
  select coalesce(sum(i.valor), 0), max(p.pago_em) into v_pago, v_ult from public.obras_pagamento_itens i join public.obras_pagamentos p on p.id = i.pagamento_id
   where i.comprovante_id = p_comp and p.status in ('pago', 'auditado', 'pendencia');
  if not exists (select 1 from public.obras_pagamento_itens i join public.obras_pagamentos p on p.id = i.pagamento_id where i.comprovante_id = p_comp and p.status <> 'cancelado') then
    return;  -- despesa fora do novo fluxo (ex.: marcada paga antes): não mexe
  end if;
  update public.obras_comprovantes set situacao_pagamento = case when v_pago >= v_valor - 0.005 then 'pago' else 'a_pagar' end,
         pago_em = case when v_pago >= v_valor - 0.005 then coalesce(v_ult, now()) else null end, updated_at = now()
   where id = p_comp;
end $$;

-- Pós-auditoria de um pagamento: comprovante anexado e na nuvem, aprovado, valor pago = aprovado, nenhuma despesa paga além do valor.
create or replace function public.obras_pos_auditar_pagamento(p_pag uuid)
returns public.obras_pagamentos language plpgsql security definer set search_path = public as $$
declare v public.obras_pagamentos; v_prob text[] := '{}'; v_n int;
begin
  select * into v from public.obras_pagamentos where id = p_pag;
  if not found or v.status not in ('pago', 'auditado', 'pendencia') then return v; end if;
  if coalesce(v.comprovante_path, '') = '' then v_prob := v_prob || 'falta anexar o comprovante do pagamento'::text;
  elsif not exists (select 1 from storage.objects s where s.bucket_id = 'obras-comprovantes' and s.name = v.comprovante_path) then
    v_prob := v_prob || 'arquivo do comprovante de pagamento nao encontrado na nuvem'::text; end if;
  if v.aprovado_em is null then v_prob := v_prob || 'pagamento sem aprovacao do Presidente'::text; end if;
  if abs(coalesce(v.valor_pago, 0) - v.valor_aprovado) > 0.01 then
    v_prob := v_prob || format('valor pago (R$ %s) diferente do aprovado (R$ %s)', coalesce(v.valor_pago, 0), v.valor_aprovado); end if;
  select count(*) into v_n from (
    select i.comprovante_id from public.obras_pagamento_itens i join public.obras_pagamentos p on p.id = i.pagamento_id
     join public.obras_comprovantes c on c.id = i.comprovante_id
     where p.status <> 'cancelado' and i.comprovante_id in (select comprovante_id from public.obras_pagamento_itens where pagamento_id = v.id)
     group by i.comprovante_id, c.valor having sum(i.valor) > c.valor + 0.01) x;
  if v_n > 0 then v_prob := v_prob || format('%s despesa(s) paga(s) acima do valor do recibo', v_n); end if;
  if array_length(v_prob, 1) is null then
    update public.obras_pagamentos set status = 'auditado', auditada_em = now(), auditoria_resultado = 'OK - conferido com o aprovado e comprovante anexado', updated_at = now()
     where id = v.id returning * into v;
    perform public.obras_pag_evento(v.id, null, v.prestador, 'AUDITADO', 'Agente Auditor', '{}'::jsonb);
  else
    update public.obras_pagamentos set status = 'pendencia', auditoria_resultado = array_to_string(v_prob, '; '), updated_at = now() where id = v.id returning * into v;
    perform public.obras_pag_evento(v.id, null, v.prestador, 'PENDENCIA', 'Agente Auditor', jsonb_build_object('problemas', v_prob));
  end if;
  return v;
end $$;

-- PRESIDENTE: marca as despesas (e quanto de cada) e escolhe: 'financeiro' (aprova e envia) ou 'ja_paguei' (ele pagou).
-- p_itens = [{"id": "<uuid da despesa>", "valor": 123.45, "justificativa": "obrigatória se a despesa tiver ponto crítico"}]
create or replace function public.obras_presidente_pagar(p_prestador text, p_itens jsonb, p_modo text, p_descontar_adiantamento boolean default true,
  p_forma text default null, p_observacao text default null)
returns public.obras_pagamentos language plpgsql security definer set search_path = public as $$
declare
  v public.obras_pagamentos; v_quem text := public.obras_usuario_nome(); e jsonb; c record; v_val numeric; v_tot numeric := 0;
  v_saldo numeric; v_crit int; v_disp numeric; v_abate numeric := 0; r record; v_ids uuid[] := '{}';
begin
  if not public.obras_tem_papel('presidente') then raise exception 'Somente o Presidente pode aprovar ou pagar despesas de Obras.'; end if;
  if p_modo not in ('financeiro', 'ja_paguei') then raise exception 'Opcao invalida: %', p_modo; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Marque ao menos uma despesa.'; end if;

  insert into public.obras_pagamentos (prestador, status, valor_itens, valor_aprovado, aprovado_por, aprovado_em, observacao)
  values (p_prestador, 'aprovado', 0.01, 0, v_quem, now(), p_observacao) returning * into v;

  for e in select * from jsonb_array_elements(p_itens) loop
    v_val := round((e->>'valor')::numeric, 2);
    select * into c from public.obras_despesas_pagamento where id = (e->>'id')::uuid;
    if not found then raise exception 'Despesa nao encontrada.'; end if;
    perform 1 from public.obras_comprovantes where id = c.id for update;
    select saldo, criticos into v_saldo, v_crit from public.obras_despesas_pagamento where id = c.id;
    if c.prestador is distinct from p_prestador then raise exception 'A despesa de % (%) nao e de %.', c.fornecedor, c.valor, p_prestador; end if;
    if c.id = any(v_ids) then raise exception 'Despesa repetida na selecao.'; end if;
    if v_val is null or v_val <= 0 then raise exception 'Valor invalido para % (R$ %).', coalesce(c.fornecedor, 'despesa'), c.valor; end if;
    if v_val > v_saldo + 0.005 then raise exception 'R$ % e mais do que o saldo em aberto (R$ %) da despesa % de %.', v_val, v_saldo, coalesce(c.fornecedor, ''), to_char(c.data_despesa, 'DD/MM'); end if;
    if v_crit > 0 then
      if coalesce(trim(e->>'justificativa'), '') = '' then
        raise exception 'A despesa % (R$ %) tem ponto CRITICO do Auditor. Informe a justificativa para pagar mesmo assim.', coalesce(c.fornecedor, ''), c.valor; end if;
      update public.obras_auditoria_achados set resolvido = true, resolvido_por = (select auth.uid()), resolvido_por_nome = v_quem, resolvido_em = now(),
             observacao = 'Liberado pelo Presidente no pagamento: ' || trim(e->>'justificativa'), atualizado_em = now()
       where comprovante_id = c.id and not resolvido and nivel = 'critico';
      perform public.obras_pag_evento(v.id, c.id, p_prestador, 'CRITICO_LIBERADO', v_quem, jsonb_build_object('justificativa', e->>'justificativa'));
    end if;
    insert into public.obras_pagamento_itens (pagamento_id, comprovante_id, valor) values (v.id, c.id, v_val);
    v_ids := v_ids || c.id; v_tot := v_tot + v_val;
  end loop;

  if p_descontar_adiantamento then
    select adiantamento_disponivel into v_disp from public.obras_saldo_prestador where prestador = p_prestador;
    v_abate := least(coalesce(v_disp, 0), v_tot);
  end if;
  select * into r from public.obras_remetentes where nome = p_prestador and ativo order by (pix_chave is not null) desc limit 1;
  update public.obras_pagamentos set valor_itens = v_tot, valor_abatido = v_abate, valor_aprovado = v_tot - v_abate,
    favorecido = coalesce(r.titular, p_prestador), pix_tipo = r.pix_tipo, pix_chave = r.pix_chave, banco = r.banco, agencia = r.agencia, conta = r.conta,
    forma_pagamento = coalesce(p_forma, case when r.pix_chave is not null then 'pix' else null end), updated_at = now()
  where id = v.id returning * into v;
  perform public.obras_pag_evento(v.id, null, p_prestador, 'APROVADO', v_quem,
    jsonb_build_object('itens', array_length(v_ids, 1), 'valor_itens', v_tot, 'adiantamento_abatido', v_abate, 'valor_aprovado', v.valor_aprovado, 'modo', p_modo));

  if p_modo = 'ja_paguei' then
    update public.obras_pagamentos set status = 'pago', pago_por = v_quem, pago_em = now(), valor_pago = valor_aprovado, updated_at = now() where id = v.id returning * into v;
    perform public.obras_pag_evento(v.id, null, p_prestador, 'PAGO', v_quem, jsonb_build_object('valor', v.valor_pago, 'por', 'Presidente', 'forma', v.forma_pagamento));
    perform public.obras_atualizar_situacao(x) from unnest(v_ids) x;
    v := public.obras_pos_auditar_pagamento(v.id);
  else
    perform public.obras_pag_evento(v.id, null, p_prestador, 'ENVIADO_FINANCEIRO', v_quem, jsonb_build_object('favorecido', v.favorecido, 'pix', v.pix_chave));
  end if;
  return v;
end $$;

-- FINANCEIRO (ou o Presidente): registra o pagamento de um lote aprovado, com o comprovante.
create or replace function public.obras_pagamento_registrar(p_pag uuid, p_valor numeric, p_comprovante_path text, p_forma text default null, p_observacao text default null)
returns public.obras_pagamentos language plpgsql security definer set search_path = public as $$
declare v public.obras_pagamentos; v_quem text := public.obras_usuario_nome(); x uuid;
begin
  if not (public.obras_tem_papel('financeiro') or public.obras_tem_papel('presidente')) then raise exception 'Somente o Financeiro ou o Presidente registram pagamento.'; end if;
  select * into v from public.obras_pagamentos where id = p_pag for update;
  if not found then raise exception 'Pagamento nao encontrado.'; end if;
  if v.status <> 'aprovado' then raise exception 'Este pagamento nao esta aguardando (situacao: %).', v.status; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor pago.'; end if;
  if coalesce(p_comprovante_path, '') = '' then raise exception 'Anexe o comprovante do pagamento.'; end if;
  update public.obras_pagamentos set status = 'pago', pago_por = v_quem, pago_em = now(), valor_pago = p_valor, comprovante_path = p_comprovante_path,
    forma_pagamento = coalesce(p_forma, forma_pagamento), observacao = coalesce(p_observacao, observacao), updated_at = now()
   where id = v.id returning * into v;
  perform public.obras_pag_evento(v.id, null, v.prestador, 'PAGO', v_quem, jsonb_build_object('valor', p_valor, 'forma', v.forma_pagamento));
  perform public.obras_pag_evento(v.id, null, v.prestador, 'COMPROVANTE_ANEXADO', v_quem, jsonb_build_object('arquivo', p_comprovante_path));
  for x in select comprovante_id from public.obras_pagamento_itens where pagamento_id = v.id loop perform public.obras_atualizar_situacao(x); end loop;
  return public.obras_pos_auditar_pagamento(v.id);
end $$;

-- Anexa/troca o comprovante (e corrige o valor) de um pagamento já feito — resolve a pendência se tudo bater.
create or replace function public.obras_pagamento_anexar(p_pag uuid, p_comprovante_path text, p_valor numeric default null)
returns public.obras_pagamentos language plpgsql security definer set search_path = public as $$
declare v public.obras_pagamentos; v_quem text := public.obras_usuario_nome();
begin
  if not (public.obras_tem_papel('financeiro') or public.obras_tem_papel('presidente')) then raise exception 'Sem permissao.'; end if;
  select * into v from public.obras_pagamentos where id = p_pag for update;
  if not found or v.status not in ('pago', 'pendencia', 'auditado') then raise exception 'So da para anexar em pagamento ja feito.'; end if;
  if coalesce(p_comprovante_path, '') = '' then raise exception 'Escolha o arquivo do comprovante.'; end if;
  update public.obras_pagamentos set comprovante_path = p_comprovante_path, valor_pago = coalesce(p_valor, valor_pago), updated_at = now() where id = v.id;
  perform public.obras_pag_evento(v.id, null, v.prestador, 'COMPROVANTE_ANEXADO', v_quem, jsonb_build_object('arquivo', p_comprovante_path, 'valor', p_valor));
  return public.obras_pos_auditar_pagamento(v.id);
end $$;

-- PRESIDENTE: cancela um lote ainda não pago (as despesas voltam para o saldo em aberto).
create or replace function public.obras_pagamento_cancelar(p_pag uuid, p_motivo text)
returns public.obras_pagamentos language plpgsql security definer set search_path = public as $$
declare v public.obras_pagamentos; v_quem text := public.obras_usuario_nome();
begin
  if not public.obras_tem_papel('presidente') then raise exception 'Somente o Presidente cancela uma aprovacao.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo.'; end if;
  select * into v from public.obras_pagamentos where id = p_pag for update;
  if not found or v.status <> 'aprovado' then raise exception 'So da para cancelar um pagamento que ainda nao foi pago.'; end if;
  update public.obras_pagamentos set status = 'cancelado', motivo_cancelamento = p_motivo, updated_at = now() where id = v.id returning * into v;
  perform public.obras_pag_evento(v.id, null, v.prestador, 'CANCELADO', v_quem, jsonb_build_object('motivo', p_motivo));
  return v;
end $$;

-- PRESIDENTE: não reconhece uma despesa (sai do saldo devedor) ou desfaz a recusa.
create or replace function public.obras_despesa_recusar(p_comp uuid, p_motivo text, p_desfazer boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare c record; v_quem text := public.obras_usuario_nome();
begin
  if not public.obras_tem_papel('presidente') then raise exception 'Somente o Presidente pode recusar uma despesa.'; end if;
  select * into c from public.obras_despesas_pagamento where id = p_comp;
  if not found then raise exception 'Despesa nao encontrada.'; end if;
  if p_desfazer then
    if c.situacao <> 'recusado' then raise exception 'Esta despesa nao esta recusada.'; end if;
    update public.obras_comprovantes set situacao_pagamento = 'a_pagar', recusado_motivo = null, recusado_por = null, recusado_em = null, updated_at = now() where id = p_comp;
    perform public.obras_pag_evento(null, p_comp, c.prestador, 'RECUSA_DESFEITA', v_quem, '{}'::jsonb);
    return;
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  if c.valor_pago > 0 or c.valor_reservado > 0 then raise exception 'Esta despesa ja tem pagamento feito ou aprovado; cancele o pagamento antes.'; end if;
  if c.situacao_pagamento <> 'a_pagar' then raise exception 'So da para recusar despesa em aberto.'; end if;
  update public.obras_comprovantes set situacao_pagamento = 'recusado', recusado_motivo = p_motivo, recusado_por = v_quem, recusado_em = now(), updated_at = now() where id = p_comp;
  perform public.obras_pag_evento(null, p_comp, c.prestador, 'RECUSADA', v_quem, jsonb_build_object('motivo', p_motivo, 'valor', c.valor));
end $$;

-- Adiantamento ao prestador (abatido automaticamente no próximo pagamento)
create or replace function public.obras_adiantamento_registrar(p_prestador text, p_valor numeric, p_data date default null, p_observacao text default null, p_comprovante_path text default null)
returns public.obras_adiantamentos language plpgsql security definer set search_path = public as $$
declare v public.obras_adiantamentos; v_quem text := public.obras_usuario_nome();
begin
  if not (public.obras_tem_papel('financeiro') or public.obras_tem_papel('presidente')) then raise exception 'Somente o Financeiro ou o Presidente registram adiantamento.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Valor invalido.'; end if;
  if not exists (select 1 from public.obras_remetentes where nome = p_prestador) and not exists (select 1 from public.obras_comprovantes where responsavel = p_prestador) then
    raise exception 'Prestador % nao cadastrado.', p_prestador; end if;
  insert into public.obras_adiantamentos (prestador, valor, data, observacao, comprovante_path, registrado_por)
  values (p_prestador, p_valor, coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date), p_observacao, p_comprovante_path, v_quem) returning * into v;
  perform public.obras_pag_evento(null, null, p_prestador, 'ADIANTAMENTO', v_quem, jsonb_build_object('valor', p_valor, 'data', v.data, 'id', v.id));
  return v;
end $$;

create or replace function public.obras_adiantamento_cancelar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.obras_adiantamentos; v_disp numeric;
begin
  if not (public.obras_tem_papel('financeiro') or public.obras_tem_papel('presidente')) then raise exception 'Sem permissao.'; end if;
  select * into v from public.obras_adiantamentos where id = p_id and not cancelado;
  if not found then raise exception 'Adiantamento nao encontrado.'; end if;
  select adiantamento_disponivel into v_disp from public.obras_saldo_prestador where prestador = v.prestador;
  if coalesce(v_disp, 0) < v.valor - 0.005 then raise exception 'Este adiantamento ja foi abatido em pagamento; nao pode ser cancelado.'; end if;
  update public.obras_adiantamentos set cancelado = true, observacao = coalesce(observacao || ' | ', '') || 'Cancelado: ' || coalesce(p_motivo, '') where id = p_id;
  perform public.obras_pag_evento(null, null, v.prestador, 'ADIANTAMENTO_CANCELADO', public.obras_usuario_nome(), jsonb_build_object('valor', v.valor, 'motivo', p_motivo));
end $$;

-- Dados de pagamento do prestador: Presidente também pode informar
create or replace function public.obras_definir_pagamento_prestador(p_prestador text, p_pix_tipo text, p_pix_chave text, p_titular text,
  p_cpf_cnpj text default null, p_banco text default null, p_agencia text default null, p_conta text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.obras_pode_auditar() or public.obras_tem_papel('financeiro') or public.obras_tem_papel('presidente')) then raise exception 'Sem permissao para alterar dados de pagamento.'; end if;
  update public.obras_remetentes set pix_tipo = p_pix_tipo, pix_chave = nullif(trim(p_pix_chave), ''), titular = nullif(trim(p_titular), ''),
    cpf_cnpj = nullif(trim(p_cpf_cnpj), ''), banco = nullif(trim(p_banco), ''), agencia = nullif(trim(p_agencia), ''), conta = nullif(trim(p_conta), ''), updated_at = now()
   where nome = p_prestador;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Prestador % nao cadastrado.', p_prestador; end if;
  update public.obras_pagamentos set favorecido = coalesce(nullif(trim(p_titular), ''), favorecido), pix_tipo = p_pix_tipo, pix_chave = nullif(trim(p_pix_chave), ''),
    banco = nullif(trim(p_banco), ''), agencia = nullif(trim(p_agencia), ''), conta = nullif(trim(p_conta), ''), updated_at = now()
   where prestador = p_prestador and status = 'aprovado';
  return n;
end $$;

-- ---------- 7) Permissões ----------
revoke all on public.obras_despesas_pagamento, public.obras_saldo_prestador, public.obras_fluxo_semanal from anon;
grant select on public.obras_despesas_pagamento, public.obras_saldo_prestador, public.obras_fluxo_semanal to authenticated;
revoke execute on function public.obras_pag_evento(uuid, uuid, text, text, text, jsonb), public.obras_atualizar_situacao(uuid),
  public.obras_pos_auditar_pagamento(uuid) from public, anon, authenticated;
revoke execute on function public.obras_presidente_pagar(text, jsonb, text, boolean, text, text), public.obras_pagamento_registrar(uuid, numeric, text, text, text),
  public.obras_pagamento_anexar(uuid, text, numeric), public.obras_pagamento_cancelar(uuid, text), public.obras_despesa_recusar(uuid, text, boolean),
  public.obras_adiantamento_registrar(text, numeric, date, text, text), public.obras_adiantamento_cancelar(uuid, text) from public, anon;
grant execute on function public.obras_presidente_pagar(text, jsonb, text, boolean, text, text), public.obras_pagamento_registrar(uuid, numeric, text, text, text),
  public.obras_pagamento_anexar(uuid, text, numeric), public.obras_pagamento_cancelar(uuid, text), public.obras_despesa_recusar(uuid, text, boolean),
  public.obras_adiantamento_registrar(text, numeric, date, text, text), public.obras_adiantamento_cancelar(uuid, text) to authenticated;

-- ADMINISTRADOR: ajuste manual de uma despesa (valor, fornecedor, categoria, data, prestador). Fica no histórico com antes/depois.
create or replace function public.obras_despesa_ajustar(p_comp uuid, p_motivo text, p_valor numeric default null, p_fornecedor text default null,
  p_categoria text default null, p_data date default null, p_prestador text default null, p_descricao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c record; v_quem text := public.obras_usuario_nome();
begin
  if not public.obras_tem_papel('__admin__') then raise exception 'Somente o administrador faz ajuste manual.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do ajuste.'; end if;
  select * into c from public.obras_despesas_pagamento where id = p_comp;
  if not found then raise exception 'Despesa nao encontrada.'; end if;
  if p_valor is not null and c.ultimo_pagamento_numero is not null and p_valor < c.valor_pago + c.valor_reservado - 0.005 then
    raise exception 'O valor nao pode ficar abaixo do que ja foi pago/aprovado (R$ %).', c.valor_pago + c.valor_reservado; end if;
  if p_prestador is not null and p_prestador is distinct from c.prestador and (c.valor_pago > 0 or c.valor_reservado > 0) and c.ultimo_pagamento_numero is not null then
    raise exception 'Esta despesa ja entrou em pagamento; nao da para trocar o prestador.'; end if;
  update public.obras_comprovantes set valor = coalesce(p_valor, valor), fornecedor = coalesce(nullif(trim(p_fornecedor), ''), fornecedor),
    categoria = coalesce(p_categoria, categoria), data_despesa = coalesce(p_data, data_despesa),
    responsavel = coalesce(nullif(trim(p_prestador), ''), responsavel), descricao = coalesce(nullif(trim(p_descricao), ''), descricao),
    revisado = true, updated_at = now()
  where id = p_comp;
  perform public.obras_atualizar_situacao(p_comp);
  perform public.obras_pag_evento(null, p_comp, coalesce(nullif(trim(p_prestador), ''), c.prestador), 'AJUSTE_MANUAL', v_quem, jsonb_build_object('motivo', p_motivo,
    'antes', jsonb_build_object('valor', c.valor, 'fornecedor', c.fornecedor, 'categoria', c.categoria, 'data', c.data_despesa, 'prestador', c.prestador, 'descricao', c.descricao),
    'depois', jsonb_build_object('valor', p_valor, 'fornecedor', p_fornecedor, 'categoria', p_categoria, 'data', p_data, 'prestador', p_prestador, 'descricao', p_descricao)));
end $$;
revoke execute on function public.obras_despesa_ajustar(uuid, text, numeric, text, text, date, text, text) from public, anon;
grant execute on function public.obras_despesa_ajustar(uuid, text, numeric, text, text, date, text, text) to authenticated;
