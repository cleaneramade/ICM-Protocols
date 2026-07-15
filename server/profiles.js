// Permission profile viewer/editor. production also refreshes the
// claude-template settings.json copy (it is defined as "production's copy").
import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS, PROFILE_NAMES } from './config.js';
import { readFileTracked, backupThenAtomicWrite } from './fsio.js';
import { httpError } from './router.js';
import { logActivity } from './logbook.js';

function profilePath(name) {
  if (!PROFILE_NAMES.includes(name)) throw httpError(404, 'NOT_FOUND', `Unknown profile ${name}`);
  return path.join(PATHS.profilesDir, `${name}.settings.json`);
}

export async function listProfiles() {
  const out = [];
  for (const name of PROFILE_NAMES) {
    const p = profilePath(name);
    try {
      const t = await readFileTracked(p);
      out.push({ name, path: p, json: JSON.parse(t.text), baseHash: t.hash });
    } catch (e) {
      out.push({ name, path: p, error: e.message });
    }
  }
  return out;
}

function validateProfile(json) {
  if (!json || typeof json !== 'object') throw httpError(400, 'BAD_PROFILE', 'Profile must be a JSON object');
  const p = json.permissions;
  if (!p || typeof p !== 'object') throw httpError(400, 'BAD_PROFILE', 'Missing permissions block');
  for (const key of ['allow', 'ask', 'deny']) {
    if (!Array.isArray(p[key]) || p[key].some((r) => typeof r !== 'string' || !r.trim())) {
      throw httpError(400, 'BAD_PROFILE', `permissions.${key} must be an array of non-empty strings`);
    }
  }
}

export async function putProfile(name, json, baseHash) {
  const p = profilePath(name);
  validateProfile(json);
  const text = JSON.stringify(json, null, 2) + '\n';
  JSON.parse(text); // sanity
  const newHash = await backupThenAtomicWrite(p, text, { expectedHash: baseHash });
  if (name === 'production') {
    const templateCopy = path.join(path.dirname(PATHS.profilesDir), 'settings.json');
    await backupThenAtomicWrite(templateCopy, text, {}).catch(() => {});
  }
  await logActivity('update', `Project Standards/claude-template/profiles/${name}.settings.json`, 'edited via Protocols UI').catch(() => {});
  return { newHash };
}
