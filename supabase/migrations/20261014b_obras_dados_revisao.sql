-- Obras & Reformas — correções de dados de 14/10/2026 (já aplicadas no Supabase; registradas aqui como histórico).
-- Cópia de antes: obras_interno.bkp_20261014_comprovantes / _pagamentos / _remetentes / _adiantamentos.

-- 1. Prestador único: o número novo do WhatsApp do "Eng. Josemar Henrique" é o Josemar Henrique; obra padrão = Loja Maceió Centro.
update public.obras_remetentes set obra_id = (select id from public.obras where codigo = 'MCZ-CENTRO'), updated_at = now() where nome = 'Josemar Henrique';
insert into public.obras_remetentes (numero, nome, obra_id, ativo)
values ('220245990047892', 'Josemar Henrique', (select id from public.obras where codigo = 'MCZ-CENTRO'), true)
on conflict (numero) do update set nome = excluded.nome, obra_id = excluded.obra_id, ativo = true, updated_at = now();
update public.obras_comprovantes set responsavel = 'Josemar Henrique', updated_at = now() where responsavel = 'Eng. Josemar Henrique';

-- 2. Sem "Desconhecido": os PIX do Presidente ficam como remetente Paulo Almeida (Presidente).
update public.obras_comprovantes set remetente = 'Paulo Almeida (Presidente)', updated_at = now() where remetente = 'Desconhecido' and status = 'pagamento';
update public.obras_comprovantes set remetente = 'Paulo Almeida (Presidente)', responsavel = 'Paulo Almeida', updated_at = now() where responsavel = 'Desconhecido';

-- 3. Nota fiscal totalizada (Casa dos Parafusos 13/10: 12 linhas → 1 despesa de R$ 510,08).
select obras_interno.consolidar_nota(n)
  from (select distinct public.obras_nota_de(wa_msg_id, arquivo_path, id) n from public.obras_comprovantes where origem = 'whatsapp' and status = 'lancado') x;

-- 4. Obra de cada despesa do WhatsApp (legenda → descrição → cidade → obra padrão do prestador).
update public.obras_comprovantes c set obra_id = coalesce(public.obras_obra_de(c.legenda), public.obras_obra_de(c.descricao), public.obras_obra_de(c.loja),
    (select r.obra_id from public.obras_remetentes r where r.nome = c.responsavel and r.obra_id is not null and r.ativo limit 1)), updated_at = now()
 where c.origem = 'whatsapp' and c.obra_id is null and c.status in ('lancado', 'orcamento', 'nao_despesa');
-- Histórico do Josemar distribuído pela cidade lida no recibo; o que não tem cidade fica no "Histórico Josemar".
update public.obras_comprovantes c set obra_id = public.obras_obra_de(c.loja), updated_at = now()
 where c.obra_id = (select id from public.obras where codigo = 'ENG-JOSEMAR') and c.responsavel = 'Josemar Henrique' and public.obras_obra_de(c.loja) is not null;
update public.obras set nome = 'Histórico Josemar (loja não informada)' where codigo = 'ENG-JOSEMAR';
update public.obras set nome = 'Histórico Enildo (loja não informada)' where codigo = 'ENILDO';
update public.obras set nome = 'Histórico Everton (Maceió)' where codigo = 'EVERTON-MCZ';

-- 5. Revisão das mensagens do grupo: 6 prints de corrida Uber/99 do Josemar (13/10, R$ 195,87) tinham sido lidos como "não é despesa".
update public.obras_comprovantes set status = 'lancado', tipo_doc = 'recibo', categoria = 'transporte_combustivel',
       fornecedor = coalesce(fornecedor, 'Uber'), obra_id = null, revisado = true, updated_at = now(),
       descricao = left(coalesce(descricao, '') || ' — corrida de app (print), lançada como despesa na revisão de 14/10', 500)
 where origem = 'whatsapp' and status = 'nao_despesa' and valor > 0 and tipo_doc = 'outros'
   and (legenda ~* '\m(uber|99)\M' or fornecedor ~* '^(uber|99)$' or descricao ~* '(corrida|viagem)');

