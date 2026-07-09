// Secrets view — one card per project the ICM protocol was added to. Expand a
// project to see its API keys. A reveal PASSWORD (owner-set) gates the values:
// when set, the server never sends real values to the browser until the
// password verifies, so inspecting the page can't expose them. The AI can read
// .env to operate but never edits it — this editor is yours.
import { el, clear, icon, toast, emptyState, dialog, field, input, confirmDialog } from '../ui.js';
import { get, put, post, del } from '../api.js';

const enc = encodeURIComponent;

// Only real secrets / API keys — hide plain config strings (URLs, emails, flags).
// Matched on the key NAME. (Kept in sync with server/envfiles.js SECRET_RE.)
const SECRET_RE = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL|PRIVATE|BEARER|JWT|OAUTH|API|SIGN|WEBHOOK|SALT|CERT|ACCESS)/i;
const isSecretKey = (name) => SECRET_RE.test(name);

let container = null, actionsBar = null;
let state = {
  projects: [], hasPassword: false,
  open: null, file: null, raw: '', baseRaw: '', baseHash: null,
  revealed: false, showValues: false, password: '', isNew: false, pending: [],
  selectMode: false, selected: new Set(),
};

// Fetch + dedupe projects. One card per project name — if a name appears twice
// (e.g. a stray copy in another folder), keep the one with more keys.
async function reloadProjects() {
  const data = await get('/api/projects');
  const byName = new Map();
  for (const p of data.projects) {
    const cur = byName.get(p.name);
    if (!cur || (p.keyCount || 0) > (cur.keyCount || 0)) byName.set(p.name, p);
  }
  state.projects = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function envView(root, actions) {
  container = root; actionsBar = actions;
  state.selectMode = false; state.selected = new Set();
  const [, lock] = await Promise.all([reloadProjects(), get('/api/secrets-lock')]);
  state.hasPassword = lock.hasPassword;
  mountHeader();
  render();
}

function mountHeader() {
  clear(actionsBar);
  if (state.selectMode) {
    const n = state.selected.size;
    actionsBar.append(
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: exitSelectMode }, 'Cancel'),
      el('button', { class: 'btn btn-danger-soft', type: 'button', disabled: !n, onclick: deleteSelected },
        icon('trash', { size: 15 }), n ? `Delete ${n}` : 'Delete'),
    );
    return;
  }
  actionsBar.append(
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: passwordDialog },
      icon(state.hasPassword ? 'shield-check' : 'lock', { size: 15 }),
      state.hasPassword ? 'Change password' : 'Set password'),
    el('button', { class: 'btn btn-ghost', type: 'button', title: 'Select projects to delete their secrets', onclick: enterSelectMode },
      icon('trash', { size: 15 }), 'Manage'),
  );
}

function enterSelectMode() {
  state.selectMode = true; state.selected = new Set();
  // Close any open project so the list is a clean set of selectable rows.
  state.open = null; state.pending = []; state.revealed = false; state.showValues = false; state.password = '';
  mountHeader(); render();
}

function exitSelectMode() {
  state.selectMode = false; state.selected = new Set();
  mountHeader(); render();
}

function toggleSelect(p) {
  if (state.selected.has(p.path)) state.selected.delete(p.path); else state.selected.add(p.path);
  mountHeader(); render();
}

// Ask for the reveal password (returns the entered value, or null if cancelled).
function askPassword(title) {
  return new Promise((resolve) => {
    const pw = input({ type: 'password', placeholder: 'Your reveal password' });
    dialog({
      title, iconName: 'lock',
      body: el('div', { class: 'stack' },
        field('Password', pw),
        el('p', { class: 'cm-body-sm muted', text: 'Deleting locked secrets needs your password.' }),
      ),
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: () => resolve(null) },
        { label: 'Confirm', kind: 'primary', onClick: () => resolve(pw.value) },
      ],
    });
    setTimeout(() => pw.focus(), 60);
  });
}

