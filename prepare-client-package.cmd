@echo off
setlocal
cd /d "%~dp0"

set "APP_NAME=SupermarcheEtoileDuGolfe"
set "OUTPUT_ROOT=%~dp0delivery"
set "OUTPUT_DIR=%OUTPUT_ROOT%\%APP_NAME%"

echo Preparation du package client dans "%OUTPUT_DIR%"...

if exist "%OUTPUT_DIR%" rmdir /s /q "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%" || exit /b 1

mkdir "%OUTPUT_DIR%\backend" || exit /b 1
mkdir "%OUTPUT_DIR%\frontend" || exit /b 1
mkdir "%OUTPUT_DIR%\runtime" || exit /b 1

robocopy "%~dp0backend\dist" "%OUTPUT_DIR%\backend\dist" /E >nul
if errorlevel 8 exit /b 1

robocopy "%~dp0backend\node_modules" "%OUTPUT_DIR%\backend\node_modules" /E >nul
if errorlevel 8 exit /b 1

robocopy "%~dp0frontend\dist" "%OUTPUT_DIR%\frontend\dist" /E >nul
if errorlevel 8 exit /b 1

copy /Y "%~dp0runtime\node.exe" "%OUTPUT_DIR%\runtime\node.exe" >nul || exit /b 1
copy /Y "%~dp0start-shopdesk.cmd" "%OUTPUT_DIR%\start-shopdesk.cmd" >nul || exit /b 1
copy /Y "%~dp0launch-supermarche.vbs" "%OUTPUT_DIR%\launch-supermarche.vbs" >nul || exit /b 1
copy /Y "%~dp0create-desktop-shortcut.cmd" "%OUTPUT_DIR%\create-desktop-shortcut.cmd" >nul || exit /b 1

if exist "%~dp0logo.ico" copy /Y "%~dp0logo.ico" "%OUTPUT_DIR%\logo.ico" >nul
if exist "%~dp0README-LIVRAISON.txt" copy /Y "%~dp0README-LIVRAISON.txt" "%OUTPUT_DIR%\README-LIVRAISON.txt" >nul

echo Package client pret.
echo Dossier: "%OUTPUT_DIR%"
exit /b 0