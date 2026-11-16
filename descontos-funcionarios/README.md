# Descontos de Funcionários (módulo do Portal)

Tela: `descontos-funcionarios/` — substitui, dentro do Portal, a página antiga "Descontos de Funcionários" (`pg-cmpaud`)
pelo patch `descontos-funcionarios-patch.js`. Mesmo login do Portal; acesso para Administração, Controladoria e Compras
(`portal_is_staff`).

## Por que a base não atualizava para todos (16/11/2026)
O módulo antigo trocava a base apagando as 54.249 linhas de `cmpaud_descontos` num único comando. Cada linha apagada
dispara 3 gatilhos de backup e o comando passava do limite de 8 s do banco → cancelado ("⚠ Não sincronizado").
Resultado: desde 10/08 nenhuma carga chegou à nuvem; quem carregava via a base só no próprio computador.

Agora cada carga é um registro em `cmpaud_cargas` + partes compactadas (gzip/base64, ~400 KB) em `cmpaud_cargas_partes`
(migração `supabase/migrations/20261116_cmpaud_cargas.sql`). Cada parte é um INSERT pequeno; a carga só vale para todos
quando está completa (`cmpaud_ativar_carga`), a anterior fica no histórico e nada é apagado. A tela confere a nuvem a
cada minuto e avisa "Nova base enviada por …". Pode-se enviar só o arquivo que mudou (ex.: só o cadastro de
funcionários): o restante continua o da nuvem.

## Arquivos aceitos (reconhecidos pelo conteúdo)
- **Base de Descontos** (CSV/XLSX do sistema): REPORTGROUP, CODIGO (nº da venda), DATA, PRODUTOX, NOMECLIENTE, QUANTIDADE,
  VPRECOITEM, VDESCITEM, PERCENTOX, AUTORIZADORX, VENDEDOR, OBS.
- **Funcionários Ativos** (XLSX): Codigo, Nome, Cpf, Data Nascimento, Data Admissão.
- **Regional** (XLSX): Filial, Regional, Tipo, UF.

## Regras (nucleo.js — mesmo código no navegador e na conferência em Node)
- Limite do desconto de funcionário: 10% do item; até **R$ 0,50 acima** do limite é tolerado.
- Desconto de centavos sem percentual (ex.: R$ 0,01) = arredondamento do caixa, não é desconto.
- Venda com Meia Hoahi + calçado = Campanha Meias (separada, não aponta).
- Funcionário = nome no cadastro de ativos, aceitando erro de digitação ("JACKSON RODIGUES" = "JACKSON RODRIGUES") e nome
  abreviado. Quem aparece como **vendedor** nas vendas mas não está na lista de ativos = "Colaborador fora do cadastro".
  Nome com 1–2 palavras = "Nome incompleto" (não confirmado).
- Sinais por pessoa (pontuação): não é funcionário, fora do cadastro, acima do limite, antes da admissão, volume de
  possível revenda (≥10 pares/mês), 3+ unidades do mesmo produto numa venda, 4+ lojas, auto-venda constante,
  desconto acumulado ≥ R$ 1.000. Alto ≥ 50 · Médio ≥ 30. Vendedores: quantos terceiros distintos receberam desconto dele.

## Tela
Cards inteligentes (clicam e abrem a composição, que soma o card), pesquisa inteligente (nome com erro, CPF, matrícula,
vendedor, nº da venda, loja, regional, produto), fichas por pessoa e por vendedor (inclui compras sem desconto),
abas Suspeitas · Por pessoa · Por vendedor · Por loja/regional · Lançamentos · Relatórios · Carregar arquivos.
Todos os relatórios (impressão/PDF com a logo e Excel) trazem **data, nº da venda**, loja, quem recebeu, vendedor,
produto, valores, % e liberação, com subtotal por pessoa e total geral, respeitando período, pesquisa e filtros.
