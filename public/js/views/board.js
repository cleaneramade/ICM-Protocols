// Rules view — the folder-icon category accordion,
// with a connector-style permission pattern inside: rules grouped by access
// (Read-only / Write / Full access), each rule a row with a 3-state
// allow / needs-approval / block toggle. Green=allow, Yellow=ask, Red=never.
import { el, clear, icon, dialog, confirmDialog, field, input, textarea, permToggle, toast } from '../ui.js';
import { loadBoard, boardState, onBoardChange, updateRow, addRow, deleteRow, deleteNewRow, setRuleColor } from '../boardstore.js';
import { groupRules, RULE_CATEGORIES } from '../categories.js';
import { get, post } from '../api.js';

const CAT_NAME = Object.fromEntries(RULE_CATEGORIES.map((c) => [c.key, c.name]));
const COLOR_WORD = { green: 'Allow', yellow: 'Ask', red: 'Block' };

const SECTION_TO_PERM = { green: 'allow', yellow: 'ask', red: 'block' };
const PERM_TO_SECTION = { allow: 'green', ask: 'yellow', block: 'red' };
const ACCESS_ICON = { read: 'eye', write: 'pencil', full: 'trash' };
const ACCESS_ORDER = { read: 0, write: 1, full: 2 };

// Icons offered in the Add/Edit-rule picker (Solar outline; color follows the rule's color).
const ICON_CHOICES = [
  'eye', 'pencil', 'trash', 'lock', 'shield-check', 'code-2', 'server-2', 'bolt',
  'layers', 'settings', 'folder-2', 'file', 'database', 'book', 'dollar', 'bell',
  'calendar', 'clock-circle', 'download', 'copy', 'magic-stick-3', 'box', 'monitor',
  'users-group-rounded', 'graph-up', 'tag', 'wallet',
];

// Scrollable icon carousel: a strip of tiles you scroll (drag/trackpad) and
// click to select. Edges fade in/out; the selected tile takes the rule color.
function iconPicker(section, current) {
  let selected = ICON_CHOICES.includes(current) ? current : 'eye';
  const tiles = {};
  const strip = el('div', { class: 'icon-strip' });
  const select = (name) => { selected = name; for (const [n, t] of Object.entries(tiles)) t.dataset.selected = String(n === name); };
  for (const name of ICON_CHOICES) {
    const t = el('button', { class: 'icon-choice', type: 'button', title: name, dataset: { color: section, selected: String(name === selected) }, onclick: () => select(name) }, icon(name, { size: 20 }));
    tiles[name] = t;
    strip.append(t);
  }
  strip.getIcon = () => selected;
  // Only fade the edge that still has icons past it — no fade at the true ends.
  const updateFade = () => {
    const max = strip.scrollWidth - strip.clientWidth;
    strip.dataset.atStart = String(strip.scrollLeft <= 1);
    strip.dataset.atEnd = String(strip.scrollLeft >= max - 1);
  };
  strip.addEventListener('scroll', updateFade);
  // center the pre-selected tile once the dialog is in the DOM, then set fades
  setTimeout(() => {
    const t = tiles[selected];
    if (t) strip.scrollLeft = Math.max(0, t.offsetLeft - strip.clientWidth / 2 + t.clientWidth / 2);
    updateFade();
  }, 0);
  return strip;
}

let container = null;
let unsub = null;
let deleted = [];
let wasDirty = false;
const open = new Set();

export async function boardView(root, actions) {
  container = root;
  await loadBoard();
  await loadDeletedList();
  wasDirty = boardState().dirty;
  actions.append(headerLegend());
  unsub?.();
  unsub = onBoardChange(async () => {
    if (!document.contains(container)) return;
    const d = boardState().dirty;
    if (wasDirty && !d) await loadDeletedList(); // a save/discard just landed — refresh history
    wasDirty = d;
    render();
  });
  render();
}

async function loadDeletedList() {
  try { deleted = (await get('/api/deleted')).deleted || []; }
  catch { deleted = []; }
}

function render() {
  const s = boardState();
  clear(container);
  if (!s.sections) return;
  const list = el('div', { class: 'cat-list' });
  for (const cat of groupRules(s.sections)) list.append(categoryCard(cat));
  container.append(list);
  const del = deletedSection();
  if (del) container.append(del);
}

