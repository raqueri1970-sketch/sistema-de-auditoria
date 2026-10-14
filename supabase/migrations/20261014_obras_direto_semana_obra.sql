-- Obras & Reformas (14/10/2026) — pedido do Ricardo:
--  1. Nota fiscal com vários produtos = UMA despesa com o total da nota (a IA quebrava o cupom em itens: Casa dos Parafusos virou 12 linhas).
--  2. Sem "Desconhecido": todo lançamento vai para um prestador. Nomes do WhatsApp ("Eng. Josemar Henrique", "Jhony Pedi")
--     viram o prestador cadastrado ("Josemar Henrique", "Jhony") e o número novo é aprendido sozinho.
--  3. Despesa distribuída por OBRA (loja) pela legenda/descrição/cidade: Maceió Centro, Petrolina, Shopping Recife, Pesqueira, CD.
--  4. Sem Financeiro: o fluxo é direto despesa → pagamento ("Já paguei"). Orçamento pode ser marcado como pago na hora.
--  5. Fechamento por semana: quando tudo da semana/prestação está pago, a prestação de contas fica QUITADA sozinha.

-- ───────────────────────── 1. Prestador canônico ─────────────────────────
create or replace function public.obras_norm_nome(t text)
returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(
    lower(translate(coalesce(t, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')),
    '\m(eng|enga|engo|engenheiro|engenheira|arq|sr|sra|dr|dra|mestre)\M\.?', ' ', 'g'), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Prestadores conhecidos: cadastro de números, prestações, adiantamentos e pagamentos.
create or replace function public.obras_prestador_canonico(p_nome text)
returns text language sql stable security definer set search_path = public as $$
  with k as (
    select distinct nome from (
      select nome from public.obras_remetentes where ativo
      union select responsavel from public.obras_prestacoes
      union select prestador from public.obras_adiantamentos
      union select prestador from public.obras_pagamentos) x
    where nome is not null and public.obras_norm_nome(nome) <> ''
  ), c as (select public.obras_norm_nome(p_nome) n)
  select k.nome from k, c
   where c.n <> ''
     and (public.obras_norm_nome(k.nome) = c.n
          -- "eng josemar henrique" contém "josemar henrique"; "jhony pedi" contém "jhony"
          or (' ' || c.n || ' ') like ('% ' || public.obras_norm_nome(k.nome) || ' %')
          or (length(c.n) >= 5 and (' ' || public.obras_norm_nome(k.nome) || ' ') like ('% ' || c.n || ' %')))
   order by (public.obras_norm_nome(k.nome) = c.n) desc, length(k.nome) desc
   limit 1
$$;

-- Nunca mais "Desconhecido" nem número solto: cadastro → nome conhecido → nome do WhatsApp → "A definir" (a tela pede para alocar).
create or replace function public.obras_prestador_de(p_numero text, p_remetente text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select r.nome from public.obras_remetentes r where r.numero = p_numero),
                  public.obras_prestador_canonico(p_remetente),
                  nullif(nullif(trim(coalesce(p_remetente, '')), ''), 'Desconhecido'),
                  'A definir')
$$;

create or replace function public.obras_responsavel_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_doc text; v_can text;
begin
  if exists (select 1 from public.obras_admins a where a.numero = new.remetente_numero and a.ativo) then
    -- Enviado pelo adm (Ricardo): o prestador sai do próprio documento (nome na capa, recebedor, legenda).
    if new.responsavel is null or new.responsavel = new.remetente or new.responsavel like 'A definir%'
       or exists (select 1 from public.obras_admins a where a.nome = new.responsavel)
       or (tg_op = 'UPDATE' and new.remetente_numero is distinct from old.remetente_numero) then
      v_doc := public.obras_prestador_do_documento(
                 concat_ws(' ', new.ia_json->'resumo'->>'responsavel', new.fornecedor, new.legenda, new.arquivo_nome));
      new.responsavel := coalesce(v_doc, 'A definir');
    end if;
    return new;
  end if;
  if new.responsavel is null or new.responsavel in ('Desconhecido', 'A definir')
     or (tg_op = 'UPDATE' and new.remetente_numero is distinct from old.remetente_numero) then
    new.responsavel := public.obras_prestador_de(new.remetente_numero, new.remetente);
  end if;
  -- Nome do WhatsApp com título/sobrenome vira o prestador cadastrado; número novo dele é aprendido.
  if new.status <> 'pagamento' then
    v_can := public.obras_prestador_canonico(new.responsavel);
    if v_can is not null and v_can <> new.responsavel then new.responsavel := v_can; end if;
    if v_can is not null and coalesce(new.remetente_numero, '') <> ''
       and not exists (select 1 from public.obras_remetentes r where r.numero = new.remetente_numero)
       and not exists (select 1 from public.obras_admins a where a.numero = new.remetente_numero)
       and not exists (select 1 from public.obras_pagadores p where p.numero = new.remetente_numero) then
      insert into public.obras_remetentes (numero, nome, obra_id, ativo)
      select new.remetente_numero, v_can, (select r.obra_id from public.obras_remetentes r where r.nome = v_can and r.obra_id is not null limit 1), true
      on conflict (numero) do nothing;
    end if;
  end if;
  if coalesce(new.remetente, '') in ('', 'Desconhecido') and new.status = 'pagamento' then
    new.remetente := coalesce(new.responsavel, 'Presidente');
  end if;
  return new;
end $$;

-- ───────────────────────── 2. Obras (lojas) ─────────────────────────
alter table public.obras add column if not exists palavras text[];

insert into public.obras (codigo, nome, localizacao, status, palavras, created_by)
select v.codigo, v.nome, v.localizacao, 'em_andamento', v.palavras, (select created_by from public.obras order by created_at limit 1)
  from (values
  ('MCZ-CENTRO', 'Loja Maceió Centro', 'Maceió/AL', array['maceio centro', 'maceio']),
  ('PETROLINA', 'Loja Petrolina', 'Petrolina/PE', array['petrolina']),
  ('REC-SHOPPING', 'Loja Shopping Recife', 'Recife/PE', array['shopping recife', 'esposende shopping recife', 'recife', 'boa vista']),
  ('PESQUEIRA', 'Loja Pesqueira', 'Pesqueira/PE', array['pesqueira']),
  ('CD', 'CD (Centro de Distribuição)', 'CD', array['cd', 'centro de distribuicao'])) v(codigo, nome, localizacao, palavras)
on conflict (codigo) do update set palavras = excluded.palavras;

-- Obra citada num texto (legenda, descrição, cidade). A palavra mais longa vence ("maceio centro" antes de "maceio").
create or replace function public.obras_obra_de(p_texto text)
returns uuid language sql stable security definer set search_path = public as $$
  select o.id from public.obras o, unnest(o.palavras) p
   where coalesce(p_texto, '') <> '' and o.status <> 'concluida'
     and (' ' || public.obras_norm_nome(p_texto) || ' ') like ('% ' || public.obras_norm_nome(p) || ' %')
   order by length(p) desc limit 1
$$;

-- Distribui a despesa na obra: legenda do WhatsApp → descrição → cidade lida no documento → obra padrão do prestador.
create or replace function public.obras_obra_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.obra_id is null then
    new.obra_id := coalesce(public.obras_obra_de(new.legenda), public.obras_obra_de(new.descricao), public.obras_obra_de(new.loja),
      (select r.obra_id from public.obras_remetentes r where r.nome = new.responsavel and r.obra_id is not null and r.ativo limit 1));
  end if;
  return new;
end $$;
-- Gatilhos BEFORE rodam em ordem alfabética: este nome roda depois do obras_responsavel_trg (precisa do prestador já definido).
create trigger obras_z_obra_trg before insert or update of obra_id, legenda, descricao, loja, responsavel on public.obras_comprovantes
  for each row execute function public.obras_obra_trigger();

-- ───────────────────────── 3. Nota fiscal = uma despesa só ─────────────────────────
-- Funções internas ficam no schema obras_interno (não exposto pela API), sem precisar de REVOKE.
create schema if not exists obras_interno;
-- Junta os itens de uma mesma nota (mesma mensagem, mesmo fornecedor, mesma data, mesma autenticação) numa despesa com o total.
-- Os itens somados ficam como status "agrupado" (não somam de novo). Só notas ainda sem pagamento (o que já foi pago fica como está).
create or replace function obras_interno.consolidar_nota(p_nota text)
returns int language plpgsql security definer set search_path = public as $$
declare g record; v_keep uuid; v_resto uuid[]; v_n int := 0;
begin
  for g in
    select public.obras_norm_forn(fornecedor) f, data_despesa d, coalesce(regexp_replace(autenticacao, '[[:space:]]', '', 'g'), '') a,
           array_agg(id order by length(wa_msg_id), wa_msg_id) ids, sum(valor) total, count(*) n,
           string_agg(coalesce(nullif(trim(descricao), ''), 'item') || ' R$ ' || replace(to_char(valor, 'FM9999990.00'), '.', ','), '; ' order by length(wa_msg_id), wa_msg_id) itens
      from public.obras_comprovantes c
     where public.obras_nota_de(wa_msg_id, arquivo_path, id) = p_nota and origem = 'whatsapp' and status = 'lancado'
       and tipo_doc in ('cupom_fiscal', 'nf', 'nfs', 'recibo') and situacao_pagamento = 'a_pagar'
       and not exists (select 1 from public.obras_pagamento_itens i where i.comprovante_id = c.id)
     group by 1, 2, 3 having count(*) > 1
  loop
    v_keep := g.ids[1];
    v_resto := g.ids[2:array_length(g.ids, 1)];
    update public.obras_comprovantes set status = 'agrupado', updated_at = now(),
           descricao = left('Item somado na nota ' || coalesce((select wa_msg_id from public.obras_comprovantes where id = v_keep), '') || ': ' || coalesce(descricao, ''), 500)
     where id = any(v_resto);
    update public.obras_comprovantes set valor = g.total, updated_at = now(),
           descricao = left('Nota com ' || g.n || ' itens: ' || g.itens, 2000)
     where id = v_keep;
    perform public.obras_pag_evento(null, v_keep, (select responsavel from public.obras_comprovantes where id = v_keep), 'NOTA_TOTALIZADA', 'Sistema',
      jsonb_build_object('itens', g.n, 'total', g.total));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Rede de segurança: mesmo um capturador com código antigo que mande a nota quebrada em itens tem a nota totalizada ao gravar.
create or replace function public.obras_consolidar_novos()
returns trigger language plpgsql security definer set search_path = public as $$
declare n text;
begin
  for n in select distinct public.obras_nota_de(wa_msg_id, arquivo_path, id) from novos
            where origem = 'whatsapp' and status = 'lancado' and tipo_doc in ('cupom_fiscal', 'nf', 'nfs', 'recibo') loop
    begin perform obras_interno.consolidar_nota(n);
    exception when others then raise warning 'obras consolidar nota %: %', n, sqlerrm; end;
  end loop;
  return null;
end $$;
create trigger obras_consolidar_trg after insert on public.obras_comprovantes
  referencing new table as novos for each statement execute function public.obras_consolidar_novos();

-- ───────────────────────── 4. Sem Financeiro: despesa → pagamento direto ─────────────────────────
-- O Presidente só registra "Já paguei" (o modo "financeiro" deixa de existir).
do $$
declare d text;
begin
  select pg_get_functiondef('public.obras_presidente_pagar(text, jsonb, text, boolean, text, text)'::regprocedure) into d;
  if position('O Financeiro saiu do fluxo' in d) = 0 then
    d := replace(d, $q$if p_modo not in ('financeiro', 'ja_paguei') then raise exception 'Opcao invalida: %', p_modo; end if;$q$,
      $q$if p_modo = 'financeiro' then raise exception 'O Financeiro saiu do fluxo: marque as despesas e use "Já paguei".'; end if;
  if p_modo <> 'ja_paguei' then raise exception 'Opcao invalida: %', p_modo; end if;$q$);
    execute d;
  end if;
end $$;

-- Orçamento marcado como pago direto (e distribuído na obra).
create or replace function public.obras_orcamento_pago(p_comp uuid, p_obra uuid default null, p_observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c record; v_quem text := public.obras_usuario_nome();
begin
  if not public.obras_tem_papel('presidente') then raise exception 'Somente o Presidente marca orçamento como pago.'; end if;
  select * into c from public.obras_despesas_pagamento where id = p_comp;
  if not found then raise exception 'Documento nao encontrado.'; end if;
  if c.status <> 'orcamento' then raise exception 'Este documento nao e um orcamento.'; end if;
  update public.obras_comprovantes set status = 'lancado', situacao_pagamento = 'pago', pago_em = now(),
         obra_id = coalesce(p_obra, obra_id), updated_at = now() where id = p_comp;
  perform public.obras_pag_evento(null, p_comp, c.prestador, 'ORCAMENTO_PAGO', v_quem,
    jsonb_build_object('valor', c.valor, 'fornecedor', c.fornecedor, 'obra', p_obra, 'observacao', p_observacao));
end $$;

-- Obra na despesa (ajuste do administrador/Presidente).
create or replace function public.obras_despesa_obra(p_comp uuid, p_obra uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not (public.obras_tem_papel('__admin__') or public.obras_tem_papel('presidente')) then raise exception 'Sem permissao para mudar a obra.'; end if;
  select id, responsavel, obra_id into c from public.obras_comprovantes where id = p_comp;
  if not found then raise exception 'Despesa nao encontrada.'; end if;
  update public.obras_comprovantes set obra_id = p_obra, updated_at = now() where id = p_comp;
  perform public.obras_pag_evento(null, p_comp, c.responsavel, 'OBRA_DEFINIDA', public.obras_usuario_nome(), jsonb_build_object('antes', c.obra_id, 'depois', p_obra));
end $$;

-- Alocar despesa "A definir" a um prestador (vale também para o Presidente, não só o administrador).
create or replace function public.obras_despesa_alocar(p_comp uuid, p_prestador text)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not (public.obras_tem_papel('__admin__') or public.obras_tem_papel('presidente')) then raise exception 'Sem permissao para alocar.'; end if;
  if coalesce(trim(p_prestador), '') = '' then raise exception 'Escolha o prestador.'; end if;
  select * into c from public.obras_despesas_pagamento where id = p_comp;
  if not found then raise exception 'Despesa nao encontrada.'; end if;
  if c.valor_pago > 0 and c.ultimo_pagamento_numero is not null then raise exception 'Esta despesa ja entrou em pagamento.'; end if;
  update public.obras_comprovantes set responsavel = trim(p_prestador), revisado = true, updated_at = now() where id = p_comp;
  perform public.obras_pag_evento(null, p_comp, trim(p_prestador), 'PRESTADOR_ALOCADO', public.obras_usuario_nome(), jsonb_build_object('antes', c.prestador));
end $$;

-- ───────────────────────── 5. Prestação de contas quitada ─────────────────────────
-- quitada_em preenchida = prestação QUITADA (todas as despesas dela/da semana pagas). Volta a null se reabrir.
alter table public.obras_prestacoes add column if not exists quitada_em timestamptz;

create or replace function obras_interno.quitar_prestacoes(p_prestador text default null)
returns int language plpgsql security definer set search_path = public as $$
declare p record; v_tem int; v_aberto int; v_ult timestamptz; v_n int := 0;
begin
  for p in select * from public.obras_prestacoes where p_prestador is null or responsavel = p_prestador loop
    select count(*), count(*) filter (where c.situacao_pagamento = 'a_pagar'), max(c.pago_em)
      into v_tem, v_aberto, v_ult
      from public.obras_comprovantes c
     where c.status = 'lancado'
       and (c.prestacao_id = p.id
            or (c.prestacao_id is null and p.periodo_inicio is not null and c.responsavel = p.responsavel
                and c.data_despesa between p.periodo_inicio and coalesce(p.periodo_fim, p.periodo_inicio + 6)));
    if v_tem > 0 and v_aberto = 0 and p.quitada_em is null then
      update public.obras_prestacoes set quitada_em = coalesce(v_ult, now()), updated_at = now() where id = p.id;
      v_n := v_n + 1;
    elsif v_aberto > 0 and p.quitada_em is not null then
      update public.obras_prestacoes set quitada_em = null, updated_at = now() where id = p.id;
    end if;
  end loop;
  return v_n;
end $$;

create or replace function public.obras_quitar_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  for r in select distinct responsavel from novos where responsavel is not null and status = 'lancado' loop
    begin perform obras_interno.quitar_prestacoes(r);
    exception when others then raise warning 'obras quitar prestacoes: %', sqlerrm; end;
  end loop;
  return null;
end $$;
create trigger obras_quitar_trg after update on public.obras_comprovantes
  referencing new table as novos for each statement execute function public.obras_quitar_trigger();
