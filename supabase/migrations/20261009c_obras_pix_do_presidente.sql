-- =====================================================================================================
-- OBRAS & REFORMAS — Pix do Presidente no grupo do WhatsApp = comprovante do pagamento (09/10/2026)
-- Regra: comprovante enviado por um PRESTADOR (Josemar, Jhony...) entra como CONTA A PAGAR.
--        comprovante enviado pelo PRESIDENTE (Paulo Almeida, Mar Aberto) é o comprovante do pagamento que ele
--        marcou na tela: não vira despesa; liga sozinho ao pagamento de mesmo valor e o Auditor confere.
--        Se o Pix chegar antes de ele marcar na tela, fica aguardando e liga quando ele marcar "Já paguei".
-- Funciona com o capturador atual (é tudo no banco). Só acréscimos.
-- =====================================================================================================

create table if not exists public.obras_pagadores (
  numero text primary key, nome text not null, ativo boolean not null default true, created_at timestamptz not null default now()
);
alter table public.obras_pagadores enable row level security;
create policy "obras pagadores leitura" on public.obras_pagadores for select to authenticated using ((select public.obras_pode_ver_fluxo()));
revoke all on public.obras_pagadores from anon;
grant select on public.obras_pagadores to authenticated;

alter table public.obras_comprovantes add column if not exists pagamento_id uuid references public.obras_pagamentos(id) on delete set null;

-- Antes de gravar: o que vem do número do Presidente não é despesa, é comprovante de pagamento
create or replace function public.obras_pagador_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  select nome into v_nome from public.obras_pagadores where numero = new.remetente_numero and ativo;
  if v_nome is not null and new.status = 'lancado' then
    new.status := 'pagamento'; new.situacao_pagamento := 'pago'; new.responsavel := v_nome;
  end if;
  return new;
end $$;
create trigger obras_pagador_trg before insert or update of status on public.obras_comprovantes
  for each row execute function public.obras_pagador_before();

