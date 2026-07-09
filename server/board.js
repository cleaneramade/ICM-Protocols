// APPROVAL_POLICY.md round-trip: section-anchored table parse + serialize.
// Guarantees: prose is never touched (verbatim lines); unmodified rows re-emit
// their original raw line; zero-edit round-trips are byte-identical by
// construction; a self-check re-parse gates every write.
import fs from 'node:fs/promises';
import { PATHS } from './config.js';
import { readFileTracked, backupThenAtomicWrite } from './fsio.js';
import { httpError } from './router.js';

export const SECTIONS = [
  { key: 'green', prefix: 'G', heading: /^## GREEN\b/ },
  { key: 'yellow', prefix: 'Y', heading: /^## YELLOW\b/ },
  { key: 'red', prefix: 'R', heading: /^## RED\b/ },
  { key: 'zones', prefix: 'Z', heading: /^## Path zones\b/ },
  { key: 'integrations', prefix: 'I', heading: /^## Integrations\b/ },
];

const ALIGN_ROW = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/;

export function splitCells(line) {
  // Honors \| escapes. Returns trimmed cells between the outer pipes.
  const cells = [];
  let cur = '';
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') {
      if (!started) { started = true; continue; } // leading pipe
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  // text after the final pipe is ignored (trailing whitespace)
  return cells;
}

function renderCell(text) {
  return String(text).replace(/\|/g, '\\|');
}

export function renderRow(cells) {
  return '| ' + cells.map(renderCell).join(' | ') + ' |';
}

// Parse the policy text (logical: no BOM, any EOL) into a structured model.
export function parseBoard(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const model = { lines, sections: {} };
  for (const def of SECTIONS) {
    let headingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (def.heading.test(lines[i])) { headingIdx = i; break; }
    }
    if (headingIdx === -1) throw httpError(422, 'SECTION_MISSING', `Section for ${def.key} not found in APPROVAL_POLICY.md`);
    let sectionEnd = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) { sectionEnd = i; break; }
    }
    // first consecutive run of '|' lines inside the section
    let tStart = -1;
    for (let i = headingIdx + 1; i < sectionEnd; i++) {
      if (lines[i].startsWith('|')) { tStart = i; break; }
    }
    if (tStart === -1) throw httpError(422, 'TABLE_MISSING', `No table found in the ${def.key} section`);
    let tEnd = tStart;
    while (tEnd < sectionEnd && lines[tEnd].startsWith('|')) tEnd++;
    const headerLine = lines[tStart];
    const alignLine = lines[tStart + 1];
    if (!alignLine || !ALIGN_ROW.test(alignLine)) {
      throw httpError(422, 'BAD_TABLE', `Missing/invalid alignment row under the ${def.key} table (line ${tStart + 2})`);
    }
    const columns = splitCells(headerLine);
    const rows = [];
    for (let i = tStart + 2; i < tEnd; i++) {
      const cells = splitCells(lines[i]);
      if (cells.length !== columns.length) {
        throw httpError(422, 'BAD_ROW', `Row at line ${i + 1} has ${cells.length} cells, expected ${columns.length}: ${lines[i]}`);
      }
      rows.push({ id: cells[0], cells, raw: lines[i] });
    }
    model.sections[def.key] = {
      key: def.key, prefix: def.prefix, columns,
      headingIdx, tableStart: tStart, tableEnd: tEnd, rows,
    };
  }
  return model;
}

// Public JSON shape for the API.
export function toJson(model) {
  const out = {};
  for (const def of SECTIONS) {
    const s = model.sections[def.key];
    out[def.key] = { prefix: s.prefix, columns: s.columns, rows: s.rows.map((r) => ({ id: r.id, cells: r.cells })) };
  }
  return out;
}

async function loadRetired() {
  try { return JSON.parse(await fs.readFile(PATHS.retiredIds, 'utf8')); }
  catch { return { G: [], Y: [], R: [], Z: [], I: [] }; }
}

async function saveRetired(retired) {
  await backupThenAtomicWrite(PATHS.retiredIds, JSON.stringify(retired, null, 2) + '\n', {});
}

async function loadAccess() {
  try { return JSON.parse(await fs.readFile(PATHS.ruleAccess, 'utf8')); }
  catch { return {}; }
}

async function saveAccess(map) {
  await backupThenAtomicWrite(PATHS.ruleAccess, JSON.stringify(map, null, 2) + '\n', {});
}

async function loadRuleCat() {
  try { return JSON.parse(await fs.readFile(PATHS.ruleCat, 'utf8')); }
  catch { return {}; }
}
async function saveRuleCat(map) {
  await backupThenAtomicWrite(PATHS.ruleCat, JSON.stringify(map, null, 2) + '\n', {});
}

async function loadRuleIcon() {
  try { return JSON.parse(await fs.readFile(PATHS.ruleIcon, 'utf8')); }
  catch { return {}; }
}
async function saveRuleIcon(map) {
  await backupThenAtomicWrite(PATHS.ruleIcon, JSON.stringify(map, null, 2) + '\n', {});
}

// Deleted-rule history (restorable). A list, newest first.
async function loadDeleted() {
  try { const v = JSON.parse(await fs.readFile(PATHS.deletedRules, 'utf8')); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
async function saveDeleted(list) {
  await backupThenAtomicWrite(PATHS.deletedRules, JSON.stringify(list, null, 2) + '\n', {});
}

const RULE_SECTION_KEYS = new Set(['green', 'yellow', 'red']);

const DEFAULT_INT_PERMS = { read: 'green', write: 'yellow', full: 'red' };

async function loadIntPerms() {
  try { return JSON.parse(await fs.readFile(PATHS.intPerms, 'utf8')); }
  catch { return {}; }
}

async function saveIntPerms(map) {
  await backupThenAtomicWrite(PATHS.intPerms, JSON.stringify(map, null, 2) + '\n', {});
}

// Sensible default access level for a rule from its text.
export function inferAccess(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(read|reads|view|list|preview|see)\b/.test(t)) return 'read';
  if (/\b(delete|force|destroy|destructive|wipe|production|reveal|secret|publish|deploy)\b/.test(t)) return 'full';
  return 'write';
}

function idNumber(id, prefix) {
  const m = new RegExp('^' + prefix + '-(\\d+)$').exec(id);
  return m ? parseInt(m[1], 10) : null;
}

function nextId(prefix, usedNumbers) {
  const n = (usedNumbers.length ? Math.max(...usedNumbers) : 0) + 1;
  return prefix + '-' + String(n).padStart(2, '0');
}

// Apply an edited model {sections:{key:{rows:[{id,cells}]}}} to the current file model.
// Returns { newRowsBySection, assignedIds, deletedIds } or throws 400s.
export function applyEdits(fileModel, editedSections, retired) {
  const newRowsBySection = {};
  const assignedIds = {};
  const deletedIds = [];
  const deletedRows = [];
  const editedIds = [];
  const addedRules = [];
  for (const def of SECTIONS) {
    const fileSec = fileModel.sections[def.key];
    const edited = editedSections?.[def.key];
    if (!edited || !Array.isArray(edited.rows)) {
      // section not provided → unchanged
      newRowsBySection[def.key] = fileSec.rows.slice();
      continue;
    }
    const fileById = new Map(fileSec.rows.map((r) => [r.id, r]));
    const seen = new Set();
    const usedNumbers = fileSec.rows.map((r) => idNumber(r.id, def.prefix)).filter((n) => n !== null)
      .concat((retired[def.prefix] || []).map((id) => idNumber(id, def.prefix)).filter((n) => n !== null));
    const outRows = [];
    for (const row of edited.rows) {
      if (!Array.isArray(row.cells) || row.cells.length !== fileSec.columns.length) {
        throw httpError(400, 'BAD_CELLS', `${def.key}: each row needs exactly ${fileSec.columns.length} cells`);
      }
      for (const c of row.cells) {
        if (/[\r\n]/.test(String(c))) throw httpError(400, 'BAD_CELLS', `${def.key}: cells cannot contain line breaks`);
      }
      let id = row.id;
      if (id == null || id === '') {
        id = nextId(def.prefix, usedNumbers);
        usedNumbers.push(idNumber(id, def.prefix));
        (assignedIds[def.key] ||= []).push(id);
        const cells = row.cells.slice();
        cells[0] = id;
        addedRules.push(`${id}: ${cells[1] || ''}`);
        outRows.push({ id, cells, raw: null, access: row.access, perms: row.perms, category: row.category, icon: row.icon });
      } else {
        const existing = fileById.get(id);
        if (!existing) throw httpError(400, 'UNKNOWN_ID', `${def.key}: row ${id} does not exist (IDs are immutable — new rows use id:null)`);
        if (seen.has(id)) throw httpError(400, 'DUP_ID', `${def.key}: duplicate row ${id}`);
        const cells = row.cells.slice();
        if (cells[0] !== id) throw httpError(400, 'ID_CELL', `${def.key}: first cell of ${id} must be the ID itself`);
        const unchanged = existing.cells.length === cells.length && existing.cells.every((c, i) => c === cells[i]);
        if (!unchanged) editedIds.push(id);
        outRows.push({ id, cells, raw: unchanged ? existing.raw : null, access: row.access, perms: row.perms, category: row.category, icon: row.icon });
      }
      seen.add(id);
    }
    for (const r of fileSec.rows) {
      if (!seen.has(r.id)) {
        deletedIds.push(r.id);
        deletedRows.push({ id: r.id, section: def.key, cells: r.cells.slice() });
        (retired[def.prefix] ||= []).push(r.id);
      }
    }
    newRowsBySection[def.key] = outRows;
  }
  return { newRowsBySection, assignedIds, deletedIds, deletedRows, editedIds, addedRules };
}

// Rebuild the full text with new table rows per section. Everything else verbatim.
export function serializeBoard(fileModel, newRowsBySection) {
  const replacements = SECTIONS.map((def) => {
    const s = fileModel.sections[def.key];
    const rows = newRowsBySection[def.key];
    const lines = [s.lines?.header ?? fileModel.lines[s.tableStart], fileModel.lines[s.tableStart + 1]];
    for (const r of rows) lines.push(r.raw != null ? r.raw : renderRow(r.cells));
    return { start: s.tableStart, end: s.tableEnd, lines };
  }).sort((a, b) => a.start - b.start);

  const out = [];
  let idx = 0;
  for (const rep of replacements) {
    while (idx < rep.start) out.push(fileModel.lines[idx++]);
    out.push(...rep.lines);
    idx = rep.end;
  }
  while (idx < fileModel.lines.length) out.push(fileModel.lines[idx++]);
  return out.join('\n');
}

function deepEqualRows(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].cells.length !== b[i].cells.length) return false;
    for (let j = 0; j < a[i].cells.length; j++) if (a[i].cells[j] !== b[i].cells[j]) return false;
  }
  return true;
}

