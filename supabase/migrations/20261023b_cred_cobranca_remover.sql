-- 23/10/2026: a tabela cred_cobranca (e o tipo 'cobranca' em cred_arquivos / ramo 'cobranca' em cred_importar) foi criada
-- por engano — a aba "crediario" da planilha de desconto da folha é o DESCONTADO, não o devido, e entra como tipo 'folha'.
-- Ficou vazia e sem uso (RLS ativo). O DROP expirou pelo conector em 23/10; rodar este arquivo para limpar.
drop table if exists public.cred_cobranca;
alter table public.cred_arquivos drop constraint if exists cred_arquivos_tipo_check;
alter table public.cred_arquivos add constraint cred_arquivos_tipo_check check (tipo in ('compras', 'cadastro', 'folha', 'baixas'));
