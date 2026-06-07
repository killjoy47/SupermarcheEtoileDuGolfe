@echo off
setlocal
cd /d "%~dp0"

set "PORT=8080"
set "APP_DB_PATH=%~dp0data.db"
set "PERSISTENT_DB_DIR=%LOCALAPPDATA%\SupermarcheEtoileDuGolfe"
set "PERSISTENT_DB_PATH=%PERSISTENT_DB_DIR%\data.db"
set "JWT_SECRET_FILE=%PERSISTENT_DB_DIR%\jwt-secret.txt"

if not exist "%PERSISTENT_DB_DIR%" mkdir "%PERSISTENT_DB_DIR%"

if not exist "%PERSISTENT_DB_PATH%" (
	if exist "%APP_DB_PATH%" (
		echo Migration de la base existante vers %PERSISTENT_DB_PATH%
		copy /Y "%APP_DB_PATH%" "%PERSISTENT_DB_PATH%" >nul
	)
)

if "%JWT_SECRET%"=="" (
	if exist "%JWT_SECRET_FILE%" set /p JWT_SECRET=<"%JWT_SECRET_FILE%"
)
if "%JWT_SECRET:~31,1%"=="" (
	for /f %%S in ('powershell -NoProfile -Command "[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))"') do set "JWT_SECRET=%%S"
	>"%JWT_SECRET_FILE%" echo %JWT_SECRET%
)

if "%DATABASE_PATH%"=="" set "DATABASE_PATH=%PERSISTENT_DB_PATH%"

echo Nettoyage des anciennes instances serveur ShopDesk...
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":%PORT% .*LISTENING"') do (
	taskkill /PID %%P /F >nul 2>&1
)

set "APP_URL=http://localhost:%PORT%/?v=%RANDOM%%RANDOM%"
echo Demarrage Supermarche etoile du golfe sur %APP_URL%

powershell -NoProfile -Command "Start-Process -FilePath '%~dp0runtime\node.exe' -ArgumentList '%~dp0backend\dist\index.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden" >nul 2>&1

set "BROWSER_READY=0"
powershell -NoProfile -Command "$ok=$false; for($i=0; $i -lt 40; $i++){ try { $c=New-Object Net.Sockets.TcpClient; $a=$c.BeginConnect('127.0.0.1',%PORT%,$null,$null); if($a.AsyncWaitHandle.WaitOne(200)){ $c.EndConnect($a); $c.Close(); $ok=$true; break }; $c.Close() } catch {}; Start-Sleep -Milliseconds 100 }; if($ok){ exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 set "BROWSER_READY=1"

:launch_app
if not "%BROWSER_READY%"=="1" (
	echo Le serveur met plus de temps a demarrer, ouverture de l'application quand meme.
)

set "EDGE_EXE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE_EXE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

set "CHROME_EXE="
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"

if defined EDGE_EXE (
	start "" "%EDGE_EXE%" --new-window --app="%APP_URL%" --window-size=1400,900
) else if defined CHROME_EXE (
	start "" "%CHROME_EXE%" --new-window --app="%APP_URL%" --window-size=1400,900
) else (
	echo Aucun navigateur compatible trouve a l'emplacement habituel pour ouvrir l'application.
	exit /b 1
)
