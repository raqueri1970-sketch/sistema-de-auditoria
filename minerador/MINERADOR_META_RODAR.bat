@echo off
title Minerador Meta Ads - ShopPainless v4.0
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python nao encontrado. Instale em https://www.python.org ^(marque "Add to PATH"^).
  pause
  exit /b
)

echo Verificando dependencias...
python -m pip install --quiet --upgrade playwright openpyxl
python -c "import playwright" >nul 2>nul || (echo Falha ao instalar playwright & pause & exit /b)
python -m playwright install chromium >nul 2>nul

:menu
cls
echo ==========================================================
echo     MINERADOR META ADS - SHOPPAINLESS  v4.0 (ESCALANDO)
echo ==========================================================
echo  Acha produtos com 40+ anuncios NOVOS (ate 45 dias) do
echo  MESMO anunciante = produto escalando agora.
echo ----------------------------------------------------------
echo   [1] Minerar por PALAVRA-CHAVE (~60-90 min)
echo   [2] Teste rapido (3 buscas)
echo   [3] Buscar UMA palavra-chave
echo   [4] CONFIGURAR (1a vez: login Facebook + copycat.ads)
echo   [5] Editar lista de palavras-chave
echo   [6] Abrir planilha do ultimo resultado
echo   [7] Minerar por DOR + sem palavra-chave (~2-3 h)
echo   [8] Editar lista de DORES
echo   [9] Abrir PAINEL (dashboard - mostra a mineracao ao vivo)
echo   [R] Abrir RELATORIO PDF (fotos + links)
echo   [0] Sair
echo ==========================================================
echo  O painel abre sozinho no navegador quando a mineracao comeca.
echo.
set "OP="
set /p OP=Escolha:

if "%OP%"=="1" python minerador_meta_ads.py & pause & goto menu
if "%OP%"=="2" python minerador_meta_ads.py --teste & pause & goto menu
if "%OP%"=="3" goto uma
if "%OP%"=="4" python minerador_meta_ads.py --configurar & pause & goto menu
if "%OP%"=="5" (
  if not exist keywords_meta.txt python -c "import minerador_meta_ads as m; m.carregar_keywords()"
  notepad keywords_meta.txt
  goto menu
)
if "%OP%"=="6" (
  if exist meta_ads_ranking.xlsx (start "" meta_ads_ranking.xlsx) else (echo Ainda nao ha resultado. & pause)
  goto menu
)
if "%OP%"=="7" python minerador_meta_ads.py --dores --geral --max-anunciantes 60 & pause & goto menu
if "%OP%"=="8" (
  if not exist dores_meta.txt python -c "import minerador_meta_ads as m; m.carregar_dores()"
  notepad dores_meta.txt
  goto menu
)
if "%OP%"=="9" (
  if not exist painel_minerador.html python -c "import minerador_meta_ads as m; m.salvar_painel([], {}, 40, 45)"
  start "" painel_minerador.html
  goto menu
)
if /i "%OP%"=="R" (
  if exist relatorio_minerador.pdf (start "" relatorio_minerador.pdf) else (echo Ainda nao ha relatorio. & pause)
  goto menu
)
if "%OP%"=="0" exit /b
goto menu

:uma
set "KW="
set "PAIS="
set /p KW=Palavra-chave (ex: posture corrector):
set /p PAIS=Pais (US, MX, ES) [US]:
if "%PAIS%"=="" set "PAIS=US"
python minerador_meta_ads.py --keyword "%KW%" --pais %PAIS%
pause
goto menu
