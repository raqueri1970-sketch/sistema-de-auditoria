-- Obras & Reformas (14/10/2026, 2ª parte) — pedido do Ricardo:
--  * Paulo Almeida é o Presidente (quem paga), não prestador: sai do saldo por prestador e não pode receber despesa alocada.
--  * Agente Auditor aponta POSSÍVEL FRAUDE / DESVIO DE FINALIDADE em todas as despesas (inclusive as já pagas)
--    e a IA do capturador audita a FOTO de cada comprovante (coluna auditoria_ia).
-- (Aplicado no Supabase pelo SQL editor; as funções usam create or replace sobre a definição atual.)

-- 1. Presidente fora do saldo por prestador
do $$
declare d text;
begin
  d := pg_get_viewdef('public.obras_saldo_prestador'::regclass);
  if position('obras_pagador_nomes' in d) = 0 then
    d := replace(d, $q$((obras_despesas_pagamento.prestador IS NOT NULL) AND (obras_despesas_pagamento.status <> 'pagamento'::text))$q$,
      $q$((obras_despesas_pagamento.prestador IS NOT NULL) AND (obras_despesas_pagamento.status <> 'pagamento'::text)
          AND (NOT (obras_despesas_pagamento.prestador IN (SELECT n.nome FROM obras_pagador_nomes n))))$q$);
    execute 'create or replace view public.obras_saldo_prestador as ' || d;
  end if;
end $$;
do $$
declare d text;
begin
  d := pg_get_functiondef('public.obras_despesa_alocar(uuid, text)'::regprocedure);
  if position('obras_pagador_nomes' in d) = 0 then
    d := replace(d, $q$if coalesce(trim(p_prestador), '') = '' then raise exception 'Escolha o prestador.'; end if;$q$,
      $q$if coalesce(trim(p_prestador), '') = '' then raise exception 'Escolha o prestador.'; end if;
  if exists (select 1 from public.obras_pagador_nomes n where n.nome = trim(p_prestador)) then raise exception '% é quem paga (Presidente), não é prestador.', trim(p_prestador); end if;$q$);
    execute d;
  end if;
end $$;

-- 2. Leitura antifraude da foto pela IA
alter table public.obras_comprovantes add column if not exists auditoria_ia jsonb;

