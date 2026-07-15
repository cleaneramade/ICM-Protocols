// Memory view — browse the brain's files, PREVIEW them rendered, edit when you
// want. System (00_system) files ask for confirmation before saving.
// The tree and the file pane render independently: selecting a file only
// rebuilds the pane, so the tree keeps its scroll position and open folders.
import { el, clear, icon, confirmDialog, toast, textarea, emptyState, input } from '../ui.js';
import { get, put } from '../api.js';
import { renderMarkdown } from '../md.js';

let container = null, treeHost = null, paneHost = null, searchEl = null;
// openDirs persists across page visits (module state) AND across a hard refresh
// (localStorage), so collapsing/expanding folders is always remembered.
// null = not yet seeded.
let state = { tree: null, current: null, raw: '', baseHash: null, system: false, mode: 'preview', dirty: false, filter: '', openDirs: null };

const OPEN_KEY = 'icm.brain.openDirs';
function loadOpenDirs() {
  try { const v = JSON.parse(localStorage.getItem(OPEN_KEY)); return Array.isArray(v) ? new Set(v) : null; } catch { return null; }
}
function saveOpenDirs() {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...state.openDirs])); } catch { /* storage unavailable — in-memory only */ }
}

export async function brainView(root) {
  container = root;
  const data = await get('/api/brain/tree');
  state.tree = data.tree;
  mount();
}

function mount() {
  clear(container);
  searchEl = input({ class: 'input mono brain-search', type: 'search', placeholder: 'Search files…', spellcheck: 'false' });
  searchEl.value = state.filter;
  searchEl.addEventListener('input', () => { state.filter = searchEl.value; renderTree(); });
  treeHost = el('div', { class: 'tree-scroll scrolly' });
  treeHost.addEventListener('scroll', updateTreeFade);
  const treeCard = el('div', { class: 'tree cm-soft-card' }, treeHost);
  paneHost = el('div', { class: 'file-pane' });
  // Two-column grid: search + tree share the narrow left column; the preview owns
  // its own full-height column on the right (title lines up with the search bar top).
  container.append(el('div', { class: 'brain-page' },
    el('div', { class: 'brain-search-wrap' }, icon('magnifer', { size: 15 }), searchEl),
    treeCard,
    paneHost,
  ));
  renderTree();
  renderPane();
  setTimeout(updateTreeFade, 0);
}

function fileItem(n, showPath) {
  return el('div', {
    class: 'tree-item tree-file', 'aria-current': String(state.current === n.rel), dataset: { rel: n.rel },
    onclick: () => openFile(n.rel),
  }, icon(n.system ? 'lock' : 'file', { size: 13 }), el('span', { class: 'ellip', text: showPath ? n.rel : n.name }));
}

// Only fade the edge that still has files past it — no fade at the true top/bottom,
// so the first and last row stay crisp (mirrors the icon carousel's edge fade).
function updateTreeFade() {
  const max = treeHost.scrollHeight - treeHost.clientHeight;
  treeHost.dataset.atStart = String(treeHost.scrollTop <= 1);
  treeHost.dataset.atEnd = String(max <= 1 || treeHost.scrollTop >= max - 1);
}

function renderTree() {
  clear(treeHost);
  // First render: restore the saved open/closed folders from a previous session;
  // if there's nothing saved yet, seed defaults (top-level open, deeper closed).
  if (state.openDirs === null) {
    const saved = loadOpenDirs();
    if (saved) state.openDirs = saved;
    else { state.openDirs = new Set(state.tree.filter((n) => n.type === 'dir').map((n) => n.rel)); saveOpenDirs(); }
  }
  const q = state.filter.trim().toLowerCase();
  if (q) {
    const matches = [];
    const walk = (nodes) => { for (const n of nodes) { if (n.type === 'dir') walk(n.children); else if (n.name.toLowerCase().includes(q) || n.rel.toLowerCase().includes(q)) matches.push(n); } };
    walk(state.tree);
    if (!matches.length) { treeHost.append(el('div', { class: 'tree-empty cm-caption muted', text: `No files match “${state.filter.trim()}”` })); updateTreeFade(); return; }
    for (const n of matches) treeHost.append(fileItem(n, true));
    updateTreeFade();
    return;
  }
  renderNodes(treeHost, state.tree);
  updateTreeFade();
}

