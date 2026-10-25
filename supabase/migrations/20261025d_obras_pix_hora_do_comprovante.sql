-- 25/10/2026 (pedido do Ricardo) — JÁ APLICADA no projeto "sistema de auditoria" (registro).
-- PIX automático (pago_por = 'PIX Mar Aberto (automático)'): pago_em passa a ser a hora do PRÓPRIO comprovante do PIX
-- (data_despesa + hora_documento, horário de Brasília), não a hora da mensagem no grupo. Ex.: Josemar nº 21 = 20/10 16:55:20
-- (antes 17:07:18); Jhony nº 20 = 20/10 16:57:02 (antes 17:06:50). Corrigidos os nº 18, 19, 20 e 21.
-- obras_pix_paga_prestador: v_quando = data_despesa + hora_documento do PIX quando existe; senão wa_data / created_at.
update public.obras_pagamentos p set pago_em = ((c.data_despesa + (substring(c.hora_documento from '^(\d{1,2}:\d{2}(:\d{2})?)'))::time) at time zone 'America/Sao_Paulo'), updated_at = now()
  from public.obras_comprovantes c
 where c.pagamento_id = p.id and c.status = 'pagamento' and p.pago_por = 'PIX Mar Aberto (automático)'
   and c.data_despesa is not null and c.hora_documento ~ '^\d{1,2}:\d{2}';
