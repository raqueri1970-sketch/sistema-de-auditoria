#!/usr/bin/env bash
# Instala o capturador 24/7 num servidor Ubuntu 22.04/24.04 (Oracle Cloud, Hostinger, etc.).
# Uso (como root):  curl -fsSL https://raw.githubusercontent.com/raqueri1970-sketch/sistema-de-auditoria/main/rl-transportes-bot/deploy/instalar_vps.sh | bash
# Começa em MODO=sombra: lê e processa tudo, mas NÃO grava nas tabelas oficiais (o D90 continua sendo o oficial).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo -i)."; exit 1; }
BASE=/opt/capturador; REPO=https://github.com/raqueri1970-sketch/sistema-de-auditoria.git

echo "== 1/6 Pacotes e Docker"
apt-get update -y && apt-get install -y ca-certificates curl git ufw
command -v docker >/dev/null || apt-get install -y docker.io docker-compose-v2 || curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

echo "== 2/6 Memória: swap de 2 GB se o servidor tiver menos de 4 GB"
if [ "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)" -lt 3800 ] && ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
timedatectl set-timezone America/Sao_Paulo || true

echo "== 3/6 Firewall: SSH + 80/443 (telas de Obras com HTTPS). O painel 3456 fica só local / Tailscale"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

echo "== 4/6 Código"
mkdir -p $BASE/{wwebjs_auth,wwebjs_cache,dados,fotos_obras}
if [ -d $BASE/codigo/.git ]; then git -C $BASE/codigo pull --ff-only; else git clone --depth 1 $REPO $BASE/codigo; fi

echo "== 5/6 Chaves (.env) — digitadas aqui, ficam só neste servidor"
if [ ! -s $BASE/.env ]; then
  ler() { local v; read -r -p "$1: " v </dev/tty; echo "$v"; }
  lers() { local v; read -r -s -p "$1: " v </dev/tty; echo >&2; echo "$v"; }
  {
    echo "MODO=sombra"
    echo "CAPTURADOR_INSTANCIA=nuvem"
    echo "SUPABASE_URL=https://rdztzurfesnobfkazgpm.supabase.co"
    echo "SUPABASE_KEY=$(lers 'SUPABASE_KEY (a mesma do .env do D90)')"
    echo "SUPABASE_ROBO_EMAIL=$(ler 'SUPABASE_ROBO_EMAIL')"
    echo "SUPABASE_ROBO_SENHA=$(lers 'SUPABASE_ROBO_SENHA')"
    echo "GEMINI_API_KEY=$(lers 'GEMINI_API_KEY')"
    echo "ANTHROPIC_API_KEY=$(lers 'ANTHROPIC_API_KEY (pode deixar vazio)')"
  } > $BASE/.env
  chmod 600 $BASE/.env
fi

echo "== 6/6 Subindo"
IP=$(curl -4 -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
SITE_HOST="$(echo "$IP" | tr . -).sslip.io"
mkdir -p $BASE/caddy_data
cd $BASE/codigo/rl-transportes-bot/deploy && echo "SITE_HOST=$SITE_HOST" > .env && docker compose up -d --build
cat > /etc/cron.d/capturador-backup <<'CRON'
# Backup diário 03:15 da sessão do WhatsApp e do banco (7 dias)
15 3 * * * root tar czf /opt/capturador/backup_$(date +\%u).tgz -C /opt/capturador wwebjs_auth dados .env 2>/dev/null
CRON
echo
echo "PRONTO. Agora leia o QR Code com o celular do WhatsApp do grupo (Aparelhos conectados > Conectar aparelho):"
echo "   docker compose -f $BASE/codigo/rl-transportes-bot/deploy/docker-compose.yml logs -f capturador"
echo "Telas de Obras (Presidente, Financeiro, Relatorios):  https://$SITE_HOST/obras/"
echo "Atualizar depois:  cd $BASE/codigo && git pull && cd rl-transportes-bot/deploy && docker compose up -d --build"
