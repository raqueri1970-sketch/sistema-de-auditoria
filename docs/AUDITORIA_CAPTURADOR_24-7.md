# Capturador WhatsApp 24/7 — Auditoria e plano de migração

Data da auditoria: 08/10/2026. Nada foi alterado no D90, no Supabase nem no Portal durante esta auditoria
(somente leitura).

---

## 1. O que já está funcionando

### Processo no D90 (`C:\Users\controladoria\Documents\claude\whatapp - rl`)

| Item | Situação |
|---|---|
| `node bot_v3.js` (PID 8484) | No ar desde 08/10 17:07, iniciado à mão por `INICIAR_BOT_RL.bat` (cmd.exe na Área de Trabalho) |
| WhatsApp (whatsapp-web.js, `LocalAuth`) | `CONNECTED`. Sessão em `.wwebjs_auth` (1.185 arquivos, ~1 GB) |
| RL Transportes | Grupo "RL TRANSPORTES" → SQLite `rl_transportes.db` (fonte da verdade) → espelho no Supabase (`rl_*`). Watchdog de 5 min, varredura de 2h, reprocessamento de zeradas e espelho a cada 2h |
| Obras (`obras_bot.js`, criado hoje) | Carregado dentro do `bot_v3.js` (mesma sessão). Grupo "Adm Obras Esposende" → `obras_comprovantes` + bucket privado `obras-comprovantes`. `/api/obras/status` responde: IA `claude-sonnet-5-5`, Supabase ok |
| Outro leitor no D90 | `node leitor.js` em `Documents\AJUSTE_EXPRESS_LEITOR_WHATSAPP` (tarefa agendada `AjusteExpressoLeitorWhatsApp`). É de outro módulo (Ajuste Express) e fica fora deste projeto |

A integração de Obras no `bot_v3.js` tem só 9 linhas (diff contra `bot_v3.js.bak_antes_obras`):
carrega o módulo, desvia mensagens do grupo de Obras antes da regra da RL e expõe `/api/obras/*`.
O fluxo da RL não foi alterado.

### O que o `obras_bot.js` já faz

- Detecta mídia nova no grupo de Obras em tempo real (evento `message`).
- Aceita imagem e PDF e ignora o resto.
- Grava cópia local em `fotos_obras/` e envia o arquivo ao bucket privado.
- Calcula SHA-256 do arquivo. Foto reenviada vira registro `duplicada` com valor 0.
- Trava por mensagem: índice único `wa_msg_id = "<idMsg>#<n>"`.
- IA principal Claude, reserva Gemini 2.5 Flash. Se as duas falharem, grava `pendente_leitura`.
- Um documento com vários comprovantes gera uma linha por comprovante (`#0`, `#1`, …).
- O prompt já separa `orcamento` (não soma) de despesa e pede para não contar duas vezes cupom + comprovante de cartão da mesma compra.
- As categorias já batem com a constraint do banco (10 categorias).
- Importação manual por período: `POST /api/obras/importar?de=&ate=`.

### Supabase (projeto "sistema de auditoria", `rdztzurfesnobfkazgpm`)

| Objeto | Conteúdo |
|---|---|
| `obras` | 3 obras: Josemar Henrique, Everton (Maceió), Enildo |
| `obras_prestacoes` | 16 prestações semanais (seg–dom) com `valor_declarado`, `valor_adiantado`, `valor_reembolso` |
| `obras_comprovantes` | 982 linhas, **todas `origem = prestacao_pdf`** (importadas dos PDFs/DOCX). Nenhuma veio do WhatsApp ainda |
| bucket `obras-comprovantes` | privado, 885 arquivos |
| RLS | escrita: `obras_pode_auditar()` (admin/controladoria/diretoria **ou robô da área `rl`**); leitura: `portal_pode_ver()` |
| `rl_*` | `rl_despesas` 1.047, `rl_depositos` 81, `rl_fornecedores` 271, `rl_ajustes` 2, `rl_saldo_inicial` 1 |

