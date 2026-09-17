@echo off
title pointStream
color 0A
cls

REM ============================================================
REM  Anclar el directorio de trabajo a la ubicacion del .bat
REM  Esto es critico para que funcione desde doble click,
REM  desde CMD en cualquier directorio, y desde accesos directos.
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo    POINTSTREAM
echo ============================================================
echo.

REM ============================================================
REM  Verificar que Node.js esta instalado
REM ============================================================
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js no encontrado en el PATH.
    echo.
    echo Instala Node.js desde: https://nodejs.org
    echo Asegurate de marcar "Add to PATH" durante la instalacion.
    echo.
    pause
    exit /b 1
)

REM ============================================================
REM  Detectar gestor de paquetes (preferir pnpm, fallback npm)
REM ============================================================
set "PKG_MGR="
where pnpm >nul 2>&1
if not errorlevel 1 (
    set "PKG_MGR=pnpm"
) else (
    where npm >nul 2>&1
    if not errorlevel 1 (
        set "PKG_MGR=npm"
    )
)

if "%PKG_MGR%"=="" (
    echo ERROR: Ni pnpm ni npm fueron encontrados en el PATH.
    echo.
    echo Instala Node.js y pnpm desde: https://nodejs.org y https://pnpm.io
    echo.
    pause
    exit /b 1
)

echo Usando gestor de paquetes: %PKG_MGR%
echo.

REM ============================================================
REM  Instalar dependencias si faltan
REM ============================================================
if not exist "node_modules" (
    echo Instalando dependencias por primera vez con %PKG_MGR%...
    echo.
    call %PKG_MGR% install
    if errorlevel 1 (
        echo.
        echo ERROR: %PKG_MGR% install fallo.
        echo.
        echo Posibles causas:
        echo   - Sin conexion a internet
        echo   - Permisos insuficientes
        echo   - package.json corrupto
        echo.
        echo Intenta ejecutar manualmente en CMD:
        echo   cd /d "%~dp0"
        echo   %PKG_MGR% install
        echo.
        pause
        exit /b 1
    )
    echo.
)

REM ============================================================
REM  Verificar que electron esta instalado en node_modules
REM ============================================================
if not exist "node_modules\.bin\electron.cmd" (
    if not exist "node_modules\electron" (
        echo Electron no encontrado en node_modules.
        echo Reinstalando dependencias con %PKG_MGR%...
        echo.
        call %PKG_MGR% install
        if errorlevel 1 (
            echo.
            echo ERROR: No se pudo instalar Electron.
            echo Intenta: %PKG_MGR% install
            echo.
            pause
            exit /b 1
        )
        echo.
    )
)

echo Iniciando pointStream...
echo.

REM ============================================================
REM  Iniciar la aplicacion
REM  Usamos "%PKG_MGR% start" que invoca "electron ." segun package.json
REM ============================================================
call %PKG_MGR% start

if errorlevel 1 (
    echo.
    echo ERROR: pointStream no pudo iniciarse.
    echo.
    echo Posibles causas:
    echo   - Electron bloqueado por antivirus (Malwarebytes / Windows Defender)
    echo   - Archivo electron\main.js con error de sintaxis
    echo   - Dependencias incompletas o corruptas
    echo.
    echo Si el antivirus detecto electron.exe como falso positivo (Spyware.InfoStealer):
    echo   1. Abre Malwarebytes / Antivirus
    echo   2. Ve a Historial de detecciones -> Cuarentena
    echo   3. Selecciona el archivo y pulsa "Restaurar"
    echo   4. Agrega la carpeta del proyecto a la Lista de exclusiones / Allow list
    echo.
    echo Para diagnosticar, ejecuta en CMD:
    echo   cd /d "%~dp0"
    echo   %PKG_MGR% run dev
    echo.
    pause
    exit /b 1
)

exit /b 0
