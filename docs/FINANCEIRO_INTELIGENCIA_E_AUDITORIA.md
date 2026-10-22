# Financeiro · Inteligência e Auditoria (revisão de 22/10/2026)

Objetivo: **entender para onde o dinheiro está indo e identificar, com evidência, onde a empresa pode estar perdendo dinheiro.**

- Tela: `financeiro/` (publicada pelo Vercel em https://sistema-de-auditoria-omega.vercel.app/financeiro/) — login do Portal; acesso só para perfis administrador, controladoria e diretoria (`fin_pode_auditar`).
- Perguntas por texto: MCP do Portal (`consultar_portal_esposende`) ou aba **Pergunte** da tela.
- Banco: `supabase/migrations/20261022_fin_sistema_unificado.sql`. Edge Functions: `supabase/functions/`.

## Como funciona

```
Sallamo ──financeiro-sallamo──▶ fin_sallamo_cache ──(pg_cron, 10 min: fin_processar)──▶ fin_lancamentos ──▶ fin_auditar()
                                                                                              │                 │
comprovantes (fin_comprovantes) + banco/OCR (fin_duplicidade_comprovantes) ───────────────────┴──▶ fin_ocorrencias
                                                                                                                │
                              Caixa de Revisão (fin_decidir) ──▶ fin_decisoes (usuário, data, observação, evidências)
```

| Peça | O que faz |
|---|---|
| `fin_lancamentos` / `fin_base` | Todas as contas a pagar do Sallamo numa base só. Cada dia de vencimento vem da carga mais recente que cobre o dia. Receitas ficam marcadas `RECEITA` e fora dos gastos. Título que some do Sallamo fica `vigente = false` (histórico). |
| `fin_auditar()` | **Cruzador** (Sallamo × comprovantes × banco/OCR), **Auditor** (classifica e descarta falso positivo) e **Sentinela** (pontua: valor, força da evidência, reincidência, ação antes de pagar). |
| `fin_ocorrencias` | Uma linha por achado, com grupo, classificação, força, prioridade, valor envolvido, valor em risco, impacto comprovado e evidências. |
| `fin_decidir()` | Decisão humana: CONFIRMAR_IRREGULARIDADE, NAO_E_IRREGULARIDADE, REVISAR_DEPOIS, RESOLVIDO. Exige observação; grava usuário logado. |
| `fin_consulta` / `fin_comparar` / `fin_resumo` / `fin_lancamento` / `fin_ocorrencia` | Inteligência com drill-down: total → grupo → lançamento → comprovante. |
| `portal-financeiro-query` | Cérebro Executivo: gastos usam a base inteira; erros/perdas usam as ocorrências. |
| `portal-conversa` | Entrada do MCP: manda perguntas financeiras ao Cérebro Executivo e o resto ao Maestro; lembra o contexto ("e em agosto?"). |

## Classificação

| Classificação | Quando |
|---|---|
| NORMAL | Nada encontrado, ou uma pessoa decidiu que não é irregularidade. |
| SOB_ANALISE | Há indício. **Não entra como prejuízo.** O valor aparece como "em risco". |
| IRREGULARIDADE_CONFIRMADA | O próprio documento prova o fato (encargo no comprovante bancário; despesa lançada como multa/juros), ou uma pessoa confirmou sem valor. |
| PREJUIZO_CONFIRMADO | **Só por decisão humana**: irregularidade confirmada + impacto comprovado informado. |

## Regras (5 grupos)

| Grupo | Regra | Força |
|---|---|---|
| Duplicidade | `DUP_BANCO` mesmo código de barras/PIX pago 2+ vezes (leitor de comprovantes bancários) | forte; "parecidos" = média |
| | `DUP_SALLAMO` mesma parcela (título + vencimento + valor) paga 2+ vezes, com 2+ autenticações ou sem comprovante | forte / média |
| | `DUP_COMPROVANTE` comprovantes do mesmo título somam mais que o pago no Sallamo | forte |
| Pagamento incorreto | `PAG_LOTE` valor que saiu do banco ≠ soma dos títulos baixados com a mesma autenticação | média |
| | `PAG_SITUACAO` título Cancelado/Renegociado com pagamento | média / fraca |
| Juros e multas | `JUROS_COMPROVANTE` encargos no comprovante (fato) · `JUROS_CONTA` conta de multa/juros/mora (fato; **FGTS rescisório fica fora**) · `JUROS_ATRASO` pago após o vencimento e acima da parcela (suspeita) | |
| Crédito não aproveitado | `CREDITO_NAO_USADO` pago a mais em dia, sem abatimento posterior do mesmo fornecedor | média |
| Inconsistência | parcela repetida (paga e/ou a pagar — **risco de pagar de novo**), "Pago" com menos da metade paga, comprovante repetido, centro de custo vazio, fornecedor com nomes diferentes | |

Não confirma duplicidade só porque fornecedor e valor são iguais: as chaves fortes são documento/código de barras, fornecedor, título/parcela e identificador do pagamento (autenticação/PIX).

## Achados da auditoria do sistema antigo (corrigidos)

1. **Dados financeiros abertos na internet**: `portal-cerebro-financeiro` respondia sem chave; `portal-financeiro-query` devolvia lançamentos para quem tivesse a chave pública (que fica no código das páginas). Agora só usuário com `fin_pode_auditar` ou o próprio servidor.
2. **MCP respondia errado**: "prejuízo com duplicidade" devolvia o total de NF-e canceladas; "gastos com energia" não era reconhecido.
3. **Base encolhia**: cada consulta lia "a última carga", que podia ser um recorte de 3 meses.
4. **Busca sem resultado virava o total geral** (o filtro caía para todos os lançamentos) e palavras eram cortadas no meio ("comercial" → "ercial").
5. **Receitas somadas como despesa** e **Renegociado/Cancelado no saldo a pagar** (dívida contada duas vezes).
6. **38 casos gravados como "irregular" pelo robô** sem revisão humana (R$ 584 mil apresentados como irregularidade). Voltaram para "em análise".
7. `fin_revisar_duplicidade` (4 parâmetros) aceitava qualquer nome de usuário na decisão; agora usa o usuário logado.
8. Juros, crédito, pagamento incorreto e inconsistência existiam só como nome de regra: nenhuma ocorrência era gerada.
9. A mesma carga do Sallamo era gravada de novo a cada consulta (27 cargas iguais em um dia); agora carga repetida só renova a data.

## Limites conhecidos (não é zero, é falta de dado)

- Pagamentos no Sallamo só a partir de 28/05/2026; por vencimento a base é completa a partir de 06/2026. A tela e o Cérebro avisam isso em toda resposta.
- O Sallamo não traz CNPJ nem número de NF: a chave de título é código + vencimento + valor.
- Cerca de metade dos pagamentos tem comprovante anexado (indicador na tela); sem comprovante, duplicidade fica com força média.
- A base atualiza até 10 minutos depois da carga do Sallamo (`fin_processar` no pg_cron).
