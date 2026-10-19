# Capturador WhatsApp 24/7 (RL Transportes + Obras) — imagem para servidor na nuvem.
# Chromium do sistema (não baixa o do puppeteer), Python + pypdf (pacote do Debian) para o leitor local de PDF, fuso de São Paulo.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-color-emoji ca-certificates tzdata \
      python3 python3-pypdf python-is-python3 build-essential \
 && rm -rf /var/lib/apt/lists/*
# 15/10/2026: navegador FIXO. Num rebuild o apt trouxe o Chromium 154 do Debian: o whatsapp-web.js 1.34.7 passou a dar
# "Erro mensagem: r | r: r" em toda mensagem, e o perfil do WhatsApp foi convertido para o formato do 154 (voltar para um
# navegador mais antigo depois disso desfaz o pareamento). Fixado o Chrome 146.0.7680.31, o que rodava até então e o mesmo
# do D90. Para trocar de versão: testar antes em outra pasta de sessão; nunca abrir a sessão oficial num navegador mais novo.
# O pacote chromium do Debian fica só pelas bibliotecas do sistema.
ARG CHROME_VERSAO=146.0.7680.31
RUN cd /tmp && npx -y @puppeteer/browsers@2.10.10 install chrome@${CHROME_VERSAO} --path /opt/chrome \
 && ln -s /opt/chrome/chrome/linux-${CHROME_VERSAO}/chrome-linux64/chrome /usr/local/bin/chrome-fixo && chrome-fixo --version
ENV TZ=America/Sao_Paulo \
    CHROME_PATH=/usr/local/bin/chrome-fixo \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    DADOS_DIR=/dados \
    NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
# 15/10/2026: o WhatsApp Web 2.3000.x renomeou o campo interno _serialized para $1 e o whatsapp-web.js 1.34.7 passou a
# falhar em toda mensagem ("Erro mensagem: r | r: r"). Correção da PR wwebjs/whatsapp-web.js#201910 (ainda não lançada)
# aplicada sobre a 1.34.7 (versão fixa no package.json). Quando sair versão oficial com a correção, remover este passo.
COPY patches ./patches
RUN patch -d node_modules/whatsapp-web.js -p1 < patches/whatsapp-web.js-1.34.7-serialized.patch
COPY bot_v3.js obras_bot.js ia.js lider.js capturador_status.js sync_supabase.js espelho_nuvem.js leitor_pdf.py ./
# Sessão do WhatsApp, cache da versão do WhatsApp Web, banco/fotos da RL e cópias das fotos de Obras ficam em volumes
VOLUME ["/app/.wwebjs_auth", "/app/.wwebjs_cache", "/dados", "/app/fotos_obras"]
EXPOSE 3456
# Recriar o container muda o hostname e o Chromium recusa o perfil travado pelo container anterior
# ("profile appears to be in use by another Chromium process ... on another computer"). As travas Singleton*
# são só de processo: apagar ao iniciar é seguro e não mexe na sessão do WhatsApp (15/10/2026).
CMD ["sh", "-c", "rm -f /app/.wwebjs_auth/session*/Singleton* && exec node -r dotenv/config bot_v3.js dotenv_config_path=/app/.env"]
