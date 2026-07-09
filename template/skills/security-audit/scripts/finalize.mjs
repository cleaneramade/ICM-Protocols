#!/usr/bin/env node
// The deterministic gate for /security-audit.
//
// It takes the DRAFT report the main agent assembled from its parallel dimension
// agents and turns it into a TRUSTED, dated report. This script — not the model —
// enforces the honesty guarantees:
//   * evidence-or-gray: a "pass" without machine-shaped proof cannot render green
//   * absence != pass: a dimension that didn't report keeps the tile off-green
//   * dedup by fingerprint (not line numbers) across dimensions
//   * suppressions honored (with expiry) and NEW suppressions surfaced
//   * safe atomic write + retention pruning into the ICM report store
//
// Usage:  node finalize.mjs --draft <draft.json> [--print]
// The draft carries project.path; everything else is derived here.

import fs from 'node:fs';
import path from 'node:path';
import {
  REPORTS_DIR, REGISTRY_FILE, RULEBOOK_FILE,
  RETENTION_KEEP, sha256, stamp, slugForPath, readJson, atomicWrite,
  fingerprint, resolveRule, severityRank, tileColor,
} from './lib.mjs';

function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const draftPath = arg('draft');
if (!draftPath) {
  console.error('finalize: --draft <file> is required');
  process.exit(2);
}
const draft = readJson(draftPath);
if (!draft || !draft.project || !draft.project.path) {
  console.error('finalize: draft missing project.path');
  process.exit(2);
}

const now = new Date();
const projectPath = path.resolve(draft.project.path);
const slug = slugForPath(projectPath);
const projectName = draft.project.name || path.basename(projectPath);
const projectDir = path.join(REPORTS_DIR, slug);

// Rulebook snapshot — reproducibility + detect mid-run edits between agents.
let rulebookHash = null;
try { rulebookHash = sha256(fs.readFileSync(RULEBOOK_FILE)); } catch {}

// ---- previous report (latest existing) for trend + suppression diff ----
const prevFiles = listReports(projectDir);
const prevReport = prevFiles.length ? readJson(path.join(projectDir, prevFiles[prevFiles.length - 1])) : null;

// ---- dedup rules by id across dimensions (overlap is by design) ----
// When several dimensions assess the same rule, keep the most decisive view:
// a real failure outranks a proven pass, which outranks a judgment pass, which
// outranks "unverified". This prevents double-counting in the rule tally.
function ruleAuthority(r) {
  if (r.result === 'fail') return 3;
  const ev = r.evidence || {};
  const machine = (ev.command && (ev.output || ev.outputDigest)) || (ev.file && ev.excerpt) || ev.hash;
  if (r.result === 'pass' && machine) return 2;
  if (r.result === 'pass') return 1;
  return 0;
}
const bestById = new Map();
for (const r of draft.rules || []) {
  if (!r || !r.id) continue;
  const cur = bestById.get(r.id);
  if (!cur || ruleAuthority(r) > ruleAuthority(cur)) bestById.set(r.id, r);
}

// ---- resolve every rule through evidence-or-gray ----
const rules = [...bestById.values()].map((r) => {
  const resolved = resolveRule(r);
  return {
    id: r.id,
    pack: r.pack || 'core',
    enforcement: r.enforcement || 'warning',
    dimension: r.dimension || null,
    result: r.result || 'unverified',
    judgment: !!r.judgment,
    status: resolved.status,
    rank: resolved.rank,
    downgradedFrom: resolved.downgradedFrom || null,
    evidence: r.evidence || {},
    note: r.note || null,
  };
});

// ---- dimension completeness: absence is never a pass ----
const expected = draft.expectedDimensions || [];
const reported = new Map((draft.dimensions || []).map((d) => [d.name, d.status || 'ok']));
const dimensions = expected.map((name) => ({
  name,
  status: reported.has(name) ? reported.get(name) : 'unknown',
}));
const dimensionProblem = dimensions.some((d) => d.status !== 'ok');
const dimensionRank = dimensionProblem ? 2 : 0;