Status em uso hoje em `obras_comprovantes`: `lancado`, `duplicada`, `orcamento` (e, pelo código, `nao_despesa` e `pendente_leitura`).

---

## 2. Problemas encontrados (por gravidade)

1. **VERIFICAR: o `.env` não aparece para o acesso remoto.** A listagem remota mostra só `.env.bak_antes_obras` (08/10 12:32)
   e `.env.example`. A tentativa de restaurar o `.env` foi **bloqueada pela proteção do Desktop Commander**, que, corretamente,
   não deixa um agente remoto ler nem gravar `.env`. Por isso não dá para saber, de fora, se o arquivo existe. Se não existir,
   o próximo reinício (`MATAR_E_REINICIAR_BOT.bat`) sobe **sem Supabase e sem IA, e isso vale para a RL também**.
   Conferir no próprio D90: `cd "C:\Users\controladoria\Documents\claude\whatapp - rl"`, depois `dir /a .env*`. Se não houver
   `.env`, rodar `copy .env.bak_antes_obras .env`. O atalho `INICIAR_BOT_RL.bat`, que iniciou o processo atual, também não
   existe mais na Área de Trabalho.
2. **Risco de somar duas vezes (WhatsApp × PDF de prestação).** Até hoje Obras entrou pelos PDFs semanais.
   Com o capturador ligado, o mesmo cupom vai chegar pelo WhatsApp e, no fim da semana, dentro do PDF da prestação.
   O hash não pega esse caso, porque o arquivo é outro. Hoje nada impede a soma dupla.
3. **Nada se perde de propósito, mas pode se perder por falha:**
   - a fila é em memória (`Promise`). Se o processo cair, o que estava na fila some;
   - se o Supabase estiver fora quando a mensagem chega, `jaLancada()` dá erro e o item só vai para o log, sem nova tentativa;
   - `erro_download` também não tem nova tentativa;
   - `pendente_leitura` não é relido automaticamente. A RL tem "reprocessar zeradas"; Obras não tem;
   - se o upload para o bucket falhar, só há um aviso e o lançamento fica sem arquivo no Storage.
4. **Obras não recupera mensagens perdidas.** A RL varre o histórico ao reconectar e a cada 2h. Obras só tem a importação manual.
   Se o WhatsApp cair por um dia, os comprovantes de Obras daquele dia não entram sozinhos.
5. **O remetente é identificado pelo nome (`pushname`), não pelo número.** O nome muda e é ambíguo
   ("Josimar" × "Josemar Henrique"; "Jony" ainda não aparece na base). Contas a pagar precisa do número.
6. **Não existe fechamento semanal automático** (contas a pagar / reembolso). Hoje ele depende do PDF de prestação.
7. **Não é 24/7:** inicia por `.bat` à mão, não reinicia sozinho (os 25 `bot_restart*.log` mostram reinícios manuais) e depende do D90 ligado.
8. **Sem health check nem alertas:** não há heartbeat no Supabase. A tabela `executor_heartbeat` existe, mas está vazia.
9. **O repositório está desatualizado:** o `rl-transportes-bot/bot_v3.js` do Git tem 111 KB, o do D90 tem 116 KB, e o `obras_bot.js` não está versionado.
10. **O painel de Obras não está neste repositório.** O `index.html` não tem nada de Obras. Existe `obras_hist/modulo_obras_v3.html` no D90. Falta confirmar onde o painel publicado está hospedado.

---

## 3. O que será reaproveitado (sem reescrever)

- `bot_v3.js` inteiro (regras da RL intactas), com a mesma estrutura de 9 linhas de integração.
- `obras_bot.js`: prompt, leitura com IA, regra de múltiplos itens, categorias e dedup por mensagem/hash.
- Tabelas `obras`, `obras_prestacoes`, `obras_comprovantes`, bucket `obras-comprovantes` e as políticas RLS.
- Conta-robô do Supabase (área `rl`), que já pode escrever em Obras.
- SQLite da RL como fonte da verdade da RL, mudando apenas de máquina.

