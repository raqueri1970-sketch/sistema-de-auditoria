@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist PAUSA (
  echo A fila NAO esta pausada. Nada a fazer.
  timeout /t 6 >nul
  exit /b 0
)
echo ================================================
echo   FILA PAUSADA PELO FREIO DE SEGURANCA
echo ================================================
type PAUSA
echo.
echo.
echo Antes de retomar, confira:
echo   1. O Seta esta aberto, logado e na tela principal, sem aviso aberto.
echo   2. Servidor/VPN estao normais (a TI consegue acessar).
echo   3. Pedidos em DIVERGENCIA foram conferidos no Seta (Portal ^> Detalhes).
echo.
set /p OK=Digite SIM para retomar a fila: 
if /I not "%OK%"=="SIM" (
  echo Nada foi alterado. A fila continua pausada.
  timeout /t 6 >nul
  exit /b 1
)
del PAUSA
echo Fila retomada. O Executor volta a pegar pedidos em ate 5 segundos.
timeout /t 6 >nul
