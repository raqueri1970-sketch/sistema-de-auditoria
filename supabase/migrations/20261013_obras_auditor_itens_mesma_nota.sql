-- =====================================================================================================
-- OBRAS & REFORMAS — Auditor não acusa "pagamento em dobro" entre itens da MESMA nota (13/10/2026)
-- O capturador quebra um cupom em vários itens (wa_msg_id "XXXX#0", "XXXX#1", ...). Todos têm a mesma
-- autenticação/NSU e o mesmo fornecedor/data, e o Auditor acusava cada item como duplicata dos irmãos.
-- Agora as regras de duplicidade ignoram itens da mesma mensagem/arquivo e a regra "fornecedor várias vezes
-- no dia" conta notas, não itens. Também cria a aprovação em lote (nota inteira) dos pontos do Auditor.
-- =====================================================================================================

-- Chave da nota de origem: a mensagem do WhatsApp sem o sufixo "#n" do item.
create or replace function public.obras_nota_de(p_wa_msg_id text, p_arquivo text, p_id uuid)
returns text language sql immutable as $$
  select coalesce(nullif(split_part(coalesce(p_wa_msg_id, ''), '#', 1), ''), nullif(p_arquivo, ''), p_id::text)
$$;

create or replace function public.obras_auditar_comprovante(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  c public.obras_comprovantes; o record; v_p90 numeric; v_n int; v_prest text; v_achou boolean; v_nota text;
begin
  select * into c from public.obras_comprovantes where id = p_id;
  if not found then return; end if;
  if c.status <> 'lancado' then
    delete from public.obras_auditoria_achados where comprovante_id = p_id and not resolvido;
    return;
  end if;
  v_prest := public.obras_prestador_de(c.remetente_numero, c.remetente);
  v_nota := public.obras_nota_de(c.wa_msg_id, c.arquivo_path, c.id);

  select id into o from public.obras_comprovantes x
   where x.id <> c.id and x.status = 'lancado' and length(regexp_replace(coalesce(c.autenticacao, ''), '\s', '', 'g')) >= 6
     and regexp_replace(x.autenticacao, '\s', '', 'g') = regexp_replace(c.autenticacao, '\s', '', 'g')
     and public.obras_nota_de(x.wa_msg_id, x.arquivo_path, x.id) <> v_nota
     and coalesce(x.arquivo_path, '') <> coalesce(c.arquivo_path, '-') limit 1;
  v_achou := found;
  perform public.obras_achado(c.id, 'duplicidade_autenticacao', v_achou, 'critico',
    'Mesma autenticação/NSU de outra despesa já lançada — possível pagamento em dobro.', jsonb_build_object('autenticacao', c.autenticacao), case when v_achou then o.id end);

  select id, hora_documento into o from public.obras_comprovantes x
   where x.id <> c.id and x.status = 'lancado' and x.valor = c.valor and x.data_despesa = c.data_despesa and c.valor > 0
     and public.obras_norm_forn(x.fornecedor) = public.obras_norm_forn(c.fornecedor) and public.obras_norm_forn(c.fornecedor) <> ''
     and public.obras_nota_de(x.wa_msg_id, x.arquivo_path, x.id) <> v_nota
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

  -- Conta NOTAS distintas (itens da mesma nota contam uma vez só).
  select count(distinct public.obras_nota_de(x.wa_msg_id, x.arquivo_path, x.id)) into v_n from public.obras_comprovantes x
   where x.status = 'lancado' and x.data_despesa = c.data_despesa and public.obras_norm_forn(x.fornecedor) = public.obras_norm_forn(c.fornecedor)
     and public.obras_norm_forn(c.fornecedor) <> '' and public.obras_prestador_de(x.remetente_numero, x.remetente) = v_prest;
  perform public.obras_achado(c.id, 'fornecedor_varias_vezes_dia', v_n >= 3, 'atencao',
    'Mesmo fornecedor pago ' || v_n || ' vezes no mesmo dia pelo mesmo prestador.', jsonb_build_object('vezes', v_n));
end $function$;

-- Aprovação em lote: resolve vários pontos de uma vez (ex.: todos os itens de uma nota), com o nome de quem aprovou.
create or replace function public.obras_resolver_achados(p_ids uuid[], p_observacao text)
 returns int language plpgsql security definer set search_path to 'public'
as $function$
declare v_n int;
begin
  if not (public.obras_pode_auditar() or public.obras_tem_papel('auditor') or public.obras_tem_papel('presidente')) then
    raise exception 'Sem permissao para resolver achados.'; end if;
  if coalesce(trim(p_observacao), '') = '' then raise exception 'Explique a resolucao.'; end if;
  update public.obras_auditoria_achados set resolvido = true, resolvido_por = (select auth.uid()), resolvido_por_nome = public.obras_usuario_nome(),
    resolvido_em = now(), observacao = trim(p_observacao), atualizado_em = now()
   where id = any(p_ids) and not resolvido;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke all on function public.obras_resolver_achados(uuid[], text) from public, anon;
grant execute on function public.obras_resolver_achados(uuid[], text) to authenticated;

-- Reaudita o que tem ponto aberto das regras alteradas (limpa os falsos "pagamento em dobro" entre itens da mesma nota).
select public.obras_auditar_comprovante(a.comprovante_id)
  from (select distinct comprovante_id from public.obras_auditoria_achados
         where not resolvido and comprovante_id is not null
           and regra in ('duplicidade_autenticacao', 'duplicidade_valor_data_fornecedor', 'fornecedor_varias_vezes_dia')) a;