## 4. O que será alterado / criado

### Contas a pagar (pedido novo)

Daqui para frente todo recibo enviado ao grupo entra em contas a pagar. A conta fecha **semanalmente (segunda a domingo)**
para reembolso, por responsável. O responsável é identificado **pelo número do WhatsApp**.

Banco (somente acréscimos, nada é apagado):

- `obras_remetentes`: número → nome (Jony, Josimar/Josemar, Enildo, Everton…), obra padrão, ativo.
- `obras_contas_pagar`: um registro por responsável e semana, com `semana_inicio`, `semana_fim`, `qtd_comprovantes`,
  `total_despesas`, `valor_adiantado`, `valor_reembolso`, `status` (`aberta` → `fechada` → `aprovada` → `paga`), `pago_em`,
  `prestacao_id` (liga ao PDF da prestação quando ele chegar) e `observacao`.
- Novas colunas em `obras_comprovantes`: `remetente_numero`, `conta_pagar_id`, `tentativas` e `ultimo_erro`.
- Novos status: `recebido`, `processando`, `erro`, `revisao` (os atuais continuam valendo).
- View `obras_contas_pagar_resumo`, que soma só `status = 'lancado'`.

Regra contra a soma dupla (problema 2): quando o PDF da prestação de uma semana chega, cada item dele é **conciliado**
com os recibos daquela semana e daquele responsável (valor + data ± 1 dia + fornecedor/autenticação).
O que bate vira "conferido" e não soma de novo. O que só existe no PDF entra como novo. O que só existe no WhatsApp fica
marcado "não declarado na prestação".

### Capturador

- `obras_bot.js`:
  - fila persistente em disco (sobrevive a queda) com nova tentativa automática para Supabase, download e IA;
  - varredura de mensagens perdidas ao reconectar e a cada 2h, como na RL;
  - captura do número do remetente;
  - dedup por autenticação/NSU e por valor + data + fornecedor;
  - releitura automática de `pendente_leitura`.
- `bot_v3.js`: só pontos de integração (heartbeat e chamada da varredura de Obras). As regras da RL não mudam.
- Novo `capturador_status` (Supabase): heartbeat a cada 1 min com WhatsApp, Supabase, IA, última mensagem,
  último comprovante, fila e erros nas últimas 24h.
- Alertas: mensagem de WhatsApp para um número/grupo de administração e registro em `portal_sentinel_alerts`.

### Servidor

- VPS Linux (Ubuntu 24.04, 2 vCPU / 4 GB, em São Paulo).
- Serviço `systemd` com `Restart=always` e início no boot. Chromium headless já é suportado pelo whatsapp-web.js.
- Backup diário: SQLite da RL, `fotos/`, `fotos_obras/` e sessão do WhatsApp, enviados para o bucket privado `capturador-backup`.

## 5. Riscos da migração

| Risco | Mitigação |
|---|---|
| Dois processos na mesma sessão do WhatsApp derrubam um ao outro | O servidor entra como **novo aparelho vinculado** (QR novo; o WhatsApp aceita até 4). A sessão do D90 não é copiada |
| Lançamento em dobro durante o paralelo | O servidor roda em **modo observação** (`MODO=sombra`): lê e classifica, mas grava em tabela de teste, nunca nas oficiais |
| SQLite da RL com escrita em dois lugares | Na virada o D90 para primeiro, o `.db` é copiado e só então o servidor assume. Nunca os dois gravando |
| Perder o histórico do grupo ao trocar de aparelho | O D90 continua ligado até a varredura do servidor cobrir o período |
| Chave exposta | `.env` só no servidor (permissão 600) e fora do Git. Nada de Service Role no Portal |
| WhatsApp bloquear por automação | Mesmo uso de hoje: só leitura e o mesmo número. Nenhum envio em massa |

