# Approval Policy — the Green / Yellow / Red board

## Purpose

This file is the single source of truth for what your AI assistant may do.
Three colors, one meaning each. The ICM Protocols panel edits this file
visually; your AI reads it at the start of every session and obeys it.

## Plain-words summary

- **Green** — the AI just does it, then tells you.
- **Yellow** — the AI prepares everything, shows you, and waits for a yes.
- **Red** — the AI never does it. Only you can change that, in writing, here.

## How to read this file

Each rule has an ID that never changes and is never reused, even after the
rule is deleted. Edit rules in the ICM Protocols panel (the Rules page) —
it keeps IDs, history, and backups straight for you.

## GREEN — always allowed (act, then report)

| ID | Rule | Scope / details | Notes |
| --- | --- | --- | --- |
| G-01 | Read project files to get work done | Code, docs, configs in the project | Secrets files are covered by R-01 |
| G-02 | Run tests, builds, and local dev servers | Local machine only | Report failures honestly |
| G-03 | Make local git commits | On a branch, on this machine | Pushing is Y-01 |
| G-04 | Fix bugs and improve code inside the project | Keep changes small and explained | |

## YELLOW — ask first (prepare, show, wait for a yes)

| ID | Rule | Scope / details | Notes |
| --- | --- | --- | --- |
| Y-01 | Push code online or open a pull request | Any remote repository | Show what will be pushed |
| Y-02 | Deploy or publish anything | Hosting, app stores, package registries | Includes preview deploys |
| Y-03 | Send anything to another person or service | Email, messages, posts, webhooks | Show the exact content first |
| Y-04 | Spend money or change a paid plan | Any amount | Show the price first |
| Y-05 | Install new dependencies or tools | Project or machine | Name the package and why |

## RED — never do (only a recorded standing decision can move these)

| ID | Rule | Scope / details | Notes |
| --- | --- | --- | --- |
| R-01 | Reveal or edit secret values | .env files, keys, tokens, passwords | Reading to operate is fine; never repeat values back |
| R-02 | Destructive git actions | Force-push, delete repos or branches | |
| R-03 | Touch production data | Live databases, live user data | Dev copies are fine |
| R-04 | Make anything public | Repos, links, posts | The owner does the publishing |

## Path zones

| ID | Zone | Paths | What's allowed |
| --- | --- | --- | --- |
| Z-01 | Secrets | .env, .env.*, keys, certificates | Read to operate; never edit, never quote |
| Z-02 | Project files | Everything else in a project folder | Edit freely, within the rules above |

## Integrations — permission overlays

| ID | Integration | Read | Write | Full access |
| --- | --- | --- | --- | --- |
| I-01 | GitHub | allow | ask | block |

## When unsure

Treat it as Yellow: prepare, show, and ask. Asking twice is cheaper than
undoing once.

## Enforcement — two layers

This board is the human-readable law. The Permissions page holds the
machine-enforced allow / ask / deny lists that back it up. Keep them in
agreement — the panel helps you do that.
