// Connections view — one simple control per app. The card head has a master
// allow/ask/block toggle that sets the whole connection at once. Open it to
// fine-tune just three plain buckets: Read, Write, Full access. No managing
// dozens of individual tool permissions.
import { el, clear, icon, dialog, confirmDialog, field, input, textarea, toast, emptyState, permToggle } from '../ui.js';
import { get, put } from '../api.js';
import { boardState, onBoardChange, updateRow, addRow, deleteRow, markDirty, loadBoard, setIntBucket, setIntMaster } from '../boardstore.js';
import { domainFor, logoSources, bucketLabel } from '../integration-meta.js';

const PERM_OF = { green: 'allow', yellow: 'ask', red: 'block' };
const COLOR_OF_PERM = { allow: 'green', ask: 'yellow', block: 'red' };
const BUCKETS = [
  { key: 'read', icon: 'eye', idx: 2, hint: 'Look things up' },
  { key: 'write', icon: 'pencil', idx: 3, hint: 'Create, change, or send' },
  { key: 'full', icon: 'trash', idx: 4, hint: 'Delete and other big actions' },
];

let container = null;
let unsub = null;
let clientId = '';
const open = new Set();

export async function integrationsView(root, actions) {
  container = root;
  await loadBoard();
  try { clientId = (await get('/api/config')).config?.brandfetchClientId || ''; } catch { clientId = ''; }
  actions.append(headerLegend());
  unsub?.();
  unsub = onBoardChange(() => { if (document.contains(container)) render(); });
  render();
}

function integrations() {
  return boardState().sections.integrations.rows.filter((r) => !(r.cells[1] || '').startsWith('(pattern)'));
}

function logoEl(name, size = 38) {
  const wrap = el('span', { class: 'conn-logo', style: `width:${size}px;height:${size}px;` });
  const letter = () => { clear(wrap); wrap.classList.add('is-letter'); wrap.append(el('span', { text: (name || '?').trim()[0].toUpperCase() })); };
  const sources = logoSources(name, clientId);
  if (!sources.length) { letter(); return wrap; }
  const img = document.createElement('img');
  img.width = size; img.height = size; img.alt = ''; img.loading = 'lazy';
  let i = 0;
  const tryNext = () => { if (i < sources.length) img.src = sources[i++]; else letter(); };
  img.onerror = tryNext; tryNext();
  wrap.append(img);
  return wrap;
}

function render() {
  clear(container);
  const rows = integrations();
  if (!rows.length) {
    container.append(emptyState('layers', 'No connections yet', 'Add one to control what a connected app is allowed to do.'));
    return;
  }
  const list = el('div', { class: 'cat-list' });
  for (const row of rows) list.append(connectionCard(row));
  container.append(list);
}

// Legend in the header actions area — same tile style as before, no descriptions.
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

function masterColor(row) {
  const p = row.perms || {};
  return (p.read && p.read === p.write && p.write === p.full) ? p.read : null; // null = mixed
}

function connectionCard(row) {
  const name = row.cells[1];
  const key = row.id || 'new:' + name;
  const isOpen = open.has(key);
  const master = masterColor(row);

  const toggle = () => { isOpen ? open.delete(key) : open.add(key); render(); };
  const master3 = permToggle(master ? PERM_OF[master] : null, (perm) => setIntMaster(row, COLOR_OF_PERM[perm]));

  const head = el('div', { class: 'cat-head conn-head-row', onclick: toggle },
    logoEl(name, 30),
    el('span', { class: 'cat-head-text' },
      el('span', { class: 'cat-name', text: name }),
      el('span', { class: 'cat-desc', text: master ? masterLabel(master) : 'Custom' }),
    ),
    el('span', { class: 'conn-master' }, master3),
    el('span', { class: 'cat-chev', dataset: { open: String(isOpen) } }, icon('chevron-down', { size: 16 })),
  );

  const card = el('div', { class: 'cm-soft-card cat-card', dataset: { open: String(isOpen) } }, head);
  if (isOpen) {
    const body = el('div', { class: 'cat-body' });
    for (const b of BUCKETS) body.append(bucketRow(row, b));
    card.append(body);
  }
  return card;
}

