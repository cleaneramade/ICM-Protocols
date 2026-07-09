# Security Protocols — the rulebook for keeping your projects safe

## Purpose

This file is your personal security program. It answers one question for every
project: **"is my stuff safe, or can a random person break in and take it?"**
It works like Vanta (are the rules being followed?) plus CodeRabbit (is the code
itself safe?), sized for one person.

The `/security-audit` command reads this file, checks a project against it, and
gives every rule a color. This file is the source of truth; the command and the
Security page in the ICM app just report on it.

## Grade 6 summary

Every rule gets a color, just like the approval board:

- 🟢 **Green** = this is safe and it was proven safe (there's real evidence).
- 🟡 **Yellow** = needs your attention, OR it's a judgment call the robot can't
  fully prove on its own.
- 🔴 **Red** = a real hole. Fix this — a stranger could use it to get in.
- ⚪ **Gray** = not checked yet, or the robot couldn't prove it either way.
  **Gray never counts as safe.** No proof means not green.

The most important idea: **green needs evidence.** The audit only paints a rule
green when it actually ran a command or read a file and saw the proof. If it
just "thinks" something is fine, the best it can say is yellow. This is what
stops the robot from lying to you with a screen full of fake green.

## The four ideas behind every rule

1. **Least privilege** — give every key, account, and program the smallest
   amount of power that still works. A leaked key that can do little hurts little.
2. **Defense in depth** — never trust one wall. A login AND a locked door AND a
   backup, so one failure isn't the whole game.
3. **Evidence over claims** — a rule is only "done" when there's proof (a command
   that ran, a file line, a hash). A promise is not proof.
4. **Iterate** — run the audit often, fix the reds, and improve this rulebook
   over time. Security is a habit, not a one-time cleanup.

## How each rule is written

Every rule below carries four things, so the audit knows how to grade it:

