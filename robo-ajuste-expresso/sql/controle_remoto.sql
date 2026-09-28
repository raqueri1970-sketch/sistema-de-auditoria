-- CONTROLE REMOTO DO ROBO (app no celular)
-- Comandos por maquina: PAUSAR, RETOMAR, REINICIAR, ABRIR_SETA. So administrador (orc_is_admin), tudo no log de seguranca.
-- O comando fica guardado ate a maquina buscar no proximo sinal (heartbeat, a cada 15 s no robo 1.5.2) e vale por 5 minutos:
-- maquina desligada nao recebe comando velho horas depois.
-- Compativel com robos antigos: o heartbeat so ganha a chave "comando" na resposta.

alter table private.executor_devices
  add column if not exists comando text,
  add column if not exists comando_em timestamptz,
  add column if not exists comando_por uuid,
  add column if not exists comando_entregue_em timestamptz;

create or replace function public.ajuste_admin_comando_executor(p_nome text, p_comando text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.orc_is_admin() then raise exception 'acesso negado'; end if;
  if p_comando not in ('PAUSAR', 'RETOMAR', 'REINICIAR', 'ABRIR_SETA') then raise exception 'comando invalido'; end if;
  update private.executor_devices
     set comando = p_comando, comando_em = now(), comando_por = (select auth.uid()), comando_entregue_em = null
   where device_name = p_nome and ativo;
  if not found then raise exception 'maquina nao encontrada ou desativada (reative antes de mandar comando)'; end if;
  insert into public.ajuste_seguranca_log(evento, ator, detalhe) values ('EXECUTOR_COMANDO_' || p_comando, (select auth.uid()), p_nome);
  return jsonb_build_object('ok', true, 'maquina', p_nome, 'comando', p_comando);
end $function$;

revoke all on function public.ajuste_admin_comando_executor(text, text) from public, anon;
grant execute on function public.ajuste_admin_comando_executor(text, text) to authenticated;

-- Heartbeat: mesma assinatura e mesmo retorno de antes + "comando" (entregue uma unica vez, valido por 5 min).
create or replace function public.executor_heartbeat(p_token text, p_device text, p_status text, p_detalhe text default null::text, p_versao text default null::text, p_host text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_hash text := encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex'); v_pend int; v_cmd text; v_entende boolean;
begin
  if not exists(select 1 from private.executor_devices d where d.token_hash = v_hash and d.device_name = p_device and d.ativo) then raise exception 'executor nao autorizado'; end if;
  update private.executor_devices set status = left(p_status,60), detalhe = left(p_detalhe,400), versao = left(p_versao,40), host = left(p_host,80), heartbeat_em = now(), ultimo_acesso = now()
   where token_hash = v_hash and device_name = p_device;
  -- comando remoto so para robo que sabe obedecer (1.5.2+); robo antigo nao "consome" o comando sem executar
  v_entende := coalesce(p_versao ~ '^\d+\.\d+\.\d+$' and string_to_array(p_versao, '.')::int[] >= array[1,5,2], false);
  if v_entende then
    update private.executor_devices set comando_entregue_em = now()
     where token_hash = v_hash and device_name = p_device and comando is not null and comando_entregue_em is null and comando_em > now() - interval '5 minutes'
    returning comando into v_cmd;
  end if;
  select count(*) into v_pend from public.ajuste_estoque_entrada where status = 'PENDENTE';
  return jsonb_build_object('ok', true, 'pendentes', v_pend, 'comando', v_cmd);
end $function$;

-- Tudo o que o app mostra, numa chamada so.
create or replace function public.ajuste_admin_painel_robo()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v jsonb;
begin
  if not public.orc_is_admin() then raise exception 'acesso negado'; end if;
  select jsonb_build_object(
    'agora', now(),
    'executores', coalesce((select jsonb_agg(jsonb_build_object(
        'nome', d.device_name, 'ativo', d.ativo, 'status', d.status, 'detalhe', d.detalhe, 'versao', d.versao, 'host', d.host,
        'heartbeat_em', d.heartbeat_em, 'comando', d.comando, 'comando_em', d.comando_em, 'comando_entregue_em', d.comando_entregue_em)
        order by d.device_name) from private.executor_devices d where d.heartbeat_em is not null or d.ativo), '[]'::jsonb),
    'fila', (select jsonb_build_object(
        'pendentes', count(*) filter (where a.status = 'PENDENTE'),
        'em_execucao', count(*) filter (where a.status = 'EM_EXECUCAO'),
        'concluidos_hoje', count(*) filter (where a.status = 'CONCLUIDO' and a.atualizado_em >= date_trunc('day', now() at time zone 'America/Recife') at time zone 'America/Recife'),
        'erros_hoje', count(*) filter (where a.status = 'ERRO' and a.atualizado_em >= date_trunc('day', now() at time zone 'America/Recife') at time zone 'America/Recife'),
        'divergencias', count(*) filter (where a.status = 'BLOQUEADO_DIVERGENCIA'))
        from public.ajuste_estoque_entrada a where a.criado_em > now() - interval '30 days'),
    'link', (select c.valor from public.ajuste_config c where c.chave = 'link_pedidos'),
    'recentes', coalesce((select jsonb_agg(x order by x->>'atualizado_em' desc) from (
        select jsonb_build_object('id', a.id, 'status', a.status, 'loja', a.loja_normalizada, 'produto', a.codigo_produto, 'qtd', a.quantidade,
               'maquina', a.executor_device, 'atualizado_em', a.atualizado_em, 'erro', left(a.erro_executor, 160)) x
        from public.ajuste_estoque_entrada a
        where a.status in ('PENDENTE', 'EM_EXECUCAO', 'ERRO', 'BLOQUEADO_DIVERGENCIA', 'CONCLUIDO') and a.atualizado_em > now() - interval '24 hours'
           or a.status in ('PENDENTE', 'EM_EXECUCAO', 'BLOQUEADO_DIVERGENCIA')
        order by a.atualizado_em desc limit 25) s), '[]'::jsonb)
  ) into v;
  return v;
end $function$;

revoke all on function public.ajuste_admin_painel_robo() from public, anon;
grant execute on function public.ajuste_admin_painel_robo() to authenticated;
