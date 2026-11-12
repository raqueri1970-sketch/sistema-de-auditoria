# Segurança Patrimonial e CFTV (módulo do Portal)

Tela: `seguranca-cftv/` — no Portal em **Auditoria › Segurança e CFTV** (menu lateral e card na Visão Geral). Visual azul e branco.

## O que faz
- **Painel**: patrimônio anterior a 2026, investimentos 2026 (equipamentos × instalação), manutenção, custos potencialmente evitáveis,
  monitoramento e novos investimentos pelo orçamento; câmeras, gravadores, lojas com câmera no estoque, defeitos e instalações pendentes;
  gráficos (mensal, por loja, por equipamento, por fornecedor, manutenção, ranking, ampliação × substituição, evolução da cobertura).
  Todo indicador abre os registros que o compõem (com Excel).
- **Por loja**: uma linha por loja do cadastro oficial (`portal_lojas` ativas), com canais, câmeras, compras, instalação, manutenção,
  necessidade, plano e cobertura do estoque; a ficha da loja mostra tudo e os detalhes sensíveis (só para quem pode).
- **Importação**: ZIP (inclusive ZIP dentro de ZIP), PDF de NF-e/NFS-e (escaneado → OCR no navegador), XML de NF-e, Excel/CSV
  (cadastro CFTV por loja, levantamento de necessidades, inventário, movimentações) e foto de comprovante. Histórico de importações.
- **Conferência**: notas que não foram lidas com segurança (loja ambígua, faturada na matriz, OCR, natureza a confirmar).
  Confirmar a loja grava o CNPJ da filial e as próximas notas daquele CNPJ entram sozinhas.
- **Inventário**: patrimônio anterior a 2026 × aquisições 2026 × patrimônio atualizado (desconta retirados, baixados, substituídos).
  Comprado ≠ instalado: o item da nota vira equipamento só quando a instalação é registrada (com opção de substituição e baixa).
- **Cobertura**: entrada, caixa, vendas, estoque, recebimento e outras áreas, por loja. Loja só é "completa" com as 5 áreas cobertas e
  sem equipamento com defeito. Ajuste manual não é sobrescrito por nova planilha. Histórico para a evolução.
- **Manutenção e custos evitáveis**: 7 classificações; "possível mau uso" só com evidência (o banco recusa sem ela). Reincidência,
  frequência, ranking por equipamento instalado e alerta a partir de 3 ocorrências semelhantes na mesma loja.
- **Auditoria**: regras automáticas (notas duplicadas, mesmo orçamento e valor, sem loja, comprado e não instalado, inventário sem nota,
  substituição sem baixa, manutenção repetida, valores inconsistentes, mesmo produto com preço acima do menor pago, gasto sem documento,
  acima da capacidade de gravação, CNPJ em lojas diferentes, gasto em loja desativada). Pendente / suspeita / confirmada; toda decisão
  exige observação e fica no histórico com responsável e data.
- **Plano e orçamento**: valoriza a necessidade de cada loja pela proposta KGMlan nº 1011040400 (26/10/2026): equipamento pelo preço
  do orçamento, cabeamento e mão de obra (R$ 70/ponto, das NFS-e de 2026). Premissas editáveis pelo administrador.
- **Relatórios** (tela, impressão/PDF e Excel), sempre com período, filtros, fonte e data de atualização: inventário, patrimônio,
  investimentos, manutenção mensal, ranking de custos, defeitos, cobertura do estoque, evitáveis e plano.
- **Acessos**: administrador/controladoria liberam Presidência, Diretoria, Segurança ou Consulta; registro de acessos e alterações.

## Dados e segurança
- Supabase, tabelas `cftv_*` (migrations `20261112_cftv_seguranca.sql` e `20261112b_cftv_complementos.sql`). Arquivos das notas no
  bucket privado `cftv-documentos`. **Nenhum dado no repositório** (é público): ver `.gitignore`.
- Perfis: administrador/controladoria = administração; diretoria do Portal = leitura; `cftv_acessos` = presidência, diretoria,
  segurança (edição) e consulta. Localização exata, pontos cegos e configurações ficam em `cftv_detalhes_sensiveis`, só para
  Segurança, Presidência e administração.
- Uma nota nunca entra duas vezes: mesmo arquivo (SHA-256), mesma chave de acesso, ou mesmo emitente + número + série + valor.
- Números do painel, do Cérebro e dos relatórios saem da mesma função: `cftv_painel(de, ate, loja, fornecedor, categoria)`.

## Cérebro Executivo e Sentinela
- `supabase/functions/portal-cftv-query`: responde perguntas de segurança/CFTV com período, fonte e critério.
  O `portal-conversa` (MCP/Siri) e o `portal-cerebro-financeiro` encaminham para ele (antes da regra financeira).
- Sentinela: teste `cftv_investimento_2026` (saúde do agente). O `portal-sentinel-agent-proxy` passou a aceitar só a chave de serviço.

## Leitor
`leitor.js` roda no navegador e no Node (mesmo código nos testes): DANFE e DANFSe por posição dos rótulos, OCR pelas palavras do
tesseract.js, categoria do item, natureza da despesa, loja de destino (apelidos/chaves por loja em `cftv_lojas`) e planilhas.
