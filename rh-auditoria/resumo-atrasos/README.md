# Faltas e Atrasos — menu "Resumo de atrasos"

Nova aba **Resumo de atrasos** (entre Visão executiva e Casos para ação) no módulo
`portal-esposende-login/faltas-atrasos/index.html`, com 6 cards inteligentes (quantidade, % e R$, clique abre a composição):

1. **Chegaram atrasados** — % do quadro ativo · R$/h descontáveis (atraso − dias de até 15 min, CLT art. 58 §1º)
2. **Atrasados descontados** — rubrica 1354 (ou 1356 acima das faltas) · integral × em parte
3. **Atrasados não descontados** — separa quem foi para o banco de quem ficou sem banco nem desconto
4. **Atrasos lançados no banco de horas** — DEBT do espelho AbsisRH sem COMP BCO · alerta de duplicidade com a folha
5. **Já tinham banco negativo** — SANT negativo no início do período
6. **Advertidos** — marcação ADV/advertência no cartão de ponto ou no espelho, com atrasos, faltas e desconto em folha

Conferência: atrasados = descontados + não descontados + até 15 min + demitidos. Tabela por regional com os mesmos números.

## Aplicar no Portal
```
cd portal-esposende-login && git apply ../sistema-de-auditoria/rh-auditoria/resumo-atrasos/portal-esposende-login.patch
```
(o patch também troca o `?v=` do `faltas-atrasos-patch.js` para `20261118-1`).
