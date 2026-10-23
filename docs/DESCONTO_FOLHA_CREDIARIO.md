# Auditoria · Desconto em Folha do Crediário

Objetivo: saber, **funcionário por funcionário e mês a mês**, quanto deveria ser descontado na folha pelas compras no crediário, quanto foi descontado de fato e quando foi pago.

- Tela: `desconto-folha/` (publicada com o restante do site). Tudo é processado **no navegador**: os arquivos (com CPF) não são enviados para nenhum servidor e ficam guardados só naquele computador (IndexedDB). O botão "Limpar base" apaga tudo.

## Fontes

| Arquivo | Obrigatório | Colunas usadas |
|---|---|---|
| Compras no crediário ("COMPRA EM LOJA", CSV/Excel) | sim | Cpfcnpj, Nome, Documento (`CE003612-1/5`), Parcela, Lançamento, Vencimento, Valor. Pode carregar vários períodos; parcelas repetidas são unificadas. O total do rodapé é conferido com a soma das linhas. |
| Cadastro de funcionários (Ativos, Excel) | sim | CPF, Matrícula, Nome, Nome CCusto (loja), Cidade, Função, Data Admissão, Situação. |
| Descontos da folha (Excel/CSV) | para auditar | CPF **ou** Matrícula (ou Nome), Competência, Evento/Rubrica, Valor, Data de pagamento. Se o arquivo não tiver competência ou data de pagamento, informa-se no quadro do arquivo. Os eventos que contam como desconto do crediário são marcados na tela. |
| Baixas do crediário (Excel/CSV) | opcional | Documento, Parcela, CPF, Data da baixa/pagamento, Valor pago. |

As colunas são reconhecidas pelo nome do cabeçalho; dá para corrigir em "Colunas e opções".

## Como o cruzamento funciona

1. **Devido**: cada parcela vai para uma competência da folha.
   - *Ciclo da compra + parcela* (padrão): compra de 21/09 a 20/10 → folha de outubro na 1ª parcela, novembro na 2ª, e assim por diante (o relatório "21-09 a 20-10" mostra o corte no dia 20).
   - *Vencimento com corte*: a parcela entra na folha do mês do vencimento (vencimento depois do corte vai para o mês seguinte).
   - Com a folha carregada, a tela mede qual regra explica mais descontos (funcionário × mês batendo exato) e permite trocar.
2. **Descontado**: soma do(s) evento(s) do crediário na folha por CPF e competência (matrícula e nome são usados quando a folha não traz CPF).
3. **Pago efetivamente**: data de pagamento da folha da competência e, com o arquivo de baixas, a data em que cada parcela foi baixada no crediário.
4. **Situação por funcionário × mês** (tolerância de arredondamento configurável, padrão R$ 0,05):

| Situação | Significado |
|---|---|
| OK | descontado = devido |
| Não descontou | havia parcela e nada foi descontado — perda para a empresa |
| Descontou a menos | descontado < devido — perda para a empresa |
| Descontou a mais | descontado > devido com todas as compras carregadas — devolver ao funcionário (risco trabalhista) |
| Desconto sem compra | desconto na folha sem parcela no crediário |
| Verificar | desconto acima do previsto, mas faltam compras de ciclos anteriores para fechar a conta |
| Previsto | competência sem folha carregada (previsão) |

5. **Cobertura**: uma competência só é "completa" quando estão carregadas as compras de todos os ciclos que ainda geram parcela nela (até o maior número de parcelas visto, hoje 10). Para auditar uma folha com segurança, carregue os relatórios de compras dos ~10 ciclos anteriores.

## Alertas

- **Comprador fora do cadastro** — CPF não está entre os funcionários (desligado ou terceiro): sem folha não há desconto; cobrar na rescisão/boleto. Mostra o saldo em aberto.
- **Afastado sem salário** (doença, acidente, aposentadoria por invalidez, rescisão) — o desconto em folha não cobre a parcela.
- **Situação especial** (férias, maternidade, licença) — conferir se o desconto entrou.
- **Nome diferente no CPF** — nome do crediário muito diferente do cadastro (tolerando erros de digitação e abreviações): possível compra de outra pessoa no CPF do funcionário.
- **Parcela faltando no contrato**, **parcela com valor alterado** entre relatórios, **compra antes da admissão**, **arquivo incompleto** (soma ≠ rodapé).
- Com baixas: **descontado e não baixado** (risco de cobrar duas vezes) e **baixado sem desconto** (confirmar o recebimento).

## Exportação

"Exportar Excel" gera: Resumo por competência, Funcionário x mês, Matriz mensal, Divergências, Alertas, Parcelas (com a competência atribuída e a baixa), Folha importada e Parâmetros.
