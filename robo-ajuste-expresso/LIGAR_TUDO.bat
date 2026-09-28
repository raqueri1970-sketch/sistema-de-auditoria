@echo off
chcp 65001 >nul
title LIGAR TUDO - Robo Ajuste Expresso
set "EXEC=%USERPROFILE%\Documents\AJUSTE_EXPRESS_EXECUTOR"
set "LEITOR=%USERPROFILE%\Documents\AJUSTE_EXPRESS_LEITOR_WHATSAPP"
set "SETA=C:\SETA\seta.exe"
echo ================================================
echo   LIGAR TUDO - ROBO DO AJUSTE EXPRESSO
echo ================================================
echo.

echo [1/4] Desktop Commander (acesso remoto do Claude)...
powershell -NoProfile -Command "if(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*desktop-commander*remote*' }){exit 0}else{exit 1}"
if errorlevel 1 (
  start "Desktop Commander - NAO FECHE" /min cmd /k npx @wonderwhy-er/desktop-commander@latest remote
  echo       LIGADO agora - janela minimizada, nao feche.
) else (
  echo       ja estava ligado.
)
echo.
echo [2/4] SETA...
set "SETA_ABRIU=0"
tasklist /FI "IMAGENAME eq seta.exe" | find /I "seta.exe" >nul
if errorlevel 1 (
  if exist "%SETA%" (
    start "" /d "C:\SETA" "%SETA%"
    set "SETA_ABRIU=1"
    echo       ABERTO agora - FACA O LOGIN no Seta e deixe na tela principal.
  ) else (
    echo       ATENCAO: nao achei %SETA%. Abra o Seta manualmente.
  )
) else (
  echo       ja estava aberto.
)
echo.

echo [3/4] Executor (robo que lanca no Seta)...
if not exist "%EXEC%\config.json" (
  echo       ERRO: falta configurar. Rode CONFIGURAR.bat na pasta do Executor.
) else (
  powershell -NoProfile -Command "if(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*supervisor.py*' }){exit 0}else{exit 1}"
  if errorlevel 1 (
    start "" /d "%EXEC%" pythonw supervisor.py
    echo       LIGADO agora - roda em segundo plano, sem janela.
  ) else (
    echo       ja estava ligado - nao liguei de novo para nao duplicar.
  )
)
echo.
echo [4/4] Leitor WhatsApp...
if not exist "%LEITOR%\config.json" (
  echo       ERRO: falta configurar. Rode 2_CONFIGURAR.bat na pasta do Leitor.
) else (
  powershell -NoProfile -Command "if(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*leitor.js*' }){exit 0}else{exit 1}"
  if errorlevel 1 (
    start "Leitor WhatsApp - NAO FECHE" /min /d "%LEITOR%" cmd /c 3_INICIAR.bat
    echo       LIGADO agora - janela minimizada, nao feche.
  ) else (
    echo       ja estava ligado.
  )
)
echo.
echo ================================================
echo   PRONTO. Confira no Portal: Executores = ONLINE
echo   Para desligar o robo: "Parar Ajuste Estoque"
echo ================================================
if "%SETA_ABRIU%"=="1" (
  echo.
  echo   LEMBRE: faca o login no Seta. O robo so pega
  echo   pedidos com o Seta logado na tela principal.
  pause
) else (
  timeout /t 15
)
