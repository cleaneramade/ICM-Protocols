// Skills manager: list/read/create/update/archive user skills; read-only plugin scan.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PATHS } from './config.js';
import { readFileTracked, backupThenAtomicWrite } from './fsio.js';
import { httpError } from './router.js';
import { logActivity } from './logbook.js';

// Open the OS file explorer with the skill's SKILL.md selected (Windows).
export function revealSkill(name) {
  const file = skillFile(name);
  if (process.platform === 'win32') spawn('explorer.exe', ['/select,' + file], { detached: true }).unref();
  else spawn('open', ['-R', file], { detached: true }).unref();
  return { path: file };
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function parseFrontmatter(text) {
  const t = text.replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return { frontmatter: {}, body: t };
  const end = t.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: {}, body: t };
  const fmRaw = t.slice(4, end);
  const body = t.slice(t.indexOf('\n', end + 1) + 1);
  const frontmatter = {};
  let curKey = null;
  for (const line of fmRaw.split('\n')) {
    const m = /^([A-Za-z][\w-]*):\s?(.*)$/.exec(line);
    if (m) { curKey = m[1]; frontmatter[curKey] = m[2]; }
    else if (curKey && /^\s+\S/.test(line)) frontmatter[curKey] += ' ' + line.trim();
  }
  return { frontmatter, body };
}

// Collapse to a single safe line: newlines/tabs/other control chars in a
// frontmatter value would otherwise inject new YAML keys (e.g. allowed-tools),
// letting a crafted description mint a skill that grants itself tool access.
const oneLine = (s) => String(s ?? '').replace(/[\u0000-\u001f\u2028\u2029]+/g, ' ').trim();