// Full save pipeline used by the API.
export async function saveBoard(editedSections, baseHash, meta = {}) {
  const t = await readFileTracked(PATHS.policy);
  if (baseHash && baseHash !== t.hash) throw httpError(409, 'STALE', 'APPROVAL_POLICY.md changed on disk — reload the board');
  const fileModel = parseBoard(t.text);
  const retired = await loadRetired();
  // Snapshot the old sidecars before applyEdits so deleted rows keep their level/category/icon.
  const oldAccess = await loadAccess();
  const oldRuleCat = await loadRuleCat();
  const oldRuleIcon = await loadRuleIcon();
  const { newRowsBySection, assignedIds, deletedIds, deletedRows, editedIds, addedRules } = applyEdits(fileModel, editedSections, retired);
  const newText = serializeBoard(fileModel, newRowsBySection);

  // self-check gate: the serialized output must re-parse to exactly the intended model
  const reparsed = parseBoard(newText);
  for (const def of SECTIONS) {
    if (!deepEqualRows(reparsed.sections[def.key].rows, newRowsBySection[def.key])) {
      throw httpError(422, 'SELF_CHECK_FAILED', `Serializer self-check failed for ${def.key} — nothing was written`);
    }
  }

  const newHash = await backupThenAtomicWrite(PATHS.policy, newText, { bom: t.bom, eol: t.eol, expectedHash: t.hash });
  if (deletedIds.length) await saveRetired(retired);

  // Record deleted rules (green/yellow/red) into the restorable history.
  const toRecord = (deletedRows || []).filter((d) => RULE_SECTION_KEYS.has(d.section) && !meta.skipDeletedHistory);
  if (toRecord.length) {
    const hist = await loadDeleted();
    const now = new Date().toISOString();
    for (const d of toRecord) {
      const rec = {
        recordId: d.id, section: d.section, cells: d.cells,
        name: d.cells[1] || d.id, description: d.cells[2] || '', details: d.cells[3] || '',
        category: oldRuleCat[d.id] || null,
        access: oldAccess[d.id] || inferAccess(d.cells[1]),
        icon: oldRuleIcon[d.id] || null,
        deletedAt: now,
      };
      const i = hist.findIndex((h) => h.recordId === rec.recordId);
      if (i >= 0) hist[i] = rec; else hist.unshift(rec);
    }
    await saveDeleted(hist);
  }

  // Persist the per-rule access sidecar, keyed by the FINAL rule ids.
  const access = {};
  for (const key of ['green', 'yellow', 'red']) {
    for (const row of newRowsBySection[key]) {
      if (row.access) access[row.id] = row.access;
    }
  }
  await saveAccess(access);

  // Persist the category of user-added rules (keyed by final id).
  const ruleCat = { ...(await loadRuleCat()) };
  const liveRuleIds = new Set(['green', 'yellow', 'red'].flatMap((k) => (newRowsBySection[k] || []).map((r) => r.id)));
  for (const id of Object.keys(ruleCat)) if (!liveRuleIds.has(id)) delete ruleCat[id];
  for (const key of ['green', 'yellow', 'red']) {
    for (const row of newRowsBySection[key] || []) if (row.category) ruleCat[row.id] = row.category;
  }
  await saveRuleCat(ruleCat);

  // Persist the chosen icon of rules (keyed by final id).
  const ruleIcon = { ...(await loadRuleIcon()) };
  for (const id of Object.keys(ruleIcon)) if (!liveRuleIds.has(id)) delete ruleIcon[id];
  for (const key of ['green', 'yellow', 'red']) {
    for (const row of newRowsBySection[key] || []) if (row.icon) ruleIcon[row.id] = row.icon;
  }
  await saveRuleIcon(ruleIcon);

  // Persist integration bucket colors (read/write/full → allow/ask/block).
  const iperms = { ...(await loadIntPerms()) };
  const liveInt = new Set((newRowsBySection.integrations || []).map((r) => r.id));
  for (const id of Object.keys(iperms)) if (!liveInt.has(id)) delete iperms[id];
  for (const row of newRowsBySection.integrations || []) {
    if (row.perms) iperms[row.id] = row.perms;
  }
  await saveIntPerms(iperms);

  return { newHash, assignedIds, deletedIds, editedIds, addedRules, changed: { ...meta } };
}

