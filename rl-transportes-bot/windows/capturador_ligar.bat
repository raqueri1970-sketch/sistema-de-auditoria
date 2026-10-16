@echo off
rem Capturador 1 - LIGAR: liga o capturador WhatsApp (RL Transportes + Obras) numa janela minimizada que reinicia sozinha.
rem 15/10/2026: o capturador OFICIAL agora roda na VPS (instancia "nuvem"). D90 e VPS ligados juntos gravam a RL cada um
rem no seu banco e numeram as despesas diferente (aconteceu em 15/10). So ligar o D90 se a VPS estiver fora do ar.
rem 16/10/2026: mesmo que liguem os dois, o bot agora se coloca em RESERVA sozinho quando a nuvem esta no ar (lider.js).
echo ATENCAO: o capturador oficial agora roda na VPS (nuvem).
echo Ligar o D90 junto com a VPS nao lanca nada: ele fica em reserva automaticamente.
choice /c SN /n /m "Ligar o D90 mesmo assim? So responda S se a VPS estiver fora do ar. (S/N) "
if errorlevel 2 (echo Nada foi feito. & timeout /t 4 >nul & exit /b 0)
netstat -ano | findstr /r /c:":3456 .*LISTENING" >nul && (echo O capturador JA ESTA LIGADO. Veja em "Capturador 2 - STATUS". & timeout /t 6 >nul & exit /b 0)
start "Capturador WhatsApp (nao feche)" /min cmd /c "C:\Users\controladoria\Desktop\RL TRANSPORTES\INICIAR_BOT_RL_COM_BACKUP_ENV.bat"
echo Capturador ligado. Em 1 minuto o STATUS mostra WhatsApp CONECTADO.
timeout /t 6 >nul
