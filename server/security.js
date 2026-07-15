// Security dashboard — READ ONLY. Serves the rulebook, the per-project audit
// scores, and individual reports written by the /security-audit skill into
// data/security-reports/<slug>/<stamp>.json. This module never writes anything
// (the skill owns the reports; the dashboard only reads them), so it needs no
// fsio pipeline — but it MUST contain every path it resolves, since report JSON
// is untrusted input produced by an agent-driven skill.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from './config.js';
import { httpError } from './router.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const STAMP_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9-]+Z$/;

const CADENCE_DAYS = { weekly: 7, monthly: 30, quarterly: 90, biannual: 182, yearly: 365 };
const DAY_MS = 86400000;

// --- pure, testable summary of one report against "now" + a cadence ---
export function summarizeProject(entry, report, now = Date.now()) {
  const base = {
    slug: entry.slug,
    name: entry.name || entry.slug,
    path: entry.path || null,
    packs: entry.packs || [],
    cadence: entry.cadence || 'monthly',
    active: entry.active !== false,
  };
  if (!report) {
    return { ...base, color: 'gray', effectiveColor: 'gray', status: 'never-audited', lastAudit: null };
  }
  const color = report.summary?.color || 'gray';
  const lastMs = report.run?.iso ? Date.parse(report.run.iso) : null;
  const maxDays = CADENCE_DAYS[base.cadence] ?? 30;
  const staleDays = lastMs ? Math.floor((now - lastMs) / DAY_MS) : null;
  const stale = staleDays != null && staleDays > maxDays;
  // Staleness decays a green tile to yellow so an unaudited-in-a-while project
  // never reads as "all clear" just because it passed once. Yellow/red stay put.
  const effectiveColor = stale && color === 'green' ? 'yellow' : color;
  const prevColor = report.previous?.color || null;
  const rank = { red: 3, yellow: 2, green: 1, gray: 0 };
  const direction = !prevColor ? 'new' : (rank[color] < rank[prevColor] ? 'improved' : rank[color] > rank[prevColor] ? 'worse' : 'same');
  return {
    ...base,
    color,
    effectiveColor,
    status: 'audited',
    stale,
    staleDays,
    lastAudit: report.run?.stamp || null,
    lastIso: report.run?.iso || null,
    depth: report.run?.depth || null,
    dimensionProblem: !!report.run?.dimensionProblem,
    ruleCounts: report.summary?.ruleCounts || {},
    findingCounts: report.summary?.findingCounts || {},
    activeFindings: report.summary?.activeFindings ?? null,
    suppressedCount: report.suppressed?.count ?? 0,
    trend: { prevColor, direction },
  };
}

async function readJsonSafe(abs) {
  try {
    return JSON.parse(await fs.readFile(abs, 'utf8'));
  } catch {
    return null;
  }
}

async function listReportFiles(slug) {
  const dir = path.join(PATHS.securityReports, slug);
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
    files.sort();
    return files;
  } catch {
    return [];
  }
}

async function loadRegistry() {
  const reg = (await readJsonSafe(PATHS.securityRegistry)) || {};
  return reg && typeof reg === 'object' ? reg : {};
}

// The rulebook itself, for the dashboard to render (read-only).
export async function securityRulebook() {
  try {
    const raw = await fs.readFile(PATHS.securityPolicy, 'utf8');
    return { exists: true, raw };
  } catch {
    return { exists: false, raw: '' };
  }
}

// Every project the registry knows about, plus any orphan report folders,
// summarized with staleness + trend. Sorted worst-first for the dashboard.
export async function securityProjects(now = Date.now()) {
  const registry = await loadRegistry();
  const slugs = new Set(Object.keys(registry).filter((s) => SLUG_RE.test(s)));
  // include report folders not yet (or no longer) in the registry
  try {
    for (const d of await fs.readdir(PATHS.securityReports, { withFileTypes: true })) {
      if (d.isDirectory() && SLUG_RE.test(d.name)) slugs.add(d.name);
    }
  } catch { /* no reports dir yet */ }

  const projects = [];
  for (const slug of slugs) {
    const entry = { slug, ...(registry[slug] || {}) };
    const files = await listReportFiles(slug);
    const latest = files.length ? await readJsonSafe(path.join(PATHS.securityReports, slug, files[files.length - 1])) : null;
    const summary = summarizeProject(entry, latest, now);
    summary.reportCount = files.length;
    projects.push(summary);
  }
  const order = { red: 0, yellow: 1, green: 2, gray: 3 };
  projects.sort((a, b) => (order[a.effectiveColor] - order[b.effectiveColor]) || a.name.localeCompare(b.name));
  return { projects };
}

