// Single source of truth for every path the server touches.
// Machine-specific roots come from data/app-config.json (gitignored — see
// data/app-config.example.json) or ICM_* env vars, with home-dir defaults, so
// the app runs on any machine without editing source. Paths may contain
// non-ASCII characters (e.g. emoji folders) — always pass them to node:fs APIs
// directly, never through a shell command line.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Local machine config (optional). Shape: see data/app-config.example.json.
function readLocalConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'data', 'app-config.json'), 'utf8'));
  } catch {
    return {};
  }
}
const LOCAL = readLocalConfig();

const HOME = os.homedir();
const PLUTUS_ROOT = process.env.ICM_PLUTUS_ROOT || LOCAL.plutusRoot || path.join(HOME, 'Plutus');
const PLUTUS_OS = path.join(PLUTUS_ROOT, 'Plutus OS');
const BRAIN = path.join(PLUTUS_OS, 'Brain');
const HOME_CLAUDE = process.env.ICM_CLAUDE_DIR || LOCAL.claudeDir || path.join(HOME, '.claude');

// Folders scanned (depth 1) for Plutus projects. env var is ; separated.
const SCAN_ROOTS = (process.env.ICM_SCAN_ROOTS ? process.env.ICM_SCAN_ROOTS.split(';') : null)
  || (Array.isArray(LOCAL.scanRoots) && LOCAL.scanRoots.length ? LOCAL.scanRoots : null)
  || [path.join(PLUTUS_ROOT, 'My Projects')];

export const PATHS = {
  plutusRoot: PLUTUS_ROOT,
  brain: BRAIN,
  policy: path.join(BRAIN, '00_system', 'APPROVAL_POLICY.md'),
  securityPolicy: path.join(BRAIN, '00_system', 'SECURITY_PROTOCOLS.md'),
  activityLog: path.join(BRAIN, '06_logs', 'ACTIVITY_LOG.md'),
  memoryChanges: path.join(BRAIN, '06_logs', 'MEMORY_CHANGES.md'),
  profilesDir: path.join(PLUTUS_OS, 'Project Standards', 'claude-template', 'profiles'),
  skillsDir: path.join(HOME_CLAUDE, 'skills'),
  pluginsManifest: path.join(HOME_CLAUDE, 'plugins', 'installed_plugins.json'),
  pluginsDir: path.join(HOME_CLAUDE, 'plugins'),
  retiredSkills: path.join(PLUTUS_OS, 'Archive', 'retired-skills'),
  scanRoots: SCAN_ROOTS.map((r) => path.resolve(String(r))),
  backups: path.join(APP_ROOT, '.backups'),
  retiredIds: path.join(APP_ROOT, 'data', 'retired-ids.json'),
  ruleAccess: path.join(APP_ROOT, 'data', 'rule-access.json'),
  ruleCat: path.join(APP_ROOT, 'data', 'rule-category.json'),
  ruleIcon: path.join(APP_ROOT, 'data', 'rule-icon.json'),
  deletedRules: path.join(APP_ROOT, 'data', 'deleted-rules.json'),
  intPerms: path.join(APP_ROOT, 'data', 'integration-perms.json'),
  intLogos: path.join(APP_ROOT, 'data', 'integration-logos.json'),
  appConfig: path.join(APP_ROOT, 'data', 'app-config.json'),
  secretsLock: path.join(APP_ROOT, 'data', 'secrets-lock.json'),
  securityReports: path.join(APP_ROOT, 'data', 'security-reports'),
  securityRegistry: path.join(APP_ROOT, 'data', 'security-projects.json'),
  publicDir: path.join(APP_ROOT, 'public'),
};

export const PORT = Number(process.env.ICM_PORT) || 7717;
export const BACKUP_KEEP = 20;
export const PROFILE_NAMES = ['prototype', 'production', 'client-work'];
