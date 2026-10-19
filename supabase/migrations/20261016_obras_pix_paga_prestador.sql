-- 16/10/2026 — PIX da Mar Aberto para o prestador já entra como PAGAMENTO (pedido do Ricardo).
--
-- Antes: o PIX do Presidente (pagador Mar Aberto) só era ligado a um pagamento que o Presidente já tivesse APROVADO no
-- sistema com o mesmo valor. Sem essa aprovação o PIX ficava solto (ex.: 16/10, R$ 6.577,27 para a Martins Souza e
-- R$ 13.200,27 para o Josemar) e as despesas continuavam "a pagar".
--
-- Agora, se não houver pagamento aprovado para ligar, o favorecido do PIX diz de quem é:
--   JOSEMAR → Josemar Henrique · MARTINS SOUZA / MARTINS & SOUZA → Jhony   (tabela obras_favorecido_prestador)
-- e o PIX paga as despesas em aberto desse prestador pela ordem de chegada no grupo (a última pode ficar parcial).
-- NÃO desconta adiantamento: a regra é o prestador ficar sempre com o fundo de R$ 10 mil; o PIX repõe o que ele gastou.
-- Se o PIX for maior que tudo o que está em aberto, a sobra vira ADIANTAMENTO (com o mesmo comprovante).

create table if not exists public.obras_favorecido_prestador (
  padrao text primary key,          -- trecho do nome do favorecido, já normalizado (maiúsculas, sem acento, só letras/números e espaço)
  prestador text not null,
  ativo boolean not null default true
);
alter table public.obras_favorecido_prestador enable row level security;
drop policy if exists "favorecido prestador leitura" on public.obras_favorecido_prestador;
create policy "favorecido prestador leitura" on public.obras_favorecido_prestador for select to authenticated using ((select public.portal_pode_ver()));
drop policy if exists "favorecido prestador escrita" on public.obras_favorecido_prestador;
create policy "favorecido prestador escrita" on public.obras_favorecido_prestador for all to authenticated
  using ((select public.obras_pode_auditar())) with check ((select public.obras_pode_auditar()));

insert into public.obras_favorecido_prestador (padrao, prestador) values
  ('JOSEMAR', 'Josemar Henrique'),
  ('MARTINS SOUZA', 'Jhony')
on conflict (padrao) do update set prestador = excluded.prestador, ativo = true;

