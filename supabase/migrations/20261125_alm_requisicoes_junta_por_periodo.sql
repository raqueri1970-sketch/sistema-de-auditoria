-- Almoxarifado: carga de requisições JUNTA por período, não apaga o histórico.
-- 25/11/2026 11:10 o arquivo de requisições carregado tinha só 02/11 a 17/11 (66 linhas) e, como o módulo
-- troca a lista inteira, a base caiu de 16.224 para 66 requisições: jan–out/2026 sumiram, o Consumo Loja
-- e o painel mostraram R$ 0. Já tinha acontecido em 09/11 (outubro sumiu) e em 23 e 24/11 (vai e volta
-- entre 66 e 16.224 linhas, um PC com a cópia completa regravando por cima).
--
-- Regra nova (gatilho b_portal_sync_alm_junta_requisicoes, roda antes de preserva_bases e registra_cargas):
-- o arquivo novo manda no período que ele cobre (da menor à maior Data Solicitação dele); as requisições
-- da nuvem FORA desse período continuam. Arquivo com o ano todo substitui tudo, como antes; arquivo só do
-- mês troca só o mês; cópia antiga completa que chega depois de uma carga nova não apaga os dias novos.
-- Datas aceitas: ISO (2026-11-02T03:00:00.000Z → dia 2026-11-02) e dd/mm/aaaa.

create or replace function portal_private.alm_req_dia(r jsonb)
returns date language sql immutable set search_path = '' as $$
  select case
    when coalesce(r->>'Data Solicitação','') ~ '^\d{4}-\d{2}-\d{2}' then left(r->>'Data Solicitação', 10)::date
    when coalesce(r->>'Data Solicitação','') ~ '^\d{2}/\d{2}/\d{4}' then to_date(left(r->>'Data Solicitação', 10), 'DD/MM/YYYY')
  end
$$;

create or replace function portal_private.portal_sync_alm_junta_requisicoes()
returns trigger language plpgsql set search_path = '' as $$
declare
  o jsonb; n jsonb; ini date; fim date; fora jsonb;
begin
  if new.module_id <> 'alm' or jsonb_typeof(old.payload) <> 'object' or jsonb_typeof(new.payload) <> 'object' then
    return new;
  end if;
  o := old.payload->'dbConsumoRaw';
  n := new.payload->'dbConsumoRaw';
  if jsonb_typeof(o) <> 'array' or jsonb_typeof(n) <> 'array'
     or jsonb_array_length(o) = 0 or jsonb_array_length(n) = 0 or o = n then
    return new;
  end if;
  select min(portal_private.alm_req_dia(x)), max(portal_private.alm_req_dia(x))
    into ini, fim from jsonb_array_elements(n) x;
  if ini is null then return new; end if; -- arquivo sem data: regra antiga
  select jsonb_agg(x) into fora from jsonb_array_elements(o) x
   where portal_private.alm_req_dia(x) < ini or portal_private.alm_req_dia(x) > fim;
  if fora is null then return new; end if; -- o arquivo cobre todo o histórico: substitui
  new.payload := jsonb_set(new.payload, '{dbConsumoRaw}', fora || n, true);
  raise notice 'Almoxarifado: requisições de % a % trocadas; % requisições de fora do período mantidas.',
    ini, fim, jsonb_array_length(fora);
  return new;
end $$;

drop trigger if exists b_portal_sync_alm_junta_requisicoes on public.portal_sync;
create trigger b_portal_sync_alm_junta_requisicoes
  before update on public.portal_sync
  for each row when (new.module_id = 'alm')
  execute function portal_private.portal_sync_alm_junta_requisicoes();

-- Correção de dados (registro, não reexecutar): dbConsumoRaw restaurado de portal_sync_historico.id 8856
-- (25/11 11:10:16, 16.224 requisições jan → 17/11/2026). As 66 de novembro da carga de 11:10:29 são
-- idênticas às de novembro dessa versão.
--   update public.portal_sync s set payload = jsonb_set(s.payload, '{dbConsumoRaw}', h.payload->'dbConsumoRaw'), updated_at = now()
--     from public.portal_sync_historico h where s.module_id = 'alm' and h.id = 8856;
