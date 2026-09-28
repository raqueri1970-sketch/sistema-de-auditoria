@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Estes testes mexem na tela do Seta (abrem/fecham telas) mas NAO lancam estoque.
echo Deixe o Seta aberto e logado, sem usar o mouse/teclado durante o teste (cerca de 3 minutos).
pause
python testes.py --completo
pause
