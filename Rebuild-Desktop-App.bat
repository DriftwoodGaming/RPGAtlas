@echo off
setlocal enableextensions
title Rebuild RPGAtlas Desktop App

rem ============================================================================
rem  RPGAtlas - Rebuild the Desktop app (RPGAtlas-Desktop.exe)
rem
rem  Double-click this file, or run it from a terminal, to rebuild the desktop
rem  version of RPGAtlas from the current source code. It bundles the latest
rem  editor and engine - including brand-new features like project folders -
rem  into a fresh RPGAtlas-Desktop.exe at the project root.
rem
rem  This is a friendly wrapper around a single command:  npm run package:exe
rem  (scripts/package-exe.mjs: vite build -> cargo build --release -> copy exe).
rem  Keeping this a thin wrapper means there is only ONE real build recipe to
rem  maintain, so the desktop app can never drift from the web build.
rem
rem  Re-run it whenever you (or another contributor) add new features and want
rem  the desktop .exe brought up to date.
rem ============================================================================

rem Always run from the folder this script lives in (the project root), so it
rem works no matter where it is launched from - including a double-click.
pushd "%~dp0"

echo.
echo ===========================================================
echo   Rebuilding the RPGAtlas Desktop app...
echo ===========================================================
echo.

rem --- Make sure we are actually sitting in the project root ----------------
if not exist "package.json" (
  echo   [X] Could not find package.json next to this script.
  echo       Keep this .bat file in the RPGAtlas project folder - the one
  echo       that holds package.json and the src-tauri folder - then try again.
  goto :fail
)
if not exist "scripts\package-exe.mjs" (
  echo   [X] Could not find scripts\package-exe.mjs next to this script.
  echo       Keep this .bat file in the RPGAtlas project folder and try again.
  goto :fail
)

rem --- Check that the build tools are installed -----------------------------
echo Checking that the build tools are installed...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js was not found.
  echo       Install the LTS version from https://nodejs.org/ then run this again.
  goto :fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo   [X] npm was not found - it normally comes bundled with Node.js.
  echo       Reinstall Node.js from https://nodejs.org/ then run this again.
  goto :fail
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo   [X] Rust was not found - the desktop shell is compiled with Rust.
  echo       Install it from https://rustup.rs/ then run this again.
  echo       On Windows you also need the C++ build tools; see the setup guide
  echo       at https://tauri.app/start/prerequisites/
  goto :fail
)

for /f "delims=" %%v in ('node --version') do set "NODE_VER=%%v"
echo   Found Node.js %NODE_VER%, npm, and Rust. Good to go.
echo.

rem --- Keep npm dependencies current ----------------------------------------
rem "npm install" is quick when nothing changed, and it quietly picks up any
rem new packages a feature may have added - so contributors do not have to
rem remember to run it themselves.
echo Making sure npm dependencies are up to date...
echo.
call npm install
if errorlevel 1 (
  echo.
  echo   [X] "npm install" failed. See the messages above.
  goto :fail
)
echo.

rem --- Build the desktop app ------------------------------------------------
echo Building the frontend and compiling the desktop app...
echo The first Rust build can take several minutes; later builds are much faster.
echo.
call npm run package:exe
if errorlevel 1 (
  echo.
  echo   [X] The build failed. See the messages above.
  echo       A common first-time cause on Windows is missing C++ build tools;
  echo       see https://tauri.app/start/prerequisites/
  goto :fail
)

rem --- Confirm the result ---------------------------------------------------
if not exist "RPGAtlas-Desktop.exe" (
  echo.
  echo   [X] The build finished but RPGAtlas-Desktop.exe was not created.
  echo       Check the messages above for what went wrong.
  goto :fail
)

for %%A in ("RPGAtlas-Desktop.exe") do set "EXE_BYTES=%%~zA"
for %%A in ("RPGAtlas-Desktop.exe") do set "EXE_STAMP=%%~tA"
set /a EXE_MB=EXE_BYTES/1048576

echo.
echo ===========================================================
echo   Success - RPGAtlas-Desktop.exe has been rebuilt.
echo ===========================================================
echo.
echo   File:  RPGAtlas-Desktop.exe
echo   Size:  %EXE_MB% MB
echo   Built: %EXE_STAMP%
echo.
echo You can now double-click RPGAtlas-Desktop.exe to run the updated
echo desktop app. Re-run this script whenever new features are added.
echo.
popd
pause
exit /b 0

:fail
echo.
echo -----------------------------------------------------------
echo   The rebuild did not finish. Nothing was changed.
echo   Read the messages above, fix the issue, and run it again.
echo -----------------------------------------------------------
echo.
popd
pause
exit /b 1
