// Shared board model for the Board + Integrations views.
// Holds local edits + dirty state; one save path (Update foundation).
import { get, post } from './api.js';
import { toast } from './ui.js';
import { RULE_ID_TO_CAT } from './categories.js';

const state = {
  sections: null,   // { key: { prefix, columns, rows:[{id, cells}] } }
  baseHash: null,
  dirty: false,
  listeners: new Set(),
};

function emit() { for (const fn of state.listeners) fn(state); }

export function onBoardChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }

export async function loadBoard(force = false) {
  if (state.sections && !force) return state;
  const data = await get('/api/board');
  state.sections = data.sections;
  state.baseHash = data.baseHash;
  state.dirty = false;
  emit();
  return state;
}

export function boardState() { return state; }

export function markDirty() { state.dirty = true; emit(); }

export function updateRow(sectionKey, id, cells, icon) {
  const rows = state.sections[sectionKey].rows;
  const row = rows.find((r) => r.id === id);
  if (row) { row.cells = cells; if (icon !== undefined) row.icon = icon; markDirty(); }
}

export function addRow(sectionKey, cells, access, category, icon) {
  state.sections[sectionKey].rows.push({ id: null, cells, access, category, icon });
  markDirty();
}

// Integration bucket permissions (read/write/full → allow/ask/block via color).
export function setIntBucket(row, bucket, color) {
  row.perms = { read: 'green', write: 'yellow', full: 'red', ...(row.perms || {}), [bucket]: color };
  markDirty();
}

export function setIntMaster(row, color) {
  row.perms = { read: color, write: color, full: color };
  markDirty();
}

// Move a rule to another color (green/yellow/red). It re-ids on save; access travels with it.
// The category must be resolved BEFORE the move: built-in rules carry no
// explicit category (theirs comes from the static ID map), and the moved row
// gets id:null then a brand-new ID on save — so without pinning the category
// here the rule would fall into "Other" and look like it vanished.
export function setRuleColor(fromKey, row, toKey) {
  if (fromKey === toKey) return;
  const from = state.sections[fromKey];
  from.rows = from.rows.filter((r) => r !== row);
  const cells = row.cells.slice(); cells[0] = '';
  const category = row.category || RULE_ID_TO_CAT[row.id] || undefined;
  state.sections[toKey].rows.push({ id: null, cells, access: row.access, category, icon: row.icon });
  markDirty();
}

export function deleteRow(sectionKey, id) {
  const s = state.sections[sectionKey];
  s.rows = s.rows.filter((r) => r.id !== id);
  markDirty();
}

export function deleteNewRow(sectionKey, rowRef) {
  const s = state.sections[sectionKey];
  s.rows = s.rows.filter((r) => r !== rowRef);
  markDirty();
}

export async function saveBoard(summary) {
  const sections = {};
  for (const [key, s] of Object.entries(state.sections)) {
    sections[key] = { rows: s.rows.map((r) => ({ id: r.id, cells: r.cells, access: r.access, perms: r.perms, category: r.category, icon: r.icon })) };
  }
  const res = await post('/api/board', { baseHash: state.baseHash, sections, summary });
  const added = Object.values(res.assignedIds || {}).flat();
  const bits = [];
  if (added.length) bits.push('added ' + added.join(', '));
  if (res.editedIds?.length) bits.push('edited ' + res.editedIds.join(', '));
  if (res.deletedIds?.length) bits.push('retired ' + res.deletedIds.join(', '));
  toast('Foundation updated', (bits.join('; ') || 'saved') + ' — logged to the brain. CLI sessions pick this up on next launch.');
  for (const w of res.warnings || []) toast('Warning', w, 'err');
  await loadBoard(true);
  return res;
}

export async function discardBoard() {
  await loadBoard(true);
}