- **Test** — how the robot checks it (usually a real read-only command or a file read).
- **Cadence** — how often it should be re-checked (the dashboard turns a project
  yellow/"stale" when it's overdue).
- **Evidence** — what proof makes it green (a command's output, a file line, a hash).
- **Enforcement** — how much a failure hurts:
  - `off` = not scored, shown gray (a rule you turned off on purpose).
  - `warning` = a failure caps the project at 🟡 yellow.
  - `error` = a failure turns the project 🔴 red.

Cite the rule ID (for example `SEC-1` or `WEB-3`) when reporting or fixing, so
findings are traceable over time.

## How to read this file (reference like a book — don't re-read everything)

- Start with the **12 core protocols** — they apply to *every* project.
- Then read only the **packs** that match the project in front of you (a static
  website skips the payments and VPS packs entirely).
- The `.security-audit.yaml` file in each project says which packs are active.
- When something goes red, the **Incident Response runbook** at the bottom says
  what to do first.

---

## The 12 core protocols (every project)

These are the always-on rules. They inherit the global Plutus rules and the
approval board (`APPROVAL_POLICY.md`); where they overlap, the stricter one wins.

| ID | Rule (plain words) | Test | Cadence | Green needs | Enforce |
| --- | --- | --- | --- | --- | --- |
| SEC-1 | **Secrets live in `.env` files only** — never typed into code, never printed to logs. | Grep the source tree for key-shaped strings (`sk-`, `AIza`, `AKIA`, private-key headers, long hex/base64). | Every run | A grep that returns no real key in tracked source (redacted matches only). | error |
| SEC-2 | **Git ignores secrets; `.env.example` is the only env file tracked.** | Read `.gitignore`; run `git ls-files` and check no `.env*` (except `.env.example`) is tracked. Scan git *history* too (see PUB-1 for public repos). | Every run | The `git ls-files` output showing no secret env file is committed. | error |
| SEC-3 | **Changed code gets a security look before it's called done.** | Was `/security-audit` (or `/security-review`) run on the current changes? Check for a recent report covering this commit. | Per change | A dated report whose git anchor matches recent commits. | warning |
| SEC-4 | **Local apps listen on your computer only (`127.0.0.1`), not the whole network.** | Grep server start code for `listen(`, `host`, `0.0.0.0`, `::`. | Every run | The bind line showing `127.0.0.1`/`localhost`, or a documented reason it must be wider. | error |
| SEC-5 | **A login sits in front of anything private.** No "secret URL" as the only guard. | Trace private routes/pages to an auth check; list any that reach data without one. | Every run | Each private route shown calling an auth/session check (file:line). | error |
| SEC-6 | **Never trust what a user types** — every input is checked before it's used. | Look for user input flowing into queries, file paths, shells, or HTML without validation/escaping. | Every run | (Judgment call — caps at yellow) quoted safe-handling at each input site. | warning |
| SEC-7 | **2-step login (or a passkey) on every account that can touch your projects.** | Ask the human to confirm 2FA/passkey on GitHub, email, cloud, domain registrar, password manager. | Quarterly | Human confirmation, dated. (Cannot be auto-proven — caps at yellow until confirmed.) | warning |
| SEC-8 | **Every key has the least power that works, and each project has its own key.** | List keys/tokens the project uses; check scope and that they're not shared across projects. | Quarterly | An inventory showing scoped, per-project keys (human-confirmed for scope). | warning |
| SEC-9 | **Git from day one, plus a copy that isn't only on this PC.** | Is the folder a git repo? Is there an offsite/remote or backup copy? | Every run | `git status` proving a repo + evidence of a remote/offsite copy. | warning |
| SEC-10 | **Keep dependencies few and known; the ones you have are safe.** | Read the manifest + lockfile; check runtime isn't end-of-life (e.g. dead Node); flag abandoned/known-bad packages. Runs FULL every time. | Every run | Lockfile present + no high/critical known issue + runtime supported (captured output). | error |
| SEC-11 | **Online apps use HTTPS and can't be hammered forever** (rate limiting). | For deployed projects, check TLS is enforced and public endpoints have rate limits. | Every run (if online) | Config/headers showing HTTPS + a rate-limit on public endpoints. | warning |
| SEC-12 | **Know what data leaves your machine.** Every outside service is listed on purpose. | Build the list of third parties (APIs, AI, analytics, email, forms) the project talks to. | Monthly | A data-map listing each destination and what data goes to it. | warning |

---

## Platform packs (turn on only the ones that match)

Each pack adds rules for one kind of project. The project's `.security-audit.yaml`
lists which packs are active; the audit also suggests packs it detects.

### WEB — deployed web app (Next.js / Vercel / any live site with a server)

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| WEB-1 | **Security headers are set** (CSP, HSTS, X-Content-Type-Options, frame-ancestors, Referrer-Policy, Permissions-Policy). | Read header config or fetch a live response. | The headers present in config/response. | warning |
| WEB-2 | **Login is re-checked at every route and Server Action**, not just in middleware (middleware alone was bypassable — CVE-2025-29927). | Trace each protected route/action to its own auth check. | Each route/action showing its own check (file:line). | error |
| WEB-3 | **You can't read someone else's data by changing a number** (IDOR / object-level authz). | Find ID-based fetches; check they verify the row belongs to the caller. | Ownership check shown at each ID fetch. | error |
| WEB-4 | **No secrets baked into the browser bundle.** | Scan built client output for keys and `NEXT_PUBLIC_`-leaked secrets. | Clean scan of the client bundle. | error |
| WEB-5 | **Vercel env vars are scoped per environment and marked sensitive; preview deploys are protected.** | Human confirms in the Vercel dashboard; check config where possible. | Human confirmation + any config evidence. | warning |
| WEB-6 | **Server never fetches a user-supplied URL blindly** (SSRF) — protocol/host/port allowlisted. | Find server-side fetches of user URLs (proxies, link previews, webhooks). | Allowlist/guard shown at each fetch site. | error |
| WEB-7 | **File uploads are limited** (type, size, stored outside web root, never executed). | Find upload handlers; check the limits. | Limits shown in the handler. | warning |
| WEB-8 | **No source maps or debug endpoints shipped to production.** | Check build config and routes. | Config showing maps off + no debug route in prod. | warning |
| WEB-9 | **Contact forms can't be turned into a spam relay** (strip CR/LF from anything put in email headers). | Find form → email code; check header sanitization. | Sanitization shown (file:line). | warning |
| WEB-10 | **Email domain is protected** (SPF, DKIM, DMARC set) and no dangling DNS points at dead hosts. | Check DNS records; human confirms registrar. | DNS records present (captured). | warning |

### PAY — site that takes payments (Stripe)

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| PAY-1 | **Card numbers never touch your server** — only Stripe's hosted fields collect them; you store only Stripe IDs. | Grep for any card-number handling; check Checkout/Elements is used. | No PAN/CVV handling in code. | error |
| PAY-2 | **Webhooks are signature-verified** (`constructEvent` with the endpoint secret) over HTTPS. | Find the webhook handler; check signature verification. | Verification call shown (file:line). | error |
| PAY-3 | **Webhook handling is idempotent** (dedupe on `event.id`; Stripe retries). | Check the handler dedupes. | Dedupe logic shown. | warning |
| PAY-4 | **Prices and amounts are computed on the server**, never trusted from the browser. | Trace amount/price source. | Server-side amount shown. | error |
| PAY-5 | **Restricted keys, live/test kept separate.** | Check key prefixes (`rk_`, `sk_live` vs `sk_test`) and how they're loaded. | Key usage evidence (redacted). | warning |
| PAY-6 | **Payment endpoints have card-testing protection** (Radar on, rate limit, bot filter). | Human confirms Radar; check rate limit on the endpoint. | Rate-limit shown + human confirms Radar. | warning |

### ACCT — site with user accounts / logins

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| ACCT-1 | **Passwords hashed with argon2id or bcrypt** — never SHA/MD5, never homemade. | Find the hashing call. | The argon2id/bcrypt call shown (file:line). | error |
| ACCT-2 | **New passwords checked against known-breached lists** (HIBP k-anonymity). | Find the signup password check. | The breach check shown. | warning |
| ACCT-3 | **Session cookies are `HttpOnly; Secure; SameSite`**, ideally `__Host-` prefix. | Read cookie settings. | Cookie flags shown. | error |
| ACCT-4 | **Sessions rotate on login and die on logout**, with idle + absolute timeouts. | Trace session lifecycle. | Rotation/expiry shown. | warning |
| ACCT-5 | **CSRF protection on state-changing routes.** | Check tokens / SameSite coverage. | Protection shown. | warning |
| ACCT-6 | **Login, signup, and reset don't reveal which accounts exist** (uniform errors/timing). | Read the flows. | Uniform responses shown. | warning |
| ACCT-7 | **Password reset tokens are single-use, expiring, random.** | Read the reset flow. | Token properties shown. | error |
| ACCT-8 | **Login and reset endpoints are rate-limited / lock out on abuse.** | Find the limiter on auth endpoints. | Limiter shown. | error |
| ACCT-9 | **Users can export and delete their data; a privacy + breach-notify note exists** (PIPEDA). | Human confirms the policy + export/delete path. | Human confirmation + any code evidence. | warning |

### AI — AI / LLM app or agent

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| AI-1 | **The model's OUTPUT is treated as untrusted** — encoded/sanitized before it's rendered as HTML, run as code, or passed to a shell/SQL/API. | Trace model output to its sinks. | Safe handling shown at each sink. | error |
| AI-2 | **Agent tools have the least power needed, and destructive/paid actions ask a human first.** | Read tool definitions; check confirm-gates on delete/send/pay. | Least-privilege + gates shown. | error |
| AI-3 | **No secrets or auth logic hidden in the system prompt** (assume it will leak). | Read the system prompt. | No secret in the prompt. | error |
| AI-4 | **Spending is capped** — per-user/request token limits, max output, provider spend alerts. | Find the caps. | Caps shown, or human confirms provider alerts. | warning |
| AI-5 | **User input is kept separate from data the model fetches** (RAG/web); fetched content is treated as hostile (indirect prompt injection). | Trace how retrieved content is framed. | Separation shown. | warning |
| AI-6 | **PII is minimized in prompts and in the provider's logs** (retention/training settings checked). | Check what goes into prompts + provider settings. | Minimization + settings evidence. | warning |

### MOB — mobile app (Android APK / Flutter)

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| MOB-1 | **No real secret keys baked into the app binary** (anything shipped is public — route through a backend). | Grep source + build config for keys. | Clean scan (client Firebase keys noted as expected-public — see FIRE pack). | error |
| MOB-2 | **Release builds are shrunk/obfuscated** (R8/ProGuard `minifyEnabled true`). | Read the release build config. | The setting shown. | warning |
| MOB-3 | **`debuggable=false`; internal components are `exported=false`; backups reviewed.** | Read the manifest. | Manifest values shown. | warning |
| MOB-4 | **Cleartext (plain HTTP) traffic is blocked.** | Read network-security config / target SDK. | Config shown. | warning |
| MOB-5 | **Sensitive data uses Keystore / EncryptedSharedPreferences**, not plain prefs/SQLite/external storage. | Find where secrets/tokens are stored. | Secure store shown. | error |
| MOB-6 | **Only the permissions it truly needs** are in the manifest. | Read requested permissions. | Minimal list justified. | warning |
| MOB-7 | **The device holds tokens, not passwords; the server re-checks everything.** | Trace on-device auth. | Token-based flow shown. | warning |
| MOB-8 | **The signing keystore is backed up offline; there's an update path.** | Human confirms. | Human confirmation, dated. | warning |

### FIRE — Firebase backend

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| FIRE-1 | **Firestore/Storage security rules are reviewed and NOT default-open** (the #1 Firebase breach). | Read `firestore.rules` / `storage.rules`. | Rules shown restricting access per user. | error |
| FIRE-2 | **The client API key is restricted** (app/domain restrictions in Google Cloud). | Human confirms restriction in console. | Human confirmation. | warning |
| FIRE-3 | **App Check is on** (blocks requests from outside your real app). | Human confirms / check init. | Evidence App Check is enabled. | warning |

### VPS — a server you rent (public VPS)

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| VPS-1 | **SSH is key-only and root login is OFF; you log in as a normal sudo user.** | Read `sshd_config` (or human confirms): `PasswordAuthentication no`, `PermitRootLogin no`. | The config lines shown. | error |
| VPS-2 | **Firewall default-denies inbound; only 22/80/443 open; databases not public.** | Check ufw/nftables + listening ports. | Firewall rules + port list. | error |
| VPS-3 | **fail2ban (or similar) bans repeated failures.** | Check it's installed/running. | Service status shown. | warning |
| VPS-4 | **Security updates install automatically** (unattended-upgrades); reboots watched. | Check the setting. | Config shown. | warning |
| VPS-5 | **Services run as unprivileged users under systemd**, not root. | Read the unit files. | `User=` (non-root) shown. | warning |
| VPS-6 | **Offsite backups exist AND a restore was actually tested.** | Human confirms a real restore. | Human confirmation, dated. | warning |
| VPS-7 | **Provider account has 2FA; snapshot taken before risky changes.** | Human confirms. | Human confirmation. | warning |

### LOCAL — local-only tool (desktop/CLI on your machine)

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| LOCAL-1 | **A local server checks the `Host`/`Origin` header** (stops a website you visit from poking `localhost`). | Read the request guard. | The guard shown (file:line). | warning |
| LOCAL-2 | **No secrets written to logs, temp files, or command arguments.** | Grep logging/temp paths for secret handling. | Clean scan. | warning |
| LOCAL-3 | **File-path inputs are sanitized against `../` traversal**, even in personal tools. | Find path handling. | Sanitization shown. | warning |
| LOCAL-4 | **No unpinned remote code** (`npx thing@latest` in scripts runs whatever ships today). | Grep scripts for unpinned `npx`/remote fetch-execute. | Pinned or absent. | warning |

### PUB — published / public code (open-source repo)

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| PUB-1 | **Full git HISTORY is clean of secrets**, not just the current files (a key deleted later is still public). | Scan history for key-shaped strings. | History scan output (redacted). | error |
| PUB-2 | **Publishing tokens are hardened** (npm granular tokens with expiry; scoped GitHub PATs). | Human confirms token setup. | Human confirmation. | warning |
| PUB-3 | **No personal paths, IPs, or internal hostnames in the public copy.** | Grep for home paths, IPs, internal names. | Clean scan. | warning |

### DEV — the development environment itself (you + your AI agents)

This pack matters because you run AI agents that execute shell commands. Here the **agent and this machine are
the attack surface**, not just the app you ship.

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| DEV-1 | **No agent runs in full-access mode** (`--dangerously-skip-permissions`, Codex `--yolo`/`danger-full-access`, Cursor "run everything"). | Grep configs/scripts for those flags. | Clean scan. | error |
| DEV-2 | **Agent shell runs in an OS sandbox** (filesystem + network isolation). | Check sandbox settings where the platform supports it. | Sandbox setting shown or documented. | warning |
| DEV-3 | **Agent network is default-deny with a domain allowlist**; `curl`/`wget` are never blanket auto-approved. | Read permission/allowlists. | Allowlist + no blanket fetch approval. | error |
| DEV-4 | **The agent can't edit its own config, hooks, or allowlists** (`.claude`, `.codex`, `.agents` kept protected). | Check protection of config paths. | Protection shown. | error |
| DEV-5 | **An ignore-file keeps `.env*` and key files out of agent context.** | Read `.cursorignore`/equivalent. | The ignore entries shown. | warning |
| DEV-6 | **Orchestrators strip secrets before the agent phase runs** (inject only during setup). | Read the orchestrator's secret flow. | Strip step shown. | warning |
| DEV-7 | **MCP servers are vetted and allowlisted** (self-written or reviewed; checked into source). | List MCP servers in use. | The allowlist shown. | warning |
| DEV-8 | **Untrusted web content is never piped straight into the agent**; hot-reload is off during agent sessions. | Read fetch handling + dev-server config. | Safe handling shown. | warning |
| DEV-9 | **AI training opt-out / privacy mode is ON in every AI tool**, and retention windows are known. | Human confirms each tool's setting. | Human confirmation, dated. | warning |
| DEV-10 | **Agent activity is logged** so you can reconstruct what it did after an incident. | Check logging is on. | Log location shown. | warning |

### ELEC — Electron desktop app

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| ELEC-1 | **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`** on every window. | Read `webPreferences`. | The settings shown. | error |
| ELEC-2 | **`ipcMain.handle` validates the sender / channel**; no blanket bridge. | Read IPC handlers. | Validation shown. | error |
| ELEC-3 | **`shell.openExternal` never takes raw user input.** | Grep for `openExternal`. | Safe usage shown. | warning |
| ELEC-4 | **A CSP is set; the autoUpdater feed is signed/HTTPS.** | Read CSP + updater config. | Both shown. | warning |

### EXT — browser extension (Chrome MV3)

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| EXT-1 | **Minimal `permissions` and `host_permissions`.** | Read the manifest. | Minimal list justified. | warning |
| EXT-2 | **No remotely-hosted code** (MV3 forbids it — all code shipped in the package). | Grep for remote script loads. | Clean scan. | error |
| EXT-3 | **`externally_connectable` is locked down; message origins are validated.** | Read manifest + message handlers. | Lockdown + origin checks shown. | warning |

### SSH — SSH / desktop credential handling (apps that connect to servers)

| ID | Rule | Test | Green needs | Enforce |
| --- | --- | --- | --- | --- |
| SSH-1 | **Host-key verification is ON** (no `StrictHostKeyChecking=no`; `known_hosts` kept) — stops man-in-the-middle. | Grep for disabled host-key checks. | No disabled check, or a documented, accepted reason. | error |
| SSH-2 | **Private keys/passphrases live in the OS keystore**, not plaintext config, and aren't persisted needlessly. | Find where creds are stored. | Secure storage shown. | error |
| SSH-3 | **No surprise agent-forwarding**; downloaded installers are hash/signature-checked before elevated runs. | Read the connection + install code. | Checks shown. | warning |

---

## Cross-cutting must-haves (not tied to one project)

| ID | Rule | What it means | Cadence |
| --- | --- | --- | --- |
| X-1 | **Incident-response runbook exists** | The one-pager below is filled in and you've read it. | Reviewed twice a year |
| X-2 | **Quarterly dead-credential sweep** | List every token/key/OAuth grant/deploy key across projects; revoke anything you don't use. | Quarterly |
| X-3 | **Third-party register per project** | Each project lists the outside services it trusts and why (this is SEC-12, rolled up). | Monthly |
| X-4 | **This rulebook is current** | It was reviewed/updated in the last 6 months. | Every 6 months |

---

## Incident Response runbook (what to do when something goes red)

Keep this short and follow it in order. Don't skip the rotate step to "look
around first" — rotate first, investigate second.

**A key or secret leaked (committed, pasted, or shown somewhere public):**
1. **Rotate it now** — make a new key in the provider dashboard, put the new one
   in `.env`, delete the old key so it stops working. (Rotating beats deleting the
   commit — assume it was already copied.)
2. Remove the secret from the file and from git history if the repo is/was public.
3. Check the provider's logs for any use you didn't make.
4. Write one line in the activity log: what leaked, when, what you rotated.

**An account looks compromised (GitHub, email, cloud, Vercel):**
1. Change the password and confirm 2FA/passkey is on.
2. Revoke active sessions and any tokens/OAuth apps you don't recognize.
3. Check recent activity (logins, new deploys, new repos, sent mail).
4. Rotate any keys that account could reach.

**A dependency looks malicious (weird postinstall, unexpected network, worm news):**
1. Stop — don't run installs or the app.
2. Pin back to a known-good version in the lockfile; delete `node_modules` and reinstall clean.
3. Rotate any secret the machine had while the bad package could run.
4. Check other projects using the same package.

**After any incident:** run `/security-audit` on the affected project to confirm
it's clean, and note what rule would have caught it earlier (then strengthen it).

---

## When unsure

If a check can't be proven, it is **not green** — mark it yellow (a judgment
call) or gray (couldn't verify), and say why. A rule painted green without
evidence is worse than a red, because it hides a hole behind a false "all clear."

*Rulebook established 2026-07-07 (foundation v2). Rule IDs are stable — never
reuse a retired ID. Rows are added and edited over time via conversation and the
ICM Protocols Security page.*