-- Liga um Pix do Presidente ao pagamento de mesmo valor (aprovado e ainda sem comprovante, ou "já paguei" sem arquivo)
create or replace function public.obras_vincular_pix_presidente(p_comp uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.obras_comprovantes; p public.obras_pagamentos; v_quando timestamptz; x uuid;
begin
  select * into c from public.obras_comprovantes where id = p_comp;
  if not found or c.status <> 'pagamento' or c.pagamento_id is not null or coalesce(c.valor, 0) <= 0 then return null; end if;
  v_quando := coalesce(c.wa_data, c.created_at);
  select * into p from public.obras_pagamentos k
   where k.status in ('aprovado', 'pago', 'pendencia') and coalesce(k.comprovante_path, '') = ''
     and abs(case when k.status = 'aprovado' then k.valor_aprovado else coalesce(k.valor_pago, k.valor_aprovado) end - c.valor) <= 0.05
     and k.created_at between v_quando - interval '10 days' and v_quando + interval '10 days'
     and not exists (select 1 from public.obras_comprovantes o where o.pagamento_id = k.id)
   order by (upper(coalesce(c.fornecedor, '')) like '%' || upper(split_part(coalesce(k.favorecido, k.prestador), ' ', 1)) || '%') desc,
            abs(extract(epoch from k.created_at - v_quando))
   limit 1 for update;
  if not found then return null; end if;
  update public.obras_comprovantes set pagamento_id = p.id, updated_at = now() where id = c.id;
  if p.status = 'aprovado' then
    update public.obras_pagamentos set status = 'pago', pago_por = c.responsavel, pago_em = v_quando, valor_pago = c.valor,
      comprovante_path = c.arquivo_path, forma_pagamento = coalesce(forma_pagamento, 'pix'), updated_at = now() where id = p.id;
    perform public.obras_pag_evento(p.id, c.id, p.prestador, 'PAGO', c.responsavel, jsonb_build_object('valor', c.valor, 'origem', 'Pix do Presidente no WhatsApp'));
    for x in select comprovante_id from public.obras_pagamento_itens where pagamento_id = p.id loop perform public.obras_atualizar_situacao(x); end loop;
  else
    update public.obras_pagamentos set comprovante_path = c.arquivo_path, valor_pago = c.valor, updated_at = now() where id = p.id;
  end if;
  perform public.obras_pag_evento(p.id, c.id, p.prestador, 'COMPROVANTE_ANEXADO', c.responsavel,
    jsonb_build_object('arquivo', c.arquivo_path, 'valor', c.valor, 'origem', 'Pix do Presidente no WhatsApp', 'recebedor', c.fornecedor));
  perform public.obras_pos_auditar_pagamento(p.id);
  return p.id;
end $$;

create or replace function public.obras_pagador_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pagamento' and new.pagamento_id is null then
    begin perform public.obras_vincular_pix_presidente(new.id);
    exception when others then raise warning 'obras pix presidente: %', sqlerrm; end;  -- nunca impede a gravação
  end if;
  return null;
end $$;
create trigger obras_pagador_after_trg after insert or update of status on public.obras_comprovantes
  for each row execute function public.obras_pagador_after();

-- Quando o Presidente marca "Já paguei" sem arquivo: procura um Pix dele já recebido com o mesmo valor
create or replace function public.obras_vincular_pagamento_pix(p_pag uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p public.obras_pagamentos; v uuid;
begin
  select * into p from public.obras_pagamentos where id = p_pag;
  if not found or coalesce(p.comprovante_path, '') <> '' then return null; end if;
  select id into v from public.obras_comprovantes c
   where c.status = 'pagamento' and c.pagamento_id is null
     and abs(c.valor - case when p.status = 'aprovado' then p.valor_aprovado else coalesce(p.valor_pago, p.valor_aprovado) end) <= 0.05
     and coalesce(c.wa_data, c.created_at) between p.created_at - interval '10 days' and p.created_at + interval '10 days'
   order by (upper(coalesce(c.fornecedor, '')) like '%' || upper(split_part(coalesce(p.favorecido, p.prestador), ' ', 1)) || '%') desc,
            abs(extract(epoch from coalesce(c.wa_data, c.created_at) - p.created_at))
   limit 1;
  if v is null then return null; end if;
  return public.obras_vincular_pix_presidente(v);
end $$;

-- Cadastra (ou desliga) o número do Presidente; converte o que já veio desse número e ainda não entrou em pagamento
create or replace function public.obras_definir_pagador(p_numero text, p_nome text, p_ativo boolean default true)
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  if not public.obras_tem_papel('__admin__') then raise exception 'Somente o administrador cadastra o número do Presidente.'; end if;
  if coalesce(trim(p_numero), '') = '' or coalesce(trim(p_nome), '') = '' then raise exception 'Informe número e nome.'; end if;
  insert into public.obras_pagadores (numero, nome, ativo) values (trim(p_numero), trim(p_nome), p_ativo)
  on conflict (numero) do update set nome = excluded.nome, ativo = excluded.ativo;
  if p_ativo then
    for r in select id from public.obras_comprovantes c where c.remetente_numero = trim(p_numero) and c.status = 'lancado' and c.situacao_pagamento = 'a_pagar'
               and not exists (select 1 from public.obras_pagamento_itens i where i.comprovante_id = c.id) loop
      update public.obras_comprovantes set status = 'lancado', updated_at = now() where id = r.id;  -- dispara o gatilho: vira 'pagamento'
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;

-- "Já paguei" liga sozinho ao Pix do Presidente quando não veio arquivo pela tela
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
    if public.obras_vincular_pagamento_pix(v.id) is null then v := public.obras_pos_auditar_pagamento(v.id);
    else select * into v from public.obras_pagamentos where id = v.id; end if;
  else
    perform public.obras_pag_evento(v.id, null, p_prestador, 'ENVIADO_FINANCEIRO', v_quem, jsonb_build_object('favorecido', v.favorecido, 'pix', v.pix_chave));
  end if;
  return v;
end $$;

-- O Pix do Presidente não é prestador: fica fora do saldo por prestador. Despesa ganha a coluna pagamento_id (no fim).
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
       coalesce(it.ultimo_pagamento_em, c.pago_em) as pago_em, it.ultimo_pagamento_numero, c.pagamento_id
from public.obras_comprovantes c
left join it on it.comprovante_id = c.id
left join ach on ach.comprovante_id = c.id
left join public.obras o on o.id = c.obra_id;

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
  from public.obras_despesas_pagamento where prestador is not null and status <> 'pagamento' group by 1
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

revoke execute on function public.obras_pagador_before(), public.obras_pagador_after(), public.obras_vincular_pix_presidente(uuid),
  public.obras_vincular_pagamento_pix(uuid) from public, anon, authenticated;
revoke execute on function public.obras_definir_pagador(text, text, boolean) from public, anon;
grant execute on function public.obras_definir_pagador(text, text, boolean) to authenticated;

-- ---------- Pagador lido no comprovante (09/10 tarde): "Mar Aberto" (empresa do Presidente) ou "Paulo Almeida" ----------
-- Vale mesmo quando o comprovante é encaminhado por outra pessoa: se quem PAGOU foi o Presidente/Mar Aberto, é pagamento, não despesa.
alter table public.obras_comprovantes add column if not exists pagador text;
create table if not exists public.obras_pagador_nomes (padrao text primary key, nome text not null, ativo boolean not null default true);
alter table public.obras_pagador_nomes enable row level security;
create policy "obras pagador nomes leitura" on public.obras_pagador_nomes for select to authenticated using ((select public.obras_pode_ver_fluxo()));
revoke all on public.obras_pagador_nomes from anon;
grant select on public.obras_pagador_nomes to authenticated;
insert into public.obras_pagador_nomes (padrao, nome) values ('MAR ABERTO', 'Paulo Almeida'), ('PAULO ALMEIDA', 'Paulo Almeida') on conflict do nothing;

create or replace function public.obras_pagador_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  select nome into v_nome from public.obras_pagadores where numero = new.remetente_numero and ativo;
  if v_nome is null and coalesce(new.pagador, '') <> '' then
    select nome into v_nome from public.obras_pagador_nomes
     where ativo and upper(translate(new.pagador, 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeioooucAAAAEEIOOOUC')) like '%' || padrao || '%' limit 1;
  end if;
  if v_nome is not null and new.status = 'lancado' then
    new.status := 'pagamento'; new.situacao_pagamento := 'pago'; new.responsavel := v_nome;
  end if;
  return new;
end $$;
revoke execute on function public.obras_pagador_before() from public, anon, authenticated;

-- ---------- Tabela do MODO SOMBRA (servidor novo em paralelo ao D90): mesma estrutura, sem gatilhos, nada oficial ----------
create table if not exists public.obras_comprovantes_sombra (like public.obras_comprovantes including defaults including generated including indexes);
alter table public.obras_comprovantes_sombra enable row level security;
create policy "obras sombra robo" on public.obras_comprovantes_sombra for all to authenticated
  using ((select public.obras_pode_auditar())) with check ((select public.obras_pode_auditar()));
revoke all on public.obras_comprovantes_sombra from anon;

-- ---------- Comparação SOMBRA (nuvem) × OFICIAL (D90): só vira a chave quando as duas baterem ----------
create or replace function public.obras_comparar_sombra(p_desde timestamptz default now() - interval '2 days')
returns jsonb language sql stable security definer set search_path = public as $$
  with o as (select split_part(wa_msg_id, '#', 1) m, count(*) n, sum(valor) filter (where status = 'lancado') v from public.obras_comprovantes
              where origem = 'whatsapp' and wa_data >= p_desde group by 1),
       s as (select split_part(wa_msg_id, '#', 1) m, count(*) n, sum(valor) filter (where status = 'lancado') v from public.obras_comprovantes_sombra
              where origem = 'whatsapp' and wa_data >= p_desde group by 1)
  select case when not public.obras_pode_auditar() then jsonb_build_object('erro', 'sem permissao') else jsonb_build_object(
    'desde', p_desde,
    'mensagens_oficial', (select count(*) from o), 'mensagens_sombra', (select count(*) from s),
    'so_no_oficial', (select coalesce(jsonb_agg(m), '[]') from o where m not in (select m from s)),
    'so_na_sombra', (select coalesce(jsonb_agg(m), '[]') from s where m not in (select m from o)),
    'valor_diferente', (select coalesce(jsonb_agg(jsonb_build_object('msg', o.m, 'oficial', o.v, 'sombra', s.v)), '[]') from o join s using (m)
                         where coalesce(o.v, 0) <> coalesce(s.v, 0)),
    'ultimo_status_nuvem', (select to_jsonb(c) from public.capturador_status c where instancia = 'nuvem')) end
$$;
revoke execute on function public.obras_comparar_sombra(timestamptz) from public, anon;
grant execute on function public.obras_comparar_sombra(timestamptz) to authenticated;