export async function getBoard() {
  // First run on a new machine: no brain yet. Say so plainly instead of a 500.
  const t = await readFileTracked(PATHS.policy).catch((e) => {
    if (e && e.code === 'ENOENT') {
      throw httpError(424, 'NOT_SET_UP', 'No rules file found yet. Run "node tools/init-brain.mjs" in the app folder to create the starter setup, then restart. The Help page (question mark, bottom left) walks you through it.');
    }
    throw e;
  });
  const model = parseBoard(t.text);
  const sections = toJson(model);
  const access = await loadAccess();
  const ruleCat = await loadRuleCat();
  const ruleIcon = await loadRuleIcon();
  for (const key of ['green', 'yellow', 'red']) {
    for (const row of sections[key].rows) {
      row.access = access[row.id] || inferAccess(row.cells[1]);
      if (ruleCat[row.id]) row.category = ruleCat[row.id];
      if (ruleIcon[row.id]) row.icon = ruleIcon[row.id];
    }
  }
  const intPerms = await loadIntPerms();
  for (const row of sections.integrations.rows) {
    row.perms = { ...DEFAULT_INT_PERMS, ...(intPerms[row.id] || {}) };
  }
  return { sections, baseHash: t.hash };
}

export async function listDeleted() {
  return { deleted: await loadDeleted() };
}

