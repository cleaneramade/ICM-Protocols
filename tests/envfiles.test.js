import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PATHS } from '../server/config.js';
import { listProjects, getEnv, putEnv, redactRaw, deleteProjectSecrets, listCandidateFolders, linkProject } from '../server/envfiles.js';

// Redirect scan roots + backups at a temp fixture so tests never touch real
// projects or real .env files. All values below are fakes (project rule 5).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-env-'));
PATHS.scanRoots = [tmp];
PATHS.backups = path.join(tmp, '.backups');

const PROJ = path.join(tmp, 'demo');
fs.mkdirSync(PROJ, { recursive: true });
fs.writeFileSync(path.join(PROJ, 'PLUTUS.md'), 'fixture\n');

const ENV_FIXTURE = [
  '# comment stays',
  '',
  'DATABASE_URL=postgres://fake',
  'MY_API_KEY=fake-not-a-real-key',
  'EMPTY=',
].join('\n') + '\n';

/* ── redactRaw: the only thing standing between real values and the browser ── */

test('redactRaw: values blanked, key names kept', () => {
  const out = redactRaw('MY_API_KEY=fake-secret\nPLAIN_URL=https://x\n');
  assert.equal(out, 'MY_API_KEY=\nPLAIN_URL=\n');
  assert.ok(!out.includes('fake-secret'));
});

test('redactRaw: comments and blank lines pass through', () => {
  assert.equal(redactRaw('# note\n\nA_KEY=v\n'), '# note\n\nA_KEY=\n');
});

test('redactRaw: export-prefixed assignments are redacted', () => {
  assert.equal(redactRaw('export TOKEN=fake123'), 'export TOKEN=');
});

test('redactRaw: unrecognized lines are blanked, never passed through', () => {
  assert.equal(redactRaw('some random junk line'), '');
});

test('redactRaw: multi-line quoted value continuation lines are blanked', () => {
  const out = redactRaw('A="first\nmiddlepart==\nlast"\nB_KEY=x\n');
  assert.equal(out, 'A=\n\n\nB_KEY=\n');
  assert.ok(!out.includes('middlepart'));
});

test('redactRaw: PEM block continuation lines are blanked', () => {
  const raw = 'CERT=-----BEGIN PRIVATE KEY-----\nZmFrZWJ5dGVz==\n-----END PRIVATE KEY-----\nAFTER_KEY=v\n';
  const out = redactRaw(raw);
  assert.equal(out, 'CERT=\n\n\nAFTER_KEY=\n');
  assert.ok(!out.includes('ZmFrZWJ5dGVz'));
});

/* ── listProjects: badge counts EVERY named key, matching what the UI lists ── */

test('listProjects: counts all named keys, not just secret-looking ones', async () => {
  fs.writeFileSync(path.join(PROJ, '.env'), ENV_FIXTURE);
  const projects = await listProjects();
  const p = projects.find((x) => path.resolve(x.path) === path.resolve(fs.realpathSync(PROJ)) || x.name === 'demo');
  assert.ok(p, 'fixture project discovered');
  assert.ok(p.envFiles.includes('.env'));
  assert.equal(p.keyCount, 3); // DATABASE_URL + MY_API_KEY + EMPTY — URL is no longer invisible
});

/* ── getEnv / putEnv round-trip, staleness, and path discipline ── */

test('getEnv + putEnv: round-trip preserves comments and order', async () => {
  const t = await getEnv(PROJ, '.env');
  assert.ok(t.raw.includes('MY_API_KEY=fake-not-a-real-key'));
  const edited = t.raw.replace('MY_API_KEY=fake-not-a-real-key', 'MY_API_KEY=fake-2');
  await putEnv(PROJ, '.env', edited, t.baseHash);
  const onDisk = fs.readFileSync(path.join(PROJ, '.env'), 'utf8');
  assert.ok(onDisk.includes('# comment stays'));
  assert.ok(onDisk.includes('MY_API_KEY=fake-2'));
  assert.ok(onDisk.includes('DATABASE_URL=postgres://fake'));
});

test('putEnv: stale baseHash is rejected with STALE', async () => {
  const t = await getEnv(PROJ, '.env');
  await putEnv(PROJ, '.env', t.raw + 'ADDED_KEY=1\n', t.baseHash);
  await assert.rejects(
    () => putEnv(PROJ, '.env', 'CLOBBER=1\n', t.baseHash), // hash from before the write above
    (e) => e.code === 'STALE' && e.httpStatus === 409,
  );
});

test('putEnv: creates a new file when none exists (no baseHash)', async () => {
  await putEnv(PROJ, '.env.local', 'LOCAL_KEY=fake\n', null);
  assert.ok(fs.readFileSync(path.join(PROJ, '.env.local'), 'utf8').includes('LOCAL_KEY=fake'));
});

