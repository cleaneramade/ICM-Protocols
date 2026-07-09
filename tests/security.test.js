import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PATHS } from '../server/config.js';
import {
  summarizeProject, securityProjects, securityReport, securityHistory, securityTimeline,
} from '../server/security.js';

// Redirect the module's paths at a temp fixture so tests never touch real data.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-sec-'));
PATHS.securityReports = path.join(tmp, 'security-reports');
PATHS.securityRegistry = path.join(tmp, 'security-projects.json');
PATHS.securityPolicy = path.join(tmp, 'SECURITY_PROTOCOLS.md');
fs.mkdirSync(PATHS.securityReports, { recursive: true });

const DAY = 86400000;
const NOW = Date.parse('2026-07-07T00:00:00.000Z');

function reportFixture(over = {}) {
  return {
    schema: 1,
    project: { slug: 's', name: 'Demo', path: 'C:/x', packs: ['web'] },
    run: { stamp: '2026-07-01T00-00-00-000Z', iso: '2026-07-01T00:00:00.000Z', depth: 'quick', dimensionProblem: false },
    rules: [],
    findings: [],
    suppressed: { count: 0, fingerprints: [] },
    summary: { color: 'green', ruleCounts: {}, findingCounts: {}, activeFindings: 0 },
    previous: null,
    ...over,
  };
}

function writeReport(slug, stamp, report) {
  const dir = path.join(PATHS.securityReports, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, stamp + '.json'), JSON.stringify(report));
}

test('summarizeProject: no report -> never-audited, gray', () => {
  const s = summarizeProject({ slug: 'x', name: 'X' }, null, NOW);
  assert.equal(s.status, 'never-audited');
  assert.equal(s.effectiveColor, 'gray');
});

test('summarizeProject: fresh green stays green', () => {
  const r = reportFixture({ run: { iso: new Date(NOW - 2 * DAY).toISOString(), stamp: 'a' }, summary: { color: 'green' } });
  const s = summarizeProject({ slug: 'x', cadence: 'monthly' }, r, NOW);
  assert.equal(s.stale, false);
  assert.equal(s.effectiveColor, 'green');
});

test('summarizeProject: stale green decays to yellow', () => {
  const r = reportFixture({ run: { iso: new Date(NOW - 60 * DAY).toISOString(), stamp: 'a' }, summary: { color: 'green' } });
  const s = summarizeProject({ slug: 'x', cadence: 'monthly' }, r, NOW);
  assert.equal(s.stale, true);
  assert.equal(s.color, 'green');
  assert.equal(s.effectiveColor, 'yellow'); // decayed, but underlying color preserved
});

test('summarizeProject: stale red stays red', () => {
  const r = reportFixture({ run: { iso: new Date(NOW - 200 * DAY).toISOString(), stamp: 'a' }, summary: { color: 'red' } });
  const s = summarizeProject({ slug: 'x', cadence: 'monthly' }, r, NOW);
  assert.equal(s.effectiveColor, 'red');
});

test('summarizeProject: trend direction from previous color', () => {
  const r = reportFixture({ summary: { color: 'green' }, previous: { color: 'red', stamp: 'p' } });
  const s = summarizeProject({ slug: 'x' }, r, NOW);
  assert.equal(s.trend.direction, 'improved');
});

test('securityProjects: lists registry + orphan report dirs, worst-first', async () => {
  fs.writeFileSync(PATHS.securityRegistry, JSON.stringify({
    'good-abc123': { path: 'C:/good', name: 'Good', packs: [], cadence: 'monthly', lastColor: 'green' },
  }));
  writeReport('good-abc123', '2026-07-05T00-00-00-000Z', reportFixture({
    run: { iso: new Date(NOW - 1 * DAY).toISOString(), stamp: '2026-07-05T00-00-00-000Z' }, summary: { color: 'green' },
  }));
  // orphan: has a report folder but no registry entry
  writeReport('orphan-def456', '2026-07-06T00-00-00-000Z', reportFixture({
    run: { iso: new Date(NOW - 1 * DAY).toISOString(), stamp: '2026-07-06T00-00-00-000Z' }, summary: { color: 'red' },
  }));
  const { projects } = await securityProjects(NOW);
  const slugs = projects.map((p) => p.slug);
  assert.ok(slugs.includes('good-abc123'));
  assert.ok(slugs.includes('orphan-def456'));
  assert.equal(projects[0].effectiveColor, 'red'); // worst first
});

