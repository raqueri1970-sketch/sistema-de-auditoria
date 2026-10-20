# 💰 Auditoria Financeira · Contas a Pagar (Sallamo)

Módulo do Portal (menu **Financeiro → Auditoria Financeira**, ou `financeiro/` direto) que puxa o Contas a Pagar
do Sallamo ao vivo, cruza tudo e aponta possíveis irregularidades para o auditor analisar.

## Como funciona

```
Navegador (Portal)  ──login Portal──▶  Edge Function financeiro-sallamo  ──Bearer SALLAMO_TOKEN──▶  API Sallamo
      │                                  (confere perfil: administrador,
      │                                   controladoria ou diretoria)
      └─ auditoria.js cruza os títulos no navegador ─▶ ocorrências ─▶ análise do auditor grava em fin_analises
```

- A API do Sallamo **não libera CORS** e exige token: por isso o navegador fala com a Edge Function, que guarda o token
  como segredo. O token **nunca** fica no HTML (o Portal é publicado no GitHub Pages).
- A análise roda no navegador (17.943 títulos em ~1 s).
- O período filtrado é de **vencimento** (igual à API do Sallamo).

## Configuração

1. O token do Sallamo está no **Supabase Vault** (criptografado) com o nome `sallamo_token` — cadastrado em 16/10/2026.
   Para trocar o token, ver `supabase/migrations/20261016b_financeiro_token_vault.sql`. (Se existir o segredo
   `SALLAMO_TOKEN` nas Edge Functions, ele tem prioridade.) Opcional: `SALLAMO_EMPRESA` (padrão `6835c03f0ffe7df22945d191`).
2. Os usuários precisam ter perfil `administrador`, `controladoria` ou `diretoria` ativo em `orc_perfis`.
3. Campos que a API do Sallamo pode passar a enviar e o módulo já lê sozinho: `observacao`, `valorDesconto`, `valorAbatimento`, `valorJuros`, `valorMulta`, `numeroDocumento` (NF/duplicata — reforça a duplicidade), `formaPagamento`, `usuarioBaixa` e `comprovante` (link do comprovante, aparece no comparativo lado a lado).
4. Publicado no Portal: `portal-esposende-login` (pasta `financeiro/` + `financeiro-patch.js`), menu Financeiro → Auditoria Financeira.

## As 23 regras de cruzamento

| Regra | O que pega | Por que importa |
|---|---|---|
| R01 Duplicidade | mesmo fornecedor + valor + vencimento + centro de custo em códigos diferentes | pagamento em dobro / NF lançada 2× |
| R02 Linha repetida | linhas idênticas dentro do mesmo código | rateio duplicado |
| R03 Pago a maior | valor pago > parcela | juros/multa evitáveis ou pagamento indevido |
| R04 Status incoerente | "Pago" com saldo, cancelado com pagamento, "A vencer" já vencido | baixa errada no sistema |
| R05 Antecipado | pago antes da competência ou ≥15 dias antes do vencimento | perda financeira / favorecimento |
| R06 Fim de semana/feriado | baixa em sábado, domingo ou feriado nacional | fora do expediente bancário |
| R08 Fracionamento | ≥3 títulos do mesmo fornecedor no mesmo dia, cada um abaixo da alçada, somando acima | fuga de aprovação |
| R09 Valor atípico | valor muito acima da mediana do fornecedor/conta | desvio de padrão |
| R10 Benford | 1º dígito dos valores foge da Lei de Benford (MAD de Nigrini). Explicação em linguagem simples na tela, com a lista dos pagamentos do dígito fora do padrão | valores "inventados" — **não** é duplicidade; o valor é o total pago ao fornecedor |
| R11 Cadastro duplicado | nomes de fornecedor quase iguais | porta para pagamento em dobro |
| R12 Pessoa física | nome de pessoa recebendo fora da folha | vínculo com funcionário / sem NF |
| R13 Conta sensível | retirada bancária, partes relacionadas, adiantamentos, acordos, ajuda de custo… | saída sem documento fiscal |
| R14 Redondos altos | valores cheios (múltiplos de R$ 1.000) altos | estimativa sem documento |
| R15 Fornecedor novo | apareceu recentemente e já recebeu muito | fornecedor de fachada |
| R16 Mesmo valor/dia | mesmo valor exato no mesmo dia para fornecedores diferentes | documento reaproveitado |
| R17 Datas incoerentes | vencimento antes da competência / competência muito antiga | lançamento retroativo |
| R18 Vencido em aberto | vencido há 30+ dias | juros, protesto, corte de fornecimento |
| R19 Classificação | mesmo fornecedor em muitas contas contábeis | distorce DRE, esconde despesa |
| R20 Pago a menor | duplicata paga abaixo da parcela (baixa "Pago" com diferença = desconto/abatimento ou baixa errada; ou pagamento parcial) | desconto sem documento, baixa indevida |
| R21 Despesa na conta errada | nome do fornecedor indica hotel, posto, Uber, restaurante, aérea… e a conta é outra | despesa escondida em outra conta |
| R22 Observação/abatimento | observação, desconto, abatimento, juros ou multa informados na baixa | **depende da API enviar `observacao`, `valorDesconto`, `valorAbatimento`, `valorJuros`, `valorMulta`** — lidos automaticamente quando vierem |
| R23 Possível duplicidade (Agente) | mesmo fornecedor/pessoa + mesmo valor exato saindo mais de uma vez: mesmo dia, até 7 dias, mesmo título (código), centros de custo diferentes, ou mesma competência na folha (pensão, salário, VT, Uber, reembolso…) — inclui títulos em aberto | pagamento em dobro (e o que ainda dá para evitar) |

