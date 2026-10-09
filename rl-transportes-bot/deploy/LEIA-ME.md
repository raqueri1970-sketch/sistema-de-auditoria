# Capturador WhatsApp 24/7 na nuvem

Leva o capturador (RL Transportes + Obras & Reformas) do PC D90 para um servidor que fica ligado 24 h.
Ele sobe sozinho quando o servidor liga, volta sozinho se travar, e manda o estado para o painel de saúde.

## 1. Contratar o servidor (escolha um)

| Opção | Custo | Observação |
|---|---|---|
| **Hostinger VPS KVM 2** (recomendado) | ~R$ 50/mês | 2 vCPU, 8 GB, datacenter no Brasil, painel simples |
| Oracle Cloud "Always Free" (região São Paulo) | R$ 0 | máquina ARM gratuita; o cadastro pede cartão e às vezes falta vaga |

Sistema: **Ubuntu 24.04**. Anote o **IP** e a **senha do root**.

## 2. Instalar (um comando)

Entre no servidor (no Windows: `ssh root@IP`) e rode:

```bash
curl -fsSL https://raw.githubusercontent.com/raqueri1970-sketch/sistema-de-auditoria/main/rl-transportes-bot/deploy/instalar_vps.sh | bash
```

O instalador:
- instala o Docker;
- cria memória extra (swap), se faltar;
- fecha o firewall, deixando só o SSH;
- baixa o código.

Depois ele **pede as chaves**: as mesmas do `.env` do D90. Elas são digitadas na tela e ficam só no servidor, nunca no Git nem no chat.

## 3. Conectar o WhatsApp

```bash
docker compose -f /opt/capturador/codigo/rl-transportes-bot/deploy/docker-compose.yml logs -f capturador
```

Aparece um QR Code. No celular do WhatsApp dos grupos, vá em **Aparelhos conectados → Conectar aparelho** e leia o QR.
O D90 continua conectado: o WhatsApp aceita vários aparelhos ao mesmo tempo.

## 4. Período em paralelo (modo sombra)

O servidor começa em `MODO=sombra`: lê e processa tudo, mas **não grava nada oficial**.
- **Obras:** grava em `obras_comprovantes_sombra` e na pasta `sombra/` do bucket.
- **RL:** grava num SQLite separado, sem tocar nas tabelas `rl_*`.

O D90 segue sendo o oficial.

Depois de 1 ou 2 dias, compare a nuvem com o D90 no SQL do Supabase (ou peça para o Claude):

```sql
select obras_comparar_sombra(now() - interval '2 days');
```

Se `so_no_oficial`, `so_na_sombra` e `valor_diferente` vierem vazios, a nuvem está igual ao D90.

## 5. Virar a chave (só depois de comprovado)

1. No D90, desative a tarefa "Capturador WhatsApp Esposende" e feche o `INICIAR_BOT_RL_COM_BACKUP_ENV.bat`.
2. Copie o banco da RL (`rl_transportes.db`) do D90 para `/opt/capturador/dados/` no servidor.
3. No servidor, troque `MODO=sombra` por `MODO=producao` em `/opt/capturador/.env`.
4. Reinicie: `cd /opt/capturador/codigo/rl-transportes-bot/deploy && docker compose up -d`.
5. Painel da RL no Portal: o endereço `100.125.195.119:3456` é o IP do D90 no Tailscale.
   - Instale o Tailscale no servidor: `curl -fsSL https://tailscale.com/install.sh | sh && tailscale up`.
   - Aponte o Portal para o IP novo, ou dê ao servidor o mesmo nome no Tailscale.

**Voltar atrás:** reative a tarefa no D90 e pare o servidor com `docker compose down`. Nada se perde.

## Dia a dia

- **Atualizar:** `cd /opt/capturador/codigo && git pull && cd rl-transportes-bot/deploy && docker compose up -d --build`
- **Backup:** diário às 03:15 em `/opt/capturador/backup_<dia>.tgz` (sessão do WhatsApp, banco e `.env`, 7 dias).
- **Saúde:** a página Contas a Pagar mostra a instância `nuvem` ONLINE/OFFLINE, o WhatsApp, a fila e os erros.
