// Shell: navigation, health, dirty-bar wiring, view mounting.
import { el, clear, icon, toast, confirmDialog } from './ui.js';
import { get } from './api.js';
import { boardState, onBoardChange, saveBoard, discardBoard } from './boardstore.js';
import { boardView } from './views/board.js';
import { integrationsView } from './views/integrations.js';
import { skillsView } from './views/skills.js';
import { envView } from './views/env.js';
import { brainView } from './views/brain.js';
import { securityView } from './views/security.js';
import { profilesView, saveProfiles, discardProfiles, onProfilesChange, profilesDirty } from './views/profiles.js';
import { helpView } from './views/help.js';

const VIEWS = [
  { key: 'board', label: 'Rules', iconName: 'widget-2', sub: 'What the AI can and can’t do on your projects.', render: boardView },
  { key: 'integrations', label: 'Connections', iconName: 'layers', sub: 'What each connected app is allowed to do.', render: integrationsView },
  { key: 'skills', label: 'Skills', iconName: 'code-2', sub: 'Create custom skills to run in the terminal CLI.', render: skillsView },
  { key: 'env', label: 'Secrets', iconName: 'database', sub: 'A project’s keys and passwords. They never leave this computer.', render: envView },
  { key: 'brain', label: 'Memory', iconName: 'folder-2', sub: 'Every rule and note that shapes how the AI works.', render: brainView },
  { key: 'security', label: 'Security', iconName: 'shield-check', sub: 'Each project’s safety score — run /security-audit to check one.', render: securityView },
  { key: 'profiles', label: 'Permissions', iconName: 'lock', sub: 'The exact allow / ask / block lists enforced per project.', render: profilesView },
  // foot: pinned to the bottom of the sidebar, below the main sections.
  { key: 'help', label: 'Help', iconName: 'question-circle', sub: 'How to use each section — with copy-paste prompts for setting it up with AI.', render: helpView, foot: true },
];

let current = null;

async function mount(key) {
  const def = VIEWS.find((v) => v.key === key) || VIEWS[0];
  if (current === def.key) return;
  if (boardState().dirty && (current === 'board' || current === 'integrations') && def.key !== 'board' && def.key !== 'integrations') {
    const ok = await confirmDialog('Unsaved board changes', 'Leaving discards your unsaved board edits. Discard them?', 'Discard', 'danger');
    if (!ok) return;
    await discardBoard();
  }
  if (current === 'profiles' && profilesDirty() && def.key !== 'profiles') {
    const ok = await confirmDialog('Unsaved permission changes', 'Leaving discards your unsaved permission edits. Discard them?', 'Discard', 'danger');
    if (!ok) return;
    await discardProfiles();
  }
  current = def.key;
  document.getElementById('main').dataset.view = def.key;
  document.getElementById('view-title').textContent = def.label;
  document.getElementById('view-sub').textContent = def.sub;
  clear(document.getElementById('view-actions'));
  const container = clear(document.getElementById('view'));
  renderNavs();
  try { await def.render(container, document.getElementById('view-actions')); }
  catch (e) { toast('Failed to load ' + def.label, e.message, 'err'); }
  refreshDirtyBar();
  location.hash = def.key;
}

function navButton(def, withLabel) {
  return el('button', {
    class: 'nav-item', type: 'button',
    'aria-current': String(current === def.key),
    onclick: () => mount(def.key),
    title: def.label,
  }, icon(def.iconName, { size: 18, active: current === def.key }), withLabel ? el('span', { class: 'nav-label', text: def.label }) : null);
}

function renderNavs() {
  const nav = clear(document.getElementById('nav'));
  const bottom = clear(document.getElementById('bottomnav'));
  for (const def of VIEWS.filter((v) => !v.foot)) {
    nav.append(navButton(def, true));
    bottom.append(navButton(def, false));
  }
  // Foot items (Help) sit at the bottom of the sidebar, pushed down by a spacer.
  nav.append(el('span', { class: 'nav-grow' }));
  for (const def of VIEWS.filter((v) => v.foot)) {
    nav.append(navButton(def, true));
    bottom.append(navButton(def, false));
  }
}

/* Floating Save / Discard pill — shared by Rules, Connections, and Permissions.
   Board + Connections edit the board store; Permissions edits the profiles store.
   The pill routes Save / Discard to whichever store the current view uses. */
const dirtybar = document.getElementById('dirtybar');
const isProfiles = () => current === 'profiles';

function refreshDirtyBar() {
  let show = false;
  if (current === 'board' || current === 'integrations') show = boardState().dirty;
  else if (current === 'profiles') show = profilesDirty();
  dirtybar.hidden = !show;
}

document.getElementById('dirty-save').onclick = async (e) => {
  const btn = e.currentTarget; // capture before await — currentTarget is null afterwards
  btn.disabled = true;
  try { await (isProfiles() ? saveProfiles() : saveBoard()); }
  catch (err) {
    if (err.code === 'STALE') {
      toast('File changed on disk', 'Another session edited it. Reloading fresh copy.', 'err');
      await (isProfiles() ? discardProfiles() : discardBoard());
    } else toast('Update failed', err.message, 'err');
  }
  btn.disabled = false;
};
document.getElementById('dirty-discard').onclick = () => (isProfiles() ? discardProfiles() : discardBoard());

onBoardChange(refreshDirtyBar);
onProfilesChange(refreshDirtyBar);

window.addEventListener('beforeunload', (e) => {
  if (boardState().dirty || profilesDirty()) { e.preventDefault(); e.returnValue = ''; }
});

window.addEventListener('hashchange', () => {
  const key = (location.hash || '#board').slice(1);
  if (key !== current) mount(key);
});

mount((location.hash || '#board').slice(1));