async function deleteSelected() {
  const paths = [...state.selected];
  if (!paths.length) return;
  const names = state.projects.filter((p) => state.selected.has(p.path)).map((p) => p.name);
  const ok = await confirmDialog(
    names.length === 1 ? `Delete ${names[0]}’s secrets?` : `Delete secrets for ${names.length} projects?`,
    `This permanently removes the .env secret file(s) for ${names.join(', ')}. A backup is kept, so it can be restored. Continue?`,
    'Delete', 'danger');
  if (!ok) return;
  let password = state.password;
  if (state.hasPassword && !password) {
    password = await askPassword('Enter password to delete');
    if (password == null) return;
  }
  let done = 0;
  for (const proj of paths) {
    try { await del('/api/env', { project: proj, password }); done++; }
    catch (e) {
      if (e.code === 'BAD_PASSWORD') { toast('Wrong password', 'Nothing was deleted.', 'err'); return; }
      toast('Delete failed', e.message, 'err');
    }
  }
  await reloadProjects();
  exitSelectMode();
  toast('Deleted', `Cleared secrets for ${done} ${done === 1 ? 'project' : 'projects'} (backup kept).`);
}

// Full folder path, prettified: ~ for the home dir, forward slashes, no emoji.
function prettyPath(p) {
  return String(p)
    .replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~')
    .replace(/♾️\s*/g, '')
    .replace(/\\/g, '/');
}

function render() {
  clear(container);
  if (!state.projects.length) {
    container.append(emptyState('database', 'No projects found', 'A project shows up here once its folder has a PLUTUS.md file marking it as yours.'));
    return;
  }
  const stack = el('div', { class: 'stack' });
  const list = el('div', { class: 'cat-list' });
  for (const p of state.projects) list.append(projectCard(p));
  stack.append(list);
  container.append(stack);
}

function projectCard(p) {
  if (state.selectMode) return selectableCard(p);
  const isOpen = state.open === p.path;
  const toggle = () => (isOpen ? collapse() : openProject(p));
  const n = isOpen ? keyCount() : (p.keyCount || 0);
  const head = el('div', { class: 'cat-head conn-head-row', onclick: toggle },
    el('span', { class: 'cat-icon' }, icon('lock', { size: 18 })),
    el('span', { class: 'cat-head-text' },
      el('span', { class: 'cat-name', text: p.name }),
      el('span', { class: 'cat-desc env-proj-loc', title: p.path, text: prettyPath(p.path) }),
    ),
    keyCountBadge(n),
    el('span', { class: 'cat-chev', dataset: { open: String(isOpen) } }, icon('chevron-down', { size: 16 })),
  );
  const card = el('div', { class: 'cm-soft-card cat-card', dataset: { open: String(isOpen) } }, head);
  if (isOpen) card.append(projectBody(p));
  return card;
}

// A non-expandable card shown in select mode — the whole row toggles selection.
function selectableCard(p) {
  const sel = state.selected.has(p.path);
  const head = el('div', { class: 'cat-head conn-head-row env-select-head', onclick: () => toggleSelect(p) },
    el('span', { class: 'env-check', dataset: { on: String(sel) } }, icon(sel ? 'check-circle' : 'circle', { size: 20 })),
    el('span', { class: 'cat-icon' }, icon('lock', { size: 18 })),
    el('span', { class: 'cat-head-text' },
      el('span', { class: 'cat-name', text: p.name }),
      el('span', { class: 'cat-desc env-proj-loc', title: p.path, text: prettyPath(p.path) }),
    ),
    keyCountBadge(p.keyCount || 0),
  );
  return el('div', { class: 'cm-soft-card cat-card env-select-card', dataset: { selected: String(sel) } }, head);
}

function keyCountBadge(n) {
  if (!n) return el('span', { class: 'env-count is-empty', text: 'Empty' });
  return el('span', { class: 'env-count' }, el('b', { text: String(n) }), el('span', { text: n === 1 ? ' key' : ' keys' }));
}

function keyCount() {
  return state.raw.split('\n').filter((l) => {
    const m = /^\s*([A-Za-z_][\w.-]*)\s*=/.exec(l);
    return m && isSecretKey(m[1]);
  }).length;
}

