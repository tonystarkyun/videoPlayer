@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%start.ps1"

if not exist "%PS_SCRIPT%" (
  echo Could not find start.ps1 in:
  echo %SCRIPT_DIR%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Startup failed with exit code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%

