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

## Correção de 06/10/2026 — depósitos parados desde 30/09

Sintoma: a aba Depósitos parou em 30/09. Os comprovantes da Bruna (despesas) entravam, mas os
do Paulo (02/10) e do Rafael (05/10 e 06/10) davam `Erro baixar midia: t` em toda varredura.

Causa: `msg.downloadMedia()` do whatsapp-web.js 1.34.7 falha em algumas mídias com um erro
minificado do WhatsApp Web. O retry repetia sempre o mesmo caminho, então esses depósitos nunca
eram lançados.

Correção (`baixarMidiaPelaPagina` em `bot_v3.js`): quando a lib falha, o bot baixa direto na
página do WhatsApp Web: (1) pede o download como se o usuário clicasse (também pede ao celular de
quem mandou para reenviar mídia expirada), (2) lê o arquivo já resolvido da memória e (3) baixa
do CDN testando o tipo de mídia. Se ainda falhar, o log de ERRO traz em `dados` o motivo exato
de cada tentativa (etapa da mídia, status HTTP etc.).

Também sincronizados com o PC: `/api/despesas`, `/api/depositos` e `/api/ajustes` sem LIMIT
(com LIMIT 500 o saldo da Conciliação saía errado).

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
