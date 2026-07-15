# Self-healing remote preview for ICM Protocols.
# Keeps a Cloudflare quick tunnel to the local server (127.0.0.1:7717) alive,
# auto-rebuilding it whenever it drops. Writes the current public URL to
# PREVIEW-URL.txt in the project root so the live link is always discoverable.
#
# Coexists with other projects doing the same: it uses a UNIQUE metrics port
# (20251, not cloudflared's default 20241) and only ever touches THIS project's
# server on port 7717 — it never kills processes by name, so it won't disturb
# another project's server or tunnel.
$ErrorActionPreference = 'Continue'
$env:ICM_ALLOW_TUNNEL = '1'
$root = (Get-Location).Path
$urlFile = Join-Path $root 'PREVIEW-URL.txt'

function Server-Up {
  try { (Invoke-WebRequest 'http://127.0.0.1:7717/' -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200 }
  catch { $false }
}

if (-not (Server-Up)) {
  Write-Host 'Starting the ICM Protocols server (minimized)...'
  Start-Process -WindowStyle Minimized cmd -ArgumentList '/c', 'set ICM_ALLOW_TUNNEL=1&& node server.js'
  for ($i = 0; $i -lt 12 -and -not (Server-Up); $i++) { Start-Sleep 1 }
}

Write-Host '============================================================'
Write-Host '  Keeping the remote preview alive. Leave this window open.'
Write-Host '  The current link is always saved to PREVIEW-URL.txt'
Write-Host '  Close this window to stop the tunnel.'
Write-Host '============================================================'

while ($true) {
  Write-Host ("[{0}] Starting tunnel..." -f (Get-Date -Format 'HH:mm:ss'))
  & cloudflared tunnel --url http://localhost:7717 --metrics 127.0.0.1:20251 2>&1 | ForEach-Object {
    Write-Host $_
    if ("$_" -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
      $matches[0] | Out-File -Encoding ascii -NoNewline $urlFile
    }
  }
  Write-Host ("[{0}] Tunnel dropped — rebuilding in 2s..." -f (Get-Date -Format 'HH:mm:ss'))
  Start-Sleep 2
}
