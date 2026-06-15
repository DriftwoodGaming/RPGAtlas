@echo off
rem RPGAtlas - puts a clickable RPGAtlas icon on your Desktop. GPL-3.0-or-later.
rem Double-click this file once; afterwards launch RPGAtlas from the Desktop.

setlocal
if not exist "%~dp0RPGAtlas.exe" (
  echo.
  echo   RPGAtlas.exe was not found next to this file.
  echo   Make sure this file stays inside the RPGAtlas folder, then try again.
  echo.
  pause
  exit /b 1
)

set "PS=$l=Join-Path ([Environment]::GetFolderPath('Desktop')) 'RPGAtlas.lnk'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($l); $s.TargetPath='%~dp0RPGAtlas.exe'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0RPGAtlas.exe,0'; $s.Description='Chart your world. Tell your story.'; $s.Save()"
powershell -NoProfile -ExecutionPolicy Bypass -Command "%PS%"

if errorlevel 1 (
  echo.
  echo   Sorry - the shortcut could not be created.
  echo.
  pause
  exit /b 1
)

echo.
echo   Done! Look for the RPGAtlas icon on your Desktop.
echo   Double-click it any time to start making games.
echo.
pause
