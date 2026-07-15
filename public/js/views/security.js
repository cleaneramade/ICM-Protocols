// Security view — the per-project audit dashboard (read-only). Reads the reports
// the /security-audit skill writes and shows each project's green/yellow/red
// score, findings, trend, and staleness, plus the rulebook itself.
// Report JSON is produced by an agent-driven skill, so it is UNTRUSTED input:
// everything here renders through el()/textContent — never innerHTML — except the
// rulebook, which is a brain markdown file rendered by the shared safe renderer.
import { el, clear, icon, emptyState, toast } from '../ui.js';
import { get } from '../api.js';
import { renderMarkdown } from '../md.js';

let container = null, listHost = null, paneHost = null;
let state = { projects: [], current: null, currentStamp: null, mode: 'empty' };
// Whether the "Prior issues — resolved" section is expanded (collapsed by
// default — it's history). Persists across report re-renders within a session.
let resolvedOpen = false;

const COLOR_WORD = { red: 'At risk', orange: 'Major issue', yellow: 'Needs work', green: 'Protected', gray: 'Not audited' };
const TALLY_WORD = { red: 'at risk', orange: 'need attention', yellow: 'need work', green: 'protected', gray: 'not audited' };

export async function securityView(root, actionsHost) {
  container = root;
  state = { projects: [], current: null, currentStamp: null, mode: 'empty' };
  if (actionsHost) {
    actionsHost.append(
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: showRulebook },
        icon('folder-2', { size: 14 }), 'Rulebook'),
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => refresh(), title: 'Re-check the scores (keeps the open project)' },
        icon('refresh', { size: 14 }), 'Refresh'),
    );
  }
  mountShell();
  await refresh();
}

function mountShell() {
  clear(container);
  listHost = el('div', { class: 'sec-list scrolly' });
  paneHost = el('div', { class: 'sec-pane' });
  container.append(el('div', { class: 'sec-page' },
    el('div', { class: 'sec-list-card cm-soft-card' }, listHost),
    paneHost,
  ));
  renderPane();
}

async function refresh() {
  try {
    const data = await get('/api/security/projects');
    state.projects = data.projects || [];
  } catch (e) {
    toast('Could not load scores', e.message, 'err');
    state.projects = [];
  }
  renderList();
  // Reopen the selected project (only if it still exists) so a reload/refresh
  // keeps you on it; otherwise fall back to the empty pane.
  if (state.current && state.projects.some((p) => p.slug === state.current)) openProject(state.current, true, state.currentStamp);
  else { state.current = null; state.currentStamp = null; renderPane(); }
}

