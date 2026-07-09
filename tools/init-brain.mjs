// One-command setup: builds the standard ICM Protocols folder layout with
// starter files, so a brand-new user is running in seconds. Safe to run any
// time — it NEVER overwrites a file that already exists, it only fills gaps.
// Run: node tools/init-brain.mjs
// Paths come from data/app-config.json / ICM_* env vars, or home-dir defaults
// (see server/config.js).
import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS, APP_ROOT } from '../server/config.js';

const TEMPLATE = path.join(APP_ROOT, 'template');

// [template file, destination] — the files the app needs to operate.
const FILES = [
  [path.join(TEMPLATE, 'brain', '00_system', 'APPROVAL_POLICY.md'), PATHS.policy],
  [path.join(TEMPLATE, 'brain', '00_system', 'SECURITY_PROTOCOLS.md'), PATHS.securityPolicy],
  [path.join(TEMPLATE, 'brain', '06_logs', 'ACTIVITY_LOG.md'), PATHS.activityLog],
  [path.join(TEMPLATE, 'brain', '06_logs', 'MEMORY_CHANGES.md'), PATHS.memoryChanges],
  [path.join(TEMPLATE, 'profiles', 'prototype.settings.json'), path.join(PATHS.profilesDir, 'prototype.settings.json')],
  [path.join(TEMPLATE, 'profiles', 'production.settings.json'), path.join(PATHS.profilesDir, 'production.settings.json')],
  [path.join(TEMPLATE, 'profiles', 'client-work.settings.json'), path.join(PATHS.profilesDir, 'client-work.settings.json')],
];

// Extra folders the panel expects to exist.
const DIRS = [
  path.join(PATHS.brain, '01_memory'),
  PATHS.retiredSkills,
  PATHS.skillsDir,
  ...PATHS.scanRoots,
];

const exists = (p) => fs.access(p).then(() => true).catch(() => false);

let created = 0, skipped = 0;
for (const [src, dest] of FILES) {
  if (await exists(dest)) { skipped++; console.log('keep    ' + dest); continue; }
  if (!(await exists(src))) { console.log('missing template: ' + src); continue; }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  created++;
  console.log('create  ' + dest);
}
for (const dir of DIRS) {
  await fs.mkdir(dir, { recursive: true });
}

// Bundled skills (e.g. /security-audit — it writes the reports the Security
// page shows). Installed only when the user doesn't already have that skill,
// so an existing installation is never modified. paths.json tells the skill's
// scripts where this app and the brain live on this machine.
const skillsTemplate = path.join(TEMPLATE, 'skills');
let skillsInstalled = 0;
for (const name of await fs.readdir(skillsTemplate).catch(() => [])) {
  const src = path.join(skillsTemplate, name);
  const dest = path.join(PATHS.skillsDir, name);
  if (await exists(path.join(dest, 'SKILL.md'))) { console.log('keep    ' + dest); continue; }
  await fs.cp(src, dest, { recursive: true });
  await fs.writeFile(path.join(dest, 'paths.json'),
    JSON.stringify({ icmRoot: APP_ROOT, brainRoot: PATHS.brain }, null, 2) + '\n');
  skillsInstalled++;
  console.log('create  ' + dest + '  (skill /' + name + ')');
}

console.log('');
console.log(created ? `Done — ${created} file(s) created, ${skipped} kept as-is.` : 'Everything was already in place — nothing changed.');
if (skillsInstalled) console.log(`Installed ${skillsInstalled} skill(s) — available in your AI's NEXT session.`);
console.log('Start the panel with: node server.js');
