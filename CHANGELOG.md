# Changelog

All notable changes to ICM Protocols. Dates are YYYY-MM-DD. This project aims
to follow [Semantic Versioning](https://semver.org): security fixes and bug
fixes in patch/minor releases, breaking changes in majors.

## [1.2.0] — 2026-07-21

A Secrets overhaul. Every key is visible, deletes can't miss, the browser's
password manager stays out, projects with several env files show them all —
and the server keeps itself up to date.

### Added
- **Add a project from the Secrets page.** A dashed "Add project" button lists
  folders in your project roots that aren't linked yet. Pick one and it gets
  its own Secrets group (just the `PLUTUS.md` marker — no secrets are ever
  created for you). A folder that's already linked simply opens instead of
  being added twice.
- **File tabs.** A project with several env files gets one tab per file, each
  with its key count, so no file (and no key) is ever hidden.
- **Search when the list grows.** With more than 8 projects, a search box
  appears above the Secrets list, so the page stays quick with tons of
  projects.
- **Tests for the secrets engine** (`tests/envfiles.test.js`) — redaction,
  key counting, saving, linking, and path safety.

### Fixed
- **Deleting a key can never remove the wrong one.** Each delete re-finds its
  exact line at click time instead of trusting a remembered line number, and
  it writes only the deletion — unsaved edits to other rows stay in the
  editor until you press Save.
- **Every key in the file is listed.** The page used to hide keys whose names
  didn't look secret (like `DATABASE_URL`), which could block adding a
  "duplicate" you couldn't see. All keys now show, values masked.
- **A project's keys can no longer hide behind an empty env file.** The page
  opens the file with the most keys instead of a fixed favorite, so an empty
  `.env.development` can't blank out a project whose keys live in `.env`.
- **A cleared key name can't corrupt the file.** The row stays visible and
  Save refuses until the key is named or deleted.
- **Honest delete warnings.** Secret files are never copied to backups, so
  dialogs no longer promise a restorable backup.

### Changed
- **No more "Save password?" pop-ups.** Secret values and the password dialogs
  are masked by CSS instead of real password fields, so the browser's password
  manager never offers to save them.
- **Permission changes now prompt.** All three project profiles ask before any
  edit inside a project's `.claude/` folder — permission changes happen only
  on your request plus your confirmation.
- **The server keeps itself current.** `npm start` runs `node --watch`, so
  code updates restart the app automatically — the UI can never call routes
  an old process doesn't have.

### Removed
- Dead code: two unused UI components (dropdown, segmented control) and their
  styles, plus two orphaned CSS classes.

## [1.1.0] — 2026-07-15

A reliability and security release. Every change below is backward-compatible —
your rules, connections, secrets, and memory carry over untouched. If you're on
v1.0.0, just pull the new code; there's nothing to migrate.

### Added
- **Connections: add, remove, and choose a logo source.** You can now add a new
  connected app, remove one, and set the logo source right from the Connections
  page. A new connection starts on the safe default it always promised — Read
  allowed, Write asks first, Full access blocked.
- **`docs/DATA-MAP.md`** — a plain-words register of where data can (and can't)
  leave your machine. Short version: the server makes no outbound calls at all;
  the only ways anything leaves are the preview tunnel you start yourself and
  your own `git push`.
- **A CHANGELOG** (this file) so upgrades are easy to follow.

### Fixed
- **Rules no longer disappear when you change their color.** Moving a rule
  between Allow / Ask / Block used to drop it out of its category (it looked
  deleted). The category now travels with the rule through every move, delete,
  and restore.
- **Saving a connection stays on the Connections page.** A leftover background
  refresh could repaint the Rules board over the top of Connections right after
  you saved. Each page is now isolated, so that can't happen.
- **Editing a brand-new rule edits the right rule.** Adding two rules and editing
  the second no longer overwrites the first.
- **The Security page count matches the project dots.** A project that passes
  everything it can check now reads green "Passing" in both the header tally and
  its own dot, instead of being counted as "needs work."
- **Escape / click-away on a confirmation now cancels cleanly** instead of
  leaving the action waiting forever.
- **A failed Secrets save no longer desyncs the screen** — nothing is committed
  until the save actually succeeds.

### Security
- **Secret redaction is now fully fail-closed.** Values are stripped before they
  ever reach the browser, and this now covers every line shape — `export KEY=…`
  lines and multi-line values like a PEM private key are blanked completely, so
  not even a fragment can slip through.
- **The phone-preview tunnel now shows only the Rules board.** When you start the
  optional Cloudflare preview, the public link can no longer reach your memory
  notes, project list, secret key names, skills, permission profiles, or audit
  reports — only the board, read-only. Writes stay blocked, values stay redacted.
- **No plaintext secret copies on disk.** Editing or deleting a project's `.env`
  no longer writes an unencrypted backup of it, and any existing ones were
  removed. Non-secret files still keep their automatic undo.
- **A malformed web address can no longer crash the panel** (a bad `%` sequence
  now returns "not found" instead of taking the server down).
- **Changing the Secrets password is rate-limited** with the same brute-force
  lockout as revealing secrets.
- **Internal endpoints hardened** against path and parameter abuse (the backups
  listing and the app-config write are now strictly scoped).

### Changed
- Version reported by the app now always matches the release (no more hard-coded
  version drift).
- The publishing recipe was hardened so local-only agent config never reaches
  the public repo.
- Removed unused/dead code; the log/notes append path no longer drops a line when
  two writes land at once; every screen was re-tested end-to-end.

## [1.0.0] — 2026-07-09

First public release. A local control panel for the rules that govern your AI
coding assistant — Rules, Connections, Skills, Secrets, Memory, Security, and
Permissions. Runs only on `127.0.0.1`, zero dependencies, nothing leaves your
machine. See the [v1.0.0 release notes](https://github.com/cleaneramade/ICM-Protocols/releases/tag/v1.0.0).

[1.1.0]: https://github.com/cleaneramade/ICM-Protocols/releases/tag/v1.1.0
[1.0.0]: https://github.com/cleaneramade/ICM-Protocols/releases/tag/v1.0.0
