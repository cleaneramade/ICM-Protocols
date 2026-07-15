// Small app-level settings (e.g. the Brandfetch logo client ID).
import fs from 'node:fs/promises';
import { PATHS } from './config.js';
import { backupThenAtomicWrite } from './fsio.js';

export async function getConfig() {
  try { return JSON.parse(await fs.readFile(PATHS.appConfig, 'utf8')); }
  catch { return {}; }
}

// Only these keys may be set through the API. Without a whitelist, a caller
// could inject structural keys (plutusRoot, claudeDir, scanRoots) that config.js
// reads at startup — e.g. repointing the Secrets scanner at the whole drive.
const ALLOWED_KEYS = new Set(['brandfetchClientId']);

export async function putConfig(patch) {
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (ALLOWED_KEYS.has(k)) clean[k] = v;
  }
  const next = { ...(await getConfig()), ...clean };
  await backupThenAtomicWrite(PATHS.appConfig, JSON.stringify(next, null, 2) + '\n', {});
  return next;
}
