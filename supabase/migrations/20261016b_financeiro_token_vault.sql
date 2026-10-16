-- Token do Sallamo guardado no Supabase Vault (criptografado), lido só pela Edge Function financeiro-sallamo.
-- O VALOR do token NÃO fica no repositório. Para cadastrar ou trocar (SQL Editor do Supabase):
--   select vault.create_secret('<token>', 'sallamo_token', 'Bearer da API do Sallamo');      -- primeira vez
--   select vault.update_secret((select id from vault.secrets where name = 'sallamo_token'), '<token novo>');  -- troca
-- Se o segredo SALLAMO_TOKEN existir nas Edge Functions, ele tem prioridade sobre o Vault.
create or replace function public.fin_sallamo_token()
returns text
language sql
stable security definer
set search_path to ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'sallamo_token' limit 1 $$;
revoke all on function public.fin_sallamo_token() from public, anon, authenticated;
grant execute on function public.fin_sallamo_token() to service_role;