-- 6. Orçamentos em aberto marcados como pagos (All Clean R$ 12.000 → Shopping Recife; Mister Construções R$ 607,98 → Maceió Centro).
with o as (
  update public.obras_comprovantes set status = 'lancado', situacao_pagamento = 'pago', pago_em = now(), updated_at = now()
   where origem = 'whatsapp' and status = 'orcamento' and situacao_pagamento = 'a_pagar'
  returning id, responsavel, valor, fornecedor, obra_id)
insert into public.obras_pagamento_eventos (pagamento_id, comprovante_id, prestador, evento, usuario, detalhes)
select null, o.id, o.responsavel, 'ORCAMENTO_PAGO', 'Ricardo (pedido de 14/10)', jsonb_build_object('valor', o.valor, 'fornecedor', o.fornecedor, 'obra', o.obra_id) from o;

-- 7. Sem Financeiro: o pagamento nº 10 (Josemar, 23ª prestação, R$ 4.936,26) foi pago pelo PIX de R$ 14.936,00 do Presidente em 13/10;
--    a sobra (R$ 9.999,74) virou adiantamento do Josemar para a semana 12/10–18/10 (decisão do Ricardo em 14/10).
do $$
declare p public.obras_pagamentos; c public.obras_comprovantes; x uuid; v_sobra numeric;
begin
  select * into p from public.obras_pagamentos where numero = 10 and status = 'aprovado' for update;
  select * into c from public.obras_comprovantes where wa_msg_id = '3EB08E57DD78A756E223D0#0' and status = 'pagamento' and pagamento_id is null for update;
  if p.id is null or c.id is null then return; end if;
  update public.obras_pagamentos set status = 'pago', pago_por = 'Paulo Almeida', pago_em = c.wa_data, valor_pago = p.valor_aprovado,
         comprovante_path = c.arquivo_path, forma_pagamento = coalesce(forma_pagamento, 'pix'), updated_at = now() where id = p.id;
  update public.obras_comprovantes set pagamento_id = p.id, updated_at = now() where id = c.id;
  perform public.obras_pag_evento(p.id, c.id, p.prestador, 'PAGO', 'Paulo Almeida', jsonb_build_object('valor', p.valor_aprovado, 'origem', 'Pix do Presidente no WhatsApp (13/10)', 'pix_total', c.valor));
  perform public.obras_pag_evento(p.id, c.id, p.prestador, 'COMPROVANTE_ANEXADO', 'Paulo Almeida', jsonb_build_object('arquivo', c.arquivo_path, 'valor', c.valor));
  for x in select comprovante_id from public.obras_pagamento_itens where pagamento_id = p.id loop perform public.obras_atualizar_situacao(x); end loop;
  perform public.obras_pos_auditar_pagamento(p.id);
  v_sobra := round(c.valor - p.valor_aprovado, 2);
  if v_sobra > 0 then
    insert into public.obras_adiantamentos (prestador, valor, data, observacao, registrado_por, comprovante_path)
    values (p.prestador, v_sobra, (c.wa_data at time zone 'America/Sao_Paulo')::date,
      format('Sobra do PIX de R$ %s do Presidente em 13/10 (pagou o nº 10, 23ª prestação, de R$ %s). Adiantamento da semana 12/10 a 18/10.', c.valor, p.valor_aprovado),
      'Claude (decisão do Ricardo em 14/10)', c.arquivo_path);
  end if;
end $$;

-- 8. Prestações já todas pagas ficam quitadas.
select obras_interno.quitar_prestacoes(null);

-- 9. Foto reenviada guarda o valor da foto original (status duplicada, NÃO somado) — para saber quanto foi duplicado.
with o as (
  select d.id, x.valor, x.fornecedor, x.data_despesa, x.categoria, x.status st_orig
    from public.obras_comprovantes d
    join public.obras_comprovantes x on x.wa_msg_id = substring(d.descricao from 'igual a ([^)]+)\)')
   where d.origem = 'whatsapp' and d.valor = 0 and d.descricao like 'Foto reenviada (igual a %')
update public.obras_comprovantes d set status = 'duplicada', valor = o.valor, fornecedor = coalesce(d.fornecedor, o.fornecedor),
       data_despesa = coalesce(d.data_despesa, o.data_despesa), categoria = o.categoria,
       descricao = d.descricao || ' — valor da foto original, NÃO somado' || case when o.st_orig = 'pagamento' then ' (comprovante de pagamento do Presidente)' else '' end
  from o where d.id = o.id;
