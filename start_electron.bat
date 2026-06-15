@echo off
title pointStream
color 0A
cls

echo ============================================================
echo    POINTSTREAM
echo ============================================================
echo.

REM Instalar dependencias si faltan
if not exist "node_modules" (
    echo Instalando dependencias...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo ERROR: No se pudieron instalar las dependencias.
        echo Verifica que Node.js este instalado: https://nodejs.org
        echo.
        pause
        exit /b
    )
)

echo Iniciando aplicacion...
echo.

npm start

if errorlevel 1 (
    echo.
    echo ERROR: No se pudo iniciar la aplicacion.
    echo Intenta en CMD: npm install
    echo.
    pause
)

exit /b
