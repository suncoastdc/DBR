@echo off
setlocal
cd /d "%~dp0"

rem One-time install if node_modules is missing
if not exist node_modules (
  echo Installing dependencies...
  npm install
  if errorlevel 1 (
    echo npm install failed. Check Node.js/npm setup.
    pause
    exit /b 1
  )
)

echo Launching Electron dev app...
echo Close this window to stop it.
npm run electron:dev
pause
