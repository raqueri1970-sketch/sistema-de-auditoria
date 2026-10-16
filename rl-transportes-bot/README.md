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
| `obras_bot.js` | Módulo Obras (08/10/2026): grupo "Adm Obras Esposende" → `obras_comprovantes` + bucket `obras-comprovantes`. Carregado pelo `bot_v3.js`, mesma sessão |
| `leitor_pdf.py` | Lê PIX e boleto do Cora direto do texto do PDF, sem IA e sem custo. Usado antes da IA |
| `sync_supabase.js` | Espelho completo SQLite → Supabase (upsert + remove o que foi excluído localmente) |
| `ia.js` | Leitura com IA da RL e de Obras: Claude primeiro, Gemini (vários modelos) de reserva, respeitando a cota diária |
| `lider.js` | Uma instância só gravando: com a nuvem no ar, o D90 fica em reserva sozinho |

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

## Correções de 16/10/2026

Contexto: a nuvem (VPS) e o D90 ficaram ligados juntos, os dois gravando a RL (`duplicate key ... rl_despesas_pkey`,
despesa #1342), e as leituras pararam porque o Claude estava sem crédito e o Gemini gratuito agora aceita só
**20 leituras por dia por modelo**.

- **IA (`ia.js`):** Claude → `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-2.0-flash`. Cota diária esgotada:
  aquele modelo fica de fora até a hora indicada pelo Google e passa para o próximo na hora. Claude sem crédito: pausa
  30 min e tenta de novo sozinho (antes ficava desligado até reiniciar). O que não for lido fica zerado/`pendente_leitura`
  e é relido automaticamente quando a IA voltar.
- **Uma instância só (`lider.js`):** com outra instância de prioridade maior no ar (a `nuvem` tem 10, o resto 1), esta
  fica em **reserva**: não lança RL nem Obras. Se a nuvem cair, o D90 assume **só Obras** (a RL do D90 fica parada até
  reiniciar, para não misturar dois bancos SQLite). O papel aparece em `capturador_status.detalhes.papel`.
- **RL no Supabase:** `insert` → `upsert` (sem mais `duplicate key`).

Variáveis novas (opcionais) no `.env`: `IA_MODELO_CLAUDE`, `GEMINI_MODELOS`, `CAPTURADOR_PRIORIDADE`.

```bat
node teste_obras_bot.js    :: cenários de Obras
node teste_ia_lider.js     :: IA (cota/sem crédito) e trava de instância
```