## 6. Plano de backup (fase 1, antes de qualquer alteração)

**Executado em 08/10/2026 às 20:03, sem parar o bot:**

- `C:\BACKUP_CAPTURADOR_20261008\whatapp - rl`: pasta inteira, sem `node_modules` (2.734 arquivos, 875 MB). Só 16 arquivos de
  cache, cookies e GPU do Chrome não foram copiados, porque o processo os mantém travados. Eles não afetam a sessão nem os dados.
- `C:\BACKUP_CAPTURADOR_20261008\rl_transportes_CONSISTENTE.db`: cópia feita pela API de backup do SQLite, com
  `integrity_check = ok`. As contagens batem 100% com o Supabase: despesas 1.047, depósitos 81, fornecedores 271, ajustes 2,
  saldo_inicial 1.
- `C:\BACKUP_CAPTURADOR_20261008\Desktop_RL_TRANSPORTES`: os `.bat` de operação.
- Git: `rl-transportes-bot/bot_v3.js` e `obras_bot.js` agora estão idênticos aos do D90 (SHA-256 conferido: `58793d42…` e
  `8d7cd756…`). `sync_supabase.js`, `leitor_pdf.py` e `package.json` já eram idênticos.

Plano original:

1. Restaurar o `.env` (problema 1) e copiá-lo para um local seguro fora da pasta.
2. Copiar a pasta `whatapp - rl` inteira (com `.wwebjs_auth`, `rl_transportes.db*`, `fotos`, `fotos_obras`) para
   `D:\BACKUP_CAPTURADOR_<data>` ou para um pendrive, com o bot **parado por menos de 1 minuto** só para copiar o `.db` com consistência
   (ou usar `sqlite3 .backup` com o bot ligado).
3. Exportar `obras_*` e `rl_*` do Supabase em CSV e listar os objetos do bucket.
4. Versionar no Git o `bot_v3.js` e o `obras_bot.js` atuais do D90 (sem `.env`, banco ou sessão).

## 7. Plano de rollback

- Até a virada: nada muda no D90, então não há o que desfazer.
- Depois da virada: parar o serviço no servidor (`systemctl stop capturador`), copiar o `.db` de volta e rodar `INICIAR_BOT_RL.bat` no D90.
  A sessão do D90 continua vinculada durante 30 dias de propósito.
- Banco: as mudanças são apenas acréscimos (colunas e tabelas novas), então as versões antigas continuam funcionando sem elas.

## 8. Arquitetura final

```
WhatsApp (grupos)
   │  aparelho vinculado no servidor
   ▼
VPS · systemd "capturador" (reinicia sozinho, sobe no boot)
   ├─ roteador por grupo
   │    ├─ "RL TRANSPORTES"       → regras RL (bot_v3)   → SQLite → espelho rl_*
   │    └─ "Adm Obras Esposende"  → obras_bot             → fila em disco
   │                                         │
   │              download → cópia local → SHA-256/dedup → IA (Claude → Gemini → pendente)
   │                                         ▼
   │                         obras_comprovantes + bucket obras-comprovantes
   │                         obras_contas_pagar (fecha seg–dom por número)
   ├─ heartbeat 1 min → capturador_status
   └─ alertas → WhatsApp adm + portal_sentinel_alerts
                                             ▼
                                Portal Executivo (lê o Supabase)
```

## 9. Arquivos e tabelas

| Arquivo | Ação |
|---|---|
| `rl-transportes-bot/bot_v3.js` | Sincronizar com o D90 + pontos de integração (heartbeat, varredura de Obras) |
| `rl-transportes-bot/obras_bot.js` | Versionar + fila, nova tentativa, número do remetente, dedup e contas a pagar |
| `rl-transportes-bot/capturador_status.js` | Novo: heartbeat e alertas |
| `rl-transportes-bot/deploy/capturador.service` | Novo: unit do systemd |
| `rl-transportes-bot/deploy/instalar_vps.sh` / `backup.sh` | Novo |
| `supabase/migrations/*_obras_contas_pagar.sql` | Novo, só acréscimos |
| Painel de Obras do Portal | Contas a pagar + dashboard (depende de saber onde ele está publicado) |

