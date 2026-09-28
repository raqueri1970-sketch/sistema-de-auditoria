@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ====================================================
echo  INSTALAR - Executor Ajuste Expresso
echo ====================================================
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python nao encontrado. Instale o Python 3.11 ou mais novo, 64 bits, em python.org
  echo e MARQUE a opcao "Add python.exe to PATH". Depois rode este arquivo de novo.
  pause & exit /b 1
)
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 ( echo. & echo ERRO ao instalar as bibliotecas. Confira a internet. & pause & exit /b 1 )
echo.
python diagnostico.py
echo.
echo PROXIMOS PASSOS:  1) CONFIGURAR.bat   2) DIAGNOSTICO.bat   3) INICIAR.bat
pause
