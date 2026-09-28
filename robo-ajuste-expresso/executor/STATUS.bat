@echo off
chcp 65001 >nul
cd /d "%~dp0"
python executor.py --status
if exist PAUSA ( echo. & echo *** FILA PAUSADA PELO FREIO DE SEGURANCA - veja o motivo abaixo e use RETOMAR.bat *** & type PAUSA & echo. )
echo.
if exist state.json type state.json
echo.
echo --- ultimas linhas do log ---
powershell -NoProfile -Command "if(Test-Path executor.log){Get-Content executor.log -Tail 12}"
pause