function collapse() { state.open = null; state.raw = ''; state.revealed = false; state.showValues = false; state.password = ''; state.pending = []; render(); }

function primaryEnvFile(p) {
  const f = p.envFiles;
  if (f.includes('.env')) return '.env';
  if (f.includes('.env.local')) return '.env.local';
  return f.find((x) => x !== '.env.example') || f[0] || null;
}

async function openProject(p) {
  state.open = p.path; state.showValues = false; state.password = ''; state.pending = [];
  const preferred = primaryEnvFile(p);
  if (preferred) { await loadFile(p, preferred); }
  else { state.file = '.env'; state.raw = ''; state.baseRaw = ''; state.baseHash = null; state.isNew = true; state.revealed = !state.hasPassword; render(); }
}

// GET returns REDACTED values when a password is set — never the real ones.
async function loadFile(p, f) {
  try {
    const data = await get(`/api/env?project=${enc(p.path)}&file=${enc(f)}`);
    state.file = f; state.raw = data.raw; state.baseRaw = data.raw; state.baseHash = data.baseHash; state.isNew = false;
    state.hasPassword = data.hasPassword;
    state.revealed = !data.hasPassword; // real values only arrive via reveal
    state.showValues = false;
    state.pending = [];
    render();
  } catch (e) { toast('Couldn’t open', e.message, 'err'); }
}

// Fetch the REAL values — the only path that returns them, gated by the password.
// Unlocking does NOT reveal: values load but stay masked until "Show values".
async function doReveal(p, password) {
  try {
    const res = await post('/api/env/reveal', { project: p.path, file: state.file, password });
    state.raw = res.raw; state.baseRaw = res.raw; state.baseHash = res.baseHash;
    state.revealed = true; state.showValues = false; state.password = password;
    toast('Unlocked', 'Press “Show values” to view them.');
    render();
  } catch (e) {
    if (e.code === 'BAD_PASSWORD') toast('Wrong password', 'It stays locked.', 'err');
    else if (e.code === 'NOT_FOUND') { // password was right; file just doesn't exist yet
      state.raw = ''; state.baseRaw = ''; state.baseHash = null; state.isNew = true;
      state.revealed = true; state.showValues = false; state.password = password; render();
    } else toast('Couldn’t unlock', e.message, 'err');
  }
}

// The "Show values" button: locked → ask the password (unlock only); unlocked →
// just toggle whether the loaded values are shown or masked.
function toggleReveal(p) {
  if (!state.hasPassword) { state.showValues = !state.showValues; render(); return; }
  if (!state.revealed) { promptPassword(p); return; }
  state.showValues = !state.showValues; render();
}

// Drop the real values back out of the page (the lock icon when unlocked).
function relock(p) {
  state.revealed = false; state.showValues = false; state.password = ''; state.pending = [];
  if (state.isNew) { state.raw = ''; state.baseRaw = ''; render(); } else loadFile(p, state.file);
}

function promptPassword(p) {
  const pw = input({ type: 'password', placeholder: 'Your reveal password' });
  dialog({
    title: 'Enter password to reveal', iconName: 'lock',
    body: el('div', { class: 'stack' },
      field('Password', pw),
      el('p', { class: 'cm-body-sm muted', text: 'The values are fetched only after this verifies — they were never in the page before.' }),
    ),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Reveal', kind: 'primary', onClick: async () => { await doReveal(p, pw.value); } },
    ],
  });
  setTimeout(() => pw.focus(), 60);
}

