@echo off
title ICM Protocols - Remote Preview
cd /d "%~dp0"

REM Owner-run launcher for the remote preview (rule 36 / G-10).
REM Starts the local server (accepting any Cloudflare quick-tunnel host) and
REM opens a tunnel. Double-click this any time your preview link goes dead.
REM Because YOU launch it, it keeps running independently of the AI session.

set ICM_ALLOW_TUNNEL=1

echo Starting the ICM Protocols server (minimized)...
start "ICM Protocols Server" /min cmd /c "set ICM_ALLOW_TUNNEL=1&& node server.js"

echo Waiting for the server to come up...
timeout /t 2 /nobreak >nul

echo.
echo ============================================================
echo   Your preview link is the https://...trycloudflare.com
echo   address printed below. Open it on your phone.
echo   Keep this window open. Close it to stop the tunnel.
echo ============================================================
echo.

cloudflared tunnel --url http://localhost:7717
