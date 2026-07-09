// Env manager: scan for Plutus projects, read/write their .env* files.
// Values are NEVER logged anywhere on the server.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from './config.js';
import { readFileTracked, backupThenAtomicWrite, backupThenDelete } from './fsio.js';
import { httpError } from './router.js';

const ENV_FILE_RE = /^\.env(\.[\w.-]+)?$/;
const KEY_LINE = /^(\s*)([A-Za-z_][\w.-]*)(\s*=)(.*)$/;
// Keep in sync with the client's SECRET_RE (public/js/views/env.js).
const SECRET_RE = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL|PRIVATE|BEARER|JWT|OAUTH|API|SIGN|WEBHOOK|SALT|CERT|ACCESS)/i;
const isSecretKey = (name) => SECRET_RE.test(name);

// Blank every value so no real secret ever reaches the browser. Key names,
// comments, and blank lines are preserved so the UI can still render structure.
export function redactRaw(raw) {
  return String(raw).split('\n').map((line) => {
    const m = KEY_LINE.exec(line);
    return m ? `${m[1]}${m[2]}${m[3]}` : line;
  }).join('\n');
}

// The single .env the UI manages for a project (prefer .env, then .env.local…).
function primaryEnvFile(files) {
  if (files.includes('.env')) return '.env';
  if (files.includes('.env.local')) return '.env.local';
  return files.find((f) => f !== '.env.example') || files[0] || null;
}

// Count secret/API keys in a project's primary file. Reads the file (allowed)
// but returns only a number — never any value.
async function countSecretKeys(dir, files) {
  const f = primaryEnvFile(files);
  if (!f) return 0;
  try {
    const raw = await fs.readFile(path.join(dir, f), 'utf8');
    return raw.split('\n').filter((l) => { const m = /^\s*([A-Za-z_][\w.-]*)\s*=/.exec(l); return m && isSecretKey(m[1]); }).length;
  } catch { return 0; }
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
      projects.push({ name: e.name, path: dir, envFiles: files, keyCount: await countSecretKeys(dir, files) });
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
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

// Delete a project's real .env secret files (backed up first, so recoverable).
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
