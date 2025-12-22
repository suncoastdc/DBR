@echo off
setlocal

:: Simple terminal launcher for non-technical users.
:: Double-click this file to check for updates and start the app.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install from https://nodejs.org/ and run this again.
  pause
  exit /b 1
)

node "%~dp0launcher.mjs"

endlocal
