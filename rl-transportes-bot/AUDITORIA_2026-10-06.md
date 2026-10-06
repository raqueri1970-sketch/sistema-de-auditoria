# Auditoria RL TRANSPORTES — 06/10/2026

Escopo: 1.314 arquivos da pasta `fotos`, 79 depósitos, 1.027 despesas, varredura do grupo do
WhatsApp de 06/07 a 06/10 e conciliação semanal contra as folhas manuscritas da Bruna.
Backup antes das correções: `rl_transportes_backup_antes_auditoria_0610.db` (PC da controladoria).

## Resultado

| | Antes | Depois |
|---|---|---|
| Saldo do sistema em 04/10 | −13.406,35 | **−1.756,02** |
| Saldo da Bruna em 04/10 | +4.152,89 | +4.152,89 |
| Diferença | −17.559,24 | **−5.908,91** |

Supabase conferido com `sync_supabase.js`: idêntico ao SQLite.

## Correções feitas

| # | O que | Efeito no saldo |
|---|---|---|
| DEP #86 | Depósito do Paulo de 28/09 08:56, R$ 10.000,00 (Santander, aut. `MBJ37920CCC06DA0548A6BA`). A mídia falhava no download desde 01/10 e foi recuperada pelo caminho alternativo. A folha da Bruna de 28/09–04/10 registra MAR ABERTO = 30.000. | +10.000,00 |
| DESP #1116 → cancelado | PIX de R$ 1.650,33 da RL para a Bruna (15/09 18:35), que é o reembolso do abastecimento QML7F06 já lançado na DESP #1233 (15/09 18:25). Estava contado duas vezes. Agora a semana 14–20/09 bate centavo a centavo. | +1.650,33 |
| DESP #1233 | Placa QML7F06 e observação do reembolso | — |
| DEP #39 excluído | Não era depósito: era um print do "Saldo disponível" da Cora (R$ 8.375,61, 28/07). Ficava fora do saldo só porque a IA leu o ano como 2024, mas inflava o total de depósitos e recebia despesas pelo FIFO. | — |
| FIFO | Reconciliação refeita depois das correções | — |

## Fotos da pasta sem lançamento (214)

- **155** são cópias byte a byte de comprovantes já lançados.
- **4** são orçamentos (o bot não lança orçamento, de propósito).
- **55** foram conferidas uma a uma pelo conteúdo: autenticação bancária, valor e data. Todas
  estão cobertas por outro lançamento, são de antes do saldo inicial (06/07) ou são guias,
  prints e resumos que não são pagamento.
  - Exemplos: as guias GNRE de 09/07 cujos boletos estão em #606/#618/#623/#624, e os resumos
    semanais escaneados.
- Tokio Marine (#165/#176), Edilson (#240/#241) e GNRE 25/06 (#205/#206) parecem duplicatas,
  mas têm autenticações diferentes, então são pagamentos distintos.

## O que ainda falta para fechar (−5.908,91)

Não dá para lançar sem comprovante. Precisa do extrato da Cora ou dos comprovantes:

1. **Recebidos (Rafael) que a Bruna contou e que não chegaram ao grupo:** cerca de **R$ 6.897,54**.

   | Semana | Valor |
   |---|---|
   | 10–16/08 | 1.544,40 |
   | 17–23/08 | 230,00 |
   | 24/08–07/09 | 2.154,00 |
   | 21–27/09 | 2.596,00 |
   | 28/09–04/10 | 373,14 |

   Somam-se R$ 86,93 de reembolsos de Uber anotados pela Bruna (18,46 + 68,47).
2. **Despesas da folha da Bruna sem comprovante no sistema** (deixam o sistema maior, compensam
   em parte):
   - 10–16/08: ARLA FNE6J55 101,88; ABAST ITY6127 475,91; ABAST 269,72; outros 84,00.
   - 21–27/09: 20,00.
   - 28/09–04/10: 144,86.
3. Até 09/08 a diferença acumulada é de só −21,23 (centavos de reembolsos de Uber).
   - O depósito de 13/07 (R$ 10.000) entrou como **ajuste #10** em 23/07. Por isso julho bate.

## Pontos de atenção no bot

- Prints de saldo e resumos semanais entram como lançamento. Os resumos ficam como `outros` e
  não afetam o saldo. O print de saldo virou depósito (DEP #39).
- O PIX da RL para a própria Bruna pode ser reembolso de uma despesa já lançada. Vale revisar
  sempre que o favorecido for a Bruna.
- A simulação `/api/recuperar-periodo` marca como faltando comprovantes de julho que foram
  lançados com o nome de arquivo antigo (sem ID da mensagem). Esses são falsos positivos.

## Como repetir

```bat
node conciliacao_semanal.js              :: sistema x folhas da Bruna, semana a semana
node conciliacao_semanal.js 2026-08-10   :: + lancamentos da semana
```
