@echo off
rem Capturador 1 - LIGAR: liga o capturador WhatsApp (RL Transportes + Obras) numa janela minimizada que reinicia sozinha.
netstat -ano | findstr /r /c:":3456 .*LISTENING" >nul && (echo O capturador JA ESTA LIGADO. Veja em "Capturador 2 - STATUS". & timeout /t 6 >nul & exit /b 0)
start "Capturador WhatsApp (nao feche)" /min cmd /c "C:\Users\controladoria\Desktop\RL TRANSPORTES\INICIAR_BOT_RL_COM_BACKUP_ENV.bat"
echo Capturador ligado. Em 1 minuto o STATUS mostra WhatsApp CONECTADO.
timeout /t 6 >nul
