-- CFTV · 13/11/2026 (c) — loja pelo NOME DO ARQUIVO da nota, conferida pelo CNPJ do destinatário (cada filial tem um CNPJ).
-- Aplicada pela gestão no SQL Editor do Supabase em 13/11/2026 (sessão sem conexão direta ao banco). Conferência: supabase/verificacoes/cftv_conferencia_lojas.sql
-- Loja 25 (Conde da Boa Vista, fechada) e divisão de Petrolina (34 Mix Mateus × 64 River) informadas pela gestão.
-- Só muda quando arquivo e CNPJ apontam para a mesma loja (ou o arquivo é inequívoco e a nota é da matriz).
with m(id, loja, motivo) as (values
  (4,   929, 'Arquivo "NF 71 CARUARU" + CNPJ 44.616.854/0014-97 (mesmo CNPJ das notas da Caruaru Centro II)'),
  (29,  937, 'Arquivo "NF 119 CONCERTINA" + CNPJ 44.616.854/0071-85, BR 407 (mesmo CNPJ das notas de Juazeiro)'),
  (42,  920, 'Arquivo "NF 134 VISITA TECNICA" + CNPJ 44.616.854/0006-87, Rua da Palma 152 (Rua da Palma)'),
  (101, 919, 'Arquivo "NF 213 CAJUEIRO SECO" + CNPJ 44.616.854/0011-44, Av. Barreto de Menezes 341 (mesmo CNPJ das notas de Prazeres)'),
  (138, 919, 'Arquivo "NF 254 CAJUEIRO" + CNPJ 44.616.854/0011-44 (Prazeres)'),
  (74,  951, 'Arquivo "NF 190 MARCEIO ORÇ 683" = Maceió, mesmo lote dos orçamentos 682/684/687 (Maceió Centro)'),
  (62,  925, 'Arquivo "COND BOA VISTA" + CNPJ 44.616.854/0063-75, Av. Conde da Boa Vista 88 · loja 25 (fechada; equipamento realocado) — informado pela gestão'),
  (67,  925, 'Arquivo "BOA VISTA INCENDIO" + CNPJ 44.616.854/0063-75 · loja 25 Conde da Boa Vista (fechada) — informado pela gestão'),
  (103, 925, 'Arquivo "BOA VISTA RETIRADA MATERIAL" + CNPJ 44.616.854/0063-75 · loja 25 Conde da Boa Vista (fechada) — informado pela gestão'),
  (82,  925, 'Arquivo "CONDE ORÇ 745" · loja 25 Conde da Boa Vista (fechada) — informado pela gestão'),
  (83,  925, 'Arquivo "CONDE ORÇ 745 MÃO DE OBRA" · loja 25 Conde da Boa Vista (fechada) — informado pela gestão'),
  (145, 925, 'Arquivo "CONDE ORÇ 925" · loja 25 Conde da Boa Vista (fechada) — informado pela gestão'),
  (22,  934, 'Arquivo "PETROLINA" (mar/26): gravador 16 canais + 16 câmeras = sistema da loja 34 Mix Mateus Petrolina — gestão: uma nota de Petrolina é da 34'),
  (66,  934, 'Arquivo "PETROLINA" (mar/26): 16 pontos de mão de obra = sistema da loja 34 Mix Mateus Petrolina'),
  (27,  964, 'Arquivo "PETROLINA MATERIAL" + CNPJ 44.616.854/0069-60 · loja 64 Shopping River Petrolina — informado pela gestão'),
  (92,  964, 'Arquivo "PETROLINA MÃO DE OBRA" + CNPJ 44.616.854/0069-60 · loja 64 Shopping River Petrolina'),
  (94,  964, 'Arquivo "PETROLINA DESPESAS VIAGEM" + CNPJ 44.616.854/0069-60 · loja 64 Shopping River Petrolina'),
  (144, 964, 'Arquivo "PETROLINA ORÇ 888" + CNPJ 44.616.854/0069-60 · loja 64 Shopping River Petrolina')
), d as (
  update public.cftv_documentos x set loja_codigo = m.loja, loja_confianca = 'alta',
         loja_motivo = 'Definida pelo nome do arquivo e CNPJ (13/11/2026): ' || m.motivo, atualizado_em = now()
    from m where x.id = m.id and x.loja_codigo is distinct from m.loja returning x.id, x.loja_codigo)
update public.cftv_equipamentos e set loja_codigo = d.loja_codigo
  from d, public.cftv_documento_itens i where i.documento_id = d.id and e.documento_item_id = i.id;
update public.cftv_manutencoes mm set loja_codigo = x.loja_codigo
  from public.cftv_documentos x where mm.documento_id = x.id and x.id in (4, 29, 42, 101, 138, 74, 62, 67, 103, 82, 83, 145, 22, 66, 27, 92, 94, 144) and mm.loja_codigo is distinct from x.loja_codigo;

-- loja 25 no cadastro do módulo (fechada; o equipamento foi realocado)
do $$ begin
  if not exists (select 1 from public.cftv_lojas where codigo = 925) then
    insert into public.cftv_lojas (codigo, nome, cidade, apelidos, cnpjs) values (925, 'Conde da Boa Vista (fechada)', 'Recife', array['CONDE DA BOA VISTA','COND BOA VISTA'], array['44.616.854/0063-75']);
  end if;
  update public.cftv_lojas set cnpjs = array['44.616.854/0069-60'] where codigo = 964 and coalesce(array_length(cnpjs,1),0) = 0;
exception when others then raise notice 'cadastro da loja 25: %', sqlerrm;
end $$;