// ---- findings: dedup by fingerprint, merge "also flagged by" ----
const byFp = new Map();
for (const f of draft.findings || []) {
  const rel = f.file ? path.relative(projectPath, path.resolve(projectPath, f.file)) : (f.file || '');
  const fp = fingerprint(f.ruleId || f.category || 'finding', rel, f.snippet || f.whatCouldGoWrong || '');
  if (byFp.has(fp)) {
    const existing = byFp.get(fp);
    if (f.dimension && !existing.alsoFlaggedBy.includes(f.dimension)) existing.alsoFlaggedBy.push(f.dimension);
    // keep the highest severity seen
    if (severityRank(f.severity) > severityRank(existing.severity)) existing.severity = f.severity;
  } else {
    byFp.set(fp, {
      fingerprint: fp,
      ruleId: f.ruleId || null,
      category: f.category || 'Security & Privacy',
      severity: (f.severity || 'minor').toLowerCase(),
      file: rel || null,
      line: f.line ?? null,
      snippet: f.snippet || null,
      whatCouldGoWrong: f.whatCouldGoWrong || null,
      fix: f.fix || null,
      alsoFlaggedBy: f.dimension ? [f.dimension] : [],
      suppressed: false,
    });
  }
}
let findings = [...byFp.values()];

// ---- suppressions (accepted risks) with expiry ----
const suppFile = path.join(projectPath, '.security-audit-suppressions.json');
const suppressions = readJson(suppFile, []) || [];
const activeSupp = new Map();
for (const s of suppressions) {
  if (!s || !s.fingerprint) continue;
  if (s.expires && new Date(s.expires) < now) continue; // expired -> no longer suppresses
  activeSupp.set(s.fingerprint, s);
}
let suppressedCount = 0;
for (const f of findings) {
  if (activeSupp.has(f.fingerprint)) {
    f.suppressed = true;
    f.suppressionReason = activeSupp.get(f.fingerprint).reason || null;
    suppressedCount++;
  }
}
// NEW suppressions since last audit -> surfaced as their own Info finding (visible risk acceptance)
const prevSuppFps = new Set((prevReport?.suppressed?.fingerprints) || []);
const newSuppFps = [...activeSupp.keys()].filter((fp) => !prevSuppFps.has(fp));
if (newSuppFps.length && prevReport) {
  findings.push({
    fingerprint: fingerprint('X-supp', '', newSuppFps.join(',')),
    ruleId: 'X-2',
    category: 'Security & Privacy',
    severity: 'info',
    file: path.basename(suppFile),
    line: null,
    snippet: null,
    whatCouldGoWrong: `${newSuppFps.length} new accepted-risk suppression(s) added since the last audit — confirm each is still an intentional decision.`,
    fix: 'Review .security-audit-suppressions.json; give each entry a reason and an expiry date.',
    alsoFlaggedBy: ['suppression-diff'],
    suppressed: false,
  });
}

const activeFindings = findings.filter((f) => !f.suppressed);

// ---- overall color ----
let maxRank = Math.max(0, dimensionRank, ...rules.map((r) => Math.max(0, r.rank)));
for (const f of activeFindings) maxRank = Math.max(maxRank, severityRank(f.severity));
const color = tileColor(maxRank);

const ruleCounts = { green: 0, yellow: 0, red: 0, gray: 0, off: 0 };
for (const r of rules) ruleCounts[r.status] = (ruleCounts[r.status] || 0) + 1;
const findingCounts = { critical: 0, major: 0, minor: 0, trivial: 0, info: 0 };
for (const f of activeFindings) findingCounts[f.severity] = (findingCounts[f.severity] || 0) + 1;

// ---- git anchor for delta scans next time ----
const gitAnchor = draft.gitAnchor || null;

const report = {
  schema: 1,
  project: { slug, name: projectName, path: projectPath, packs: draft.project.packs || [] },
  run: {
    stamp: stamp(now),
    iso: now.toISOString(),
    depth: draft.depth || 'quick',
    rulebookHash,
    gitAnchor,
    dimensions,
    dimensionProblem,
  },
  rules,
  findings,
  suppressed: { count: suppressedCount, fingerprints: [...activeSupp.keys()], newSinceLast: newSuppFps },
  summary: { color, maxRank, ruleCounts, findingCounts, activeFindings: activeFindings.length },
  previous: prevReport ? { stamp: prevReport.run?.stamp, color: prevReport.summary?.color } : null,
};

// ---- write report (JSON + markdown), atomically ----
const outStamp = report.run.stamp;
const jsonFile = path.join(projectDir, `${outStamp}.json`);
const mdFile = path.join(projectDir, `${outStamp}.md`);
atomicWrite(jsonFile, JSON.stringify(report, null, 2));
atomicWrite(mdFile, renderMarkdown(report));

// ---- retention: keep newest N + one-per-month ----
pruneRetention(projectDir);

// ---- registry upsert ----
const registry = readJson(REGISTRY_FILE, {}) || {};
registry[slug] = {
  path: projectPath,
  name: projectName,
  packs: report.project.packs,
  lastAudit: report.run.stamp,
  lastColor: color,
  cadence: registry[slug]?.cadence || 'monthly',
  active: registry[slug]?.active !== false,
};
atomicWrite(REGISTRY_FILE, JSON.stringify(registry, null, 2));