## Abas de análise

- **🕵️ Agente de Duplicidade**: um card por caso suspeito (R01 + R23) com nota de confiança 0–100, os motivos
  (✓ a favor · ↓ o que pode explicar: rateio entre lojas, preço por loja, lote de mercadoria, cobrança recorrente) e os
  eventos **lado a lado** (verde = igual, amarelo = diferente). Mostra quanto pode ter saído a mais e quanto ainda está em
  aberto (evitável). Filtros por confiança, tipo (mesmo dia, mesmo título, folha, centros diferentes, cadastro, em aberto),
  PDF e Excel. Testes: `node financeiro/teste_duplicidade.js`.
  Nota do agente: começa em 20 e soma mesmo dia (+25) ou datas coladas ≤3 dias (+15), mesmo título com vencimentos colados
  (+25), mesmo nº de NF (+30, quando a API enviar), mesmo vencimento (+15), mesma competência (+10), mesmo centro (+10),
  cadastro com grafia diferente (+10), conta de pessoas (+10, +10 se mesmo mês); desconta rateio (máx. 20), preço por loja
  (−30/−45), lote de mercadoria (−35), cobrança recorrente (−25). Alta ≥ 70 · média ≥ 45 · abaixo de 30 não entra.
- **📂 Conferir arquivo do banco / RH** (dentro da aba do Agente): carrega o que o RH manda ao banco — **CNAB 240**
  (.txt/.rem) ou a **Relação para Depósito Bancário** em PDF — e a **Lista de Comprovantes** do Internet Banking (PDF,
  lido com pdf.js). Lido só no navegador, nada é enviado nem gravado (tem CPF e conta dos funcionários). Confere:
  total do arquivo × total informado; mesma pessoa/CPF/código/conta 2× no arquivo; conta bancária de pessoas diferentes;
  arquivo × comprovante (sem comprovante, valor diferente, pago 2× pelo banco, comprovante de quem não está no arquivo);
  adiantamento × folha (recebeu adiantamento e sumiu da folha — descontar na rescisão); o **lote** no Sallamo (total pago
  1×, 2× ou não achado) e **pessoa a pessoa** (recebeu pelo arquivo e também tem título pago no Sallamo ±20 dias — alta se
  mesmo valor). O mesmo lote em CNAB + relação + comprovante conta uma vez. Testes: `node financeiro/teste_arquivo_banco.js`.
- **Ocorrências**: por padrão **uma linha por fornecedor** — todas as regras juntas (uma linha por regra, ex.: "R06 ×19"),
  valor envolvido contado uma vez só e a coluna **Duplicidade?** (só R01/R23 dizem que algo pode ter sido pago em dobro).
  Nas regras de padrão (Benford, conta sensível, classificação, pessoa física, fornecedor novo, redondos, conta errada) o
  valor é o **analisado**, não perda. Dá para voltar à visão detalhada (uma linha por ocorrência).

- **💸 Despesas**: quanto foi gasto por categoria (transporte, hospedagem, alimentação…), tipo (conta contábil), centro de custo, fornecedor e mês — em valor pago (caixa) ou lançado (competência). Atalhos: Uber/Táxi, Hotel, Alimentação, Combustível… PDF e Excel (com matriz centro de custo × categoria), sempre com total.
- **🏷 Descontos e observações**: duplicatas pagas a menor, separando baixa com diferença × pagamento parcial, por fornecedor, com total.
- **🔎 Busca de títulos**: busca em vários formatos (código, valor, faixa, data, mês, regra, texto).


A **nota de risco por fornecedor** (0–100) soma indícios *diferentes* cruzados no mesmo fornecedor
(cada regra conta uma vez, pelo peso da pior ocorrência: alta 10, média 4, baixa 1). Todos os limites
são ajustáveis na aba **Regras e parâmetros**.

## Trabalho do auditor

Cada ocorrência tem situação **Pendente → Em análise → Justificada / Irregular / Corrigida**, com comentário
obrigatório para justificar ou declarar irregular. Tudo fica em `fin_analises` com histórico em
`fin_analises_historico` (quem, quando, o quê). Exportação para Excel com 5 abas.

## Testes

`node -e "const A=require('./financeiro/auditoria.js'); console.log(A.analisar(require('./cp.json').dados).ocorrencias.length)"`
