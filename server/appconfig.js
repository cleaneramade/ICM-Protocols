// Small app-level settings (e.g. the Brandfetch logo client ID).
import fs from 'node:fs/promises';
import { PATHS } from './config.js';
import { backupThenAtomicWrite } from './fsio.js';

export async function getConfig() {
  try { return JSON.parse(await fs.readFile(PATHS.appConfig, 'utf8')); }
  catch { return {}; }
}

export async function putConfig(patch) {
  const next = { ...(await getConfig()), ...(patch || {}) };
  await backupThenAtomicWrite(PATHS.appConfig, JSON.stringify(next, null, 2) + '\n', {});
  return next;
}
