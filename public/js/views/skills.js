// Skills view — skills.sh style, but only YOUR skills. A list of cards
// (command + 2-line summary + source path); click one to open its rendered
// preview with the file path and a "reveal in Explorer". Create/edit is a page.
import { el, clear, icon, confirmDialog, actionSheet, field, input, textarea, toast, emptyState } from '../ui.js';
import { get, post, put, del } from '../api.js';
import { renderMarkdown } from '../md.js';

const STARTER_BODY = `# What this skill does

Say in one line what it's for and when the AI should use it.

## Steps

1. First thing it does.
2. Then this.
3. Report the result.
`;

let container = null;
let actionsBar = null;

export async function skillsView(root, actions) {
  container = root;
  actionsBar = actions;
  await renderList();
}

function newBtn() {
  return el('button', { class: 'btn btn-primary', type: 'button', onclick: () => renderEditor(null) }, icon('plus', { size: 15 }), 'New skill');
}

async function renderList() {
  clear(actionsBar); actionsBar.append(newBtn());
  clear(container);
  const data = await get('/api/skills');
  const stack = el('div', { class: 'stack' });

  if (!data.user.length) {
    stack.append(emptyState('code-2', 'No skills yet', 'Press “New skill” to make your first /command.'));
  } else {
    const list = el('div', { class: 'cat-list' });
    for (const s of data.user) list.append(skillCard(s));
    stack.append(list);
  }
  container.append(stack);
}

function prettyPath(p) {
  // Shorten any OS home prefix (Windows / macOS / Linux) to ~ — machine-agnostic.
  return String(p || '').replace(/^([A-Za-z]:\\Users\\[^\\/]+|\/Users\/[^/]+|\/home\/[^/]+)/, '~').replace(/\\/g, '/');
}

function skillCard(s) {
  return el('div', { class: 'cm-soft-card cat-card skill-card' },
    el('button', { class: 'cat-head', type: 'button', onclick: () => renderDetail(s.name) },
      el('span', { class: 'cat-icon' }, icon('code-2', { size: 18 })),
      el('span', { class: 'cat-head-text' },
        el('span', { class: 'cat-name', text: '/' + s.name }),
        el('span', { class: 'cat-desc', text: s.description || 'No description yet.' }),
      ),
      el('span', { class: 'skill-chev' }, icon('chevron-right', { size: 16 })),
    ),
  );
}

async function renderDetail(name) {
  clear(actionsBar);
  clear(container);
  const s = await get('/api/skills/' + encodeURIComponent(name));

  const page = el('div', { class: 'skill-detail' },
    el('div', { class: 'editor-bar' },
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => renderList() }, icon('chevron-right', { size: 14, cls: 'flip' }), 'Back'),
      el('span', { class: 'skill-name mono grow', text: '/' + name }),
      // Mobile: one menu button opens a bottom-sheet with the actions.
      el('button', { class: 'btn btn-icon skill-more-btn', type: 'button', title: 'Actions', onclick: () => openActions(name, s) }, icon('menu', { size: 18 })),
      // Desktop: the actions inline.
      el('div', { class: 'bar-actions' },
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openEdit(name, s) }, icon('pencil', { size: 15 }), 'Edit'),
        el('button', { class: 'btn reveal-btn', type: 'button', onclick: () => reveal(name) }, icon('folder-2', { size: 15 }), 'Reveal file'),
        el('button', { class: 'btn', type: 'button', onclick: () => archive(name) }, icon('trash', { size: 15 }), 'Delete'),
      ),
    ),
    el('div', { class: 'detail-grid' },
      el('div', { class: 'detail-main file-preview scrolly' }, renderMarkdown(s.body || '')),
      el('div', { class: 'detail-side stack' },
        el('div', { class: 'skill-meta cm-soft-card' },
          metaRow('Summary', s.frontmatter.description || '—'),
          metaRow('Runs as', '/' + name),
          metaRow('Source', prettyPath(s.path), true),
        ),
      ),
    ),
  );
  container.append(page);
}

function metaRow(label, value, mono) {
  return el('div', { class: 'skill-meta-row' },
    el('span', { class: 'skill-meta-label', text: label }),
    el('span', { class: 'skill-meta-value' + (mono ? ' mono' : ''), text: value }),
  );
}

async function reveal(name) {
  try { await post('/api/skills/' + encodeURIComponent(name) + '/reveal', {}); toast('Opened', 'Explorer opened with the file selected.'); }
  catch (e) { toast('Couldn’t open', e.message, 'err'); }
}