Tabelas usadas por Obras: `obras`, `obras_prestacoes`, `obras_comprovantes`, `obras_remetentes` (nova), `obras_contas_pagar` (nova),
`capturador_status` (nova) e o bucket `obras-comprovantes`.
Tabelas da RL (`rl_*`, SQLite): **não são alteradas.**

## 10. Como a RL Transportes continua funcionando

- O código da RL em `bot_v3.js` não muda. Só entram chamadas de integração, iguais às 9 linhas de hoje, todas em `try/catch`:
  se Obras falhar, a RL segue.
- Tabelas, SQLite, grupo, regras FIFO e endpoints da RL ficam iguais.
- Teste obrigatório antes da virada: comparar `node sync_supabase.js` (SQLite × Supabase = 0 diferenças) e
  `GET /api/recuperar-periodo?simular=1` no servidor e no D90 para a mesma semana, com o mesmo resultado.
- Durante o paralelo, o servidor fica em modo sombra também para a RL.

---

## Diário de execução

### 08–09/10/2026

- **Contas a pagar (banco):** os 982 lançamentos existentes de Obras foram marcados como `pago` (R$ 108.368,29).
  Todo comprovante novo entra `a_pagar` (default da coluna). Criadas `obras_remetentes`, `obras_contas_pagar`,
  a view `obras_contas_pagar_resumo` e a função `obras_conta_pagar_definir` (aprovar/pagar/adiantamento).
  Responsáveis cadastrados: Josemar Henrique (+55 81 98453-5320) e Jhony (+55 11 91784-9843).
- **Página `obras-contas-pagar/`:** um card por pessoa + resumo geral, atenção e categorias. Login do Portal; RLS.
  Ainda não está dentro do portal: falta o segredo `PORTAL_PATCH_SECRET` para editar o HTML do portal em produção.
- **Incidente:** o D90 entrou em suspensão; o Chrome do WhatsApp travou ("detached Frame") às ~19:33 e o vigia ficou
  pendurado em `getState()` — sem captura de RL e de Obras até o reinício.
- **`.env` ausente confirmado** (ENOENT para um processo normal). O bot foi reiniciado com
  `Desktop\RL TRANSPORTES\INICIAR_BOT_RL_COM_BACKUP_ENV.bat`, que carrega as chaves de `.env.bak_antes_obras`
  (`node -r dotenv/config bot_v3.js dotenv_config_path=.env.bak_antes_obras`). Supabase e IA carregaram ok.
- **`obras_bot.js` (no Git, ainda não instalado no D90):** número do remetente, varredura automática de perdidas,
  releitura de pendentes, duplicidade por autenticação/valor+data+fornecedor(+hora) inclusive contra o histórico pago,
  retry de upload, `getState()` com limite de 15s. `teste_obras_bot.js`: 11 cenários passando.

### 09/10/2026 — Agente Auditor e fluxo de pagamento de Obras

**Auditoria dos dados (958 despesas lançadas, R$ 109.928,29):** 13 sem o arquivo no bucket (R$ 2.420,44), 2 sem obra,
49 com leitura de baixa confiança (R$ 6.807,89), 25 grupos de possível duplicidade por valor+data+fornecedor
(R$ 2.722,98 a mais), 0 autenticação repetida, 0 arquivo usado em dois documentos. Prestações com diferença
declarado × lido: Enildo −R$ 626,03; 6ª Josemar −R$ 623,60; 12ª −R$ 347,18; 13ª −R$ 315,19; 8ª −R$ 305,40;
21ª −R$ 197,00; 11ª −R$ 180,00; 4ª −R$ 80,00; 2ª −R$ 50,00. Everton sem valor declarado.

