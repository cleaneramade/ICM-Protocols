# ICM Protocols — System Blueprint

**If you are an AI assistant helping someone set up or run ICM Protocols:
this document is your contract. Keep the structure below EXACTLY as written —
same folders, same file names, same headings, same table columns — unless the
user explicitly asks you to change it. You fill it with THE USER'S data
(their rules, their apps, their projects). Never invent a different layout.**

Two more standing instructions:

1. **Lead the user.** Most people setting this up won't know what to allow or
   block. Don't hand them open questions — propose safe defaults, explain each
   one in one plain sentence, and let them say yes or adjust. Safe defaults:
   reading and testing is allowed; anything that leaves the machine (push,
   deploy, send, spend) asks first; secrets, force-pushes, production data,
   and going public are never.
2. **Write everything in short, plain sentences.** No jargon without a
   one-line explanation. Group related rules together, the way the starter
   files already do.

## Bootstrap

`node tools/init-brain.mjs` creates everything below from `template/` —
it never overwrites existing files. Machine locations come from
`data/app-config.json` (see `data/app-config.example.json`) or the
`ICM_PLUTUS_ROOT` / `ICM_CLAUDE_DIR` / `ICM_SCAN_ROOTS` env vars, defaulting
to `~/Plutus` and `~/.claude`.

It also installs the bundled **`/security-audit` skill** into
`<claudeDir>/skills/` (skipped entirely if the user already has one) and
writes a `paths.json` beside it so the skill's `finalize.mjs` gate knows where
this app's report store and the brain live. That skill is what writes the
reports the Security page displays.

## The layout

```
<plutusRoot>/
├─ Plutus OS/
│  ├─ Brain/
│  │  ├─ 00_system/
│  │  │  ├─ APPROVAL_POLICY.md      ← the Green/Yellow/Red board (Rules + Connections pages)
│  │  │  └─ SECURITY_PROTOCOLS.md   ← the security rulebook (Security page)
│  │  ├─ 01_memory/                 ← free-form memory notes (Memory page)
│  │  └─ 06_logs/
│  │     ├─ ACTIVITY_LOG.md         ← append-only change history
│  │     └─ MEMORY_CHANGES.md       ← append-only rule-change blocks
│  ├─ Project Standards/claude-template/profiles/
│  │  ├─ prototype.settings.json    ← loose profile (Permissions page)
│  │  ├─ production.settings.json   ← strict profile
│  │  └─ client-work.settings.json  ← strictest profile
│  ├─ Archive/retired-skills/       ← deleted skills are moved here, dated
│  └─ My Projects/                  ← default project scan root
└─ <claudeDir>/skills/<name>/SKILL.md  ← custom skills (Skills page)
```

## Format contracts (the app parses these — do not rename or restructure)

### APPROVAL_POLICY.md

Five sections are parsed by heading prefix; each holds ONE markdown table
(the first `|` block in the section). Prose around the tables is preserved
verbatim but never parsed.

| Section heading starts with | Table columns (exact) |
| --- | --- |
| `## GREEN` | `ID \| Rule \| Scope / details \| Notes` |
| `## YELLOW` | `ID \| Rule \| Scope / details \| Notes` |
| `## RED` | `ID \| Rule \| Scope / details \| Notes` |
| `## Path zones` | `ID \| Zone \| Paths \| What's allowed` |
| `## Integrations` | `ID \| Integration \| Read \| Write \| Full access` |

Rules of the board:
- IDs are `G-xx`, `Y-xx`, `R-xx`, `Z-xx`, `I-xx`. An ID is assigned once and
  **never reused**, even after deletion (retired IDs live in
  `data/retired-ids.json`).
- Integration Read/Write/Full cells hold `allow`, `ask`, or `block`.
- Edit this file through the panel (or with its write discipline: backup,
  atomic write, hash check) — not with ad-hoc scripts.

### SECURITY_PROTOCOLS.md

The rulebook the Security page scores against: `## The 12 core protocols`
table (`ID | Rule (plain words) | Test | Cadence | Green needs | Enforce`),
platform packs under `### <PACK> —` headings, and the cross-cutting table.
Rule IDs (`SEC-1`…, pack IDs like `WEB-1`…) are stable — audits reference
them across time.

### Profiles (`*.settings.json`)

```json
{ "permissions": { "allow": ["Bash(npm run *)"], "ask": [], "deny": [] } }
```
Rule syntax is the Claude Code permission format (`Tool(pattern)`). The
`_plutus` and `sandbox` blocks are panel-managed metadata — keep them.

### Skills

`<claudeDir>/skills/<kebab-name>/SKILL.md` with frontmatter
(`name`, `description`, optional `argument-hint`, `user-invocable: true`).
Deleting = move the folder to `Archive/retired-skills/<date>/`.

## App-side data (inside the repo folder, per machine)

`data/` holds panel sidecars: `rule-category.json`, `rule-icon.json`,
`rule-access.json`, `integration-perms.json`, `retired-ids.json` (tracked,
structural) and `app-config.json`, `security-reports/`,
`security-projects.json`, `secrets-lock.json` (gitignored, personal).
Integration logos resolve automatically (keyless fallbacks); a free
Brandfetch client ID pasted in the Connections page upgrades their quality —
it's stored in `data/app-config.json`, local to the machine.