function passwordDialog() {
  const isChange = state.hasPassword;
  const curInput = isChange ? input({ type: 'password', placeholder: 'Current password' }) : null;
  const newInput = input({ type: 'password', placeholder: isChange ? 'New password' : 'Password (min 8 chars)' });
  const confInput = input({ type: 'password', placeholder: 'Confirm' });
  dialog({
    title: isChange ? 'Change reveal password' : 'Set a reveal password', iconName: 'lock',
    body: el('div', { class: 'stack' },
      isChange ? field('Current password', curInput) : null,
      field(isChange ? 'New password' : 'Password', newInput),
      field('Confirm', confInput),
      el('p', { class: 'cm-body-sm muted', text: 'Once set, revealing or changing any secret value needs this password. Only a one-way hash is stored — never the password, never your keys.' }),
    ),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: isChange ? 'Change password' : 'Set password', kind: 'primary', onClick: async () => {
        const next = newInput.value;
        if (next.length < 8) throw new Error('Use at least 8 characters');
        if (next !== confInput.value) throw new Error('The two passwords don’t match');
        await put('/api/secrets-lock', { current: curInput ? curInput.value : undefined, next });
        state.hasPassword = true;
        toast(isChange ? 'Password changed' : 'Password set', 'Revealing values now needs this password.');
        mountHeader();
        // Re-lock the open project so the real values leave the page immediately.
        const p = state.projects.find((x) => x.path === state.open);
        state.revealed = false; state.showValues = false; state.password = '';
        if (p && !state.isNew) await loadFile(p, state.file); else render();
      } },
    ],
  });
}

function projectBody(p) {
  const body = el('div', { class: 'cat-body env-editor' });
  const locked = state.hasPassword && !state.revealed;

  // Save stays greyed out until something actually changes: an edited value/key
  // (raw differs from the loaded baseline) or a new "Add key" row with a name.
  const isDirty = () => state.raw !== state.baseRaw || state.pending.some((pr) => pr.key.trim() !== '');
  const saveBtn = locked ? null : el('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !isDirty(), onclick: () => save(p) }, 'Save');
  const updateDirty = () => { if (saveBtn) saveBtn.disabled = !isDirty(); };

  const showLabel = locked ? 'Show values' : (state.showValues ? 'Hide values' : 'Show values');
  const showIcon = locked ? 'lock' : (state.showValues ? 'eye-closed' : 'eye');
  const controls = el('div', { class: 'env-controls' },
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => toggleReveal(p) }, icon(showIcon, { size: 14 }), showLabel),
    locked ? null : el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addKeyRow(p) }, icon('plus', { size: 14 }), 'Add key'),
    el('span', { class: 'grow' }),
    saveBtn,
  );
  body.append(controls);

  const lines = state.raw.split('\n');
  const rows = el('div', { class: 'env-rows' });
  let keyN = 0;
  lines.forEach((line, idx) => {
    const m = /^(\s*)([A-Za-z_][\w.-]*)\s*=(.*)$/.exec(line);
    if (!m) return;
    const [, , key, val] = m;
    if (!isSecretKey(key)) return;
    keyN++;
    let curKey = key, curVal = val;
    const sync = () => { lines[idx] = `${curKey}=${curVal}`; state.raw = lines.join('\n'); updateDirty(); };

    const keyInput = el('input', {
      class: 'input mono env-key-input', value: key, placeholder: 'KEY_NAME', spellcheck: 'false',
      readonly: locked ? '' : null, tabindex: locked ? '-1' : null,
      oninput: locked ? null : (e) => {
        const v = e.target.value.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_.-]/g, '');
        if (v !== e.target.value) { const c = e.target.selectionStart; e.target.value = v; try { e.target.setSelectionRange(c, c); } catch { /* noop */ } }
        curKey = v; sync();
      },
    });
    // Value input carries a lock/unlock icon on the right (only when a password exists).
    const valInput = el('input', {
      class: 'input mono env-val', type: (!locked && state.showValues) ? 'text' : 'password',
      value: locked ? '' : val, placeholder: locked ? '••••••••' : 'empty',
      readonly: locked ? '' : null, tabindex: locked ? '-1' : null,
      oninput: locked ? null : (e) => { curVal = e.target.value; sync(); },
    });
    const valWrap = el('div', { class: 'env-val-wrap', dataset: { unlocked: String(state.hasPassword && !locked) } }, valInput);
    if (state.hasPassword) {
      valWrap.append(el('button', {
        class: 'env-lock-btn', type: 'button',
        title: locked ? 'Enter password to unlock' : 'Re-lock these values',
        onclick: () => (locked ? promptPassword(p) : relock(p)),
      }, icon(locked ? 'lock' : 'lock-unlocked', { size: 15 })));
    }
    rows.append(el('div', { class: 'env-row' }, keyInput, valWrap, el('span', {})));
  });

  // Inline new-key rows — added by "Add key", they only persist on Save. A row
  // left empty (or if you leave/collapse without saving) is discarded.
  state.pending.forEach((pr, pi) => {
    const keyInput = el('input', {
      class: 'input mono env-key-input', value: pr.key, placeholder: 'NEW_KEY', spellcheck: 'false',
      oninput: (e) => {
        const v = e.target.value.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_.-]/g, '');
        if (v !== e.target.value) { const c = e.target.selectionStart; e.target.value = v; try { e.target.setSelectionRange(c, c); } catch { /* noop */ } }
        pr.key = v; updateDirty();
      },
    });
    const valInput = el('input', {
      class: 'input mono env-val', type: 'text', value: pr.val, placeholder: 'paste the value',
      oninput: (e) => { pr.val = e.target.value; updateDirty(); },
    });
    rows.append(el('div', { class: 'env-row env-row-new' },
      keyInput,
      el('div', { class: 'env-val-wrap' }, valInput),
      el('button', { class: 'env-discard', type: 'button', title: 'Discard this new key', onclick: () => { state.pending.splice(pi, 1); render(); } }, icon('x', { size: 16 })),
    ));
  });

  if (!keyN && !state.pending.length) {
    rows.append(el('div', { class: 'env-empty cm-body-sm muted' },
      locked ? 'Locked. Press “Show values” and enter your password to view or add keys.'
        : state.isNew ? `No secrets here yet. Press “Add key” to create ${state.file || '.env'} for ${p.name}.`
          : 'No keys yet. Press “Add key” to add one.'));
  }
  body.append(rows);
  return body;
}