create or replace function public.obras_norm_favorecido(t text) returns text
language sql immutable set search_path to 'public' as $$
  select trim(regexp_replace(upper(translate(coalesce(t, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^A-Z0-9]+', ' ', 'g'))
$$;

create or replace function public.obras_pix_paga_prestador(p_comp uuid) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  c public.obras_comprovantes; v_prest text; v public.obras_pagamentos; d record;
  v_resto numeric; v_parte numeric; v_tot numeric := 0; v_ids uuid[] := '{}'; v_quando timestamptz; v_sobra numeric;
  v_quem text := 'PIX Mar Aberto (automático)';
begin
  select * into c from public.obras_comprovantes where id = p_comp for update;
  if not found or c.status <> 'pagamento' or c.pagamento_id is not null or coalesce(c.valor, 0) <= 0 then return null; end if;
  select f.prestador into v_prest from public.obras_favorecido_prestador f
   where f.ativo and public.obras_norm_favorecido(c.fornecedor) like '%' || f.padrao || '%'
   order by length(f.padrao) desc limit 1;
  if v_prest is null then return null; end if;

  v_quando := coalesce(c.wa_data, c.created_at);
  v_resto := round(c.valor, 2);

  insert into public.obras_pagamentos (prestador, status, valor_itens, valor_abatido, valor_aprovado, aprovado_por, aprovado_em, observacao)
  values (v_prest, 'aprovado', 0.01, 0, 0, v_quem, v_quando,
          'PIX da Mar Aberto para ' || coalesce(c.fornecedor, v_prest) || ' — lançado sozinho como pagamento (sem descontar adiantamento)')
  returning * into v;

  for d in select id, saldo from public.obras_despesas_pagamento
            where prestador = v_prest and status = 'lancado' and saldo > 0.004
            -- ordem de CHEGADA no grupo: o PIX costuma ser o total que estava em aberto na hora (o que chegou depois fica para o próximo)
            order by wa_data nulls first, data_despesa nulls last, id loop
    exit when v_resto <= 0.004;
    v_parte := round(least(d.saldo, v_resto), 2);
    if v_parte <= 0 then exit; end if;
    insert into public.obras_pagamento_itens (pagamento_id, comprovante_id, valor) values (v.id, d.id, v_parte);
    v_ids := v_ids || d.id; v_tot := v_tot + v_parte; v_resto := v_resto - v_parte;
  end loop;

  if v_tot <= 0 then
    -- nada em aberto: o PIX inteiro é adiantamento
    delete from public.obras_pagamentos where id = v.id;
    insert into public.obras_adiantamentos (prestador, valor, data, observacao, comprovante_path, registrado_por)
    values (v_prest, round(c.valor, 2), (v_quando at time zone 'America/Sao_Paulo')::date,
            'PIX da Mar Aberto sem despesas em aberto — vira adiantamento', c.arquivo_path, v_quem);
    perform public.obras_pag_evento(null, c.id, v_prest, 'ADIANTAMENTO', v_quem, jsonb_build_object('valor', c.valor, 'origem', 'PIX Mar Aberto'));
    update public.obras_comprovantes set descricao = left('Adiantamento ao ' || v_prest || '. ' || coalesce(descricao, ''), 500), updated_at = now() where id = c.id;
    return null;
  end if;

  update public.obras_pagamentos set status = 'pago', valor_itens = v_tot, valor_aprovado = v_tot, valor_pago = v_tot,
         pago_por = v_quem, pago_em = v_quando, forma_pagamento = 'pix', comprovante_path = c.arquivo_path, favorecido = c.fornecedor, updated_at = now()
   where id = v.id returning * into v;
  update public.obras_comprovantes set pagamento_id = v.id, updated_at = now() where id = c.id;
  perform public.obras_atualizar_situacao(u.cid) from unnest(v_ids) as u(cid);
  perform public.obras_pag_evento(v.id, c.id, v_prest, 'PAGO', v_quem,
    jsonb_build_object('valor', v_tot, 'pix', c.valor, 'itens', array_length(v_ids, 1), 'origem', 'PIX Mar Aberto no WhatsApp', 'recebedor', c.fornecedor));

  v_sobra := round(c.valor - v_tot, 2);
  if v_sobra > 0.004 then
    insert into public.obras_adiantamentos (prestador, valor, data, observacao, comprovante_path, registrado_por)
    values (v_prest, v_sobra, (v_quando at time zone 'America/Sao_Paulo')::date,
            'Sobra do PIX de R$ ' || to_char(c.valor, 'FM999G999G990D00') || ' (pagamento nº ' || v.numero || ' quitou R$ ' || to_char(v_tot, 'FM999G999G990D00') || ')',
            c.arquivo_path, v_quem);
    perform public.obras_pag_evento(v.id, c.id, v_prest, 'ADIANTAMENTO', v_quem, jsonb_build_object('valor', v_sobra, 'origem', 'sobra do PIX'));
  end if;
  begin perform public.obras_pos_auditar_pagamento(v.id); exception when others then raise warning 'pos auditoria pix: %', sqlerrm; end;
  return v.id;
end $$;

-- Gatilho do PIX: primeiro tenta ligar a um pagamento aprovado (regra antiga); se não houver, paga o prestador do favorecido.
create or replace function public.obras_pagador_after() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'pagamento' and new.pagamento_id is null then
    begin
      if public.obras_vincular_pix_presidente(new.id) is null then perform public.obras_pix_paga_prestador(new.id); end if;
    exception when others then raise warning 'obras pix presidente: %', sqlerrm; end;
  end if;
  return null;
end $$;

-- Só o gatilho (dono da função) chama; ninguém de fora executa direto.
revoke all on function public.obras_pix_paga_prestador(uuid) from public, anon, authenticated;