test('env file names outside .env* are rejected', async () => {
  await assert.rejects(() => getEnv(PROJ, '..\\PLUTUS.md'), (e) => e.code === 'BAD_FILE');
  await assert.rejects(() => putEnv(PROJ, 'notes.txt', 'X=1', null), (e) => e.code === 'BAD_FILE');
});

test('projects outside the scan roots are rejected', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-outside-'));
  fs.writeFileSync(path.join(outside, 'PLUTUS.md'), 'x\n');
  await assert.rejects(() => getEnv(outside, '.env'), (e) => e.code === 'BAD_PROJECT');
  await assert.rejects(() => getEnv('', '.env'), (e) => e.code === 'BAD_PROJECT');
  fs.rmSync(outside, { recursive: true, force: true });
});

/* ── Primary file: the file with the most keys wins ── */

test('listProjects: an empty .env.development never hides a full .env', async () => {
  const d = path.join(tmp, 'twofiles');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'PLUTUS.md'), 'x\n');
  fs.writeFileSync(path.join(d, '.env.development'), '# empty stub\n');
  fs.writeFileSync(path.join(d, '.env'), 'A_KEY=fake\nB_KEY=fake\n');
  const p = (await listProjects()).find((x) => x.name === 'twofiles');
  assert.equal(p.primary, '.env');
  assert.equal(p.keyCount, 2);
  assert.equal(p.keyCounts['.env.development'], 0);
});

test('listProjects: keys in .env.local beat an empty .env', async () => {
  const d = path.join(tmp, 'localwins');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'PLUTUS.md'), 'x\n');
  fs.writeFileSync(path.join(d, '.env'), '# nothing yet\n');
  fs.writeFileSync(path.join(d, '.env.local'), 'ONLY_KEY=fake\n');
  const p = (await listProjects()).find((x) => x.name === 'localwins');
  assert.equal(p.primary, '.env.local');
  assert.equal(p.keyCount, 1);
});

/* ── Add project: candidates + linking ── */

test('listCandidateFolders: unlinked folders only, no dot-folders', async () => {
  fs.mkdirSync(path.join(tmp, 'newproj'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.hidden'), { recursive: true });
  const cands = await listCandidateFolders();
  const names = cands.map((c) => c.name);
  assert.ok(names.includes('newproj'));
  assert.ok(!names.includes('demo'));    // already linked (has PLUTUS.md)
  assert.ok(!names.includes('.hidden')); // dot-folders never offered
});

test('linkProject: writes the PLUTUS.md marker once, then reports alreadyLinked', async () => {
  const dir = path.join(tmp, 'newproj');
  const first = await linkProject(dir);
  assert.equal(first.alreadyLinked, false);
  assert.ok(fs.readFileSync(path.join(dir, 'PLUTUS.md'), 'utf8').includes('linked project'));
  const second = await linkProject(dir);
  assert.equal(second.alreadyLinked, true);
  const cands = await listCandidateFolders();
  assert.ok(!cands.map((c) => c.name).includes('newproj')); // no longer a candidate
});

test('linkProject: rejects folders not directly under a scan root', async () => {
  const nested = path.join(tmp, 'newproj', 'inner');
  fs.mkdirSync(nested, { recursive: true });
  await assert.rejects(() => linkProject(nested), (e) => e.code === 'BAD_PROJECT');
  await assert.rejects(() => linkProject(path.join(tmp, 'ghost')), (e) => e.code === 'BAD_PROJECT');
  await assert.rejects(() => linkProject(''), (e) => e.code === 'BAD_PROJECT');
});

/* ── deleteProjectSecrets: removes secret files, keeps the template ── */

test('deleteProjectSecrets: removes .env files but keeps .env.example, writes no plaintext backup', async () => {
  fs.writeFileSync(path.join(PROJ, '.env.example'), 'MY_API_KEY=\n');
  const { deleted } = await deleteProjectSecrets(PROJ);
  assert.ok(deleted.includes('.env'));
  assert.ok(deleted.includes('.env.local'));
  assert.ok(!deleted.includes('.env.example'));
  assert.ok(!fs.existsSync(path.join(PROJ, '.env')));
  assert.ok(fs.existsSync(path.join(PROJ, '.env.example')));
  // no-plaintext-at-rest: nothing under .backups may contain a fixture value
  const leaked = [];
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (fs.readFileSync(f, 'utf8').includes('fake-2')) leaked.push(f);
    }
  };
  walk(PATHS.backups);
  assert.deepEqual(leaked, []);
});
