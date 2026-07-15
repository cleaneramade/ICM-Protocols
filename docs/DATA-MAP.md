# Data map — where data can leave this machine

ICM Protocols is a local-first tool. The server binds `127.0.0.1` only and makes
**no outbound network calls at runtime** — it reads and writes files on the local
machine and serves a UI to the loopback browser. This document is the register
that SEC-12 (third-party / data-map) asks for: if a future change adds an
outbound call, it must be added here first.

## Runtime egress: none

The server (`server.js` + `server/*.js`) has no `fetch`, `http.request`,
`net.connect`, or DNS calls. Its only `child_process` spawns are local:
opening the default browser at startup and revealing a file in the OS file
manager. It never sends project data anywhere.

## The only ways data leaves the machine

| Destination | What it receives | When | Control |
| --- | --- | --- | --- |
| **Cloudflare** (`*.trycloudflare.com`) | The preview UI, served over an owner-started quick-tunnel. Read-only, and scoped to the **governance board only** (`/api/health`, `/api/board`, `/api/deleted`) — no filesystem paths, secrets, brain notes, project inventory, or audit reports cross the tunnel (see `TUNNEL_GET_ALLOW` in `server.js`). Writes are blocked. | Only while the owner runs `Start Preview.cmd` / `keep-preview-alive.ps1` (which set `ICM_ALLOW_TUNNEL=1`). | Owner-initiated; ephemeral URL; TLS terminated by Cloudflare. |
| **GitHub** (`github.com`) | Source code pushed to the private `origin` and the clean public mirror. Never `.env`, `data/*` local state, or `.backups/` (all gitignored). | Manual `git push`. | Owner-initiated; see `docs/PUBLISHING.md` for the clean-mirror rules. |

## Browser-side (client), not the server

| Destination | What it receives | Notes |
| --- | --- | --- |
| **Brandfetch / logo CDN** | A connection **name** (e.g. "Stripe") to fetch a logo image in the Connections view. | Client-side `<img src>` only; no secrets. Falls back to a letter tile if it fails. Optional Brandfetch client ID configured in the UI. |

## Build-time only (not shipped, not run at runtime)

| Destination | What it receives | Notes |
| --- | --- | --- |
| **api.iconify.design** | Icon names, to regenerate `tools/solar-extra.json`. | `tools/fetch-solar-icons.mjs`, a manual dev helper. The generated JSON is committed, so this is never needed at runtime. |

## Rule

Adding any new outbound call (analytics, telemetry, an API client, an AI
provider, email) requires a row in this table **and** a re-run of
`/security-audit` — otherwise the "no runtime egress" guarantee above silently
becomes false.