// Absolute calendar date for every "audited / fixed / first seen / snapshot
// from" line. We used to show relative wording ("today", "3 days ago"), but a
// same-day audit read as a bare "today" with no way to tell when it ran, so we
// always show the real date now (the year is added only when it isn't this one).
function relTime(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (isNaN(d)) return 'unknown';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

// Absolute date + time for the audit-history rows. relTime() collapses every
// same-day run to "today", which is useless when several land on one day, so
// here we show the real calendar date and clock time to tell them apart.
function runStamp(iso) {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  if (isNaN(d)) return 'unknown date';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

// The one-line status shown under a project name (in both the left-menu tile
// and the report header): the worst severity present with its count (e.g.
// "Critical (1)"), or — when nothing is open — a word read from the rule ledger.
// A project that passed everything it could check shows "Passing" even if a few
// rules are still unverified (e.g. human-attestation items), so it never reads
// as "Needs work" when there's genuinely no defect to fix.
function severityStatus(findingCounts, color, ruleCounts) {
  const fc = findingCounts || {};
  const sevs = [['critical', 'Critical', 'red'], ['major', 'Major', 'orange'], ['minor', 'Minor', 'yellow']];
  for (const [key, label, c] of sevs) {
    const n = fc[key] || 0;
    if (n) return { label: `${label} (${n})`, color: c };
  }
  const rc = ruleCounts || {};
  if (rc.red) return { label: 'At risk', color: 'red' };
  if (rc.yellow) return { label: 'Needs work', color: 'yellow' };
  if (rc.gray) return { label: 'Passing', color: 'green' };
  const col = color || 'gray';
  if (col === 'green') return { label: 'Protected', color: 'green' };
  return { label: COLOR_WORD[col] || col, color: col };
}
function statusSummary(r) {
  return severityStatus(r.summary?.findingCounts, r.summary?.color || 'gray', r.summary?.ruleCounts);
}

// The colour a project shows in the list — the same severity-based colour the
// tile dot uses (so a project with only human-attestation grays reads green
// "Passing"). Both the per-project dots and the top tally chips derive from
// this, so the header count can never disagree with the dots below it.
function displayColor(p) {
  if (p.status !== 'audited') return 'gray';
  return severityStatus(p.findingCounts, p.effectiveColor, p.ruleCounts).color;
}

// Long, human date for the status line — "July 7th" (year added only when it
// isn't the current one).
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
function longDate(iso) {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  if (isNaN(d)) return 'unknown date';
  const day = d.getDate();
  const month = d.toLocaleDateString(undefined, { month: 'long' });
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `, ${d.getFullYear()}`;
  return `${month} ${day}${ordinal(day)}${year}`;
}

function trendChip(t) {
  if (!t || t.direction === 'new') return null;
  const map = { improved: ['↑', 'green', 'improved'], worse: ['↓', 'red', 'worse'], same: ['→', 'gray', 'no change'] };
  const [glyph, color, label] = map[t.direction] || map.same;
  return el('span', { class: 'sec-trend', dataset: { color }, title: `Trend: ${label}` }, glyph);
}

function projectTile(p) {
  // Same status line as the report header: "Critical (1) · July 8th". The dot
  // colour tracks that status too — green passing, yellow minor, orange major,
  // red critical — instead of the raw server colour.
  let sub, dotColor;
  if (p.status === 'audited') {
    const st = severityStatus(p.findingCounts, p.effectiveColor, p.ruleCounts);
    dotColor = st.color;
    sub = el('span', { class: 'sec-tile-sub cm-caption' },
      el('span', { class: 'sec-status-word', dataset: { color: st.color }, text: st.label }),
      el('span', { class: 'muted', text: ` · ${longDate(p.lastIso)}` }));
  } else {
    dotColor = 'gray';
    sub = el('span', { class: 'sec-tile-sub cm-caption muted', text: 'Not yet audited' });
  }
  return el('button', {
    class: 'sec-tile', type: 'button',
    'aria-current': String(state.current === p.slug),
    onclick: () => openProject(p.slug),
  },
    el('span', { class: 'sec-tile-dot', dataset: { color: dotColor } }),
    el('span', { class: 'sec-tile-main' },
      el('span', { class: 'sec-tile-name ellip', title: p.name, text: p.name }),
      sub,
    ),
    p.stale ? el('span', { class: 'id-badge', dataset: { color: 'yellow' }, text: 'STALE' }) : null,
    trendChip(p.trend),
  );
}

function renderList() {
  clear(listHost);
  if (!state.projects.length) {
    listHost.append(emptyState('shield', 'No audits yet', 'Run /security-audit inside a project to see its score here.'));
    return;
  }
  const tally = { red: 0, orange: 0, yellow: 0, green: 0, gray: 0 };
  for (const p of state.projects) { const c = displayColor(p); tally[c] = (tally[c] || 0) + 1; }
  const total = state.projects.length;
  const chips = el('div', { class: 'sec-list-tally' });
  for (const c of ['red', 'orange', 'yellow', 'green', 'gray']) {
    if (!tally[c]) continue;
    chips.append(el('span', { class: 'sec-tally', dataset: { color: c }, title: `${tally[c]} ${TALLY_WORD[c]}` },
      el('span', { class: 'sec-tile-dot sm', dataset: { color: c } }),
      el('span', { text: String(tally[c]) })));
  }
  listHost.append(el('div', { class: 'sec-list-head' },
    el('span', { class: 'sec-list-head-label', text: total === 1 ? '1 project' : `${total} projects` }),
    chips));
  for (const p of state.projects) listHost.append(projectTile(p));
}

async function openProject(slug, keep, stamp) {
  state.current = slug; state.mode = 'report'; state.currentStamp = stamp || null;
  if (!keep) listHost.querySelectorAll('.sec-tile').forEach((b) => b.setAttribute('aria-current', String(b === document.activeElement)));
  renderList();
  clear(paneHost);
  paneHost.append(el('div', { class: 'sec-loading cm-caption muted', text: 'Loading report…' }));
  try {
    const q = '/api/security/report?slug=' + encodeURIComponent(slug) + (stamp ? '&stamp=' + encodeURIComponent(stamp) : '');
    // The timeline (audit history + resolved log) is derived from every retained
    // report, so it recomputes on each open — re-running /security-audit updates
    // it with no button to press. It's best-effort; the report still shows without it.
    const [rep, tl] = await Promise.all([
      get(q),
      get('/api/security/timeline?slug=' + encodeURIComponent(slug)).catch(() => null),
    ]);
    renderReport(rep.report, tl);
  } catch (e) {
    clear(paneHost);
    paneHost.append(emptyState('shield', 'No report', e.code === 'NOT_FOUND' ? 'This project has not been audited yet.' : e.message));
  }
}

async function showRulebook() {
  state.mode = 'rulebook'; state.current = null;
  renderList();
  clear(paneHost);
  paneHost.append(el('div', { class: 'sec-loading cm-caption muted', text: 'Loading rulebook…' }));
  try {
    const data = await get('/api/security/rulebook');
    clear(paneHost);
    if (!data.exists) { paneHost.append(emptyState('folder-2', 'No rulebook', 'SECURITY_PROTOCOLS.md was not found in the brain.')); return; }
    paneHost.append(el('div', { class: 'file-preview scrolly' }, renderMarkdown(data.raw)));
  } catch (e) {
    clear(paneHost);
    paneHost.append(emptyState('folder-2', 'Could not load rulebook', e.message));
  }
}

function renderPane() {
  clear(paneHost);
  paneHost.append(emptyState('shield', 'Pick a project', 'Choose a project on the left to see its latest security report, or open the Rulebook.'));
}

const SEV_COLOR = { critical: 'red', major: 'red', minor: 'yellow', trivial: 'gray', info: 'gray' };
const STATUS_LABEL = { green: 'green', yellow: 'yellow', red: 'red', gray: 'unverified', off: 'off' };

function renderReport(r, tl) {
  clear(paneHost);
  if (!r || typeof r !== 'object' || !r.project) {
    paneHost.append(emptyState('shield', 'Unreadable report', 'This report file is malformed and was skipped.'));
    return;
  }
  const rc = r.summary?.ruleCounts || {}, fc = r.summary?.findingCounts || {};
  const metrics = el('div', { class: 'sec-head-metrics' },
    rulesMetric(rc),
    findingsMetric(fc),
    r.suppressed?.count ? metricBox('Suppressed', el('span', { class: 'sec-metric-num', text: String(r.suppressed.count) })) : null,
  );
  const st = statusSummary(r);
  const head = el('div', { class: 'sec-report-head' },
    el('span', { class: 'sec-tile-dot lg', dataset: { color: st.color } }),
    el('div', { class: 'sec-head-title' },
      el('div', { class: 'cm-h4 ellip', text: r.project.name || r.project.slug || 'Project' }),
      el('div', { class: 'cm-caption sec-head-sub' },
        el('span', { class: 'sec-status-word', dataset: { color: st.color }, text: st.label }),
        el('span', { class: 'muted', text: ` · ${longDate(r.run?.iso)}` })),
    ),
    el('span', { class: 'grow' }),
    metrics,
  );
  paneHost.append(head);

  // Viewing an older snapshot from the audit history (not the latest run).
  const newestStamp = tl?.runs?.[0]?.stamp || null;
  if (state.currentStamp && newestStamp && state.currentStamp !== newestStamp) {
    paneHost.append(el('div', { class: 'sec-snapshot-banner' },
      icon('clock', { size: 14 }),
      el('span', { class: 'grow', text: `You're viewing an older snapshot from ${relTime(r.run?.iso)}.` }),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openProject(state.current) }, 'Back to latest')));
  }

  if (r.run?.dimensionProblem) {
    const bad = (r.run.dimensions || []).filter((d) => d.status !== 'ok').map((d) => `${d.name} (${d.status})`);
    paneHost.append(el('div', { class: 'sec-warn' }, icon('shield', { size: 14 }),
      el('span', { text: `Incomplete audit — ${bad.join(', ')}. The score can't be green until every check reports.` })));
  }

  const body = el('div', { class: 'sec-report-body scrolly' });
  paneHost.append(body);

  // rules needing attention
  const rules = (Array.isArray(r.rules) ? r.rules : []).filter((x) => x && x.status && x.status !== 'green' && x.status !== 'off');
  rules.sort((a, b) => (b.rank || 0) - (a.rank || 0));
  if (rules.length) {
    body.append(el('div', { class: 'cm-h4 sec-section', text: 'Rules needing attention' }));
    for (const x of rules) {
      body.append(el('div', { class: 'sec-rule' },
        el('span', { class: 'id-badge', dataset: { color: statusColor(x.status) }, text: String(x.id || '?') }),
        el('span', { class: 'sec-rule-status cm-caption', dataset: { color: statusColor(x.status) }, text: STATUS_LABEL[x.status] || x.status }),
        el('span', { class: 'sec-rule-note cm-caption muted', text: ruleWhy(x) }),
      ));
    }
  }

  // findings (non-suppressed), worst first
  const sevOrder = { critical: 0, major: 1, minor: 2, trivial: 3, info: 4 };
  const findings = (Array.isArray(r.findings) ? r.findings : []).filter((f) => f && !f.suppressed);
  findings.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));
  if (findings.length) {
    body.append(el('div', { class: 'cm-h4 sec-section', text: 'Findings' }));
    for (const f of findings) body.append(findingCard(f));
  }

  if (!rules.length && !findings.length) {
    body.append(el('div', { class: 'sec-clear' }, icon('check-circle', { size: 16 }),
      el('span', { text: 'No open issues. Every checked rule is green with evidence.' })));
  }

  renderResolved(body, tl);
  renderAuditHistory(body, tl);
}