function openEdit(name, s) {
  renderEditor({ name, description: s.frontmatter.description || '', argumentHint: (s.frontmatter['argument-hint'] || '').replace(/^"|"$/g, ''), body: s.body, baseHash: s.baseHash });
}

// Mobile action menu — all the skill's actions grouped behind one button.
// (Reveal file is left out on mobile: it opens Explorer on the PC, useless from a phone.)
function openActions(name, s) {
  actionSheet({
    title: '/' + name,
    actions: [
      { label: 'Edit skill', icon: 'pencil', kind: 'primary', onClick: () => openEdit(name, s) },
      { label: 'Delete skill', icon: 'trash', kind: 'danger', onClick: () => archive(name) },
    ],
  });
}

function kebab(v) { return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

function renderEditor(existing) {
  const isNew = !existing;
  clear(actionsBar); clear(container);
  const nameInput = input({ placeholder: 'daily-standup', value: existing?.name || '' });
  const nameField = el('div', { class: 'input-prefixed' }, el('span', { class: 'input-prefix mono', text: '/' }), nameInput);
  // Live command formatting: lowercase, spaces -> dashes, strip anything else.
  // Editable when creating AND editing (editing renames the command).
  nameInput.addEventListener('input', () => {
    const v = nameInput.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (v !== nameInput.value) { const p = nameInput.selectionStart; nameInput.value = v; try { nameInput.setSelectionRange(p, p); } catch { /* noop */ } }
  });
  const descInput = textarea({ class: 'textarea ta-bare', placeholder: 'A short 1–2 line summary of what it does and when to use it.' });
  descInput.value = existing?.description || '';
  const descBox = el('div', { class: 'textarea-box' }, descInput);
  const bodyInput = textarea({ class: 'textarea mono' });
  bodyInput.value = existing?.body ?? STARTER_BODY;

  // Save/Create stays greyed out until something actually differs from the
  // original — editing then reverting every character re-disables it.
  const isDirty = () => {
    const name = kebab(nameInput.value);
    if (isNew) return !!name;
    return name !== existing.name
      || descInput.value.trim() !== (existing.description || '').trim()
      || bodyInput.value !== (existing.body ?? '');
  };
  const saveBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: true,
    onclick: (e) => { e.currentTarget.disabled = true; save(e.currentTarget); } }, isNew ? 'Create skill' : 'Save changes');
  const updateDirty = () => { saveBtn.disabled = !isDirty(); };
  nameInput.addEventListener('input', updateDirty);
  descInput.addEventListener('input', updateDirty);
  bodyInput.addEventListener('input', updateDirty);

  const save = async (btn) => {
    const payload = { description: descInput.value.trim(), argumentHint: '', body: bodyInput.value };
    try {
      if (isNew) {
        const name = kebab(nameInput.value);
        if (!name) throw new Error('Give the skill a name');
        await post('/api/skills', { name, ...payload });
        toast('Skill created', `/${name} is ready — type / to use it.`);
      } else {
        const newName = kebab(nameInput.value);
        if (!newName) throw new Error('Give the skill a name');
        const renamed = newName !== existing.name;
        await put('/api/skills/' + encodeURIComponent(existing.name), { ...payload, baseHash: existing.baseHash, newName });
        toast('Saved', renamed ? `/${existing.name} renamed to /${newName}.` : `/${existing.name} updated.`);
      }
      await renderList();
    } catch (e) { toast('Failed', e.message, 'err'); if (btn) btn.disabled = false; }
  };

  container.append(el('div', { class: 'editor-page' },
    el('div', { class: 'editor-bar' },
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => renderList() }, icon('chevron-right', { size: 14, cls: 'flip' }), 'Back'),
      el('div', { class: 'editor-name-field' }, nameField),
      el('span', { class: 'grow' }),
      saveBtn,
    ),
    el('div', { class: 'editor-form-stack stack' },
      field('Description', descBox),
      el('div', { class: 'editor-body-wrap' }, field('Instructions for the AI', bodyInput)),
    ),
  ));
}

async function archive(name) {
  const ok = await confirmDialog(`Delete /${name}?`, 'It’s moved to your archive folder, so it disappears from your commands but can be brought back later.', 'Delete skill', 'danger');
  if (!ok) return;
  await del('/api/skills/' + encodeURIComponent(name));
  toast('Deleted', `/${name} is removed.`);
  await renderList();
}