function renderSkillMd({ name, description, argumentHint, body }) {
  const fm = ['---', `name: ${name}`, `description: ${oneLine(description)}`];
  const hint = oneLine(argumentHint).replace(/"/g, '');
  if (hint) fm.push(`argument-hint: "${hint}"`);
  fm.push('user-invocable: true', '---', '');
  let b = (body || '').replace(/\r\n/g, '\n');
  if (b && !b.endsWith('\n')) b += '\n';
  return fm.join('\n') + b;
}

export async function listUserSkills() {
  let dirs = [];
  try { dirs = await fs.readdir(PATHS.skillsDir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const file = path.join(PATHS.skillsDir, d.name, 'SKILL.md');
    try {
      const raw = await fs.readFile(file, 'utf8');
      const { frontmatter } = parseFrontmatter(raw);
      out.push({
        folder: d.name,
        name: frontmatter.name || d.name,
        description: frontmatter.description || '',
        argumentHint: frontmatter['argument-hint'] || '',
        path: file,
      });
    } catch { /* folder without SKILL.md — skip */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

let pluginCache = { at: 0, data: null };

export async function listPluginSkills() {
  if (pluginCache.data && Date.now() - pluginCache.at < 60_000) return pluginCache.data;
  const groups = [];
  try {
    const manifest = JSON.parse(await fs.readFile(PATHS.pluginsManifest, 'utf8'));
    const plugins = manifest.plugins || manifest;
    for (const [pluginName, entries] of Object.entries(plugins)) {
      const entry = Array.isArray(entries) ? entries[0] : entries;
      const installPath = entry?.installPath;
      if (!installPath) continue;
      const skills = [];
      for (const sub of ['skills', path.join('.claude', 'skills')]) {
        const dir = path.join(installPath, sub);
        let items = [];
        try { items = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
        for (const it of items) {
          if (!it.isDirectory()) continue;
          try {
            const raw = await fs.readFile(path.join(dir, it.name, 'SKILL.md'), 'utf8');
            const { frontmatter } = parseFrontmatter(raw);
            skills.push({ name: frontmatter.name || it.name, description: (frontmatter.description || '').slice(0, 240) });
          } catch { /* skip */ }
        }
      }
      if (skills.length) groups.push({ plugin: pluginName, skills: skills.sort((a, b) => a.name.localeCompare(b.name)) });
    }
  } catch { /* plugins unavailable — degrade gracefully */ }
  pluginCache = { at: Date.now(), data: groups.sort((a, b) => a.plugin.localeCompare(b.plugin)) };
  return pluginCache.data;
}

function skillFile(name) {
  if (!NAME_RE.test(name) || name.length > 64) throw httpError(400, 'BAD_NAME', 'Skill name must be kebab-case (a-z, 0-9, dashes), max 64 chars');
  return path.join(PATHS.skillsDir, name, 'SKILL.md');
}

export async function getSkill(name) {
  const file = skillFile(name);
  const t = await readFileTracked(file).catch(() => { throw httpError(404, 'NOT_FOUND', `Skill ${name} not found`); });
  const { frontmatter, body } = parseFrontmatter(t.text);
  return { frontmatter, body, raw: t.text, baseHash: t.hash, path: file };
}

export async function createSkill({ name, description, argumentHint, body }) {
  const file = skillFile(name);
  if (!description || !String(description).trim()) throw httpError(400, 'BAD_DESC', 'Description is required');
  try { await fs.access(path.dirname(file)); throw httpError(409, 'EXISTS', `Skill ${name} already exists`); }
  catch (e) { if (e.httpStatus) throw e; /* ENOENT — good */ }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const text = renderSkillMd({ name, description: String(description).trim(), argumentHint, body });
  await backupThenAtomicWrite(file, text, {});
  await logActivity('create', `~/.claude/skills/${name}/SKILL.md`, 'created via Protocols UI').catch(() => {});
  return { path: file };
}

export async function updateSkill(name, { description, argumentHint, body, baseHash, newName }) {
  const file = skillFile(name);
  const cur = await getSkill(name);
  const renaming = newName && newName !== name;
  if (renaming) {
    skillFile(newName); // validates the new name format
    const targetDir = path.join(PATHS.skillsDir, newName);
    if (await fs.access(targetDir).then(() => true).catch(() => false)) {
      throw httpError(409, 'EXISTS', `A skill named /${newName} already exists`);
    }
  }
  const finalName = renaming ? newName : name;
  const text = renderSkillMd({
    name: finalName,
    description: String(description ?? cur.frontmatter.description ?? '').trim(),
    argumentHint: argumentHint ?? cur.frontmatter['argument-hint'] ?? '',
    body: body ?? cur.body,
  });
  const newHash = await backupThenAtomicWrite(file, text, { expectedHash: baseHash || cur.baseHash });
  if (renaming) {
    await fs.rename(path.dirname(file), path.join(PATHS.skillsDir, newName));
    await logActivity('rename', `~/.claude/skills/${name}/ → ${newName}/`, 'renamed via Protocols UI').catch(() => {});
    return { newHash, renamedTo: newName };
  }
  await logActivity('update', `~/.claude/skills/${name}/SKILL.md`, 'edited via Protocols UI').catch(() => {});
  return { newHash };
}

export async function archiveSkill(name) {
  const file = skillFile(name);
  await fs.access(file).catch(() => { throw httpError(404, 'NOT_FOUND', `Skill ${name} not found`); });
  const date = new Date().toISOString().slice(0, 10);
  let dest = path.join(PATHS.retiredSkills, date, name);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  let n = 2;
  while (await fs.access(dest).then(() => true).catch(() => false)) dest = path.join(PATHS.retiredSkills, date, `${name}-${n++}`);
  try {
    await fs.rename(path.dirname(file), dest);
  } catch {
    await fs.cp(path.dirname(file), dest, { recursive: true });
    await fs.rm(path.dirname(file), { recursive: true, force: true });
  }
  await logActivity('archive', `~/.claude/skills/${name}/`, `moved to Archive/retired-skills/${date}/ via Protocols UI`).catch(() => {});
  return { archivedTo: dest };
}
