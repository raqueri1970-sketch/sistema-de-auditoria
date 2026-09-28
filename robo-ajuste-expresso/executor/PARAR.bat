@echo off
cd /d "%~dp0"
echo parar > STOP
echo Pedido de parada enviado. O Executor termina o pedido atual (se houver) e encerra em ate 1 minuto.
timeout /t 5 >nul