// Restore a deleted rule back into its original color + category (as a fresh id).
// Immediate server write — the caller reloads the board afterward.
export async function restoreDeleted(recordId) {
  const hist = await loadDeleted();
  const rec = hist.find((h) => h.recordId === recordId);
  if (!rec) throw httpError(404, 'NO_RECORD', 'That deleted rule is no longer in the history');
  const t = await readFileTracked(PATHS.policy);
  const fileModel = parseBoard(t.text);
  const access = await loadAccess();
  const ruleCat = await loadRuleCat();
  const ruleIcon = await loadRuleIcon();
  // Re-supply every live rule row (with its level+category+icon) so the sidecars
  // are rebuilt intact, then append the restored row to its original section.
  const editedSections = {};
  for (const key of ['green', 'yellow', 'red']) {
    editedSections[key] = {
      rows: fileModel.sections[key].rows.map((r) => ({
        id: r.id, cells: r.cells.slice(),
        access: access[r.id] || inferAccess(r.cells[1]),
        category: ruleCat[r.id] || undefined,
        icon: ruleIcon[r.id] || undefined,
      })),
    };
  }
  const target = RULE_SECTION_KEYS.has(rec.section) ? rec.section : 'yellow';
  const cells = rec.cells.slice(); cells[0] = '';
  editedSections[target].rows.push({ id: null, cells, access: rec.access, category: rec.category || undefined, icon: rec.icon || undefined });
  const result = await saveBoard(editedSections, null, { summary: `restored “${rec.name}”`, skipDeletedHistory: true });
  await saveDeleted(hist.filter((h) => h.recordId !== recordId));
  const restoredId = (result.assignedIds?.[target] || [])[0] || null;
  return { restoredId, section: target, name: rec.name };
}

export async function purgeDeleted(recordId) {
  const hist = await loadDeleted();
  if (!hist.some((h) => h.recordId === recordId)) throw httpError(404, 'NO_RECORD', 'Not in the deleted list');
  await saveDeleted(hist.filter((h) => h.recordId !== recordId));
  return { ok: true };
}
