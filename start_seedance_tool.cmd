@echo off
set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if "%SEEDANCE_API_KEY%"=="" (
  echo Please paste your SEEDANCE_API_KEY, then press Enter.
  set /p SEEDANCE_API_KEY=SEEDANCE_API_KEY:
)

if exist "%NODE_EXE%" (
  "%NODE_EXE%" seedance_server.js
) else (
  node seedance_server.js
)

echo.
echo Seedance tool stopped. If this was unexpected, copy the error above and send it to Codex.
pause