// Prior issues that were flagged in an earlier audit but are gone from the latest
// report — i.e. they got fixed. This is the "audit history" of what was resolved.
function renderResolved(body, tl) {
  const resolved = Array.isArray(tl?.resolved) ? tl.resolved : [];
  if (!resolved.length) return;
  const chev = el('span', { class: 'cat-chev', dataset: { open: String(resolvedOpen) } }, icon('chevron-down', { size: 16 }));
  const list = el('div', { class: 'sec-resolved-list' });
  list.hidden = !resolvedOpen;
  const head = el('button', {
    class: 'cm-h4 sec-section sec-collapse-head', type: 'button', 'aria-expanded': String(resolvedOpen),
    onclick: () => {
      resolvedOpen = !resolvedOpen;
      list.hidden = !resolvedOpen;
      chev.dataset.open = String(resolvedOpen);
      head.setAttribute('aria-expanded', String(resolvedOpen));
    },
  },
    el('span', { text: 'Prior issues — resolved' }),
    el('span', { class: 'sec-count-pill', dataset: { color: 'green' }, text: String(resolved.length) }),
    chev,
  );
  for (const f of resolved) {
    const loc = f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : null;
    const sev = String(f.severity || 'minor').toLowerCase();
    list.append(el('div', { class: 'sec-resolved' },
      icon('check-circle', { size: 15 }),
      el('div', { class: 'sec-resolved-body' },
        el('div', { class: 'sec-resolved-top' },
          el('span', { class: 'id-badge', dataset: { color: SEV_COLOR[sev] || 'gray' }, text: sev.toUpperCase() }),
          el('span', { class: 'sec-finding-cat cm-caption muted', text: [f.category, f.ruleId].filter(Boolean).join(' · ') }),
          loc ? el('span', { class: 'sec-finding-loc cm-caption mono ellip', title: loc, text: loc }) : null,
        ),
        f.whatCouldGoWrong ? el('div', { class: 'sec-resolved-what cm-caption muted', text: f.whatCouldGoWrong }) : null,
        el('div', { class: 'sec-resolved-meta cm-caption muted', text:
          `Fixed ${relTime(f.resolvedIso)} · first seen ${relTime(f.firstIso)}` + (f.wasSuppressed ? ' · was an accepted risk' : '') }),
      )));
  }
  body.append(head, list);
}

