-- 23/10/2026: a tabela cred_cobranca (e o tipo 'cobranca' em cred_arquivos / ramo 'cobranca' em cred_importar) foi criada
-- por engano — a aba "crediario" da planilha de desconto da folha é o DESCONTADO, não o devido, e entra como tipo 'folha'.
-- Ficou vazia e sem uso (RLS ativo). O DROP expirou pelo conector em 23/10; rodar este arquivo para limpar.
drop table if exists public.cred_cobranca;
alter table public.cred_arquivos drop constraint if exists cred_arquivos_tipo_check;
alter table public.cred_arquivos add constraint cred_arquivos_tipo_check check (tipo in ('compras', 'cadastro', 'folha', 'baixas'));

-- 23/10/2026 (aplicado): nova regra de competência "venc_ant" — parcela que vence de 21 de um mês a 20 do seguinte é
-- descontada na folha do primeiro mês (vencimentos 21/09 a 20/10 = folha 09/2026), confirmada contra a folha de set/2026.
alter table public.cred_config drop constraint if exists cred_config_regra_check;
alter table public.cred_config add constraint cred_config_regra_check check (regra in ('ciclo', 'venc', 'venc_ant'));

-- 23/10/2026 (aplicado): limite de parcelas da política de crédito do funcionário (padrão 5x)
alter table public.cred_config add column if not exists max_parcelas int not null default 5 check (max_parcelas between 1 and 24);
