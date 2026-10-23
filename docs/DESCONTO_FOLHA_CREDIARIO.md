# Auditoria · Desconto em Folha do Crediário (revisão de 23/10/2026)

Objetivo: todo mês, saber **funcionário por funcionário** quanto deveria ser descontado na folha pelas compras no crediário, quanto foi descontado de fato e quando foi pago — e apontar erros, faltas graves e duplicidades.

- Tela: `desconto-folha/` (Portal → menu **RH → Desconto em Folha · Crediário**, ou direto em `/desconto-folha/`). Login do Portal; acesso só para perfis administrador, controladoria e diretoria (`cred_pode_auditar`).
- Banco: `supabase/migrations/20261023_cred_desconto_folha.sql` (tabelas `cred_*`, RLS, função `cred_importar`). Aplicada em produção em 23/10/2026.
- PDF e gráficos: os mesmos dos módulos de Obras (`obras-contas-pagar/comum.js` → `gerarPDF`, `svgGrafico`), com logo e assinaturas.

## Rotina do mês (aba "Arquivos do mês")

| Arquivo | Quando | O que a tela confere ao importar |
|---|---|---|
| Compras no crediário ("LISTAGEM DO RH", "COMPRA EM LOJA", CSV/Excel, inclusive o Excel antigo do sistema) — é o **devido** | todo mês | soma das linhas × total do rodapé; parcela repetida entre relatórios vira uma só; valor diferente vira alerta |
| Cadastro de funcionários (Ativos, Excel) | todo mês | quem saiu do cadastro passa a ser tratado como desligado |
| Descontos da folha (planilha "desconto de FOLHA", aba **crediario**) | depois que a folha fecha | a tela abre a aba "crediario" (o que foi descontado) e deixa trocar de aba; cada aba conta como um arquivo; linha de TOTAL é ignorada; CPF pela matrícula do cadastro; competência pelo nome do arquivo ("09-2026") ou informada; data de pagamento informada na importação ou depois ("Data de pagamento" em Arquivos importados) |
| Baixas do crediário | opcional | data em que cada parcela foi quitada |

Antes de gravar, a tela mostra o que leu (colunas, totais, primeiras linhas) para conferir. O mesmo arquivo (mesmo SHA-256) não entra duas vezes. A gravação é uma transação só (`cred_importar`): entra tudo ou nada. Um arquivo errado pode ser excluído (as linhas que vieram dele saem da base); o cadastro não se exclui — importa-se um mais novo.

## Como o cruzamento funciona

1. **Devido**: cada parcela cai numa competência da folha. Regra padrão: *ciclo da compra (corte dia 20) + parcela* — compra de 21/09 a 20/10 → 1ª parcela na folha de outubro, 2ª em novembro… Com a folha importada, a tela mede qual regra explica mais descontos (com a folha de teste, 97,8% pela regra padrão) e permite trocar.
2. **Descontado**: soma do evento por CPF e competência.
3. **Pago efetivamente**: data de pagamento da folha e, com baixas, a data de baixa de cada parcela.
4. **Situação por funcionário × mês** (tolerância padrão R$ 0,05): OK · Não descontou · Descontou a menos · Descontou a mais · Desconto sem compra · Verificar (faltam compras de ciclos anteriores) · Previsto (folha ainda não importada).
5. **Cobertura**: a competência só fica "completa" quando estão importadas as compras de todos os ciclos que ainda geram parcela nela (até 12 parcelas).

## O que a tela aponta

**Erros e faltas graves** — não descontou / a menos / a mais / sem compra; comprador fora do cadastro; saiu do cadastro (desligado com saldo); afastado sem salário (doença, acidente, aposentadoria por invalidez, rescisão); nome do crediário diferente do cadastro no mesmo CPF; compra antes da admissão; parcela faltando no contrato; parcela com valor alterado entre relatórios; relatório incompleto (rodapé); desconto sem funcionário; folha de competência já passada não importada; ciclo de compras sem relatório; descontado e não baixado; baixado sem desconto; baixas parciais.

**Duplicidades** — desconto lançado 2x na folha; mais de um desconto no mês; folha da mesma competência em dois arquivos; mesma parcela com dois vencimentos; compra repetida no mesmo dia (mesmo valor e parcelas); parcela baixada 2x.

Cada pendência recebe **tratativa** (pendente, cobrar, devolver, justificado, resolvido) com observação, usuário e data (`cred_tratativas`). Justificado/resolvido exige observação.

## Fechamento mensal

Em "Mês a mês" o auditor **fecha a competência**: devido, descontado, a menos, a mais, pendências e a lista de divergências ficam gravados (`cred_fechamentos`). Se os números mudarem depois (arquivo novo, regra trocada), a tela avisa "números mudaram depois do fechamento". Dá para reabrir.

## Relatórios (PDF, impressão e Excel)

Todo menu tem **PDF** e **Imprimir** do que está na tela (com os filtros): Painel → **PDF executivo para a Diretoria** (números da competência, evolução, achados com a ação recomendada, maiores riscos, situação dos funcionários, assinaturas Auditoria / Controladoria / Diretoria); Erros e faltas graves; Duplicidades; Mês a mês; Funcionários; Arquivos do mês.

Atenção: a LISTAGEM DO RH traz só parcelas em aberto (vencimentos a partir da data em que foi tirada). Para auditar uma folha já paga, importe a listagem tirada antes daquela folha (ou o "COMPRA EM LOJA" dos meses anteriores); senão o devido daquela competência fica zerado e a tela avisa.

Também na aba Relatórios:

- Auditoria da competência (resumo, gráficos, divergências, duplicidades, faltas graves, resumo por loja, assinaturas Auditoria / RH / Controladoria)
- Erros e faltas graves · Duplicidades · Divergências por loja (para o gerente)
- Lista para o RH lançar na folha (matrícula, nome, loja, valor da competência) — PDF e Excel
- Extrato do funcionário (na ficha de cada um)
- Excel completo (resumo, funcionário × mês, matriz, pendências, duplicidades, parcelas, folha, arquivos)

O botão **Imprimir** do Portal imprime a tela; o **Imprimir** de cada relatório gera a versão branca com logo, igual ao PDF.