**Trabalho em paralelo de outro agente no mesmo dia** (migrações `finaliza_fluxo_financeiro_obras`,
`estrutura_contas_pagar_por_responsavel`, `obras_controle_contas_fluxo_auditavel`, `obras_contas_itens_politicas_rls`
e patch do portal às 13:53): a estrutura dele (itens, eventos, token do Financeiro) foi **reaproveitada**.
Ele gravou `responsavel = 'Josemar'` em todas as 984 despesas — corrigido pelo número/remetente real.
Ele também marcou como `pago` (sem data) o PIX de R$ 1.500 e o orçamento do Jhony de 08/10 — **não alterado,
aguardando confirmação**.

**Criado** (SQL em `supabase/migrations/20261009_obras_auditor_fluxo_pagamento.sql`):
- Agente Auditor: `obras_auditoria_achados`, 10 regras por despesa, gatilho em cada lançamento + `pg_cron` a cada 30 min.
- Fluxo: Presidente (`obras_presidente_decidir`, com pré-auditoria que bloqueia crítico) → Financeiro
  (`obras_financeiro_pagar`, com comprovante) → pós-auditoria (`obras_pos_auditar_conta`: auditada ou pendência).
- Papéis `obras_papeis` (presidente, financeiro, auditor); dados de PIX/conta em `obras_remetentes`.
- Views `obras_contas_pagar_resumo` (risco normal/atenção/crítico) e `obras_fluxo_caixa_prestador`.
- Telas: `obras-presidente/`, `obras-financeiro/`, `obras-contas-pagar/` (auditor, fluxo de caixa, vincular números).
- Testado no banco (transação desfeita): aprovar → pagar → pós-auditoria; bloqueios de papel, de crítico e de atalho.

---

## 09/10/2026 (tarde) — Pagamento por despesa, parcial, saldo devedor acumulado, relatórios e PDF

**Pedido:** na tela do Presidente aparece um card com o total de cada prestador; clicando, mostra todas as despesas que formam o valor,
com uma caixa para marcar o que paga. Pode pagar parcial; o que for pago sai como pago em todo o sistema e o resto continua como
contas a pagar em aberto, acumulando com as outras semanas. Relatórios e PDF no módulo. O administrador pode mexer manualmente.

**Banco** (`supabase/migrations/20261009b_obras_pagamento_por_item.sql`, só acréscimos, aplicado e testado com rollback):
- `obras_pagamentos` (lote numerado), `obras_pagamento_itens` (despesa + valor pago nela → permite parcial), `obras_adiantamentos`, `obras_pagamento_eventos` (histórico).
- Views: `obras_despesas_pagamento` (por despesa: pago, reservado, saldo, situação, alertas do Auditor), `obras_saldo_prestador` (saldo devedor acumulado),
  `obras_fluxo_semanal` (despesas × pagamentos × adiantamentos × saldo acumulado por semana).
- Funções: `obras_presidente_pagar` (modo "ja_paguei" ou "financeiro"; despesa com ponto crítico só com justificativa; não paga além do saldo;
  desconta adiantamento), `obras_pagamento_registrar` (Financeiro), `obras_pagamento_anexar`, `obras_pagamento_cancelar`, `obras_despesa_recusar`,
  `obras_adiantamento_registrar/cancelar`, `obras_despesa_ajustar` (só administrador, guarda antes/depois). Pós-auditoria automática de cada pagamento.
- Situação "recusado" acrescentada em `obras_comprovantes.situacao_pagamento`. Fluxo antigo por semana (`obras_presidente_decidir`/`obras_financeiro_pagar`) fica sem uso.

**Teste no banco (rollback):** saldo 640 − adiant. 50 → 590; crítico sem justificativa bloqueado; R$250 numa despesa de R$200 bloqueado;
aprovou 100 + 120 (parcial de 200) − adiant. 50 = 170 → Financeiro pagou → LOJA A paga, LOJA B parcial 120/80;
Presidente "já paguei" 80 + 300 → tudo pago, saldo 0; recusada fora do saldo; fluxo semanal fecha em 0; histórico completo.

