-- Presidente aceita pagar com base no orçamento: o orçamento vira despesa lançada (entra em contas a pagar).
-- p_desfazer = true devolve para orçamento, desde que não haja pagamento feito/aprovado. Aplicada em 11/10/2026.
create or replace function public.obras_orcamento_aceitar(p_comp uuid, p_observacao text default null, p_desfazer boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $$
declare c record; v_quem text := public.obras_usuario_nome();
begin
  if not public.obras_tem_papel('presidente') then raise exception 'Somente o Presidente pode aceitar um orçamento para pagamento.'; end if;
  select * into c from public.obras_despesas_pagamento where id = p_comp;
  if not found then raise exception 'Documento nao encontrado.'; end if;
  if p_desfazer then
    if c.status <> 'lancado' then raise exception 'Este documento nao esta em contas a pagar.'; end if;
    if c.valor_pago > 0 or c.valor_reservado > 0 then raise exception 'Ja existe pagamento feito ou aprovado; cancele o pagamento antes.'; end if;
    if not exists (select 1 from public.obras_pagamento_eventos where comprovante_id = p_comp and evento = 'ORCAMENTO_ACEITO') then
      raise exception 'Este documento nao veio de um orcamento aceito.'; end if;
    update public.obras_comprovantes set status = 'orcamento', updated_at = now() where id = p_comp;
    perform public.obras_pag_evento(null, p_comp, c.prestador, 'ORCAMENTO_DEVOLVIDO', v_quem, jsonb_build_object('observacao', p_observacao));
    return;
  end if;
  if c.status <> 'orcamento' then raise exception 'Este documento nao e um orcamento.'; end if;
  if c.situacao_pagamento <> 'a_pagar' then raise exception 'Este orcamento ja foi tratado como pago.'; end if;
  if c.prestador is null then raise exception 'Orcamento sem prestador: vincule o numero do remetente antes.'; end if;
  update public.obras_comprovantes set status = 'lancado', updated_at = now() where id = p_comp;
  perform public.obras_pag_evento(null, p_comp, c.prestador, 'ORCAMENTO_ACEITO', v_quem,
    jsonb_build_object('valor', c.valor, 'fornecedor', c.fornecedor, 'observacao', p_observacao));
end $$;
revoke all on function public.obras_orcamento_aceitar(uuid, text, boolean) from public, anon;
grant execute on function public.obras_orcamento_aceitar(uuid, text, boolean) to authenticated;
