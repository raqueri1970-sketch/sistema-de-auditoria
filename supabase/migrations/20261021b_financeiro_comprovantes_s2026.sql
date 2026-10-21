-- Auditoria Financeira: leitura dos comprovantes da pasta S:\2026 e casos de duplicidade achados nela.
-- Aplicada em 21/10/2026.
--
-- fin_comprovantes_ocr: texto de cada página dos PDFs da pasta de comprovantes (texto do PDF ou OCR quando a página é print).
--   Base para conciliar comprovante x título do Sallamo e achar duplicidade.
-- fin_duplicidade_comprovantes: casos de mesmo fornecedor + mesmo valor + mesmo dia com comprovantes diferentes.
--   nivel PAGO_A_MAIS = mesmo código de barras pago de novo, ou mais pagamentos no banco que títulos no Sallamo;
--   SUSPEITA = sem documento que diferencie; EXPLICADO = um título distinto no Sallamo para cada pagamento.
--   O auditor registra a situação (conferência no extrato) na aba "Duplicidade nos comprovantes".
-- Quem pode: os mesmos perfis da auditoria (fin_pode_auditar).

create table if not exists public.fin_comprovantes_ocr (
  id bigint generated always as identity primary key,
  arquivo text not null,            -- caminho do PDF no servidor de comprovantes
  pagina int not null,              -- página (0 = primeira)
  tipo text,                        -- boleto, pix, tributo, arquivo (remessa), conta…
  data_pagamento date,
  valor numeric(14, 2),
  beneficiario text,
  doc_beneficiario text,
  autenticacao text,
  codigo_barras text,
  campos jsonb,                     -- precisa_ocr, ocr, img…
  texto text,                       -- texto da página
  criado_em timestamptz not null default now(),
  unique (arquivo, pagina)
);
create index if not exists fin_comprovantes_ocr_valor_dia on public.fin_comprovantes_ocr (valor, data_pagamento);
alter table public.fin_comprovantes_ocr enable row level security;
drop policy if exists fin_comprovantes_ocr_ler on public.fin_comprovantes_ocr;
create policy fin_comprovantes_ocr_ler on public.fin_comprovantes_ocr for select to authenticated using ((select public.fin_pode_auditar()));
revoke all on public.fin_comprovantes_ocr from anon;
revoke all on public.fin_comprovantes_ocr from authenticated;
grant select on public.fin_comprovantes_ocr to authenticated;

create table if not exists public.fin_duplicidade_comprovantes (
  id bigint generated always as identity primary key,
  nivel text not null check (nivel in ('PAGO_A_MAIS', 'SUSPEITA', 'EXPLICADO')),
  fornecedor text,
  documento text,
  valor numeric(14, 2) not null,
  qtd int not null,
  datas date[] not null,
  valor_a_mais numeric(14, 2),
  prova text,
  titulos_sallamo jsonb,            -- [{codigo, pagamento, fornecedor}] quando o período tem Sallamo
  pagamentos jsonb not null,        -- [{data, valor, tipo, favorecido, autenticacoes, id_pix, codigo_barras, loja_pagadora, arquivo, pagina}]
  situacao text not null default 'a conferir no extrato',
  criado_em timestamptz not null default now()
);
create index if not exists fin_duplicidade_comprovantes_nivel on public.fin_duplicidade_comprovantes (nivel);
alter table public.fin_duplicidade_comprovantes enable row level security;
drop policy if exists fin_duplicidade_comprovantes_ler on public.fin_duplicidade_comprovantes;
create policy fin_duplicidade_comprovantes_ler on public.fin_duplicidade_comprovantes for select to authenticated using ((select public.fin_pode_auditar()));
drop policy if exists fin_duplicidade_comprovantes_situacao on public.fin_duplicidade_comprovantes;
create policy fin_duplicidade_comprovantes_situacao on public.fin_duplicidade_comprovantes for update to authenticated
  using ((select public.fin_pode_auditar())) with check ((select public.fin_pode_auditar()));
revoke all on public.fin_duplicidade_comprovantes from anon;
revoke all on public.fin_duplicidade_comprovantes from authenticated;
grant select on public.fin_duplicidade_comprovantes to authenticated;
grant update (situacao) on public.fin_duplicidade_comprovantes to authenticated;