// The full run history — every dated audit, newest first. Click one to load that
// snapshot into the pane. Updates on its own whenever a new audit is written.
function renderAuditHistory(body, tl) {
  const runs = Array.isArray(tl?.runs) ? tl.runs : [];
  if (runs.length < 2) return;
  const active = state.currentStamp || runs[0].stamp;
  body.append(el('div', { class: 'cm-h4 sec-section' },
    el('span', { text: 'Audit history' }),
    el('span', { class: 'sec-count-pill', text: String(runs.length) })));
  const list = el('div', { class: 'sec-runs' });
  runs.forEach((run, i) => {
    const openTxt = run.open == null ? '' : (run.open === 0 ? 'no open findings' : `${run.open} open`);
    list.append(el('button', {
      class: 'sec-run', type: 'button',
      'aria-current': String(run.stamp === active),
      onclick: () => openProject(state.current, false, i === 0 ? undefined : run.stamp),
    },
      el('span', { class: 'sec-tile-dot sm', dataset: { color: run.color || 'gray' } }),
      el('span', { class: 'sec-run-when', text: runStamp(run.iso) + (i === 0 ? ' · latest' : '') }),
      el('span', { class: 'sec-run-meta cm-caption muted ellip', text: [run.depth ? run.depth + ' scan' : null, openTxt].filter(Boolean).join(' · ') }),
    ));
  });
  body.append(list);
}