// Legend in the header actions area — tile style, no descriptions (like Connections).
function headerLegend() {
  const item = (iconName, color, label) => el('div', { class: 'legend-item' },
    el('span', { class: 'legend-ico', dataset: { color } }, icon(iconName, { size: 15 })),
    el('b', { class: 'legend-label', text: label }),
  );
  return el('div', { class: 'head-legend' },
    item('check-circle', 'green', 'Allow'),
    item('question-circle', 'yellow', 'Ask'),
    item('ban', 'red', 'Block'),
  );
}

function pip(color, n) {
  if (!n) return null;
  return el('span', { class: 'pip', dataset: { color } }, el('span', { class: 'pip-dot' }), el('span', { class: 'pip-n', text: String(n) }));
}

function categoryMaster(cat) {
  const total = cat.green.length + cat.yellow.length + cat.red.length;
  if (!total) return null;
  if (cat.green.length === total) return 'green';
  if (cat.yellow.length === total) return 'yellow';
  if (cat.red.length === total) return 'red';
  return null; // mixed
}

function setCategoryMaster(cat, color) {
  const all = [
    ...cat.green.map((row) => ({ row, sectionKey: 'green' })),
    ...cat.yellow.map((row) => ({ row, sectionKey: 'yellow' })),
    ...cat.red.map((row) => ({ row, sectionKey: 'red' })),
  ];
  for (const r of all) if (r.sectionKey !== color) setRuleColor(r.sectionKey, r.row, color);
}

function categoryCard(cat) {
  const isOpen = open.has(cat.key);
  const toggle = () => { isOpen ? open.delete(cat.key) : open.add(cat.key); render(); };
  const master = categoryMaster(cat);
  const head = el('div', { class: 'cat-head conn-head-row', onclick: toggle },
    el('span', { class: 'cat-icon' }, icon(cat.icon, { size: 18 })),
    el('span', { class: 'cat-head-text' },
      el('span', { class: 'cat-name', text: cat.name }),
      el('span', { class: 'cat-desc', text: cat.desc }),
    ),
    el('button', { class: 'inline-add cat-add', type: 'button', title: 'Add a rule to this category', onclick: (e) => { e.stopPropagation(); editRowDialog('yellow', null, cat.key); } }, icon('plus', { size: 14 }), 'Add rule'),
    el('span', { class: 'conn-master' }, permToggle(master ? SECTION_TO_PERM[master] : null, (perm) => setCategoryMaster(cat, PERM_TO_SECTION[perm]))),
    el('span', { class: 'cat-chev', dataset: { open: String(isOpen) } }, icon('chevron-down', { size: 16 })),
  );

  const card = el('div', { class: 'cm-soft-card cat-card', dataset: { open: String(isOpen) } }, head);
  if (isOpen) {
    const rules = [
      ...cat.green.map((row) => ({ row, sectionKey: 'green' })),
      ...cat.yellow.map((row) => ({ row, sectionKey: 'yellow' })),
      ...cat.red.map((row) => ({ row, sectionKey: 'red' })),
    ];
    rules.sort((a, b) => (ACCESS_ORDER[a.row.access || 'write'] - ACCESS_ORDER[b.row.access || 'write']));
    const body = el('div', { class: 'cat-body' });
    for (const r of rules) body.append(ruleRow(r.sectionKey, r.row));
    // Mobile-only add button: the header stays clean (Connections-style) so this
    // carries the "Add rule" affordance where there's full width to show it.
    body.append(el('button', { class: 'inline-add cat-add-body', type: 'button', onclick: () => editRowDialog('yellow', null, cat.key) }, icon('plus', { size: 14 }), 'Add rule'));
    card.append(body);
  }
  return card;
}

