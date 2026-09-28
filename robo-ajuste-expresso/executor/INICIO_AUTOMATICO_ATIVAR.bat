@echo off
chcp 65001 >nul
cd /d "%~dp0"
for /f "delims=" %%i in ('where pythonw') do set PYW=%%i
if "%PYW%"=="" ( echo pythonw nao encontrado. Rode INSTALAR.bat. & pause & exit /b 1 )
schtasks /Create /TN "AjusteExpressoExecutor" /TR "\"%PYW%\" \"%~dp0supervisor.py\"" /SC ONLOGON /DELAY 0000:30 /RL LIMITED /F
if errorlevel 1 ( echo Nao foi possivel criar a tarefa. & pause & exit /b 1 )
echo.
echo Pronto: o Executor inicia sozinho 30 segundos depois de voce entrar no Windows (usuario atual).
echo LEMBRE: o computador precisa ficar LIGADO, com a sessao aberta e a tela DESBLOQUEADA, e o Seta logado.
echo Recomendado: em Configuracoes do Windows, tela e suspensao = "Nunca" quando ligado na tomada.
pause
