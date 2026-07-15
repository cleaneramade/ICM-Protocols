@echo off
title ICM Protocols - Keep Preview Alive
cd /d "%~dp0"
REM Double-click this to keep the remote preview alive. It starts the server if
REM needed and auto-rebuilds the Cloudflare tunnel whenever it drops. The live
REM link is written to PREVIEW-URL.txt. Close this window to stop.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\keep-preview-alive.ps1"
pause
