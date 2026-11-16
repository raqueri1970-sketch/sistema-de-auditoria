-- Patrimônio (parque anterior a 2026, preço de reposição): HD pela mesma base —
-- gravador com HD 2TB (R$ 2.341,85) − gravador sem HD (R$ 1.168,55) = R$ 1.173,30 por HD.
-- Compras de 2026 continuam pelo custo real das notas (não mudam).
update cftv_premissas set valor = round((select valor from cftv_premissas where chave = 'preco_gravador_16_com_hd') - (select valor from cftv_premissas where chave = 'preco_gravador_16'), 2),
  descricao = 'HD 2TB do gravador (gravador com HD 2TB − gravador sem HD)',
  fonte = 'Base definida pela gestão em 16/11/2026: gravador com HD 2TB R$ 2.341,85 − gravador R$ 1.168,55',
  validada = true, atualizado_em = now(), atualizado_por = 'gestão 16/11/2026'
  where chave = 'preco_hd_2tb';
