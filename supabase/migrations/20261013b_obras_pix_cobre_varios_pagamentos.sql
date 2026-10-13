-- =====================================================================================================
-- OBRAS & REFORMAS — Um PIX do Presidente pode quitar VÁRIOS pagamentos aprovados do mesmo prestador (13/10/2026)
-- Caso real: Presidente aprovou nº 11 (R$ 4.943,43) e nº 12 (R$ 1.779,65) do Jhony e pagou os dois com um PIX
-- de R$ 6.723,08 para a MARTINS SOUZA CONSTRUTORA. O vínculo automático só procurava UM pagamento de mesmo valor,
-- então o PIX ficou solto e o saldo da semana não baixou.
-- Agora: sem pagamento de valor exato, procura o prestador cujos pagamentos aprovados (sem comprovante, até 10 dias)
-- SOMAM o valor do PIX. Só liga quando há exatamente um prestador que fecha a conta (sem chute).
-- =====================================================================================================

create or replace function public.obras_vincular_pix_presidente(p_comp uuid)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare c public.obras_comprovantes; p public.obras_pagamentos; v_quando timestamptz; x uuid; v_prest text; v_n int; v_ids uuid[];
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

  if found then
    v_ids := array[p.id];
  else
    -- Um PIX para vários pagamentos aprovados do mesmo prestador.
    select min(prestador), count(*) into v_prest, v_n from (
      select k.prestador from public.obras_pagamentos k
       where k.status = 'aprovado' and coalesce(k.comprovante_path, '') = ''
         and k.created_at between v_quando - interval '10 days' and v_quando + interval '10 days'
         and not exists (select 1 from public.obras_comprovantes o where o.pagamento_id = k.id)
       group by k.prestador having count(*) > 1 and abs(sum(k.valor_aprovado) - c.valor) <= 0.05) t;
    if v_n is distinct from 1 then return null; end if;
    select array_agg(k.id order by k.created_at) into v_ids from public.obras_pagamentos k
     where k.prestador = v_prest and k.status = 'aprovado' and coalesce(k.comprovante_path, '') = ''
       and k.created_at between v_quando - interval '10 days' and v_quando + interval '10 days'
       and not exists (select 1 from public.obras_comprovantes o where o.pagamento_id = k.id);
    perform 1 from public.obras_pagamentos where id = any(v_ids) for update;
  end if;

  update public.obras_comprovantes set pagamento_id = v_ids[1], updated_at = now() where id = c.id;
  for p in select * from public.obras_pagamentos where id = any(v_ids) order by created_at loop
    if p.status = 'aprovado' then
      update public.obras_pagamentos set status = 'pago', pago_por = c.responsavel, pago_em = v_quando,
        valor_pago = case when array_length(v_ids, 1) > 1 then p.valor_aprovado else c.valor end,
        comprovante_path = c.arquivo_path, forma_pagamento = coalesce(forma_pagamento, 'pix'), updated_at = now() where id = p.id;
      perform public.obras_pag_evento(p.id, c.id, p.prestador, 'PAGO', c.responsavel, jsonb_build_object('valor', p.valor_aprovado, 'origem', 'Pix do Presidente no WhatsApp',
        'pix_total', c.valor, 'pagamentos_no_mesmo_pix', array_length(v_ids, 1)));
      for x in select comprovante_id from public.obras_pagamento_itens where pagamento_id = p.id loop perform public.obras_atualizar_situacao(x); end loop;
    else
      update public.obras_pagamentos set comprovante_path = c.arquivo_path, valor_pago = c.valor, updated_at = now() where id = p.id;
    end if;
    perform public.obras_pag_evento(p.id, c.id, p.prestador, 'COMPROVANTE_ANEXADO', c.responsavel,
      jsonb_build_object('arquivo', c.arquivo_path, 'valor', c.valor, 'origem', 'Pix do Presidente no WhatsApp', 'recebedor', c.fornecedor));
    perform public.obras_pos_auditar_pagamento(p.id);
  end loop;
  return v_ids[1];
end $function$;

-- Liga os PIX do Presidente que ficaram soltos (ex.: R$ 6.723,08 do Jhony em 13/10).
select public.obras_vincular_pix_presidente(id) from public.obras_comprovantes
 where status = 'pagamento' and pagamento_id is null and created_at > now() - interval '10 days';
