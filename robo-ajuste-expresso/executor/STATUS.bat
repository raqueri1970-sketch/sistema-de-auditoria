@echo off
chcp 65001 >nul
cd /d "%~dp0"
python executor.py --status
echo.
if exist state.json type state.json
echo.
echo --- ultimas linhas do log ---
powershell -NoProfile -Command "if(Test-Path executor.log){Get-Content executor.log -Tail 12}"
pause
