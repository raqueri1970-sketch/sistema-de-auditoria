-- RL Transportes (19/10/2026): comprovante REUTILIZADO.
-- Quando alguém manda de novo um comprovante já lançado (a mesma foto, ou o mesmo pagamento: mesma autenticação do banco,
-- ou mesmo fornecedor + valor + data + hora), em qualquer período, o bot NÃO soma de novo e grava aqui o reenvio,
-- apontando para o lançamento original. A auditoria mostra os dois comprovantes lado a lado e em que período o original foi usado.
-- Espelho do SQLite do bot (tabela reusos), igual às outras rl_*.
create table if not exists public.rl_reusos (
  id               bigint primary key,
  data             timestamptz,
  remetente        text,
  arquivo          text,
  arquivo_hash     text,
  motivo           text,
  original_tabela  text,
  original_id      bigint,
  valor            numeric,
  fornecedor       text,
  data_documento   text,
  hora_documento   text,
  autenticacao     text,
  legenda          text,
  created_at       timestamptz,
  tenant_id        text default 'esposende'
);
create index if not exists rl_reusos_original on public.rl_reusos (original_tabela, original_id);
alter table public.rl_reusos enable row level security;
drop policy if exists rl_reusos_staff_all on public.rl_reusos;
create policy rl_reusos_staff_all on public.rl_reusos for all to authenticated
  using ((select portal_pode('rl'::text))) with check ((select portal_pode('rl'::text)));
