// File IO discipline shared by every writer:
// read tracks BOM/EOL/hash → backup → write temp → atomic rename (with retry).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PATHS, BACKUP_KEEP } from './config.js';

const BOM = String.fromCharCode(0xfeff);

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Reads a file and captures everything needed to re-emit it byte-identically.
export async function readFileTracked(absPath) {
  const buf = await fs.readFile(absPath);
  let text = buf.toString('utf8');
  const bom = text.startsWith(BOM);
  if (bom) text = text.slice(1);
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  const eol = crlf >= lf ? '\r\n' : '\n';
  const trailingNL = /\r?\n$/.test(text);
  return { buf, text, bom, eol, trailingNL, hash: sha256(buf) };
}

// Mirrors an absolute path into the .backups tree: strip drive colon, keep folders.
function backupDirFor(absPath) {
  const noDrive = absPath.replace(/^([A-Za-z]):[\\/]/, '$1\\');
  return path.join(PATHS.backups, noDrive);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', 'T').slice(0, 23);
}

async function backupCurrent(absPath) {
  let cur;
  try { cur = await fs.readFile(absPath); } catch { return null; } // new file — nothing to back up
  const dir = backupDirFor(absPath);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, stamp() + '.bak');
  await fs.writeFile(dest, cur);
  // prune: keep newest BACKUP_KEEP (ISO names sort chronologically)
  const entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.bak')).sort();
  while (entries.length > BACKUP_KEEP) {
    const victim = entries.shift();
    await fs.unlink(path.join(dir, victim)).catch(() => {});
  }
  return dest;
}

async function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try { await fs.rename(from, to); return; }
    catch (e) {
      if (attempt >= 3) {
        // last resort: copy content over and remove temp
        const buf = await fs.readFile(from);
        await fs.writeFile(to, buf);
        await fs.unlink(from).catch(() => {});
        return;
      }
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
}

// Per-path write serialization. Without it, two concurrent PUTs carrying the
// same baseHash both pass the expectedHash check (the compare-then-write straddles
// several awaits) and both commit — the second silently clobbers the first.
// Running same-path writes one at a time means the second re-reads the just-changed
// hash and correctly 409s instead of losing the first write.
const writeChains = new Map();
function serialize(key, task) {
  const prev = writeChains.get(key) || Promise.resolve();
  const run = prev.then(task, task); // run regardless of the previous task's outcome
  const guarded = run.catch(() => {}); // keep the chain from rejecting for the next waiter
  writeChains.set(key, guarded);
  guarded.then(() => { if (writeChains.get(key) === guarded) writeChains.delete(key); });
  return run;
}

// text: logical text WITHOUT BOM, with '\n' line endings.
// opts: { bom, eol, trailingNL, expectedHash } — style flags usually from readFileTracked.
export async function backupThenAtomicWrite(absPath, text, opts = {}) {
  return serialize(path.resolve(absPath), () => atomicWriteInner(absPath, text, opts));
}

async function atomicWriteInner(absPath, text, opts = {}) {
  const { bom = false, eol = '\n', expectedHash = null } = opts;
  if (expectedHash) {
    let curHash = null;
    try { curHash = sha256(await fs.readFile(absPath)); } catch { /* new file */ }
    if (curHash && curHash !== expectedHash) {
      const e = new Error('File changed on disk since it was loaded — reload before saving.');
      e.httpStatus = 409;
      e.code = 'STALE';
      throw e;
    }
  }
  await backupCurrent(absPath);
  let out = text;
  if (eol === '\r\n') out = out.replace(/\r?\n/g, '\r\n');
  if (bom) out = BOM + out;
  const buf = Buffer.from(out, 'utf8');
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = absPath + '.icm-tmp';
  await fs.writeFile(tmp, buf);
  await renameWithRetry(tmp, absPath);
  return sha256(buf);
}

// Back up a file to .backups, then delete it. Recoverable from the backup copy.
// No-op (returns false) if the file doesn't exist.
export async function backupThenDelete(absPath) {
  const backedUp = await backupCurrent(absPath);
  if (!backedUp) return false; // nothing there
  await fs.unlink(absPath).catch((e) => { if (e.code !== 'ENOENT') throw e; });
  return true;
}

// Append a block to a log file, preserving its BOM/EOL style.
export async function appendTracked(absPath, blockText) {
  const t = await readFileTracked(absPath);
  let text = t.text.replace(/\r\n/g, '\n');
  if (!text.endsWith('\n')) text += '\n';
  text += blockText.endsWith('\n') ? blockText : blockText + '\n';
  return backupThenAtomicWrite(absPath, text, { bom: t.bom, eol: t.eol, expectedHash: t.hash });
}

export async function listBackups(absPath) {
  const dir = backupDirFor(absPath);
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith('.bak')).sort().reverse();
  } catch { return []; }
}
