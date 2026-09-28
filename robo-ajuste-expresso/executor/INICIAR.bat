@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist config.json ( echo Falta configurar. Rode CONFIGURAR.bat primeiro. & pause & exit /b 1 )
where pythonw >nul 2>nul
if errorlevel 1 ( echo pythonw nao encontrado. Rode INSTALAR.bat. & pause & exit /b 1 )
start "" pythonw supervisor.py
echo Executor iniciado em segundo plano (sem janela).
echo Para ver se esta funcionando: STATUS.bat  ou  Portal ^> Acerto de Estoque Lojas ^> Seguranca ^> Executores.
echo Para parar: PARAR.bat
timeout /t 6 >nul