function findingCard(f) {
  const sev = String(f.severity || 'minor').toLowerCase();
  const loc = f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : 'no location';
  const also = Array.isArray(f.alsoFlaggedBy) && f.alsoFlaggedBy.length > 1 ? `also flagged by ${f.alsoFlaggedBy.join(', ')}` : null;
  return el('div', { class: 'sec-finding cm-soft-card' },
    el('div', { class: 'sec-finding-top' },
      el('span', { class: 'id-badge', dataset: { color: SEV_COLOR[sev] || 'gray' }, text: sev.toUpperCase() }),
      el('span', { class: 'sec-finding-cat cm-caption muted', text: [f.category, f.ruleId].filter(Boolean).join(' · ') }),
      el('span', { class: 'sec-finding-loc cm-caption mono ellip', title: loc, text: loc }),
    ),
    f.whatCouldGoWrong ? el('div', { class: 'sec-finding-line', text: f.whatCouldGoWrong }) : null,
    f.fix ? el('div', { class: 'sec-finding-fix cm-caption' }, el('span', { class: 'sec-fix-label', text: 'Fix: ' }), el('span', { text: String(f.fix) })) : null,
    also ? el('div', { class: 'sec-finding-also cm-caption muted', text: also }) : null,
  );
}

function statusColor(s) {
  return s === 'red' ? 'red' : s === 'yellow' ? 'yellow' : s === 'green' ? 'green' : 'gray';
}
function ruleWhy(x) {
  if (x.downgradedFrom) return `downgraded from ${x.downgradedFrom}` + (x.note ? ` — ${x.note}` : '');
  if (x.note) return x.note;
  return x.result === 'fail' ? 'check failed' : 'not verified';
}
function metricBox(label, valueEl) {
  return el('div', { class: 'sec-metric' },
    el('div', { class: 'sec-metric-label', text: label }),
    valueEl);
}
// Spelled-out labels so each dot reads as a word, not just a colour.
const RULE_WORD = { green: 'passing', yellow: 'warnings', red: 'at risk', gray: 'unverified' };
function rulesMetric(rc) {
  const val = el('div', { class: 'sec-metric-dots' });
  for (const c of ['green', 'yellow', 'red', 'gray']) {
    val.append(el('span', { class: 'sec-metric-dot' },
      el('span', { class: 'sec-tile-dot sm', dataset: { color: c } }),
      el('span', { class: 'sec-metric-num', text: String(rc[c] || 0) }),
      el('span', { class: 'sec-sev-label', text: RULE_WORD[c] })));
  }
  return metricBox('Rules', val);
}
// Same dot style as the rules metric: a colour dot carries the severity
// (critical=red, major=orange, minor=yellow) so the number itself stays white.
const SEV_META = [
  ['critical', 'critical', 'red'],
  ['major', 'major', 'orange'],
  ['minor', 'minor', 'yellow'],
];
function findingsMetric(fc) {
  const val = el('div', { class: 'sec-metric-dots' });
  for (const [key, label, color] of SEV_META) {
    val.append(el('span', { class: 'sec-metric-dot' },
      el('span', { class: 'sec-tile-dot sm', dataset: { color } }),
      el('span', { class: 'sec-metric-num', text: String(fc[key] || 0) }),
      el('span', { class: 'sec-sev-label', text: label })));
  }
  return metricBox('Findings', val);
}
