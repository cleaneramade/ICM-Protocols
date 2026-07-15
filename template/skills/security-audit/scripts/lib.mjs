// Shared helpers for the /security-audit deterministic gate.
// Pure Node standard library — no dependencies (matches the ICM zero-dep rule).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Where is the ICM Protocols app and the brain? Resolution order:
//   1. env vars (ICM_ROOT / BRAIN_ROOT) — explicit always wins
//   2. paths.json in this skill's folder — written by `node tools/init-brain.mjs`
//      when it installs this skill, pointing at the machine's real locations
//   3. home-dir defaults — the same defaults the app itself uses
const SKILL_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function fromPathsJson(key) {
  try {
    return JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'paths.json'), 'utf8'))[key] || null;
  } catch {
    return null;
  }
}
export const ICM_ROOT =
  process.env.ICM_ROOT || fromPathsJson('icmRoot') || path.join(os.homedir(), 'ICM-Protocols');
export const BRAIN_ROOT =
  process.env.BRAIN_ROOT || fromPathsJson('brainRoot') || path.join(os.homedir(), 'Plutus', 'Plutus OS', 'Brain');

export const REPORTS_DIR =
  process.env.SECURITY_REPORTS || path.join(ICM_ROOT, 'data', 'security-reports');
export const REGISTRY_FILE =
  process.env.SECURITY_REGISTRY || path.join(ICM_ROOT, 'data', 'security-projects.json');
export const RULEBOOK_FILE =
  process.env.SECURITY_RULEBOOK || path.join(BRAIN_ROOT, '00_system', 'SECURITY_PROTOCOLS.md');

export const RETENTION_KEEP = 20; // newest N per project, plus one-per-month archive

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Colon-free ISO timestamp, matching the ICM fsio.stamp() convention.
export function stamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-');
}

// A stable, filesystem-safe slug from a project's display name (basename).
export function baseSlug(name) {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\x20-\x7E]/g, '') // drop emoji / astral chars
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

// Identity is the path, not the name: two different folders with the same name
// get distinct slugs because the short path-hash suffix differs. Duplicate
// copies of the SAME project (different roots) are intentionally distinct too —
// they carry different risk.
export function slugForPath(projectPath) {
  const abs = path.resolve(projectPath);
  const base = baseSlug(path.basename(abs));
  const suffix = sha256(abs).slice(0, 6);
  return `${base}-${suffix}`;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Windows-safe write: temp file then rename, with the same retry-then-copy fallback
// the ICM fsio.js uses (fs.rename throws EPERM if the dashboard has the file open).
export function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.sec-tmp';
  fs.writeFileSync(tmp, text);
  for (let i = 0; i < 3; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (i === 2) {
        // final fallback: copy + unlink
        fs.copyFileSync(tmp, file);
        try { fs.unlinkSync(tmp); } catch {}
        return;
      }
      const wait = 50 * (i + 1);
      const until = Date.now() + wait;
      while (Date.now() < until) {} // brief spin; scripts are short-lived
    }
  }
}

// Normalize a matched snippet for fingerprinting. Strips ALL whitespace and
// lowercases so two dimensions wording the same hit slightly differently (e.g.
// "TOKEN=x" vs "TOKEN = x") still dedupe. Line numbers are deliberately NOT part
// of the fingerprint, so it stays stable across runs (suppressions/trend survive edits).
export function normalizeSnippet(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .slice(0, 200);
}

export function fingerprint(ruleId, relPath, snippet) {
  return sha256(`${ruleId}|${relPath || ''}|${normalizeSnippet(snippet)}`).slice(0, 12);
}

// Does a rule's evidence contain machine-shaped proof (not just an opinion)?
export function hasMachineEvidence(ev = {}) {
  if (ev.command && (ev.output || ev.outputDigest)) return true;
  if (ev.file && ev.excerpt) return true;
  if (ev.hash) return true;
  return false;
}

// The heart of "evidence-or-gray": turn a raw agent result into a trusted status.
// result: 'pass' | 'fail' | 'unverified'   judgment: true when the rule is a
// reasoning call the agent can't mechanically prove (rulebook says "caps at yellow").
export function resolveRule(rule) {
  const enf = rule.enforcement || 'warning';
  if (enf === 'off') return { status: 'off', rank: -1 };
  const ev = rule.evidence || {};
  const machine = hasMachineEvidence(ev);

  if (rule.result === 'pass') {
    if (machine) return { status: 'green', rank: 0 };
    if (rule.judgment && (ev.file || ev.excerpt || rule.note))
      return { status: 'yellow', rank: 1, downgradedFrom: 'green (judgment, no machine proof)' };
    return { status: 'gray', rank: enf === 'error' ? 2 : 1, downgradedFrom: 'green (no evidence)' };
  }
  if (rule.result === 'fail') {
    return enf === 'error' ? { status: 'red', rank: 3 } : { status: 'yellow', rank: 1 };
  }
  // unverified / unknown / anything else the agent couldn't establish
  return { status: 'gray', rank: enf === 'error' ? 2 : 1 };
}

const SEVERITY_RANK = { critical: 3, major: 1, minor: 0, trivial: 0, info: 0 };
export function severityRank(sev) {
  return SEVERITY_RANK[String(sev || '').toLowerCase()] ?? 0;
}

// Overall tile color = worst of all rule ranks and all (non-suppressed) finding ranks.
// 3 -> red, 1|2 -> yellow, 0 -> green. Gray (rank 2) can never be green but does not
// turn the tile red on its own (avoids red-fatigue); it shows as a separate count.
export function tileColor(maxRank) {
  if (maxRank >= 3) return 'red';
  if (maxRank >= 1) return 'yellow';
  return 'green';
}