-- 3. Regras de fraude / desvio de finalidade
create or replace function obras_interno.auditar_fraude(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.obras_comprovantes; t text; v_obra_cidade uuid; v_nome_obra text; v_nome_cid text; v_dow int; v_h int; v_m text; v_risco text; v_motivos text;
begin
  select * into c from public.obras_comprovantes where id = p_id;
  if not found or c.status <> 'lancado' then return; end if;
  t := ' ' || public.obras_norm_nome(concat_ws(' ', c.descricao, c.fornecedor, c.legenda)) || ' ';

  -- 1. Desvio de finalidade grave: bebida alcoólica, cigarro, motel, aposta
  v_m := substring(t from ' (cerveja|cervejas|chopp|chope|cachaca|vodka|whisky|uisque|vinho|vinhos|espumante|skol|brahma|heineken|budweiser|itaipava|amstel|corona|devassa|conhaque|tequila|gin|licor|cigarro|cigarros|tabaco|tabacaria|narguile|motel|loteria|lotofacil|megasena|aposta|apostas|cassino) ');
  perform public.obras_achado(c.id, 'desvio_finalidade_grave', v_m is not null, 'critico',
    'Possível DESVIO DE FINALIDADE: o comprovante cita "' || coalesce(v_m, '') || '" — não é gasto de obra.', jsonb_build_object('termo', v_m));

  -- 2. Item pessoal (não é material/serviço de obra)
  v_m := substring(t from ' (perfume|maquiagem|batom|shampoo|xampu|condicionador|hidratante|cabelo|barbearia|barbeiro|salao de beleza|manicure|depilacao|roupa|roupas|camisa|camiseta|bermuda|vestido|lingerie|brinquedo|brinquedos|presente|cinema|ingresso|ingressos|racao|petshop|pet shop|veterinario|smartphone|fone de ouvido|videogame|playstation|netflix|spotify|academia|joia|joias|relogio|cosmetico|cosmeticos|chocolate|bombom|sorvete) ');
  perform public.obras_achado(c.id, 'desvio_finalidade', v_m is not null, 'atencao',
    'Item com cara de uso pessoal ("' || coalesce(v_m, '') || '") — confirmar que foi para a obra.', jsonb_build_object('termo', v_m));

  -- 3. Material comprado num domingo / despesa de madrugada
  v_dow := extract(isodow from c.data_despesa);
  perform public.obras_achado(c.id, 'compra_domingo', v_dow = 7 and c.categoria in ('materiais_insumos', 'equipamento_manutencao'), 'atencao',
    'Compra de material/equipamento num DOMINGO (' || to_char(c.data_despesa, 'DD/MM') || ') — conferir se a obra trabalhou nesse dia.', null);
  v_h := nullif(substring(coalesce(c.hora_documento, '') from '^(\d{1,2}):'), '')::int;
  if coalesce(c.hora_documento, '') ~* 'pm' and v_h < 12 then v_h := v_h + 12; end if;
  perform public.obras_achado(c.id, 'compra_madrugada', v_h is not null and (v_h >= 23 or v_h < 5)
      and c.categoria not in ('transporte_combustivel', 'hospedagem', 'alimentacao', 'estacionamento'), 'atencao',
    'Despesa de madrugada (' || coalesce(left(c.hora_documento, 5), '') || ') fora do horário da obra.', null);

  -- 4. Comprado em outra cidade e lançado nesta obra (só obras/lojas atuais, não o histórico)
  v_obra_cidade := public.obras_obra_de(c.loja);
  if v_obra_cidade is not null and c.obra_id is not null and v_obra_cidade <> c.obra_id
     and exists (select 1 from public.obras o where o.id = c.obra_id and o.palavras is not null)
     and c.categoria in ('materiais_insumos', 'equipamento_manutencao', 'alimentacao', 'hospedagem') then
    select nome into v_nome_obra from public.obras where id = c.obra_id;
    select nome into v_nome_cid from public.obras where id = v_obra_cidade;
  end if;
  perform public.obras_achado(c.id, 'outra_cidade', v_nome_cid is not null, 'atencao',
    'Comprovante emitido em ' || coalesce(c.loja, '') || ' (' || coalesce(v_nome_cid, '') || ') mas lançado em ' || coalesce(v_nome_obra, '') || ' — conferir a obra.', null);

  -- 5. Material sem nota fiscal (só PIX/recibo), principalmente valor redondo
  perform public.obras_achado(c.id, 'material_sem_nota', c.categoria = 'materiais_insumos' and c.tipo_doc in ('recibo', 'comprovante_pix', 'comprovante_ted')
      and c.valor >= 300, case when c.valor >= 1000 and c.valor = round(c.valor, -1) then 'critico' else 'atencao' end,
    'Material de R$ ' || translate(to_char(c.valor, 'FM999,999,990.00'), ',.', '.,') || ' pago só com ' || replace(c.tipo_doc, '_', ' ') || ', sem nota fiscal' ||
      case when c.valor = round(c.valor, -1) then ' (valor redondo)' else '' end || ' — pedir a NF do fornecedor.', null);

  -- 6. PIX para o próprio prestador (ele se paga e pede reembolso)
  perform public.obras_achado(c.id, 'pix_para_o_proprio', c.tipo_doc in ('comprovante_pix', 'comprovante_ted', 'recibo')
      and coalesce(c.fornecedor, '') <> '' and public.obras_prestador_canonico(c.fornecedor) = c.responsavel, 'critico',
    'O recebedor do pagamento é o próprio prestador (' || coalesce(c.responsavel, '') || ') — reembolso sem fornecedor de verdade.', null);

  -- 7. Leitura da FOTO pela IA como auditor (adulteração, rasura, valor/data editados, cupom de outro lugar etc.)
  v_risco := lower(coalesce(c.auditoria_ia->>'risco', ''));
  select string_agg(x, '; ') into v_motivos from jsonb_array_elements_text(coalesce(c.auditoria_ia->'motivos', '[]'::jsonb)) x;
  perform public.obras_achado(c.id, 'ia_suspeita', v_risco in ('alto', 'medio'), case when v_risco = 'alto' then 'critico' else 'atencao' end,
    'IA auditora na foto: ' || coalesce(nullif(v_motivos, ''), 'sinais de irregularidade'), c.auditoria_ia);
end $$;

-- 4. As regras novas rodam junto com as antigas em cada comprovante
do $$
declare d text;
begin
  d := pg_get_functiondef('public.obras_auditar_comprovante(uuid)'::regprocedure);
  if position('obras_interno.auditar_fraude' in d) = 0 then
    d := regexp_replace(d, 'end \$function\$\s*$', E'  perform obras_interno.auditar_fraude(c.id);\nend $function$\n');
    execute d;
  end if;
end $$;
create trigger obras_auditor_ia_trg after update of auditoria_ia, legenda, descricao, categoria, tipo_doc, responsavel on public.obras_comprovantes
  for each row execute function public.obras_auditor_trigger();

-- 5. Audita tudo o que já existe
select public.obras_auditar_tudo();

-- 6. Nome do WhatsApp aparece como o prestador cadastrado ("Eng. Josemar Henrique" → "Josemar Henrique", "Jhony Pedi" → "Jhony")
do $$
declare d text;
begin
  d := pg_get_functiondef('public.obras_responsavel_trigger()'::regprocedure);
  if position('remetente := v_can' in d) = 0 then
    d := replace(d, $q$if v_can is not null and v_can <> new.responsavel then new.responsavel := v_can; end if;$q$,
      $q$if v_can is not null and v_can <> new.responsavel then new.responsavel := v_can; end if;
    if v_can is not null and coalesce(new.remetente, '') <> v_can and public.obras_prestador_canonico(new.remetente) = v_can then new.remetente := v_can; end if;$q$);
    execute d;
  end if;
end $$;
update public.obras_comprovantes set remetente = 'Josemar Henrique' where remetente = 'Eng. Josemar Henrique';
update public.obras_comprovantes set remetente = 'Jhony' where remetente = 'Jhony Pedi';
-- 7. Adiantamento da 23ª (R$ 9.680,87) reativado: já descontado no pagamento nº 10 (decisão do Ricardo, 14/10)
update public.obras_adiantamentos set cancelado = false where prestador = 'Josemar Henrique' and valor = 9680.87 and data = '2026-10-05';
