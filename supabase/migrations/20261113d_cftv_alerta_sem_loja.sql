-- CFTV · 13/11/2026 (d) — encerra o alerta "Documento sem loja vinculada" das notas que já receberam loja
-- Aplicada pela gestão no SQL Editor do Supabase em 13/11/2026.
-- (pelo nome do arquivo + CNPJ, pela gestão ou na Conferência). O histórico fica; só deixa de contar como pendente.
update public.cftv_ocorrencias o set ativo = false
 where o.regra = 'sem_loja' and o.ativo
   and not exists (select 1 from jsonb_array_elements_text(coalesce(o.refs->'documentos', '[]'::jsonb)) r(id)
                   join public.cftv_documentos d on d.id = r.id::bigint where d.loja_codigo is null);
