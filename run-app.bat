@echo off
setlocal

REM Quick launcher for non-technical users.
REM Prerequisites: Node.js installed and this folder is writable.

if not exist node_modules (
  echo Installing dependencies...
  npm install
  if errorlevel 1 (
    echo npm install failed. Check Node.js installation and network, then try again.
    pause
    exit /b 1
  )
)

echo Starting Dentrix Bank Reconciler...
npm run electron:dev

endlocal
