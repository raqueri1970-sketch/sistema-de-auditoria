-- 2026-10-02 · Ajuste Expresso / leitor do WhatsApp
-- Aplicada em producao (projeto "sistema de auditoria") via MCP.
-- 1) CPF tolerante: se o leitor nao extraiu o CPF, procura "CPF" no texto da mensagem
--    (com ou sem pontos). CPF com 10 digitos (zero da frente omitido) vale se ficar valido com o zero.
--    Ex.: 02/10 08:22 e 08:51, loja 19 — "CPF 3257695403" era recusado como SEM_CPF.
-- 2) Mascara: CPF de 9-10 digitos apos "CPF" ficava aberto no texto guardado; agora vira "CPF ***"
--    (e os textos ja gravados foram mascarados).
-- Trecho alterado em public.leitor_ingerir (o resto da funcao ficou igual):
--
--   if v_cpf = '' then
--     v_m := regexp_match(coalesce(p_texto,''), 'cpf\D{0,6}(\d[\d.\s-]{7,16}\d)', 'i');
--     if v_m is not null then v_cpf := regexp_replace(v_m[1],'\D','','g'); end if;
--   end if;
--   if length(v_cpf) = 10 and public.ajuste_cpf_valido('0' || v_cpf) then v_cpf := '0' || v_cpf; end if;
--
--   texto gravado: regexp_replace(<mascara de 11 digitos>, '(cpf\D{0,6})\d{9,10}(?!\d)', '\1***', 'gi')

update public.ajuste_whatsapp_mensagens set texto = regexp_replace(texto, '(cpf\D{0,6})\d{9,10}(?!\d)', '\1***', 'gi')
 where texto ~* 'cpf\D{0,6}\d{9,10}(?!\d)';
