-- Auditoria Financeira: comprovantes (foto/PDF) anexados pelo auditor a um título do Sallamo.
-- O Sallamo não guarda foto da duplicata nem do comprovante (conferido na API em 21/10/2026) e a API de BI não envia nº da NF,
-- nº da parcela nem o vínculo com o extrato: a duplicidade só se confirma vendo os dois comprovantes/extrato. O auditor anexa
-- aqui e a tela mostra as fotos onde o título aparece (verificação direta, Agente de Duplicidade, ocorrências).
-- Quem pode: os mesmos perfis da auditoria (fin_pode_auditar: administrador, controladoria, diretoria).
-- Comprovante não se apaga (trilha de auditoria); só quem enviou pode marcar como substituído.
-- Aplicada em 21/10/2026.

create table if not exists public.fin_comprovantes (
  id bigint generated always as identity primary key,
  codigo text not null,                 -- código do título no Sallamo
  vencimento date,                      -- parcela (opcional)
  pagamento date,                       -- data do pagamento que o comprovante prova (opcional)
  valor numeric(14, 2),
  fornecedor text,
  arquivo_path text not null,           -- caminho no bucket fin-comprovantes
  arquivo_nome text,
  tipo text,                            -- mime (image/jpeg, application/pdf…)
  observacao text,
  substituido boolean not null default false,
  enviado_por text default (auth.jwt() ->> 'email'),
  enviado_em timestamptz not null default now()
);
create index if not exists fin_comprovantes_codigo on public.fin_comprovantes (codigo);

alter table public.fin_comprovantes enable row level security;
drop policy if exists fin_comprovantes_ler on public.fin_comprovantes;
create policy fin_comprovantes_ler on public.fin_comprovantes for select to authenticated using ((select public.fin_pode_auditar()));
drop policy if exists fin_comprovantes_gravar on public.fin_comprovantes;
create policy fin_comprovantes_gravar on public.fin_comprovantes for insert to authenticated
  with check ((select public.fin_pode_auditar()) and enviado_por is not distinct from (select auth.jwt() ->> 'email'));
drop policy if exists fin_comprovantes_substituir on public.fin_comprovantes;
create policy fin_comprovantes_substituir on public.fin_comprovantes for update to authenticated
  using ((select public.fin_pode_auditar()) and enviado_por = (select auth.jwt() ->> 'email')) with check ((select public.fin_pode_auditar()));
revoke all on public.fin_comprovantes from anon;
revoke all on public.fin_comprovantes from authenticated;
grant select, insert on public.fin_comprovantes to authenticated;
grant update (substituido, observacao) on public.fin_comprovantes to authenticated;

-- Arquivos: bucket privado (leitura por URL assinada), até 10 MB, só imagem e PDF
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fin-comprovantes', 'fin-comprovantes', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;
drop policy if exists "fin comprovantes leitura" on storage.objects;
create policy "fin comprovantes leitura" on storage.objects for select to authenticated
  using (bucket_id = 'fin-comprovantes' and (select public.fin_pode_auditar()));
drop policy if exists "fin comprovantes envio" on storage.objects;
create policy "fin comprovantes envio" on storage.objects for insert to authenticated
  with check (bucket_id = 'fin-comprovantes' and (select public.fin_pode_auditar()));
