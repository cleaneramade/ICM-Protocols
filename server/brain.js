// Brain file editor: tree of .md files, read, and guarded save.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from './config.js';
import { readFileTracked, backupThenAtomicWrite } from './fsio.js';
import { httpError } from './router.js';
import { logActivity } from './logbook.js';

async function walk(dir, rel = '') {
  const out = [];
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      const children = await walk(path.join(dir, e.name), r);
      out.push({ type: 'dir', name: e.name, rel: r, children });
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push({ type: 'file', name: e.name, rel: r, system: r.startsWith('00_system/') });
    }
  }
  return out;
}

export async function brainTree() {
  return walk(PATHS.brain);
}

// Resolve a brain-relative path to an absolute one and classify it from the
// RESOLVED location — never the raw input string. Deriving the 00_system flag
// from the input let `x/../00_system/…` (or `00_System/…` on a case-insensitive
// FS) skip the confirm guard while still resolving to a real policy file.
// A realpath check also stops a symlink inside the brain from escaping it.
async function resolveBrainPath(rel) {
  if (!rel || !/\.md$/i.test(rel)) throw httpError(400, 'BAD_PATH', 'Only .md files inside the brain');
  const abs = path.resolve(PATHS.brain, rel);
  if (abs !== PATHS.brain && !abs.startsWith(PATHS.brain + path.sep)) throw httpError(400, 'BAD_PATH', 'Path escapes the brain');
  const brainReal = await fs.realpath(PATHS.brain).catch(() => PATHS.brain);
  let real = abs;
  try { real = await fs.realpath(abs); } catch { /* new/unknown file — lexical check above stands */ }
  if (real !== brainReal && !real.startsWith(brainReal + path.sep)) throw httpError(400, 'BAD_PATH', 'Path escapes the brain');
  const relFromBrain = path.relative(brainReal, real).replace(/\\/g, '/');
  const isSystem = relFromBrain.toLowerCase().startsWith('00_system/');
  return { abs, relFromBrain, isSystem };
}

export async function getBrainFile(rel) {
  const { abs, isSystem } = await resolveBrainPath(rel);
  const t = await readFileTracked(abs).catch(() => { throw httpError(404, 'NOT_FOUND', `${rel} not found`); });
  return { raw: t.text, baseHash: t.hash, system: isSystem };
}

export async function putBrainFile(rel, raw, baseHash, confirmSystem) {
  const { abs, relFromBrain, isSystem } = await resolveBrainPath(rel);
  if (isSystem && confirmSystem !== true) {
    throw httpError(403, 'CONFIRM_REQUIRED', 'This is a 00_system policy file — the save must be explicitly confirmed');
  }
  const t = await readFileTracked(abs).catch(() => { throw httpError(404, 'NOT_FOUND', `${rel} not found`); });
  const newHash = await backupThenAtomicWrite(abs, String(raw).replace(/\r\n/g, '\n'), {
    bom: t.bom, eol: t.eol, expectedHash: baseHash || t.hash,
  });
  await logActivity('update', `Brain/${relFromBrain}`, isSystem ? 'system file edited via Protocols UI (confirmed)' : 'edited via Protocols UI').catch(() => {});
  return { newHash };
}
