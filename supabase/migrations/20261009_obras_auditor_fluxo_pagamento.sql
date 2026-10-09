-- =====================================================================================================
-- OBRAS & REFORMAS — Agente Auditor + fluxo Presidente → Financeiro → comprovante → auditoria (09/10/2026)
-- Aplicado no projeto "sistema de auditoria" (rdztzurfesnobfkazgpm) em partes pelo MCP do Supabase.
-- Usa a estrutura criada em paralelo no mesmo dia (obras_contas_pagar_itens, obras_financeiro_eventos,
-- colunas aprovado_por / pago_por / comprovante_url / valor_pagamento / pix_* / token_financeiro).
-- Só acréscimos. Nenhuma despesa é alterada pelo Auditor: ele só registra achados.
-- =====================================================================================================

-- ---------- 1) Papéis e dados de pagamento do prestador ----------
alter table public.obras_remetentes
  add column if not exists pix_tipo text, add column if not exists pix_chave text, add column if not exists titular text,
  add column if not exists cpf_cnpj text, add column if not exists banco text, add column if not exists agencia text, add column if not exists conta text;

create table if not exists public.obras_papeis (
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null check (papel in ('presidente', 'financeiro', 'auditor')),
  nome text, ativo boolean not null default true, created_at timestamptz not null default now(),
  primary key (user_id, papel)
);
alter table public.obras_papeis enable row level security;
create policy "obras papeis leitura" on public.obras_papeis for select to authenticated
  using (user_id = (select auth.uid()) or (select public.obras_pode_auditar()));
create policy "obras papeis administracao" on public.obras_papeis for all to authenticated
  using ((select public.obras_tem_papel('__admin__'))) with check ((select public.obras_tem_papel('__admin__')));

create or replace function public.obras_tem_papel(p_papel text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orc_perfis p where p.user_id = (select auth.uid()) and p.ativo and p.perfil = 'administrador')
      or exists (select 1 from public.obras_papeis o where o.user_id = (select auth.uid()) and o.ativo and o.papel = p_papel)
$$;
create or replace function public.obras_pode_ver_fluxo()
returns boolean language sql stable security definer set search_path = public as $$
  select (select public.portal_pode_ver()) or (select public.obras_pode_auditar())
      or exists (select 1 from public.obras_papeis o where o.user_id = (select auth.uid()) and o.ativo)
$$;
create or replace function public.obras_prestador_de(p_numero text, p_remetente text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select r.nome from public.obras_remetentes r where r.numero = p_numero), nullif(p_remetente, ''), p_numero, 'Desconhecido')
$$;
create or replace function public.obras_usuario_nome()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select o.nome from public.obras_papeis o where o.user_id = (select auth.uid()) and o.nome is not null limit 1),
                  (select u.email from auth.users u where u.id = (select auth.uid())), 'desconhecido')
$$;

-- ---------- 2) Conta semanal: campos do fluxo + leitura para quem tem papel ----------
alter table public.obras_contas_pagar
  add column if not exists prestador text, add column if not exists devolvida_em timestamptz, add column if not exists motivo_devolucao text,
  add column if not exists valor_aprovado numeric, add column if not exists auditada_em timestamptz, add column if not exists auditoria_resultado text;
alter table public.obras_contas_pagar drop constraint if exists obras_contas_pagar_status_check;
alter table public.obras_contas_pagar add constraint obras_contas_pagar_status_check
  check (status in ('aberta', 'fechada', 'aprovada', 'paga', 'auditada', 'pendencia'));
-- (aprovada_por, aprovada_por_nome, pago_por_nome, valor_pago, pix_destino, comprovante_pagamento_path, historico:
--  colunas criadas por engano em duplicidade, vazias e sem uso — remover quando possível)

create policy "obras contas pagar leitura papeis" on public.obras_contas_pagar for select to authenticated using ((select public.obras_pode_ver_fluxo()));
create policy "obras comprovantes leitura papeis" on public.obras_comprovantes for select to authenticated using ((select public.obras_pode_ver_fluxo()));
create policy "obras remetentes leitura papeis" on public.obras_remetentes for select to authenticated using ((select public.obras_pode_ver_fluxo()));
create policy "obras pagamentos financeiro inserir" on storage.objects for insert to authenticated
  with check (bucket_id = 'obras-comprovantes' and name like 'pagamentos/%' and (select public.obras_tem_papel('financeiro')));
create policy "obras arquivos leitura papeis" on storage.objects for select to authenticated
  using (bucket_id = 'obras-comprovantes' and (select public.obras_pode_ver_fluxo()));

alter table public.obras_financeiro_eventos drop constraint if exists obras_financeiro_eventos_evento_check;
alter table public.obras_financeiro_eventos add constraint obras_financeiro_eventos_evento_check
  check (evento in ('CRIADA', 'ENVIADA_FINANCEIRO', 'PAGO', 'CANCELADO', 'COMPROVANTE_ANEXADO', 'APROVADA', 'DEVOLVIDA', 'AUDITADA', 'PENDENCIA', 'PRE_AUDITORIA'));

