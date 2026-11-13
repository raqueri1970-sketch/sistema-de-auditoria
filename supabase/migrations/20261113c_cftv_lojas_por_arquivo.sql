-- CFTV · 13/11/2026 (c) — loja pelo NOME DO ARQUIVO da nota, conferida pelo CNPJ do destinatário (cada filial tem um CNPJ).
-- Só muda quando arquivo e CNPJ apontam para a mesma loja (ou o arquivo é inequívoco e a nota é da matriz).
with m(id, loja, motivo) as (values
  (4,   929, 'Arquivo "NF 71 CARUARU" + CNPJ 44.616.854/0014-97 (mesmo CNPJ das notas da Caruaru Centro II)'),
  (29,  937, 'Arquivo "NF 119 CONCERTINA" + CNPJ 44.616.854/0071-85, BR 407 (mesmo CNPJ das notas de Juazeiro)'),
  (42,  920, 'Arquivo "NF 134 VISITA TECNICA" + CNPJ 44.616.854/0006-87, Rua da Palma 152 (Rua da Palma)'),
  (101, 919, 'Arquivo "NF 213 CAJUEIRO SECO" + CNPJ 44.616.854/0011-44, Av. Barreto de Menezes 341 (mesmo CNPJ das notas de Prazeres)'),
  (138, 919, 'Arquivo "NF 254 CAJUEIRO" + CNPJ 44.616.854/0011-44 (Prazeres)'),
  (74,  951, 'Arquivo "NF 190 MARCEIO ORÇ 683" = Maceió, mesmo lote dos orçamentos 682/684/687 (Maceió Centro)')
), d as (
  update public.cftv_documentos x set loja_codigo = m.loja, loja_confianca = 'alta',
         loja_motivo = 'Definida pelo nome do arquivo e CNPJ (13/11/2026): ' || m.motivo, atualizado_em = now()
    from m where x.id = m.id and x.loja_codigo is distinct from m.loja returning x.id, x.loja_codigo)
update public.cftv_equipamentos e set loja_codigo = d.loja_codigo
  from d, public.cftv_documento_itens i where i.documento_id = d.id and e.documento_item_id = i.id;
update public.cftv_manutencoes mm set loja_codigo = x.loja_codigo
  from public.cftv_documentos x where mm.documento_id = x.id and x.id in (4, 29, 42, 101, 138, 74) and mm.loja_codigo is distinct from x.loja_codigo;