// One report (latest, or a specific stamp). Path-contained against the reports root.
export async function securityReport(slug, stamp) {
  if (!SLUG_RE.test(slug || '')) throw httpError(400, 'BAD_SLUG', 'invalid project slug');
  const dir = path.join(PATHS.securityReports, slug);
  let file;
  if (stamp) {
    if (!STAMP_RE.test(stamp)) throw httpError(400, 'BAD_STAMP', 'invalid report stamp');
    file = stamp + '.json';
  } else {
    const files = await listReportFiles(slug);
    if (!files.length) throw httpError(404, 'NOT_FOUND', 'no reports for this project');
    file = files[files.length - 1];
  }
  const abs = path.resolve(dir, file);
  // containment: the resolved path must stay inside this project's report dir
  if (abs !== path.join(dir, file) || !abs.startsWith(PATHS.securityReports + path.sep)) {
    throw httpError(400, 'BAD_PATH', 'path escapes the reports root');
  }
  const report = await readJsonSafe(abs);
  if (!report) throw httpError(422, 'BAD_REPORT', 'report is missing or unreadable');
  return { report };
}

// The list of report stamps for one project (for a history dropdown).
export async function securityHistory(slug) {
  if (!SLUG_RE.test(slug || '')) throw httpError(400, 'BAD_SLUG', 'invalid project slug');
  const files = await listReportFiles(slug);
  return { history: files.map((f) => f.replace(/\.json$/, '')).reverse() };
}

// Load every retained report for a project, oldest → newest.
async function loadReports(slug) {
  const files = await listReportFiles(slug); // ascending
  const reports = [];
  for (const f of files) {
    const r = await readJsonSafe(path.join(PATHS.securityReports, slug, f));
    if (r && typeof r === 'object') reports.push(r);
  }
  return reports;
}

const SEV_ORDER = { critical: 0, major: 1, minor: 2, trivial: 3, info: 4 };

// The issue lifecycle across a project's whole audit history. Findings carry a
// stable fingerprint (rule-id + path + normalized snippet, NOT line numbers), so
// we can follow each one across dated reports: an issue that showed up before but
// is gone from the latest report has been RESOLVED — it moves to the "prior
// issues" log. This is pure/derived and recomputes on every read, so re-running
// /security-audit updates it automatically — no scan button, no stored state.
export async function securityTimeline(slug, now = Date.now()) {
  if (!SLUG_RE.test(slug || '')) throw httpError(400, 'BAD_SLUG', 'invalid project slug');
  const reports = await loadReports(slug);
  if (!reports.length) return { slug, runs: [], resolved: [], counts: { runs: 0, resolved: 0 } };

  // Audit history — one row per run, newest first.
  const runs = reports.map((r) => {
    const fc = r.summary?.findingCounts || {};
    const open = r.summary?.activeFindings ?? (['critical', 'major', 'minor', 'trivial', 'info']
      .reduce((n, k) => n + (fc[k] || 0), 0));
    return {
      stamp: r.run?.stamp || null,
      iso: r.run?.iso || null,
      color: r.summary?.color || 'gray',
      depth: r.run?.depth || null,
      open,
    };
  }).reverse();

  // Follow each fingerprint across every run to find its first + last appearance.
  const life = new Map();
  reports.forEach((r, idx) => {
    for (const f of Array.isArray(r.findings) ? r.findings : []) {
      if (!f || !f.fingerprint) continue;
      const cur = life.get(f.fingerprint) || { first: idx, firstIso: r.run?.iso || null };
      cur.last = idx;
      cur.lastIso = r.run?.iso || null;
      cur.finding = f; // latest-seen fields for display
      cur.suppressedNow = !!f.suppressed;
      life.set(f.fingerprint, cur);
    }
  });

  // Resolved = present in some prior report but absent from the latest one.
  const lastIdx = reports.length - 1;
  const resolved = [];
  for (const [fp, v] of life) {
    if (v.last === lastIdx) continue;            // still present → open/accepted, not resolved
    const f = v.finding || {};
    const sev = String(f.severity || 'minor').toLowerCase();
    if (sev === 'info') continue;                // info notices aren't "issues" that get fixed
    resolved.push({
      fingerprint: fp,
      ruleId: f.ruleId || null,
      category: f.category || null,
      severity: sev,
      file: f.file || null,
      line: f.line ?? null,
      whatCouldGoWrong: f.whatCouldGoWrong || null,
      firstIso: v.firstIso || null,
      lastIso: v.lastIso || null,
      resolvedIso: reports[v.last + 1]?.run?.iso || null, // first run it went missing
      wasSuppressed: !!v.suppressedNow,
    });
  }
  resolved.sort((a, b) =>
    (Date.parse(b.resolvedIso || 0) - Date.parse(a.resolvedIso || 0)) ||
    ((SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)));

  return { slug, runs, resolved, counts: { runs: runs.length, resolved: resolved.length } };
}