-- Responsável (prestador) preenchido sozinho pelo número do WhatsApp
create or replace function public.obras_responsavel_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.responsavel is null or (tg_op = 'UPDATE' and new.remetente_numero is distinct from old.remetente_numero) then
    new.responsavel := public.obras_prestador_de(new.remetente_numero, new.remetente);
  end if;
  return new;
end $$;
create trigger obras_responsavel_trg before insert or update of remetente_numero, responsavel on public.obras_comprovantes
  for each row execute function public.obras_responsavel_trigger();
-- correção feita em 09/10: responsavel estava "Josemar" em todas as 984 despesas (inclusive Enildo, Everton e Jhony)
-- update public.obras_comprovantes set responsavel = public.obras_prestador_de(remetente_numero, remetente)
--  where responsavel is distinct from public.obras_prestador_de(remetente_numero, remetente);

-- ---------- 3) AGENTE AUDITOR ----------
create table if not exists public.obras_auditoria_achados (
  id uuid primary key default gen_random_uuid(),
  comprovante_id uuid references public.obras_comprovantes(id) on delete cascade,
  conta_id uuid references public.obras_contas_pagar(id) on delete cascade,
  regra text not null, nivel text not null check (nivel in ('atencao', 'critico')), mensagem text not null,
  detalhe jsonb, relacionado_id uuid,
  resolvido boolean not null default false, resolvido_por uuid, resolvido_por_nome text, resolvido_em timestamptz, observacao text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create unique index if not exists obras_achados_uk on public.obras_auditoria_achados (coalesce(comprovante_id, conta_id), regra);
create index if not exists obras_achados_abertos_ix on public.obras_auditoria_achados (resolvido, nivel);
alter table public.obras_auditoria_achados enable row level security;
create policy "obras achados leitura" on public.obras_auditoria_achados for select to authenticated using ((select public.obras_pode_ver_fluxo()));
create policy "obras achados administracao" on public.obras_auditoria_achados for all to authenticated
  using ((select public.obras_pode_auditar())) with check ((select public.obras_pode_auditar()));

create or replace function public.obras_norm_forn(t text)
returns text language sql immutable set search_path = public as $$
  select left(regexp_replace(upper(translate(coalesce(t, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
    '(\mLTDA\M|\mME\M|\mEPP\M|\mEIRELI\M|\mS/?A\M|\mCOMERCIO\M|[^A-Z0-9])', '', 'g'), 12)
$$;

-- Registra (ou limpa) um achado. Achado resolvido por pessoa nunca é reaberto nem apagado pelo robô.
create or replace function public.obras_achado(p_comp uuid, p_regra text, p_ativo boolean, p_nivel text, p_msg text, p_det jsonb default null, p_rel uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_ativo then
    insert into public.obras_auditoria_achados (comprovante_id, regra, nivel, mensagem, detalhe, relacionado_id)
    values (p_comp, p_regra, p_nivel, p_msg, p_det, p_rel)
    on conflict ((coalesce(comprovante_id, conta_id)), regra) do update
      set nivel = excluded.nivel, mensagem = excluded.mensagem, detalhe = excluded.detalhe, relacionado_id = excluded.relacionado_id, atualizado_em = now()
      where not public.obras_auditoria_achados.resolvido;
  else
    delete from public.obras_auditoria_achados where comprovante_id = p_comp and regra = p_regra and not resolvido;
  end if;
end $$;

-- 10 regras por despesa (só sinaliza; nunca altera a despesa)
create or replace function public.obras_auditar_comprovante(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.obras_comprovantes; o record; v_p90 numeric; v_n int; v_prest text; v_achou boolean;
begin
  select * into c from public.obras_comprovantes where id = p_id;
  if not found then return; end if;
  if c.status <> 'lancado' then
    delete from public.obras_auditoria_achados where comprovante_id = p_id and not resolvido;
    return;
  end if;
  v_prest := public.obras_prestador_de(c.remetente_numero, c.remetente);

  select id into o from public.obras_comprovantes x
   where x.id <> c.id and x.status = 'lancado' and length(regexp_replace(coalesce(c.autenticacao, ''), '\s', '', 'g')) >= 6
     and regexp_replace(x.autenticacao, '\s', '', 'g') = regexp_replace(c.autenticacao, '\s', '', 'g') limit 1;
  v_achou := found;
  perform public.obras_achado(c.id, 'duplicidade_autenticacao', v_achou, 'critico',
    'Mesma autenticação/NSU de outra despesa já lançada — possível pagamento em dobro.', jsonb_build_object('autenticacao', c.autenticacao), case when v_achou then o.id end);

  select id, hora_documento into o from public.obras_comprovantes x
   where x.id <> c.id and x.status = 'lancado' and x.valor = c.valor and x.data_despesa = c.data_despesa and c.valor > 0
     and public.obras_norm_forn(x.fornecedor) = public.obras_norm_forn(c.fornecedor) and public.obras_norm_forn(c.fornecedor) <> ''
   order by (left(coalesce(x.hora_documento, ''), 5) = left(coalesce(c.hora_documento, ''), 5)) desc limit 1;
  v_achou := found;
  perform public.obras_achado(c.id, 'duplicidade_valor_data_fornecedor', v_achou,
    case when v_achou and left(coalesce(o.hora_documento, ''), 5) <> '' and left(o.hora_documento, 5) = left(coalesce(c.hora_documento, ''), 5) then 'critico' else 'atencao' end,
    'Outra despesa com mesmo valor, mesma data e mesmo fornecedor (' || coalesce(c.fornecedor, '') || ', R$ ' || c.valor || ').',
    jsonb_build_object('valor', c.valor, 'data', c.data_despesa, 'hora', c.hora_documento), case when v_achou then o.id end);

  select id into o from public.obras_comprovantes x
   where x.id <> c.id and x.status = 'lancado' and c.arquivo_hash is not null and x.arquivo_hash = c.arquivo_hash
     and split_part(coalesce(x.wa_msg_id, x.id::text), '#', 1) <> split_part(coalesce(c.wa_msg_id, c.id::text), '#', 1)
     and coalesce(x.prestacao_id::text, '') <> coalesce(c.prestacao_id::text, '') limit 1;
  v_achou := found;
  perform public.obras_achado(c.id, 'arquivo_repetido', v_achou, 'critico', 'O mesmo arquivo de comprovante aparece em outro lançamento.', null, case when v_achou then o.id end);

  perform public.obras_achado(c.id, 'sem_comprovante',
    coalesce(c.arquivo_path, '') = '' or not exists (select 1 from storage.objects s where s.bucket_id = 'obras-comprovantes' and s.name = c.arquivo_path),
    'critico', 'Despesa sem o arquivo do comprovante guardado na nuvem.', jsonb_build_object('arquivo', c.arquivo_path));

  perform public.obras_achado(c.id, 'leitura_baixa_confianca', coalesce(c.confianca_ocr, 1) < 0.6, 'atencao',
    'A IA leu este comprovante com pouca confiança (' || round(coalesce(c.confianca_ocr, 0) * 100) || '%). Conferir valor e data no arquivo.', null);

  select percentile_cont(0.9) within group (order by valor), count(*) into v_p90, v_n
    from public.obras_comprovantes where status = 'lancado' and categoria = c.categoria and id <> c.id;
  perform public.obras_achado(c.id, 'valor_atipico', v_n >= 20 and c.valor > 500 and c.valor > 3 * coalesce(v_p90, 0), 'atencao',
    'Valor bem acima do padrão da categoria (mais de 3x o usual de R$ ' || round(coalesce(v_p90, 0)::numeric, 2) || ').', jsonb_build_object('p90_categoria', v_p90));

  perform public.obras_achado(c.id, 'sem_obra',
    c.obra_id is null and not exists (select 1 from public.obras_remetentes r where r.nome = v_prest and r.obra_id is not null),
    'atencao', 'Despesa sem obra/loja vinculada (' || v_prest || ' ainda não está ligado a uma obra).', null);

  perform public.obras_achado(c.id, 'data_incoerente',
    c.wa_data is not null and (c.data_despesa > (c.wa_data at time zone 'America/Sao_Paulo')::date + 3 or c.data_despesa < (c.wa_data at time zone 'America/Sao_Paulo')::date - 60),
    'atencao', 'Data da despesa muito distante da data em que o comprovante foi enviado.', jsonb_build_object('data_despesa', c.data_despesa, 'enviado', c.wa_data));

  perform public.obras_achado(c.id, 'pix_pessoa_fisica_material',
    c.tipo_doc in ('comprovante_pix', 'comprovante_ted') and c.categoria = 'materiais_insumos'
      and coalesce(c.fornecedor, '') !~* '(LTDA|\mME\M|EPP|EIRELI|S/?A|COMERCIO|MATERIA|CONSTRU|DEPOSITO|LOJA|FERRAG|MADEIR)'
      and coalesce(length(regexp_replace(c.cnpj, '\D', '', 'g')), 0) <> 14,
    'atencao', 'PIX para pessoa física em compra de material — confirmar se o recebedor é mesmo o fornecedor.', jsonb_build_object('recebedor', c.fornecedor));

  select count(*) into v_n from public.obras_comprovantes x
   where x.status = 'lancado' and x.data_despesa = c.data_despesa and public.obras_norm_forn(x.fornecedor) = public.obras_norm_forn(c.fornecedor)
     and public.obras_norm_forn(c.fornecedor) <> '' and public.obras_prestador_de(x.remetente_numero, x.remetente) = v_prest;
  perform public.obras_achado(c.id, 'fornecedor_varias_vezes_dia', v_n >= 3, 'atencao',
    'Mesmo fornecedor pago ' || v_n || ' vezes no mesmo dia pelo mesmo prestador.', jsonb_build_object('vezes', v_n));
end $$;

create or replace function public.obras_auditar_tudo()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.obras_comprovantes loop
    perform public.obras_auditar_comprovante(r.id); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.obras_auditor_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.obras_auditar_comprovante(new.id);
  exception when others then
    raise warning 'obras auditor: %', sqlerrm;  -- o auditor nunca impede o lançamento da despesa
  end;
  return null;
end $$;
create trigger obras_auditor_trg after insert or update of valor, status, fornecedor, autenticacao, data_despesa, hora_documento, arquivo_path, arquivo_hash, confianca_ocr, obra_id
  on public.obras_comprovantes for each row execute function public.obras_auditor_trigger();

select cron.schedule('obras-agente-auditor', '*/30 * * * *', $$select public.obras_auditar_tudo()$$);

-- ---------- 4) Pré-auditoria, Presidente, Financeiro, pós-auditoria ----------
create or replace function public.obras_preauditoria(p_responsavel text, p_semana date)
returns table (risco text, criticos int, atencoes int, pendentes_leitura int, achados jsonb)
language sql stable security definer set search_path = public as $$
  with c as (select * from public.obras_comprovantes where (select public.obras_pode_ver_fluxo()) and responsavel = p_responsavel
               and semana_ref = date_trunc('week', p_semana::timestamp)::date and situacao_pagamento = 'a_pagar'),
       a as (select a.*, c.valor, c.fornecedor, c.data_despesa from public.obras_auditoria_achados a join c on c.id = a.comprovante_id where not a.resolvido)
  select case when count(*) filter (where a.nivel = 'critico') > 0 then 'critico'
              when count(*) filter (where a.nivel = 'atencao') > 0 or (select count(*) from c where status = 'pendente_leitura') > 0 then 'atencao'
              else 'normal' end,
         (count(*) filter (where a.nivel = 'critico'))::int, (count(*) filter (where a.nivel = 'atencao'))::int,
         (select count(*) from c where status = 'pendente_leitura')::int,
         coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'nivel', a.nivel, 'regra', a.regra, 'mensagem', a.mensagem, 'valor', a.valor, 'fornecedor', a.fornecedor, 'data', a.data_despesa)
                  order by a.nivel desc) filter (where a.id is not null), '[]'::jsonb)
  from a
$$;

-- PRESIDENTE: aprova (envia ao Financeiro) ou devolve. Bloqueia aprovação com achado crítico.
create or replace function public.obras_presidente_decidir(p_responsavel text, p_semana date, p_decisao text, p_motivo text default null)
returns public.obras_contas_pagar language plpgsql security definer set search_path = public as $$
declare
  v_sem date := date_trunc('week', p_semana::timestamp)::date; v public.obras_contas_pagar; pa record;
  v_total numeric; v_adiant numeric; r record; v_quem text := public.obras_usuario_nome(); v_nova boolean := false;
begin
  if not public.obras_tem_papel('presidente') then raise exception 'Somente o Presidente pode aprovar ou devolver pagamentos de Obras.'; end if;
  if p_decisao not in ('aprovar', 'devolver') then raise exception 'Decisao invalida: %', p_decisao; end if;
  select coalesce(sum(valor) filter (where status = 'lancado'), 0) into v_total from public.obras_comprovantes
   where responsavel = p_responsavel and semana_ref = v_sem and situacao_pagamento = 'a_pagar';
  select * into v from public.obras_contas_pagar where responsavel = p_responsavel and semana_inicio = v_sem;
  if not found then
    insert into public.obras_contas_pagar (responsavel, prestador, semana_inicio, status) values (p_responsavel, p_responsavel, v_sem, 'fechada') returning * into v;
    v_nova := true;
    insert into public.obras_financeiro_eventos (conta_pagar_id, evento, usuario, detalhes) values (v.id, 'CRIADA', v_quem, jsonb_build_object('total_despesas', v_total));
  end if;
  if v.status in ('paga', 'auditada') then raise exception 'Esta semana ja foi paga.'; end if;
  v_adiant := coalesce(v.valor_adiantado, 0);

  if p_decisao = 'devolver' then
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da devolucao.'; end if;
    update public.obras_contas_pagar set status = 'pendencia', devolvida_em = now(), motivo_devolucao = p_motivo, updated_at = now() where id = v.id returning * into v;
    insert into public.obras_financeiro_eventos (conta_pagar_id, evento, usuario, detalhes) values (v.id, 'DEVOLVIDA', v_quem, jsonb_build_object('motivo', p_motivo));
    return v;
  end if;

  select * into pa from public.obras_preauditoria(p_responsavel, v_sem);
  insert into public.obras_financeiro_eventos (conta_pagar_id, evento, usuario, detalhes)
  values (v.id, 'PRE_AUDITORIA', 'Agente Auditor', jsonb_build_object('risco', pa.risco, 'criticos', pa.criticos, 'atencoes', pa.atencoes, 'pendentes_leitura', pa.pendentes_leitura));
  if pa.criticos > 0 then raise exception 'Pre-auditoria bloqueou: % achado(s) critico(s) em aberto. Resolva ou devolva a semana.', pa.criticos; end if;
  if v_total - v_adiant <= 0 then raise exception 'Nada a reembolsar nesta semana (despesas R$ % - adiantado R$ %).', v_total, v_adiant; end if;

  select * into r from public.obras_remetentes where nome = p_responsavel and ativo order by (pix_chave is not null) desc limit 1;
  update public.obras_contas_pagar set
    status = 'aprovada', aprovado_por = v_quem, aprovada_em = now(), valor_aprovado = v_total - v_adiant,
    favorecido = coalesce(r.titular, p_responsavel), pix_tipo = r.pix_tipo, pix_chave = r.pix_chave, banco = r.banco, agencia = r.agencia, conta = r.conta,
    forma_pagamento = coalesce(forma_pagamento, case when r.pix_chave is not null then 'pix' else 'transferencia' end),
    enviado_financeiro_em = now(), link_expira_em = now() + interval '7 days', updated_at = now()
  where id = v.id returning * into v;
  insert into public.obras_contas_pagar_itens (conta_pagar_id, comprovante_id, favorecido, descricao, valor, status)
  select v.id, c.id, c.fornecedor, coalesce(c.descricao, c.tipo_doc), c.valor, 'enviado_financeiro'
    from public.obras_comprovantes c where c.responsavel = p_responsavel and c.semana_ref = v_sem and c.situacao_pagamento = 'a_pagar' and c.status = 'lancado'
  on conflict (comprovante_id) where comprovante_id is not null do update set status = 'enviado_financeiro', conta_pagar_id = excluded.conta_pagar_id, updated_at = now();
  insert into public.obras_financeiro_eventos (conta_pagar_id, evento, usuario, detalhes)
  values (v.id, 'APROVADA', v_quem, jsonb_build_object('valor_aprovado', v.valor_aprovado, 'risco', pa.risco)),
         (v.id, 'ENVIADA_FINANCEIRO', v_quem, jsonb_build_object('favorecido', v.favorecido, 'pix', v.pix_chave));
  return v;
end $$;

-- PÓS-AUDITORIA: depois do pagamento + comprovante, fecha como auditada ou abre pendência.
create or replace function public.obras_pos_auditar_conta(p_conta uuid)
returns public.obras_contas_pagar language plpgsql security definer set search_path = public as $$
declare v public.obras_contas_pagar; v_prob text[] := '{}';
begin
  select * into v from public.obras_contas_pagar where id = p_conta;
  if not found or v.status not in ('paga', 'pendencia', 'auditada') then return v; end if;
  if coalesce(v.comprovante_url, '') = '' then v_prob := v_prob || 'sem comprovante de pagamento anexado'::text;
  elsif v.comprovante_url !~ '^https?://' and not exists (select 1 from storage.objects s where s.bucket_id = 'obras-comprovantes' and s.name = v.comprovante_url) then
    v_prob := v_prob || 'arquivo do comprovante de pagamento nao encontrado na nuvem'::text; end if;
  if v.aprovada_em is null then v_prob := v_prob || 'pagamento sem aprovacao do Presidente'::text; end if;
  if v.valor_pagamento is null or abs(coalesce(v.valor_pagamento, 0) - coalesce(v.valor_aprovado, 0)) > 0.01 then
    v_prob := v_prob || format('valor pago (R$ %s) diferente do aprovado (R$ %s)', coalesce(v.valor_pagamento, 0), coalesce(v.valor_aprovado, 0)); end if;
  if v.pago_em is not null and v.aprovada_em is not null and v.pago_em < v.aprovada_em then v_prob := v_prob || 'pago antes da aprovacao'::text; end if;
  if exists (select 1 from public.obras_contas_pagar o where o.id <> v.id and o.responsavel = v.responsavel and o.semana_inicio = v.semana_inicio and o.status in ('paga', 'auditada')) then
    v_prob := v_prob || 'existe outro pagamento para o mesmo prestador e semana'::text; end if;
  if array_length(v_prob, 1) is null then
    update public.obras_contas_pagar set status = 'auditada', auditada_em = now(), auditoria_resultado = 'OK - pagamento conferido com o aprovado e comprovante anexado', updated_at = now() where id = v.id returning * into v;
    insert into public.obras_financeiro_eventos (conta_pagar_id, evento, usuario, detalhes) values (v.id, 'AUDITADA', 'Agente Auditor', '{}'::jsonb);
    update public.obras_auditoria_achados set resolvido = true, resolvido_por_nome = 'Agente Auditor', resolvido_em = now(), observacao = 'Pos-auditoria OK'
     where conta_id = v.id and regra = 'pos_auditoria' and not resolvido;
  else
    update public.obras_contas_pagar set status = 'pendencia', auditoria_resultado = array_to_string(v_prob, '; '), updated_at = now() where id = v.id returning * into v;
    insert into public.obras_financeiro_eventos (conta_pagar_id, evento, usuario, detalhes) values (v.id, 'PENDENCIA', 'Agente Auditor', jsonb_build_object('problemas', v_prob));
    insert into public.obras_auditoria_achados (conta_id, regra, nivel, mensagem, detalhe)
    values (v.id, 'pos_auditoria', 'critico', 'Pos-auditoria do pagamento: ' || array_to_string(v_prob, '; '), jsonb_build_object('problemas', v_prob))
    on conflict ((coalesce(comprovante_id, conta_id)), regra) do update set mensagem = excluded.mensagem, detalhe = excluded.detalhe, nivel = 'critico', atualizado_em = now(), resolvido = false;
  end if;
  return v;
end $$;

-- FINANCEIRO: registra o pagamento (ou corrige um pagamento em pendência) com o comprovante.
create or replace function public.obras_financeiro_pagar(p_conta uuid, p_valor numeric, p_comprovante_path text, p_forma text default null, p_observacao text default null)
returns public.obras_contas_pagar language plpgsql security definer set search_path = public as $$
declare v public.obras_contas_pagar; v_quem text := public.obras_usuario_nome(); v_correcao boolean;
begin
  if not public.obras_tem_papel('financeiro') then raise exception 'Somente o Financeiro pode registrar o pagamento.'; end if;
  select * into v from public.obras_contas_pagar where id = p_conta for update;
  if not found then raise exception 'Conta nao encontrada.'; end if;
  v_correcao := v.status = 'pendencia' and v.pago_em is not null;
  if v.status <> 'aprovada' and not v_correcao then
    raise exception 'So e possivel pagar uma semana APROVADA pelo Presidente (status atual: %).', v.status; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor pago.'; end if;
  if coalesce(p_comprovante_path, '') = '' then raise exception 'Anexe o comprovante do pagamento.'; end if;
  update public.obras_contas_pagar set status = 'paga', pago_por = v_quem, pago_em = case when v_correcao then pago_em else now() end, valor_pagamento = p_valor,
    comprovante_url = p_comprovante_path, comprovante_nome = regexp_replace(p_comprovante_path, '^.*/', ''),
    forma_pagamento = coalesce(p_forma, forma_pagamento), observacao = coalesce(p_observacao, observacao), updated_at = now()
  where id = v.id returning * into v;
  update public.obras_contas_pagar_itens set status = 'pago', pago_em = coalesce(pago_em, now()), comprovante_pagamento_url = p_comprovante_path, updated_at = now()
   where conta_pagar_id = v.id and status <> 'cancelado';
  update public.obras_comprovantes c set situacao_pagamento = 'pago', pago_em = coalesce(c.pago_em, now()), updated_at = now()
   where c.id in (select comprovante_id from public.obras_contas_pagar_itens where conta_pagar_id = v.id and comprovante_id is not null) and c.situacao_pagamento <> 'pago';
  if not v_correcao then
    insert into public.obras_financeiro_eventos (conta_pagar_id, evento, usuario, detalhes) values (v.id, 'PAGO', v_quem, jsonb_build_object('valor', p_valor, 'forma', v.forma_pagamento));
  end if;
  insert into public.obras_financeiro_eventos (conta_pagar_id, evento, usuario, detalhes)
  values (v.id, 'COMPROVANTE_ANEXADO', v_quem, jsonb_build_object('arquivo', p_comprovante_path, 'valor', p_valor, 'correcao', v_correcao));
  return public.obras_pos_auditar_conta(v.id);
end $$;

create or replace function public.obras_resolver_achado(p_id uuid, p_observacao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.obras_pode_auditar() or public.obras_tem_papel('auditor')) then raise exception 'Sem permissao para resolver achados.'; end if;
  if coalesce(trim(p_observacao), '') = '' then raise exception 'Explique a resolucao.'; end if;
  update public.obras_auditoria_achados set resolvido = true, resolvido_por = (select auth.uid()), resolvido_por_nome = public.obras_usuario_nome(),
    resolvido_em = now(), observacao = p_observacao, atualizado_em = now() where id = p_id;
end $$;

-- Adiantamento (aprovar/pagar só pelo fluxo Presidente → Financeiro)
create or replace function public.obras_conta_pagar_definir(p_responsavel text, p_semana date,
  p_status text default null, p_adiantado numeric default null, p_observacao text default null)
returns public.obras_contas_pagar language plpgsql security definer set search_path = public as $$
declare v public.obras_contas_pagar; v_sem date := date_trunc('week', p_semana::timestamp)::date;
begin
  if p_status is not null then raise exception 'Aprovacao e pagamento so pelo fluxo Presidente -> Financeiro.'; end if;
  if not (public.obras_pode_auditar() or public.obras_tem_papel('financeiro') or public.obras_tem_papel('presidente')) then
    raise exception 'Sem permissao para registrar adiantamento.'; end if;
  if p_adiantado is not null and p_adiantado < 0 then raise exception 'Adiantamento invalido.'; end if;
  insert into public.obras_contas_pagar as k (responsavel, prestador, semana_inicio, status, valor_adiantado, observacao)
  values (p_responsavel, p_responsavel, v_sem, 'aberta', coalesce(p_adiantado, 0), p_observacao)
  on conflict (responsavel, semana_inicio) do update set
    valor_adiantado = case when k.status in ('paga', 'auditada') then k.valor_adiantado else coalesce(p_adiantado, k.valor_adiantado) end,
    observacao = coalesce(p_observacao, k.observacao), updated_at = now()
  returning * into v;
  return v;
end $$;

create or replace function public.obras_definir_pagamento_prestador(p_prestador text, p_pix_tipo text, p_pix_chave text, p_titular text,
  p_cpf_cnpj text default null, p_banco text default null, p_agencia text default null, p_conta text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.obras_pode_auditar() or public.obras_tem_papel('financeiro')) then raise exception 'Sem permissao para alterar dados de pagamento.'; end if;
  update public.obras_remetentes set pix_tipo = p_pix_tipo, pix_chave = nullif(trim(p_pix_chave), ''), titular = nullif(trim(p_titular), ''),
    cpf_cnpj = nullif(trim(p_cpf_cnpj), ''), banco = nullif(trim(p_banco), ''), agencia = nullif(trim(p_agencia), ''), conta = nullif(trim(p_conta), ''), updated_at = now()
   where nome = p_prestador;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Prestador % nao cadastrado.', p_prestador; end if;
  update public.obras_contas_pagar set favorecido = coalesce(nullif(trim(p_titular), ''), favorecido), pix_tipo = p_pix_tipo, pix_chave = nullif(trim(p_pix_chave), ''),
    banco = nullif(trim(p_banco), ''), agencia = nullif(trim(p_agencia), ''), conta = nullif(trim(p_conta), ''), updated_at = now()
   where responsavel = p_prestador and status = 'aprovada';
  return n;
end $$;

create or replace function public.obras_vincular_remetente(p_numero text, p_nome text)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.obras_pode_auditar() then raise exception 'Sem permissao para vincular remetentes.'; end if;
  if coalesce(trim(p_numero), '') = '' or coalesce(trim(p_nome), '') = '' then raise exception 'Informe numero e nome.'; end if;
  insert into public.obras_remetentes (numero, nome) values (trim(p_numero), trim(p_nome))
  on conflict (numero) do update set nome = excluded.nome, updated_at = now();
  update public.obras_comprovantes set responsavel = trim(p_nome), updated_at = now()
   where remetente_numero = trim(p_numero) and responsavel is distinct from trim(p_nome) and situacao_pagamento = 'a_pagar';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- 5) Views: resumo semanal (com risco e fluxo) e fluxo de caixa por prestador ----------
create or replace view public.obras_contas_pagar_resumo with (security_invoker = true) as
with semanas as (
  select distinct c.responsavel, c.semana_ref as semana_inicio from public.obras_comprovantes c
   where c.situacao_pagamento = 'a_pagar' and c.semana_ref is not null and c.responsavel is not null
  union
  select k.responsavel, k.semana_inicio from public.obras_contas_pagar k where k.status in ('aprovada', 'paga', 'auditada', 'pendencia')
),
base as (
  select s.responsavel, s.semana_inicio,
         count(c.*) filter (where c.status = 'lancado') as qtd_comprovantes,
         coalesce(sum(c.valor) filter (where c.status = 'lancado'), 0) as total_despesas,
         count(c.*) filter (where c.status = 'pendente_leitura') as qtd_pendente_leitura,
         count(c.*) filter (where c.status = 'duplicada') as qtd_duplicados,
         count(c.*) filter (where c.status = 'orcamento') as qtd_orcamentos,
         coalesce(sum(c.valor) filter (where c.status = 'orcamento'), 0) as total_orcamentos,
         min(c.wa_data) as primeiro_recibo, max(c.wa_data) as ultimo_recibo,
         count(a.*) filter (where a.nivel = 'critico') as criticos, count(a.*) filter (where a.nivel = 'atencao') as atencoes
  from semanas s
  left join public.obras_contas_pagar k0 on k0.responsavel = s.responsavel and k0.semana_inicio = s.semana_inicio
  left join public.obras_comprovantes c on c.responsavel = s.responsavel and c.semana_ref = s.semana_inicio
        and (c.situacao_pagamento = 'a_pagar' or c.id in (select i.comprovante_id from public.obras_contas_pagar_itens i where i.conta_pagar_id = k0.id))
  left join public.obras_auditoria_achados a on a.comprovante_id = c.id and not a.resolvido and c.status = 'lancado'
  group by 1, 2
)
select b.responsavel, b.responsavel as nome, b.semana_inicio, (b.semana_inicio + 6) as semana_fim,
       b.qtd_comprovantes, b.total_despesas, b.qtd_pendente_leitura, b.qtd_duplicados, b.qtd_orcamentos, b.total_orcamentos,
       b.primeiro_recibo, b.ultimo_recibo,
       coalesce(k.valor_adiantado, 0) as valor_adiantado,
       coalesce(k.valor_aprovado, b.total_despesas - coalesce(k.valor_adiantado, 0)) as valor_reembolso,
       case when k.status in ('aprovada', 'paga', 'auditada', 'pendencia') then k.status
            when (b.semana_inicio + 6) < (now() at time zone 'America/Sao_Paulo')::date then 'fechada'
            else 'aberta' end as status,
       k.id as conta_id, k.aprovada_em, k.pago_em, k.observacao,
       case when b.criticos > 0 or k.status = 'pendencia' then 'critico' when b.atencoes > 0 or b.qtd_pendente_leitura > 0 then 'atencao' else 'normal' end as risco,
       b.criticos, b.atencoes,
       k.aprovado_por, k.enviado_financeiro_em, k.valor_aprovado, k.pago_por, k.valor_pagamento, k.comprovante_url,
       k.auditada_em, k.auditoria_resultado, k.motivo_devolucao, k.favorecido, k.pix_tipo, k.pix_chave, k.forma_pagamento
from base b
left join public.obras_contas_pagar k on k.responsavel = b.responsavel and k.semana_inicio = b.semana_inicio;

create or replace view public.obras_fluxo_caixa_prestador with (security_invoker = true) as
with d as (
  select c.responsavel as prestador, c.semana_ref as semana,
         coalesce(sum(c.valor) filter (where c.status = 'lancado'), 0) as despesas,
         coalesce(sum(c.valor) filter (where c.status = 'lancado' and c.situacao_pagamento = 'pago'), 0) as despesas_pagas,
         coalesce(sum(c.valor) filter (where c.status = 'lancado' and c.situacao_pagamento = 'a_pagar'), 0) as despesas_a_pagar,
         count(*) filter (where c.status = 'lancado') as qtd
  from public.obras_comprovantes c where c.responsavel is not null and c.semana_ref is not null group by 1, 2
),
k as (select responsavel as prestador, semana_inicio as semana, valor_adiantado, valor_aprovado, valor_pagamento, status from public.obras_contas_pagar)
select coalesce(d.prestador, k.prestador) as prestador, coalesce(d.semana, k.semana) as semana, coalesce(d.semana, k.semana) + 6 as semana_fim,
       coalesce(d.qtd, 0) as qtd_despesas, coalesce(d.despesas, 0) as despesas, coalesce(d.despesas_pagas, 0) as despesas_pagas,
       coalesce(d.despesas_a_pagar, 0) as despesas_a_pagar, coalesce(k.valor_adiantado, 0) as adiantado,
       k.valor_aprovado as aprovado, k.valor_pagamento as reembolso_pago, coalesce(k.status, case when d.despesas_a_pagar > 0 then 'a_pagar' else 'pago' end) as situacao,
       sum(coalesce(d.despesas_a_pagar, 0) - case when k.status in ('paga', 'auditada') then 0 else coalesce(k.valor_adiantado, 0) end)
         over (partition by coalesce(d.prestador, k.prestador) order by coalesce(d.semana, k.semana)) as saldo_a_pagar_acumulado,
       sum(coalesce(d.despesas, 0)) over (partition by coalesce(d.prestador, k.prestador) order by coalesce(d.semana, k.semana)) as despesas_acumuladas
from d full join k on k.prestador = d.prestador and k.semana = d.semana;

-- ---------- 6) Permissões (só as ações com checagem de papel ficam abertas a usuários logados) ----------
revoke all on public.obras_contas_pagar_resumo, public.obras_fluxo_caixa_prestador from anon;
grant select on public.obras_contas_pagar_resumo, public.obras_fluxo_caixa_prestador to authenticated;
revoke execute on function public.obras_achado(uuid, text, boolean, text, text, jsonb, uuid), public.obras_auditar_comprovante(uuid), public.obras_auditar_tudo(),
  public.obras_pos_auditar_conta(uuid), public.obras_auditor_trigger(), public.obras_responsavel_trigger(), public.obras_prestador_de(text, text),
  public.obras_usuario_nome() from public, anon, authenticated;
revoke execute on function public.obras_pode_ver_fluxo(), public.obras_preauditoria(text, date), public.obras_tem_papel(text),
  public.obras_presidente_decidir(text, date, text, text), public.obras_financeiro_pagar(uuid, numeric, text, text, text),
  public.obras_resolver_achado(uuid, text), public.obras_conta_pagar_definir(text, date, text, numeric, text),
  public.obras_definir_pagamento_prestador(text, text, text, text, text, text, text, text), public.obras_vincular_remetente(text, text) from public, anon;
grant execute on function public.obras_pode_ver_fluxo(), public.obras_preauditoria(text, date), public.obras_tem_papel(text),
  public.obras_presidente_decidir(text, date, text, text), public.obras_financeiro_pagar(uuid, numeric, text, text, text),
  public.obras_resolver_achado(uuid, text), public.obras_conta_pagar_definir(text, date, text, numeric, text),
  public.obras_definir_pagamento_prestador(text, text, text, text, text, text, text, text), public.obras_vincular_remetente(text, text) to authenticated;