test('securityReport: returns latest valid report', async () => {
  const { report } = await securityReport('good-abc123');
  assert.equal(report.summary.color, 'green');
});

test('securityReport: rejects traversal slug', async () => {
  await assert.rejects(() => securityReport('../etc'), (e) => e.code === 'BAD_SLUG');
  await assert.rejects(() => securityReport('a/b'), (e) => e.code === 'BAD_SLUG');
});

test('securityReport: rejects bad stamp format', async () => {
  await assert.rejects(() => securityReport('good-abc123', '../../secret'), (e) => e.code === 'BAD_STAMP');
});

test('securityReport: malformed report file is rejected, not rendered', async () => {
  const dir = path.join(PATHS.securityReports, 'broken-xyz999');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-07-07T00-00-00-000Z.json'), '{ this is : not json ]');
  await assert.rejects(() => securityReport('broken-xyz999'), (e) => e.code === 'BAD_REPORT');
});

test('securityHistory: newest-first list of stamps', async () => {
  writeReport('good-abc123', '2026-07-06T00-00-00-000Z', reportFixture());
  const { history } = await securityHistory('good-abc123');
  assert.ok(history.length >= 2);
  assert.ok(history[0] >= history[1]); // reverse-sorted (newest first)
});

function finding(over = {}) {
  return {
    fingerprint: 'fp', ruleId: 'SEC-4', category: 'Security & Privacy', severity: 'major',
    file: 'server.js', line: 10, whatCouldGoWrong: 'binds all interfaces', suppressed: false, ...over,
  };
}

test('securityTimeline: finding gone from latest report becomes resolved', async () => {
  writeReport('life-aaa111', '2026-06-01T00-00-00-000Z', reportFixture({
    run: { stamp: '2026-06-01T00-00-00-000Z', iso: '2026-06-01T00:00:00.000Z', depth: 'quick' },
    findings: [finding({ fingerprint: 'fp1' }), finding({ fingerprint: 'fpInfo', severity: 'info' })],
    summary: { color: 'red', ruleCounts: {}, findingCounts: { major: 1, info: 1 }, activeFindings: 2 },
  }));
  writeReport('life-aaa111', '2026-06-10T00-00-00-000Z', reportFixture({
    run: { stamp: '2026-06-10T00-00-00-000Z', iso: '2026-06-10T00:00:00.000Z', depth: 'quick' },
    findings: [],
    summary: { color: 'green', ruleCounts: {}, findingCounts: {}, activeFindings: 0 },
  }));
  const tl = await securityTimeline('life-aaa111', NOW);
  assert.equal(tl.runs.length, 2);
  assert.equal(tl.runs[0].iso, '2026-06-10T00:00:00.000Z'); // newest first
  const fps = tl.resolved.map((r) => r.fingerprint);
  assert.ok(fps.includes('fp1'));
  assert.ok(!fps.includes('fpInfo')); // info notices aren't "issues" that resolve
  const r1 = tl.resolved.find((r) => r.fingerprint === 'fp1');
  assert.equal(r1.firstIso, '2026-06-01T00:00:00.000Z');
  assert.equal(r1.resolvedIso, '2026-06-10T00:00:00.000Z'); // first run it went missing
});

test('securityTimeline: finding still present in latest is NOT resolved', async () => {
  writeReport('life-bbb222', '2026-06-01T00-00-00-000Z', reportFixture({
    run: { stamp: '2026-06-01T00-00-00-000Z', iso: '2026-06-01T00:00:00.000Z' },
    findings: [finding({ fingerprint: 'fpX' })],
  }));
  writeReport('life-bbb222', '2026-06-10T00-00-00-000Z', reportFixture({
    run: { stamp: '2026-06-10T00-00-00-000Z', iso: '2026-06-10T00:00:00.000Z' },
    findings: [finding({ fingerprint: 'fpX' })],
  }));
  const tl = await securityTimeline('life-bbb222', NOW);
  assert.equal(tl.resolved.length, 0);
});

test('securityTimeline: no reports -> empty runs + resolved', async () => {
  const tl = await securityTimeline('never-zzz000', NOW);
  assert.deepEqual(tl.runs, []);
  assert.deepEqual(tl.resolved, []);
});

test('securityTimeline: rejects bad slug', async () => {
  await assert.rejects(() => securityTimeline('../etc'), (e) => e.code === 'BAD_SLUG');
});
