# RL TRANSPORTES — Bot IA Financeiro v3

Cópia versionada do bot que roda no PC da controladoria
(`C:\Users\controladoria\Documents\claude\whatapp - rl`). É ele que alimenta o módulo
**RL TRANSPORTES** do portal (`http://100.125.195.119:3456`).

Fluxo: WhatsApp (grupo "RL TRANSPORTES") → leitura do comprovante → SQLite local
(`rl_transportes.db`, fonte da verdade) → espelho no Supabase (tabelas `rl_*`).

> Credenciais ficam só no `.env` do PC. Banco, fotos e sessão do WhatsApp não vão para o
> repositório (ver `.gitignore`).

## Arquivos

| Arquivo | O que faz |
|---|---|
| `bot_v3.js` | Bot principal: WhatsApp, leitura dos comprovantes, SQLite, API/painel na porta 3456 |
| `leitor_pdf.py` | Lê PIX e boleto do Cora direto do texto do PDF, sem IA e sem custo. Usado antes da IA |
| `sync_supabase.js` | Espelho completo SQLite → Supabase (upsert + remove o que foi excluído localmente) |
| `painel_v3.html` | Painel servido em `http://100.125.195.119:3456` (Dashboard, Conciliação, Despesas…) |

## Proteções adicionadas em 01/10/2026

Contexto: de 20/09 a 27/09/2026 o bot ficou sem WhatsApp, e ao voltar só buscou as
últimas 15 mensagens. Os comprovantes de 19/09 a 25/09 ficaram sem lançamento.

- **Watchdog de conexão:** a cada 5 min confere o estado. Se não estiver `CONNECTED`, reinicia
  o cliente. Se estiver conectado, mas o evento `ready` não disparou, assume pronto e faz a varredura.
- **Recuperação até a última mensagem lançada:** ao reconectar, busca o histórico até o último
  lançamento (com 2 dias de margem). Se o WhatsApp não devolver tudo, pede o histórico antigo ao
  celular (`syncHistory`) e tenta de novo. Se ainda faltar, registra ERRO com o período exato.
- **Varredura a cada 2h:** mensagens já lançadas são puladas antes do download.
- **Anti-duplicidade:** trava por mensagem (antes era só por hash, o que gerou a duplicata #1156/#1157).
- **Leitor local de PDF antes da IA:** poupa a cota gratuita do Gemini (5 req/min).
- **Zeradas:** se a IA falhar, o item é tentado de novo automaticamente a cada 2h.
- **Supabase sempre igual ao SQLite:** espelho ao iniciar, a cada 2h e logo após conciliação
  FIFO, reprocessamento e recuperação de período.

## Conciliação (corrigida em 01/10/2026)

Na aba Conciliação, o saldo não fechava por dois motivos:
- **A API cortava os dados:** `/api/despesas` devolvia só as 500 mais recentes (`LIMIT 500`). Ficavam de fora
  105 despesas (R$ 45.801,04), e o "Saldo Disponível" aparecia +R$ 37.179,64 quando o real era -R$ 8.201,40.
  O limite foi removido de despesas, depósitos e ajustes.
- **A coluna "Saldo" começava errada:** ela partia da âncora de 06/07 e somava só o período filtrado.
  Agora o saldo acumulado é calculado sobre todo o histórico, e a tela mostra
  **Saldo anterior + Depositado − Despesas = Saldo final do período**, com o selo ✅ Confere.

## Endpoints úteis (porta 3456)

| Endpoint | Uso |
|---|---|
| `GET /api/recuperar-periodo?de=AAAA-MM-DD&ate=AAAA-MM-DD&simular=1` | Lista as mídias do período e diz quais ainda não viraram lançamento (não grava) |
| `POST /api/recuperar-periodo?de=...&ate=...` | Lança o que estiver faltando no período |
| `POST /api/reprocessar-zeradas` | Relê com IA ou leitor local todos os lançamentos com valor 0 |
| `POST /api/reconciliar-fifo` | Revincula despesas a depósitos pela data e depois espelha no Supabase |
| `GET /api/status-wa` | Estado da conexão com o WhatsApp |

## Comandos

```bat
node bot_v3.js                    :: inicia o bot (ou use INICIAR_BOT_RL.bat na Área de Trabalho)
node sync_supabase.js             :: só compara SQLite x Supabase
node sync_supabase.js aplicar     :: espelho completo
python leitor_pdf.py arquivo.pdf  :: testa o leitor local
```

`INICIAR_BOT_RL.bat` (Área de Trabalho) encerra **só** o processo do bot. Antes ele matava todos
os `node.exe`, inclusive o Desktop Commander.