function masterLabel(color) {
  return color === 'green' ? 'Allowed'
    : color === 'yellow' ? 'Asks first'
    : 'Blocked';
}

function bucketRow(row, b) {
  const name = row.cells[1];
  const desc = row.cells[b.idx] || b.hint;
  const color = (row.perms || {})[b.key] || 'yellow';
  return el('div', { class: 'bucket-row', dataset: { color } },
    el('span', { class: 'bucket-icon' }, icon(b.icon, { size: 17 })),
    el('div', { class: 'bucket-main' },
      // Inline "edit wording" pencil intentionally removed for now; the
      // editBucketDialog capability below is kept for future use.
      el('div', { class: 'bucket-line' },
        el('span', { class: 'bucket-label', text: bucketLabel(name, b.key) }),
      ),
      el('div', { class: 'bucket-desc', text: desc }),
    ),
    el('div', { class: 'bucket-toggle' }, permToggle(PERM_OF[color], (perm) => setIntBucket(row, b.key, COLOR_OF_PERM[perm]))),
  );
}

function editBucketDialog(row, b) {
  const ta = textarea({ rows: 2 }); ta.value = row.cells[b.idx] || '';
  dialog({
    title: `${bucketLabel(row.cells[1], b.key)} — ${row.cells[1]}`, iconName: 'layers',
    body: field('What this covers (plain words)', ta),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Save', kind: 'primary', onClick: () => {
        const cells = row.cells.slice();
        cells[b.idx] = ta.value.replace(/\s*\n\s*/g, ' ').trim();
        if (row.id == null) { row.cells = cells; markDirty(); } else updateRow('integrations', row.id, cells);
      } },
    ],
  });
}

function addIntegrationDialog() {
  const nameInput = input({ placeholder: 'e.g. Linear, Airtable, Resend' });
  dialog({
    title: 'Add a connection', iconName: 'layers',
    body: el('div', { class: 'stack' },
      field('Connection name', nameInput),
      el('p', { class: 'cm-body-sm muted', text: 'Starts safe: Read allowed, Write asks first, Full access blocked. Logo is pulled automatically.' }),
    ),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Add connection', kind: 'primary', onClick: () => {
        const name = nameInput.value.trim();
        if (!name) throw new Error('Name the connection first');
        addRow('integrations', ['', name, 'Look things up', 'Create, change, or send', 'Delete and other big actions']);
        open.add('new:' + name);
      } },
    ],
  });
}

async function removeIntegration(row) {
  const ok = await confirmDialog(`Remove ${row.cells[1]}?`, 'Removes this connection when you press Save changes.', 'Remove', 'danger');
  if (!ok) return;
  if (row.id == null) { boardState().sections.integrations.rows = boardState().sections.integrations.rows.filter((r) => r !== row); markDirty(); }
  else deleteRow('integrations', row.id);
}

function logoKeyDialog() {
  const keyInput = input({ value: clientId, placeholder: 'Brandfetch client ID' });
  dialog({
    title: 'Logo source', iconName: 'stars',
    body: el('div', { class: 'stack' },
      el('p', { class: 'cm-body-sm', text: 'Logos use the Brandfetch Logo API. Paste a free client ID for the best quality (developers.brandfetch.com). Without one, logos fall back to a keyless source automatically.' }),
      field('Brandfetch client ID', keyInput),
    ),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Save', kind: 'primary', onClick: async () => {
        clientId = keyInput.value.trim();
        await put('/api/config', { brandfetchClientId: clientId });
        toast('Saved', clientId ? 'Using Brandfetch logos.' : 'Using keyless logos.');
        render();
      } },
    ],
  });
}
