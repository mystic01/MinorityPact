@echo off
setlocal
title Minority Pact
cd /d "%~dp0"
if errorlevel 1 goto failed

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install Node.js and try again.
  goto failed
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  goto failed
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found. Reinstall Node.js with npm included.
  goto failed
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Dependencies are missing. Run npm.cmd ci in this folder, then try again.
  goto failed
)

if /i not "%~1"=="--check" (
  powershell.exe -NoProfile -Command "$client = [System.Net.Sockets.TcpClient]::new(); try { $client.Connect('127.0.0.1', 3000); exit 1 } catch { exit 0 } finally { $client.Dispose() }"
  if errorlevel 1 (
    echo Port 3000 is already in use. A previous game server may still be running.
    echo Press Ctrl+C in its original window, then run start-game.bat again.
    echo Restarting is required after updates. Rebuilding alone does not reload the server.
    goto failed
  )
)

echo Building Minority Pact...
call npm.cmd run build
if errorlevel 1 goto failed
if /i "%~1"=="--check" exit /b 0

echo.
echo Opening http://127.0.0.1:3000 when the server is ready...
echo Keep this window open while playing. Press Ctrl+C to stop the server.
echo Starting the server does not start an AI game or call a paid API.
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "$limit = (Get-Date).AddSeconds(60); while ((Get-Date) -lt $limit) { try { $page = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000' -TimeoutSec 2; if ($page.Content -match 'Minority Pact') { Start-Process 'http://127.0.0.1:3000'; exit } } catch {}; Start-Sleep -Seconds 1 }" >nul 2>nul
call npm.cmd run serve
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo Startup failed. See the message above.
echo If port 3000 is already in use, open http://127.0.0.1:3000 or stop the other server.
echo Do not delete a database lock while its server is still running.
if /i "%~1"=="--check" exit /b 1
pause
exit /b 1