function ruleRow(sectionKey, row) {
  const [id, rule, scope] = row.cells;
  const access = row.access || 'write';
  const glyph = row.icon || ACCESS_ICON[access];
  return el('div', { class: 'bucket-row rule-bucket', dataset: { color: sectionKey } },
    el('span', { class: 'bucket-icon' }, icon(glyph, { size: 17 })),
    el('div', { class: 'bucket-main' },
      el('div', { class: 'bucket-line' }, el('span', { class: 'bucket-label', text: rule })),
      scope ? el('div', { class: 'bucket-desc', text: scope }) : null,
    ),
    el('div', { class: 'perm-row-side' },
      el('div', { class: 'perm-row-tools' },
        el('button', { class: 'icon-btn', type: 'button', title: 'Edit', onclick: () => editRowDialog(sectionKey, row) }, icon('pencil', { size: 14 })),
        el('button', { class: 'icon-btn', type: 'button', title: 'Delete', onclick: () => retire(sectionKey, row) }, icon('trash', { size: 14 })),
      ),
      permToggle(SECTION_TO_PERM[sectionKey], (perm) => setRuleColor(sectionKey, row, PERM_TO_SECTION[perm])),
    ),
  );
}

// ── Deleted rules (restorable history), stacked under the categories ──────
function deletedSection() {
  if (!deleted.length) return null;
  const head = el('div', { class: 'deleted-head' },
    el('span', { class: 'cat-icon' }, icon('trash', { size: 16 })),
    el('span', { class: 'cat-head-text' },
      el('span', { class: 'cat-name', text: `Deleted rules (${deleted.length})` }),
      el('span', { class: 'cat-desc', text: 'Restore any rule back to the group it came from.' }),
    ),
  );
  const list = el('div', { class: 'deleted-list' });
  for (const rec of deleted) list.append(deletedRow(rec));
  return el('div', { class: 'cm-soft-card deleted-card' }, head, list);
}

function deletedRow(rec) {
  const where = [COLOR_WORD[rec.section], CAT_NAME[rec.category]].filter(Boolean).join(' · ');
  return el('div', { class: 'bucket-row deleted-row', dataset: { color: rec.section } },
    el('span', { class: 'bucket-icon' }, icon(rec.icon || 'trash', { size: 16 })),
    el('div', { class: 'bucket-main' },
      el('div', { class: 'bucket-line' }, el('span', { class: 'bucket-label', text: rec.name })),
      el('div', { class: 'bucket-desc', text: where || 'Rule' }),
    ),
    el('div', { class: 'deleted-tools' },
      el('button', { class: 'inline-add restore-btn', type: 'button', onclick: () => doRestore(rec) }, icon('refresh', { size: 14 }), 'Restore'),
      el('button', { class: 'icon-btn', type: 'button', title: 'Delete forever', onclick: () => doPurge(rec) }, icon('trash', { size: 14 })),
    ),
  );
}

async function doRestore(rec) {
  if (boardState().dirty) {
    await confirmDialog('Save your changes first',
      'Restoring updates the foundation right away, which reloads the board. Save or discard your current edits, then restore.',
      'OK', 'primary');
    return;
  }
  try {
    const out = await post('/api/deleted/restore', { recordId: rec.recordId });
    const where = [COLOR_WORD[out.section], CAT_NAME[rec.category]].filter(Boolean).join(' · ');
    toast('Rule restored', `“${out.name}” is back in ${where || 'its group'}${out.restoredId ? ` as ${out.restoredId}` : ''}. Saved to the foundation.`);
    await loadBoard(true);      // pulls the freshly-written policy
    await loadDeletedList();
    wasDirty = false;
    render();
  } catch (e) { toast('Restore failed', e.message, 'err'); }
}

async function doPurge(rec) {
  const ok = await confirmDialog('Delete forever?',
    `“${rec.name}” will be removed from the deleted list for good. This can’t be undone.`,
    'Delete forever', 'danger');
  if (!ok) return;
  try {
    await post('/api/deleted/purge', { recordId: rec.recordId });
    await loadDeletedList();
    render();
  } catch (e) { toast('Failed', e.message, 'err'); }
}

