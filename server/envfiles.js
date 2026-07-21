// Env manager: scan for Plutus projects, read/write their .env* files.
// Values are NEVER logged anywhere on the server.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from './config.js';
import { readFileTracked, backupThenAtomicWrite, backupThenDelete } from './fsio.js';
import { httpError } from './router.js';

const ENV_FILE_RE = /^\.env(\.[\w.-]+)?$/;
// Every named KEY=value line counts — the UI lists them all (values masked),
// so the badge must match what the list shows (client: public/js/views/env.js).
const KEY_LINE = /^\s*[A-Za-z_][\w.-]*\s*=/;

// Blank every value so no real secret ever reaches the browser. Key names,
// comments, and blank lines are preserved so the UI can still render structure.
// FAIL-CLOSED: any line we don't positively recognize as a comment or a
// key=value assignment is blanked entirely — never passed through. Otherwise
// `export KEY=secret`, a multi-line PEM value's continuation lines, or any
// unusual syntax would leak verbatim (and this output crosses the preview
// tunnel and the password-locked panel, see server.js redact path).
export function redactRaw(raw) {
  // `closer`, when set, means we're inside a multi-line value (an unterminated
  // quoted string or a PEM -----BEGIN block); every line until it closes is
  // blanked. Without this, a base64 continuation line ending in '=' padding
  // (e.g. "kg0X8f5t3w0abc==") would be mis-read as a KEY=value and a fragment
  // of the key bytes would leak — the per-line match alone is not fail-closed.
  let closer = null;
  return String(raw).split('\n').map((line) => {
    if (closer) {
      const done = closer instanceof RegExp ? closer.test(line) : line.includes(closer);
      if (done) closer = null;
      return '';                                             // continuation line — always blank
    }
    if (/^\s*(#|$)/.test(line)) return line;                 // comment or blank — no value
    const m = REDACT_KEY.exec(line);                         // KEY= or `export KEY=` → keep name+=, drop value
    if (!m) return '';                                        // unrecognized → blank, never leak
    const value = line.slice(m[1].length);
    // Does the value OPEN a multi-line block that doesn't close on this line?
    const q = value.match(/^\s*(["'])/);
    if (q && value.indexOf(q[1], value.indexOf(q[1]) + 1) === -1) closer = q[1];
    else if (/-----BEGIN/.test(value) && !/-----END/.test(value)) closer = /-----END/;
    return m[1];                                              // keep the key name + '=', drop the value
  }).join('\n');
}
// Matches an assignment's "prefix through the = sign" (optionally `export `),
// capturing it so the value after = can be dropped.
const REDACT_KEY = /^(\s*(?:export\s+)?[A-Za-z_][\w.-]*\s*=)/;

// Count the keys in one env file. Reads the file (allowed) but returns only
// a number — never any value.
async function countKeysIn(dir, file) {
  try {
    const raw = await fs.readFile(path.join(dir, file), 'utf8');
    return raw.split('\n').filter((l) => KEY_LINE.test(l)).length;
  } catch { return 0; }
}

// The file the UI opens first: the one with the MOST keys. A recovered or
// stub .env.development with zero keys must never hide a full .env next to
// it. Ties break on the conventional order (.env, .env.local, then the rest;
// .env.example last — it's a names-only template).
function pickPrimary(files, counts) {
  const rank = (f) => (f === '.env' ? 0 : f === '.env.local' ? 1 : f === '.env.example' ? 3 : 2);
  const sorted = [...files].sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || rank(a) - rank(b));
  return sorted[0] || null;
}

export async function listProjects() {
  const seen = new Set();
  const projects = [];
  for (const root of PATHS.scanRoots) {
    let entries = [];
    try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      if (seen.has(dir)) continue;
      const hasPlutus = await fs.access(path.join(dir, 'PLUTUS.md')).then(() => true).catch(() => false);
      if (!hasPlutus) continue;
      seen.add(dir);
      let files = [];
      try {
        files = (await fs.readdir(dir)).filter((f) => ENV_FILE_RE.test(f)).sort();
      } catch { /* ignore */ }
      const keyCounts = {};
      for (const f of files) keyCounts[f] = await countKeysIn(dir, f);
      const primary = pickPrimary(files, keyCounts);
      projects.push({ name: e.name, path: dir, envFiles: files, keyCounts, primary, keyCount: primary ? keyCounts[primary] : 0 });
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

// Folders sitting directly under a scan root that are NOT yet Plutus projects —
// the candidates for "Add project" in the Secrets view. Dot-folders and the
// Plutus OS root itself are never offered.
export async function listCandidateFolders() {
  const plutusReal = await fs.realpath(PATHS.plutusRoot).catch(() => path.resolve(PATHS.plutusRoot));
  const seen = new Set();
  const out = [];
  for (const root of PATHS.scanRoots) {
    let entries = [];
    try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir = path.join(root, e.name);
      if (seen.has(dir)) continue;
      seen.add(dir);
      const real = await fs.realpath(dir).catch(() => dir);
      if (real === plutusReal) continue;
      const hasPlutus = await fs.access(path.join(dir, 'PLUTUS.md')).then(() => true).catch(() => false);
      if (!hasPlutus) out.push({ name: e.name, path: dir });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Link an existing folder as a Plutus project by writing the PLUTUS.md marker.
// If the marker is already there, nothing is written — the caller just routes
// to the existing group. Never creates folders; the folder must already exist
// directly under a scan root (same depth-1 rule the scanner uses).
export async function linkProject(projectPath) {
  if (!projectPath || !String(projectPath).trim()) throw httpError(400, 'BAD_PROJECT', 'No folder specified');
  let norm;
  try { norm = await fs.realpath(path.resolve(projectPath)); }
  catch { throw httpError(400, 'BAD_PROJECT', 'That folder doesn’t exist'); }
  const roots = await Promise.all(PATHS.scanRoots.map((r) => fs.realpath(r).catch(() => path.resolve(r))));
  if (!roots.includes(path.dirname(norm))) throw httpError(400, 'BAD_PROJECT', 'The folder must sit directly inside a scan root');
  const plutusReal = await fs.realpath(PATHS.plutusRoot).catch(() => path.resolve(PATHS.plutusRoot));
  if (norm === plutusReal) throw httpError(400, 'BAD_PROJECT', 'The Plutus OS folder itself can’t be a project');
  const marker = path.join(norm, 'PLUTUS.md');
  if (await fs.access(marker).then(() => true).catch(() => false)) {
    return { path: norm, name: path.basename(norm), alreadyLinked: true };
  }
  const stub = [
    '# Plutus OS — linked project',
    '',
    'This folder was linked to the ICM protocols from the Protocols UI so its',
    'secrets can be managed there. Run `/plutus` in this project to complete the',
    'full foundation setup (rules, profiles, design system). This file is',
    'regenerated by `/plutus` — don’t hand-edit.',
    '',
  ].join('\n');
  await backupThenAtomicWrite(marker, stub, {});
  return { path: norm, name: path.basename(norm), alreadyLinked: false };
}

// Validate a project path is a real Plutus project inside our scan roots.
async function resolveProjectDir(projectPath) {
  // Reject an empty path — path.resolve('') is the CWD, which would silently
  // target this app's own folder. A project must always be named explicitly.
  if (!projectPath || !String(projectPath).trim()) throw httpError(400, 'BAD_PROJECT', 'No project specified');
  // Resolve symlinks before the containment check: a lexical-only check lets a
  // symlink placed inside a scan root point at .env files anywhere on disk.
  let norm;
  try { norm = await fs.realpath(path.resolve(projectPath)); }
  catch { throw httpError(400, 'BAD_PROJECT', 'Project folder not found'); }
  const roots = await Promise.all(PATHS.scanRoots.map((r) => fs.realpath(r).catch(() => path.resolve(r))));
  const inRoot = roots.some((r) => norm === r || norm.startsWith(r + path.sep));
  if (!inRoot) throw httpError(400, 'BAD_PROJECT', 'Project is outside the scan roots');
  const hasPlutus = await fs.access(path.join(norm, 'PLUTUS.md')).then(() => true).catch(() => false);
  if (!hasPlutus) throw httpError(400, 'BAD_PROJECT', 'Not a Plutus project folder');
  return norm;
}

async function resolveEnvPath(projectPath, file) {
  if (!ENV_FILE_RE.test(file || '')) throw httpError(400, 'BAD_FILE', 'Not an .env file name');
  return path.join(await resolveProjectDir(projectPath), file);
}

// Delete a project's real .env secret files. Secret files are never copied to
// .backups (fsio no-plaintext-at-rest rule), so this is NOT recoverable.
// .env.example is a non-secret template and is intentionally left in place.
export async function deleteProjectSecrets(projectPath) {
  const dir = await resolveProjectDir(projectPath);
  let files = [];
  try { files = (await fs.readdir(dir)).filter((f) => ENV_FILE_RE.test(f) && f !== '.env.example'); } catch { /* ignore */ }
  const deleted = [];
  for (const f of files) {
    const removed = await backupThenDelete(path.join(dir, f));
    if (removed) deleted.push(f);
  }
  return { deleted };
}

export async function getEnv(projectPath, file) {
  const abs = await resolveEnvPath(projectPath, file);
  const t = await readFileTracked(abs).catch(() => { throw httpError(404, 'NOT_FOUND', `${file} not found in that project`); });
  return { raw: t.text, baseHash: t.hash, bom: t.bom, eol: t.eol };
}

export async function putEnv(projectPath, file, raw, baseHash) {
  const abs = await resolveEnvPath(projectPath, file);
  const t = await readFileTracked(abs).catch(() => null);
  const newHash = await backupThenAtomicWrite(abs, String(raw).replace(/\r\n/g, '\n'), {
    bom: t ? t.bom : false,
    eol: t ? t.eol : '\n',
    expectedHash: t ? (baseHash || t.hash) : null,
  });
  return { newHash };
}