function renderNodes(host, nodes, depth = 0) {
  for (const n of nodes) {
    if (n.type === 'dir') {
      const children = el('div', { class: 'tree-children' });
      renderNodes(children, n.children, depth + 1);
      children.hidden = !state.openDirs.has(n.rel);
      const chev = icon('chevron-right', { size: 13 });
      chev.dataset.role = 'chev';
      const label = el('div', { class: 'tree-item tree-dir-label', onclick: () => {
        const open = !children.hidden;
        if (open) state.openDirs.delete(n.rel); else state.openDirs.add(n.rel);
        saveOpenDirs();
        children.hidden = open; label.dataset.open = String(!open); updateTreeFade();
      } }, chev, icon('folder-2', { size: 14 }), el('span', { text: n.name }));
      label.dataset.open = String(!children.hidden);
      host.append(el('div', {}, label, children));
    } else {
      host.append(fileItem(n, false));
    }
  }
}

async function openFile(rel) {
  if (state.dirty && !(await confirmDialog('Unsaved changes', `Discard your edits to ${state.current}?`, 'Discard', 'danger'))) return;
  // Clicking the already-open file deselects it — back to the empty "Pick a file" state.
  if (state.current === rel) {
    state.current = null; state.raw = ''; state.baseRaw = ''; state.mode = 'preview'; state.dirty = false;
    treeHost.querySelectorAll('.tree-file').forEach((elm) => elm.setAttribute('aria-current', 'false'));
    renderPane();
    return;
  }
  const data = await get('/api/brain/file?path=' + encodeURIComponent(rel));
  state.current = rel; state.raw = data.raw; state.baseRaw = data.raw; state.baseHash = data.baseHash; state.system = data.system;
  state.mode = 'preview'; state.dirty = false;
  // Update the selected highlight in place — no tree rebuild, so its scroll and
  // open folders (and the page scroll) don't jump back to the top.
  treeHost.querySelectorAll('.tree-file').forEach((elm) => elm.setAttribute('aria-current', String(elm.dataset.rel === rel)));
  renderPane();
}

function renderPane() {
  clear(paneHost);
  if (!state.current) {
    paneHost.append(emptyState('folder-2', 'Pick a file', 'Choose a file on the left to read it. Every file here is editable.'));
    return;
  }
  const name = state.current.split('/').pop();
  // Save stays greyed out until the text actually differs from what's on disk —
  // typing then deleting back to the original re-disables it.
  const saveBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: !state.dirty, onclick: save }, 'Save');
  const bar = el('div', { class: 'file-bar' },
    state.system ? icon('lock', { size: 15 }) : icon('file', { size: 15 }),
    el('span', { class: 'cm-h4 grow ellip', title: state.current, text: name }),
    state.system ? el('span', { class: 'id-badge', dataset: { color: 'yellow' }, text: 'SYSTEM' }) : null,
    state.mode === 'preview'
      ? el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { state.mode = 'edit'; renderPane(); } }, icon('pencil', { size: 14 }), 'Edit')
      : saveBtn,
    state.mode === 'edit' ? el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { state.mode = 'preview'; state.dirty = false; openFile(state.current); } }, 'Cancel') : null,
  );
  paneHost.append(bar);

  if (state.mode === 'preview') {
    paneHost.append(el('div', { class: 'file-preview scrolly' }, renderMarkdown(state.raw)));
  } else {
    const ta = textarea({ class: 'textarea mono file-editor' });
    ta.value = state.raw;
    ta.addEventListener('input', () => {
      state.raw = ta.value;
      state.dirty = ta.value !== state.baseRaw;
      saveBtn.disabled = !state.dirty;
    });
    paneHost.append(ta);
  }

  async function save() {
    let confirmSystem;
    if (state.system) {
      if (!(await confirmDialog('This is a system file', `Saving ${state.current} changes how every Plutus session behaves, starting next launch. Save it?`, 'Save system file', 'primary'))) return;
      confirmSystem = true;
    }
    try {
      const res = await put('/api/brain/file', { path: state.current, raw: state.raw, baseHash: state.baseHash, confirmSystem });
      state.baseHash = res.newHash; state.baseRaw = state.raw; state.dirty = false; state.mode = 'preview';
      toast('Saved', `${name} updated (backup kept).`);
      renderPane();
    } catch (e) {
      if (e.code === 'STALE') { toast('Changed on disk', 'Reloading.', 'err'); await openFile(state.current); }
      else toast('Save failed', e.message, 'err');
    }
  }
}