// ---- console summary ----
console.log(renderMarkdown(report));
console.log(`\nReport saved: ${jsonFile}`);

// ============================ helpers ============================

function pruneRetention(dir) {
  const files = listReports(dir);
  if (files.length <= RETENTION_KEEP) return;
  const keep = new Set(files.slice(-RETENTION_KEEP)); // newest N
  const monthSeen = new Set();
  for (const f of files) {
    const month = f.slice(0, 7); // YYYY-MM
    if (!monthSeen.has(month)) { monthSeen.add(month); keep.add(f); } // one-per-month archive
  }
  for (const f of files) {
    if (keep.has(f)) continue;
    for (const ext of ['.json', '.md']) {
      const p = path.join(dir, f.replace(/\.json$/, ext));
      try { fs.unlinkSync(p); } catch {}
    }
  }
}

function icon(c) {
  return { green: '🟢', yellow: '🟡', red: '🔴', gray: '⚪', off: '⚫' }[c] || '⚪';
}

function renderMarkdown(r) {
  const L = [];
  L.push(`# Security audit — ${r.project.name}  ${icon(r.summary.color)} ${r.summary.color.toUpperCase()}`);
  L.push('');
  L.push(`- **When:** ${r.run.iso}  (depth: ${r.run.depth})`);
  L.push(`- **Project:** \`${r.project.path}\`  (slug: \`${r.project.slug}\`)`);
  L.push(`- **Packs:** ${r.project.packs.join(', ') || 'core only'}`);
  if (r.previous) {
    const arrow = r.previous.color === r.summary.color ? '→ (no change)' : `↷ was ${icon(r.previous.color)} ${r.previous.color}`;
    L.push(`- **Trend:** ${arrow}`);
  }
  L.push(`- **Rules:** 🟢 ${r.summary.ruleCounts.green}  🟡 ${r.summary.ruleCounts.yellow}  🔴 ${r.summary.ruleCounts.red}  ⚪ ${r.summary.ruleCounts.gray}`);
  const fc = r.summary.findingCounts;
  L.push(`- **Findings:** Critical ${fc.critical} · Major ${fc.major} · Minor ${fc.minor} · Trivial ${fc.trivial} · Info ${fc.info}` + (r.suppressed.count ? `  (+${r.suppressed.count} suppressed)` : ''));
  if (r.run.dimensionProblem) {
    const bad = r.run.dimensions.filter((d) => d.status !== 'ok').map((d) => `${d.name} (${d.status})`);
    L.push(`- ⚠️ **Incomplete:** ${bad.join(', ')} — tile cannot be green until every dimension reports.`);
  }
  L.push('');

  const fails = r.rules.filter((x) => x.status === 'red' || x.status === 'gray' || x.status === 'yellow');
  if (fails.length) {
    L.push('## Rules needing attention');
    L.push('');
    L.push('| Rule | Status | Why |');
    L.push('| --- | --- | --- |');
    for (const x of fails.sort((a, b) => b.rank - a.rank)) {
      const why = x.downgradedFrom ? `downgraded from ${x.downgradedFrom}${x.note ? ' — ' + x.note : ''}` : (x.note || (x.result === 'fail' ? 'check failed' : 'not verified'));
      L.push(`| ${x.id} | ${icon(x.status)} ${x.status} | ${escapeCell(why)} |`);
    }
    L.push('');
  }

  const active = r.findings.filter((f) => !f.suppressed).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  if (active.length) {
    L.push('## Findings (deep code audit)');
    L.push('');
    for (const f of active) {
      const loc = f.file ? `\`${f.file}${f.line ? ':' + f.line : ''}\`` : '(no location)';
      const also = f.alsoFlaggedBy.length > 1 ? `  _(also flagged by: ${f.alsoFlaggedBy.join(', ')})_` : '';
      L.push(`### ${sevIcon(f.severity)} ${f.severity.toUpperCase()} · ${f.category}${f.ruleId ? ' · ' + f.ruleId : ''} — ${loc}${also}`);
      if (f.whatCouldGoWrong) L.push(`**What could go wrong:** ${f.whatCouldGoWrong}`);
      if (f.fix) L.push(`**Fix:** ${f.fix}`);
      L.push('');
    }
  }
  if (!fails.length && !active.length) L.push('_No open issues. All checked rules are green with evidence._');
  return L.join('\n');
}

function sevIcon(s) {
  return { critical: '🔴', major: '🟠', minor: '🟡', trivial: '⚪', info: 'ℹ️' }[s] || '⚪';
}
function escapeCell(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
function listReports(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { return []; }
}
