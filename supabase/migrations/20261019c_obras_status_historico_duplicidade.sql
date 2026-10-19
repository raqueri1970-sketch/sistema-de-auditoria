-- Obras (19/10/2026, pedido do Ricardo)
-- 1) Status reversível com histórico: um comprovante cancelado por engano pode voltar a "Lançado" (ou outro status).
--    Toda troca de status fica registrada em obras_status_historico (de, para, motivo, quem, quando), feita por trigger —
--    vale para a tela, para o robô e para qualquer outro caminho.
-- 2) Duplicidade só quando é o MESMO documento: mesma autenticação/NSU/nº do documento (regra já existente), mesmo arquivo
--    (regra já existente) ou mesmo favorecido + valor + data + HORA COM SEGUNDOS. Mesmo valor, data e fornecedor com horário
--    diferente, sem horário ou só até os minutos NÃO é mais apontado como duplicidade.

alter table public.obras_comprovantes        add column if not exists status_motivo text;
alter table public.obras_comprovantes_sombra add column if not exists status_motivo text;

create table if not exists public.obras_status_historico (
  id             bigint generated always as identity primary key,
  comprovante_id uuid not null references public.obras_comprovantes(id) on delete cascade,
  status_de      text,
  status_para    text,
  motivo         text,
  alterado_por   text,
  alterado_em    timestamptz not null default now()
);
create index if not exists obras_status_historico_comp on public.obras_status_historico (comprovante_id, alterado_em desc);
alter table public.obras_status_historico enable row level security;
drop policy if exists "obras status historico leitura" on public.obras_status_historico;
create policy "obras status historico leitura" on public.obras_status_historico for select to authenticated
  using ((select public.obras_pode_auditar()) or (select public.obras_pode_ver_fluxo()) or (select public.portal_pode_ver()));

create or replace function public.obras_status_historico_trigger() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status is distinct from old.status then
    -- o motivo só vale se veio junto nesta alteração (senão repetiria o motivo de uma troca anterior)
    insert into public.obras_status_historico (comprovante_id, status_de, status_para, motivo, alterado_por)
    values (new.id, old.status, new.status,
            case when new.status_motivo is distinct from old.status_motivo then nullif(trim(coalesce(new.status_motivo, '')), '') end,
            coalesce(nullif(auth.jwt() ->> 'email', ''), 'robô / sistema'));
  end if;
  return null;
end $$;
drop trigger if exists obras_status_historico_trg on public.obras_comprovantes;
create trigger obras_status_historico_trg after update of status on public.obras_comprovantes
  for each row execute function public.obras_status_historico_trigger();

-- Hora com segundos (HH:MM:SS) normalizada; null quando o comprovante não mostra os segundos.
create or replace function public.obras_hora_seg(h text) returns text language sql immutable as $$
  select case when h ~ '^\s*\d{1,2}:\d{2}:\d{2}' then lpad(split_part(trim(h), ':', 1), 2, '0') || ':' || substring(trim(h) from '^\d{1,2}:(\d{2}:\d{2})') end
$$;

-- Auditor: igual à versão anterior, só o bloco "duplicidade_valor_data_fornecedor" mudou (agora exige hora com segundos igual).
CREATE OR REPLACE FUNCTION public.obras_auditar_comprovante(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 19/10/2026: só é o MESMO documento se, além de valor + data + favorecido, a hora do comprovante bater ATÉ OS SEGUNDOS.
  select id, hora_documento into o from public.obras_comprovantes x
   where x.id <> c.id and x.status = 'lancado' and x.valor = c.valor and x.data_despesa = c.data_despesa and c.valor > 0
     and public.obras_norm_forn(x.fornecedor) = public.obras_norm_forn(c.fornecedor) and public.obras_norm_forn(c.fornecedor) <> ''
     and public.obras_hora_seg(c.hora_documento) is not null and public.obras_hora_seg(x.hora_documento) = public.obras_hora_seg(c.hora_documento)
     and public.obras_nota_de(x.wa_msg_id, x.arquivo_path, x.id) <> v_nota
   limit 1;
  v_achou := found;
  perform public.obras_achado(c.id, 'duplicidade_valor_data_fornecedor', v_achou, 'critico',
    'Mesmo documento de outra despesa já lançada: mesmo favorecido (' || coalesce(c.fornecedor, '') || '), valor R$ ' || c.valor || ', data e hora ' || coalesce(public.obras_hora_seg(c.hora_documento), '') || ' (até os segundos).',
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

  select count(distinct public.obras_nota_de(x.wa_msg_id, x.arquivo_path, x.id)) into v_n from public.obras_comprovantes x
   where x.status = 'lancado' and x.data_despesa = c.data_despesa and public.obras_norm_forn(x.fornecedor) = public.obras_norm_forn(c.fornecedor)
     and public.obras_norm_forn(c.fornecedor) <> '' and public.obras_prestador_de(x.remetente_numero, x.remetente) = v_prest;
  perform public.obras_achado(c.id, 'fornecedor_varias_vezes_dia', v_n >= 3, 'atencao',
    'Mesmo fornecedor pago ' || v_n || ' vezes no mesmo dia pelo mesmo prestador.', jsonb_build_object('vezes', v_n));
  perform obras_interno.auditar_fraude(c.id);
end $function$;
