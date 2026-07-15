// Live self-test against a running server. Exercises the real write paths:
// board add/retire (leaves one retired test ID — by design, IDs never return),
// skill create/archive, env fixture round-trip. Run: node tools/selftest-live.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from '../server/config.js';

const BASE = 'http://127.0.0.1:' + (process.env.ICM_PORT || 7717);
const POLICY = PATHS.policy;
const ACTIVITY = PATHS.activityLog;
// Throwaway fixture project inside the last scan root (created/removed by the test).
const FIXTURE = path.join(PATHS.scanRoots[PATHS.scanRoots.length - 1], '_icm-selftest');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

async function j(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function toPayload(sections) {
  const out = {};
  for (const [k, s] of Object.entries(sections)) out[k] = { rows: s.rows.map((r) => ({ id: r.id, cells: r.cells })) };
  return out;
}

// ── 1. Board: add a yellow test rule ─────────────────────────────────────
let { data: board } = await j('GET', '/api/board');
const before = await fs.readFile(POLICY, 'utf8');
const payload = toPayload(board.sections);
payload.yellow.rows.push({ id: null, cells: ['', 'UI self-test rule (temporary)', 'added and retired by tools/selftest-live.mjs', 'safe to ignore in logs'] });
const add = await j('POST', '/api/board', { baseHash: board.baseHash, sections: payload, summary: 'live self-test' });
const assigned = add.data?.assignedIds?.yellow?.[0];
check('board add returns assigned ID', add.status === 200 && !!assigned, String(assigned));

let after = await fs.readFile(POLICY, 'utf8');
check('new row present in policy file', after.includes('UI self-test rule (temporary)'));
check('prose untouched (legacy mapping intact)', after.includes('| Low impact | **Green** | Act automatically, then report |') === before.includes('| Low impact | **Green** | Act automatically, then report |'));
const activity = await fs.readFile(ACTIVITY, 'utf8');
check('ACTIVITY_LOG has ui entry', activity.includes('| ui | update | 00_system/APPROVAL_POLICY.md | added ' + assigned));

// ── 2. Stale hash → 409 ──────────────────────────────────────────────────
const stale = await j('POST', '/api/board', { baseHash: board.baseHash, sections: payload });
check('stale baseHash rejected with 409', stale.status === 409 && stale.data?.code === 'STALE');

// ── 3. Retire the test rule ──────────────────────────────────────────────
({ data: board } = await j('GET', '/api/board'));
const payload2 = toPayload(board.sections);
payload2.yellow.rows = payload2.yellow.rows.filter((r) => r.id !== assigned);
const retire = await j('POST', '/api/board', { baseHash: board.baseHash, sections: payload2, summary: 'live self-test cleanup' });
check('retire succeeds', retire.status === 200 && retire.data?.deletedIds?.includes(assigned));
after = await fs.readFile(POLICY, 'utf8');
check('test rule gone from policy file', !after.includes('UI self-test rule (temporary)'));
const retired = JSON.parse(await fs.readFile(path.join(process.cwd(), 'data', 'retired-ids.json'), 'utf8'));
check('retired ID recorded (never reused)', retired.Y.includes(assigned));

// ── 4. Skill create + archive ────────────────────────────────────────────
const mk = await j('POST', '/api/skills', { name: 'icm-selftest-echo', description: 'Temporary self-test skill created by the Protocols UI live test.', body: '# Self test\n\nSay "echo" and stop.\n' });
check('skill created', mk.status === 200);
const skillPath = path.join(PATHS.skillsDir, 'icm-selftest-echo', 'SKILL.md');
check('SKILL.md exists on disk', await fs.access(skillPath).then(() => true).catch(() => false));
const dup = await j('POST', '/api/skills', { name: 'icm-selftest-echo', description: 'dup' });
check('duplicate skill rejected', dup.status === 409);
const rm = await j('DELETE', '/api/skills/icm-selftest-echo');
check('skill archived', rm.status === 200 && String(rm.data?.archivedTo || '').includes('retired-skills'));
check('skill folder removed', !(await fs.access(skillPath).then(() => true).catch(() => false)));

// ── 5. Env fixture round-trip (never touches real .env files) ────────────
await fs.mkdir(FIXTURE, { recursive: true });
await fs.writeFile(path.join(FIXTURE, 'PLUTUS.md'), '<!-- plutus-template: 3 -->\nfixture\n');
await fs.writeFile(path.join(FIXTURE, '.env'), '# fixture — fake values only\nFAKE_KEY=aaa\nKEEP_ME=untouched\n');
const projects = await j('GET', '/api/projects');
const fx = projects.data.projects.find((p) => p.path === FIXTURE);
check('fixture project discovered', !!fx && fx.envFiles.includes('.env'));
const env1 = await j('GET', `/api/env?project=${encodeURIComponent(FIXTURE)}&file=.env`);
check('env read works', env1.status === 200 && env1.data.raw.includes('FAKE_KEY=aaa'));
const newRaw = env1.data.raw.replace('FAKE_KEY=aaa', 'FAKE_KEY=bbb');
const env2 = await j('PUT', '/api/env', { project: FIXTURE, file: '.env', raw: newRaw, baseHash: env1.data.baseHash });
check('env save works', env2.status === 200);
const envOnDisk = await fs.readFile(path.join(FIXTURE, '.env'), 'utf8');
check('env edit round-trip preserves comments/order', envOnDisk.includes('# fixture — fake values only') && envOnDisk.includes('FAKE_KEY=bbb') && envOnDisk.includes('KEEP_ME=untouched'));
const badFile = await j('GET', `/api/env?project=${encodeURIComponent(FIXTURE)}&file=..%5Csecrets.txt`);
check('env path traversal rejected', badFile.status === 400);

// ── 6. Brain guard ───────────────────────────────────────────────────────
const bf = await j('GET', '/api/brain/file?path=00_system/PIPELINE.md');
check('brain file read', bf.status === 200 && bf.data.system === true);
const guarded = await j('PUT', '/api/brain/file', { path: '00_system/PIPELINE.md', raw: bf.data.raw, baseHash: bf.data.baseHash });
check('system save without confirm rejected', guarded.status === 403 && guarded.data?.code === 'CONFIRM_REQUIRED');

// ── 7. Profiles validation ───────────────────────────────────────────────
const bad = await j('PUT', '/api/profiles/production', { json: { permissions: { allow: 'nope' } }, baseHash: 'x' });
check('invalid profile rejected', bad.status === 400);

// ── cleanup ──────────────────────────────────────────────────────────────
await fs.rm(FIXTURE, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
