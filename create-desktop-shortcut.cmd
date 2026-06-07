@echo off
setlocal
cd /d "%~dp0"

set "TARGET=%~dp0launch-supermarche.vbs"
set "ICON=%~dp0logo.ico"
set "NAME=Supermarche etoile du golfe"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desktop=[Environment]::GetFolderPath('Desktop');" ^
  "$shell=New-Object -ComObject WScript.Shell;" ^
  "$lnk=$shell.CreateShortcut((Join-Path $desktop '%NAME%.lnk'));" ^
  "$lnk.TargetPath='%TARGET%';" ^
  "$lnk.WorkingDirectory='%~dp0';" ^
  "$lnk.IconLocation='%ICON%,0';" ^
  "$lnk.WindowStyle=1;" ^
  "$lnk.Save();"

echo Raccourci cree sur le Bureau avec l'icone personnalisee.