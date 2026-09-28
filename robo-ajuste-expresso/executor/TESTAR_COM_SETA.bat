@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Estes testes mexem na tela do Seta (abrem/fecham telas) mas NAO lancam estoque.
echo Deixe o Seta aberto e logado, sem usar o mouse/teclado durante o teste (cerca de 3 minutos).
echo O robo fica DESLIGADO durante o teste e e religado no final.
pause
set "RODANDO=0"
powershell -NoProfile -Command "if(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and ($_.CommandLine -like '*supervisor.py*' -or $_.CommandLine -like '*executor.py*') }){exit 0}else{exit 1}"
if not errorlevel 1 set "RODANDO=1"
if "%RODANDO%"=="1" (
  echo parar> STOP
  echo Parando o robo para o teste - ele termina o pedido atual, se houver...
  powershell -NoProfile -Command "$t=0; while((Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and ($_.CommandLine -like '*supervisor.py*' -or $_.CommandLine -like '*executor.py*') }) -and $t -lt 150){Start-Sleep 2; $t+=2}; if($t -ge 150){exit 1}"
  if errorlevel 1 ( echo O robo nao parou em 2,5 minutos. Teste CANCELADO - nada foi feito no Seta. & pause & exit /b 1 )
  echo Robo parado.
)
python testes.py --completo
if "%RODANDO%"=="1" (
  echo Religando o robo...
  start "" pythonw supervisor.py
)
pause