function renderZones(s) {
  const sec = s.sections.zones;
  const list = el('div', { class: 'zone-list' },
    el('p', { class: 'cm-body-sm muted', style: 'margin:0;', text: 'Which folders the AI may change, which are read-only, and which are off-limits.' }),
  );
  for (const row of sec.rows) {
    const [id, zone, paths, allowed] = row.cells;
    list.append(el('div', { class: 'cm-soft-card zone-card' },
      el('div', { class: 'rule-item-main' },
        el('div', { class: 'rule-item-title', text: zone }),
        paths ? el('div', { class: 'rule-item-desc', text: paths }) : null,
        allowed ? el('div', { class: 'rule-item-desc', style: 'color: var(--fg-4);', text: allowed }) : null,
      ),
      el('div', { class: 'rule-item-tools' },
        el('button', { class: 'icon-btn', type: 'button', title: 'Edit', onclick: () => editZoneDialog(sec, row) }, icon('pencil', { size: 14 })),
        el('button', { class: 'icon-btn', type: 'button', title: 'Remove', onclick: () => retire('zones', row) }, icon('trash', { size: 14 })),
      ),
    ));
  }
  list.append(el('button', { class: 'inline-add', type: 'button', style: 'max-width:220px;', onclick: () => editZoneDialog(sec, null) }, icon('plus', { size: 14 }), 'Add a folder rule'));
  container.append(list);
}

async function retire(sectionKey, row) {
  if (row.id === null) { deleteNewRow(sectionKey, row); return; }
  const name = row.cells[1];
  const desc = row.cells[2];
  const ok = await confirmDialog(
    `Delete “${name}”?`,
    `${desc ? desc + '. ' : ''}It comes off your foundation on Save changes and moves to the Deleted list below — restore it anytime.`,
    'Delete rule', 'danger');
  if (ok) deleteRow(sectionKey, row.id);
}

function editRowDialog(sectionKey, row, category) {
  const isNew = !row;
  const cells = row ? row.cells.slice() : ['', '', '', ''];
  const labelIn = input({ placeholder: 'e.g. Edit your project files' }); labelIn.value = cells[1] || '';
  const descIn = input({ placeholder: 'e.g. Change any file in the project you’re working on' }); descIn.value = cells[2] || '';
  const detailTa = textarea({ class: 'textarea ta-bare', placeholder: 'The full rule the AI reads and follows.' }); detailTa.value = cells[3] || '';
  const detailBox = el('div', { class: 'textarea-box' }, detailTa);
  const defaultIcon = row ? (row.icon || ACCESS_ICON[row.access || 'write']) : 'eye';
  const picker = iconPicker(sectionKey, defaultIcon);
  dialog({
    title: isNew ? 'Add a rule' : 'Edit rule', iconName: 'widget-2', actionsInHeader: true,
    body: el('div', { class: 'stack rule-form' },
      field('Icon', picker),
      field('Name', labelIn),
      field('Short description', descIn),
      field('Details — what the AI reads', detailBox),
    ),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: isNew ? 'Add' : 'Apply', kind: 'primary', onClick: () => {
        cells[1] = labelIn.value.trim();
        cells[2] = descIn.value.trim();
        cells[3] = detailTa.value.replace(/\s*\n\s*/g, ' ').trim();
        if (!cells[1]) throw new Error('Type the rule name first');
        if (isNew) addRow(sectionKey, cells, undefined, category, picker.getIcon());
        else updateRow(sectionKey, row.id, cells, picker.getIcon());
      } },
    ],
  });
}

function editZoneDialog(sec, row) {
  const isNew = !row;
  const cells = row ? row.cells.slice() : ['', '', '', ''];
  const zoneTa = textarea({ rows: 1 }); zoneTa.value = cells[1] || '';
  const pathsTa = textarea({ rows: 2 }); pathsTa.value = cells[2] || '';
  const allowedTa = textarea({ rows: 2 }); allowedTa.value = cells[3] || '';
  dialog({
    title: isNew ? 'Add a folder rule' : 'Edit folder rule', iconName: 'folder-2',
    body: el('div', { class: 'stack' }, field('Folder or area', zoneTa), field('Which paths', pathsTa), field('What’s allowed there', allowedTa)),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: isNew ? 'Add' : 'Apply', kind: 'primary', onClick: () => {
        cells[1] = zoneTa.value.replace(/\s*\n\s*/g, ' ').trim();
        cells[2] = pathsTa.value.replace(/\s*\n\s*/g, ' ').trim();
        cells[3] = allowedTa.value.replace(/\s*\n\s*/g, ' ').trim();
        if (!cells[1]) throw new Error('Name the folder area first');
        if (isNew) addRow('zones', cells);
        else updateRow('zones', row.id, cells);
      } },
    ],
  });
}
