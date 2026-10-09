# Capturador WhatsApp 24/7 (RL Transportes + Obras) — imagem para servidor na nuvem.
# Chromium do sistema (não baixa o do puppeteer), Python + pypdf (pacote do Debian) para o leitor local de PDF, fuso de São Paulo.
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-color-emoji ca-certificates tzdata \
      python3 python3-pypdf python-is-python3 build-essential \
 && rm -rf /var/lib/apt/lists/*
ENV TZ=America/Sao_Paulo \
    CHROME_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    DADOS_DIR=/dados \
    NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY bot_v3.js obras_bot.js capturador_status.js sync_supabase.js leitor_pdf.py ./
# Sessão do WhatsApp, cache da versão do WhatsApp Web, banco/fotos da RL e cópias das fotos de Obras ficam em volumes
VOLUME ["/app/.wwebjs_auth", "/app/.wwebjs_cache", "/dados", "/app/fotos_obras"]
EXPOSE 3456
CMD ["node", "-r", "dotenv/config", "bot_v3.js", "dotenv_config_path=/app/.env"]