**Telas:** `obras-presidente` (cards → despesas por semana com caixa de marcar, valor editável para parcial, rodapé com "pagar agora" e
"continua em aberto", "Já paguei" ou "Aprovar e enviar ao Financeiro", recusar, ajustar, adiantamento, PIX, PDF), `obras-financeiro`
(lotes aprovados, PIX, comprovante obrigatório, pendências, adiantamentos), `obras-relatorios` (6 relatórios com filtro de prestador/período,
PDF e planilha), `obras-contas-pagar` (visão geral nova). Testadas com Playwright: sem erros, sem rolagem lateral no celular, 8 PDFs gerados.

---

## 09/10/2026 (fim da tarde) — Pix do Presidente, Jhony e capturador na nuvem

- **Jhony:** o PIX de R$ 1.500 (ELIFIAZ, 08/10) e o orçamento de R$ 607,98 estavam "pago" sem data (marcados por outro agente).
  Confirmado pelo usuário que não foram pagos → voltaram para `a_pagar`. Jhony: R$ 1.560 em aberto para o Presidente.
- **Regra do Pix** (`supabase/migrations/20261009c_obras_pix_do_presidente.sql`):
  - Pix enviado pelos **prestadores** → conta a pagar (como antes).
  - Pix em que **quem pagou** foi o Presidente → é o comprovante do pagamento, não uma despesa. Vale para o número do Paulo (`obras_pagadores`) ou para o pagador lido no comprovante: "Mar Aberto" ou "Paulo Almeida" (`obras_pagador_nomes`), mesmo encaminhado por outra pessoa.
  - O Pix do Presidente liga sozinho ao pagamento de mesmo valor marcado na tela (aprovado, ou "Já paguei" sem arquivo), em até 10 dias para frente ou para trás. O Auditor confere em seguida.
  - Se o Pix chega antes da marcação, fica em "Pix do Presidente recebidos, ainda sem pagamento marcado" na tela dele, e liga quando ele marcar "Já paguei".
  - Teste com rollback usando os dados reais do Jhony:
    - Pix "Mar Aberto Comércio Ltda" de R$ 1.500 chegou antes → "Já paguei" → ligado e auditado.
    - R$ 60 aprovado → Pix "Paulo Almeida" → pago e auditado.
    - Pix do próprio prestador continua conta a pagar.
    - O Paulo não vira prestador.
- **IA:** novo campo `pagador` (quem pagou o Pix/TED) no `obras_bot.js` e na coluna `obras_comprovantes.pagador`.
  Precisa instalar o `obras_bot.js` novo no D90 para o "Mar Aberto" ser lido. Até lá vale o número do Paulo, cadastrado pelo botão "É o Presidente" na página de Contas a Pagar.
- **Financeiro:** fica com o administrador por enquanto, que já tem todos os papéis.
- **Capturador na nuvem** (`rl-transportes-bot/deploy/`):
  - Arquivos: Dockerfile (Chromium do Debian, pypdf, fuso SP), docker-compose (reinício automático, painel só local), `instalar_vps.sh` (um comando, chaves digitadas no servidor), backup diário e LEIA-ME.
  - Começa em **MODO=sombra**:
    - Obras grava em `obras_comprovantes_sombra` e na pasta `sombra/` do bucket;
    - RL grava num SQLite separado, sem tocar nas tabelas `rl_*`.
  - Comparação com o D90: `obras_comparar_sombra()`.
  - Imagem montada e testada aqui: módulos carregam, o banco da sombra é criado, o painel responde e o Chromium abre o WhatsApp Web.
  - Testes do `teste_obras_bot.js`: 13 cenários passando (novos: pagador e modo sombra).
  - Falta o servidor: precisa de conta num provedor. Recomendado: Hostinger KVM 2 ou Oracle Free.