// Add an inline editable row (no popup). It saves only when "Save" is pressed.
function addKeyRow(p) {
  state.pending.push({ key: '', val: '' });
  render();
  setTimeout(() => {
    const inputs = container.querySelectorAll('.env-row-new .env-key-input');
    inputs[inputs.length - 1]?.focus();
  }, 20);
}

async function save(p) {
  // Fold any inline new rows (with a valid, non-duplicate name) into the file.
  const existing = new Set(state.raw.split('\n').map((l) => (/^\s*([A-Za-z_][\w.-]*)\s*=/.exec(l) || [])[1]).filter(Boolean));
  const toAdd = [];
  for (const pr of state.pending) {
    const key = pr.key.trim();
    if (!key) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) { toast('Skipped a key', `“${pr.key}” isn’t a valid name.`, 'err'); continue; }
    if (existing.has(key) || toAdd.some((a) => a.startsWith(key + '='))) { toast('Skipped a duplicate', `${key} already exists.`, 'err'); continue; }
    toAdd.push(`${key}=${pr.val}`);
  }
  if (toAdd.length) {
    const b = state.raw.replace(/\s*$/, '');
    state.raw = (b ? b + '\n' : '') + toAdd.join('\n') + '\n';
  }
  const addedN = toAdd.length;
  state.pending = [];
  try {
    const res = await put('/api/env', { project: p.path, file: state.file, raw: state.raw, baseHash: state.baseHash, password: state.password });
    state.baseHash = res.newHash; state.baseRaw = state.raw;
    if (!p.envFiles.includes(state.file)) { p.envFiles.push(state.file); p.envFiles.sort(); }
    p.keyCount = keyCount();
    state.isNew = false;
    toast('Saved', addedN
      ? `${addedN} ${addedN === 1 ? 'key' : 'keys'} added to ${state.file} for ${p.name}.`
      : `${state.file} updated for ${p.name} (backup kept).`);
    render();
  } catch (e) {
    if (e.code === 'STALE') { toast('File changed on disk', 'Reloading the fresh copy.', 'err'); await loadFile(p, state.file); }
    else if (e.code === 'BAD_PASSWORD') toast('Password needed', 'Re-enter your password (Show values) then save.', 'err');
    else toast('Save failed', e.message, 'err');
  }
}
