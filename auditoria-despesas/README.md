# Auditoria de Despesas (módulo do Portal)

Tela: `auditoria-despesas/` — aparece no Portal em **Auditoria › Auditoria de Despesas** (menu lateral e card na Visão Geral).

Cada relatório de reembolso auditado vira um conjunto de cards: resumo, parecer, achados por risco, gasto por conta e por
segmento, combustível × deslocamentos (7 km/L, margem 20%), linha do tempo por dia, custo de ida do CD a cada loja,
circuitos regionais, médias, plano de redução e as despesas uma a uma (com filtros e situação do relatório).

## Aba "Ordens de serviço"
Carteira de OS do Globalthings (abertas/pendentes) comparada com as OS fechadas: idade e pendência de cada OS, alertas
(sem responsável, atendida e não baixada, prestador sem orçamento, retrabalho, duplicada, executor fora do cadastro,
agenda impossível, trabalho em feriado), custo previsto por OS (deslocamento pela tabela CD × lojas com teto de 20%,
material pelos preços das OS fechadas e dos cupons, prestador pela mediana dos orçamentos aprovados, mão de obra em
horas), prestadores, equipe, preços de material e o cruzamento com os relatórios de despesas.
Dados na tabela `aud_os_carteira` (migration `20261109b_aud_os_carteira.sql`), uma fotografia por data.

## Dados
- Ficam no Supabase, tabela `aud_despesas_relatorios` (migration `supabase/migrations/20261109_aud_despesas_relatorios.sql`),
  com acesso só para administrador, controladoria e diretoria (`cred_pode_auditar()`).
- **Nada de dado de auditoria neste repositório** (ele é público): ver `.gitignore`.
- Entrada: botão **Importar arquivo** com o `.json` gerado na auditoria (relatório de despesas ou carteira de OS). O mesmo
  número de relatório, ou a mesma data de carteira, importado de novo atualiza o registro.

## Formato do .json (resumo)
`relatorio`, `titulo`, `solicitante`, `periodo_ini`, `periodo_fim`, `premissas{km_l, margem, cd, fonte_rotas}`, `precos`,
`kpis{total, retido, liberavel, comb_sem_comprovacao, ...}`, `parecer[]`, `achados[]`, `contas[]`, `segmentos[]`,
`combustivel{coerencia, deslocamentos[], veiculos[]}`, `frentes{texto, dias{}}`, `lojas[]`, `regioes[]`, `rotas[]`,
`medias[]`, `plano[]`, `despesas[]`.

## Ferramentas
- `ferramentas/geo.py <Enderecos_Lojas.xlsx> geo.json` — localiza o CD e as lojas (OpenStreetMap).
- `ferramentas/route.py geo.json routes.json` — distância rodoviária e tempo do CD a cada loja e entre lojas (OSRM).
- `ferramentas/os_parse.py <listagem.txt> os.json` — lê a “Listagem das Ordens de Serviços” do Globalthings
  (PDF convertido com `pdftotext -layout`): cabeçalho, reclamação, atividades (PE, OC, SE, MO com horas, MT com preço, SO).
