// Permissions view — the enforced allow / ask / block lists. Same folder-card
// style as before (collapsible category cards with a 3-state toggle per rule and
// a master toggle per category), but the three profiles that used to be a tab
// menu are now stacked as labelled sections: scroll down to see Prototype,
// Production, and Client work, each with its permission groups. Edits flip a
// shared dirty state so the floating Save / Discard pill (same as Rules &
// Connections) appears.
import { el, clear, icon, toast, permToggle } from '../ui.js';
import { get, put } from '../api.js';
import { groupPermissions, friendlyPermRule } from '../categories.js';

// profile group <-> 3-state toggle key (the toggle uses allow/ask/block)
const PERM_OF_GROUP = { allow: 'allow', ask: 'ask', deny: 'block' };
const GROUP_OF_PERM = { allow: 'allow', ask: 'ask', block: 'deny' };
const COLOR_OF = { allow: 'green', ask: 'yellow', deny: 'red' };
const GROUP_ORDER = { allow: 0, ask: 1, deny: 2 };

let container = null;
// open = set of "<profile>::<category>" keys; dirty = set of changed profile names.
let state = { profiles: [], open: new Set(), dirty: new Set() };

// Dirty notifications so the shell's floating Save / Discard pill can react —
// exactly like the board store does for Rules & Connections.
const listeners = new Set();
export function onProfilesChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function profilesDirty() { return state.dirty.size > 0; }
function emit() { for (const fn of listeners) fn(profilesDirty()); }
function markDirty(name) { state.dirty.add(name); emit(); }

export async function profilesView(root) {
  container = root;
  const data = await get('/api/profiles');
  state.profiles = data.profiles;
  state.dirty.clear();
  emit();
  render();
}

function prettyName(name) { return name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

function render() {
  clear(container);
  const wrap = el('div', { class: 'perm-profiles' });
  for (const p of state.profiles) {
    wrap.append(profileHead(p));
    if (p.error) { wrap.append(el('p', { class: 'cm-body muted', text: 'Profile unavailable.' })); continue; }
    const list = el('div', { class: 'cat-list' });
    for (const cat of groupPermissions(p.json.permissions)) list.append(categoryCard(p, cat));
    wrap.append(list);
  }
  container.append(wrap);
}

// A labelled separator that starts each profile's block of permission groups.
function profileHead(p) {
  return el('div', { class: 'perm-profile-head' },
    el('span', { class: 'perm-profile-name', text: prettyName(p.name) }),
  );
}

function categoryCard(p, cat) {
  const key = p.name + '::' + cat.key;
  const isOpen = state.open.has(key);
  const toggle = () => { state.open.has(key) ? state.open.delete(key) : state.open.add(key); render(); };
  const master = categoryMaster(cat);
  const head = el('div', { class: 'cat-head conn-head-row', onclick: toggle },
    el('span', { class: 'cat-icon' }, icon(cat.icon, { size: 18 })),
    el('span', { class: 'cat-head-text' },
      el('span', { class: 'cat-name', text: cat.name }),
      el('span', { class: 'cat-desc', text: catCount(cat) }),
    ),
    el('span', { class: 'conn-master' }, permToggle(master ? PERM_OF_GROUP[master] : null, (perm) => setCategoryMaster(p, cat, GROUP_OF_PERM[perm]))),
    el('span', { class: 'cat-chev', dataset: { open: String(isOpen) } }, icon('chevron-down', { size: 16 })),
  );
  const card = el('div', { class: 'cm-soft-card cat-card', dataset: { open: String(isOpen) } }, head);
  if (isOpen) {
    const body = el('div', { class: 'cat-body' });
    for (const entry of mergeRules(cat.rules)) body.append(permRow(p, entry));
    // No "Add rule" here — permission rules are managed by the AI, not added by hand.
    card.append(body);
  }
  return card;
}

// Merge raw rules that share a plain-English label + group into one row.
function mergeRules(rules) {
  const byKey = new Map();
  for (const r of rules) {
    const f = friendlyPermRule(r.rule);
    const k = f.label + '|' + r.group;
    if (!byKey.has(k)) byKey.set(k, { label: f.label, desc: f.desc, group: r.group, raws: [] });
    byKey.get(k).raws.push(r.rule);
  }
  return [...byKey.values()].sort((a, b) => (GROUP_ORDER[a.group] - GROUP_ORDER[b.group]) || a.label.localeCompare(b.label));
}

function categoryMaster(cat) {
  const groups = new Set(cat.rules.map((r) => r.group));
  return groups.size === 1 ? [...groups][0] : null; // null = mixed
}

function catCount(cat) {
  const c = { allow: 0, ask: 0, deny: 0 };
  for (const r of cat.rules) c[r.group]++;
  const parts = [];
  if (c.allow) parts.push(`${c.allow} allowed`);
  if (c.ask) parts.push(`${c.ask} ask`);
  if (c.deny) parts.push(`${c.deny} blocked`);
  return parts.join(' · ') || 'No rules';
}

function ruleIcon(rule) {
  if (/^Bash\(/.test(rule)) {
    if (/rm -rf|rm -fr|--force|git push -f|gh repo delete/.test(rule)) return 'trash';
    if (/\bgit\b|\bgh\b/.test(rule)) return 'code-2';
    if (/npm|npx|prisma|node|yarn|pnpm/.test(rule)) return 'box';
    if (/vercel|cloudflared|netlify/.test(rule)) return 'server-2';
    if (/curl|wget/.test(rule)) return 'magnifer';
    return 'bolt';
  }
  if (/^Read\(/.test(rule)) return 'eye';
  if (/^(Edit|Write)\(/.test(rule)) return 'pencil';
  if (/^(WebFetch|WebSearch)/.test(rule)) return 'magnifer';
  if (/^mcp__/.test(rule)) return 'layers';
  return 'settings';
}

function permRow(p, entry) {
  return el('div', { class: 'bucket-row rule-bucket', dataset: { color: COLOR_OF[entry.group] } },
    el('span', { class: 'bucket-icon' }, icon(ruleIcon(entry.raws[0]), { size: 17 })),
    el('div', { class: 'bucket-main' },
      el('div', { class: 'bucket-line' }, el('span', { class: 'bucket-label', text: entry.label })),
      entry.desc ? el('div', { class: 'bucket-desc', text: entry.desc }) : null,
      el('div', { class: 'perm-rule-code mono', text: entry.raws.join('   ·   ') }),
    ),
    el('div', { class: 'perm-row-side' },
      el('div', { class: 'perm-row-tools' },
        el('button', { class: 'icon-btn', type: 'button', title: 'Remove', onclick: () => removeEntry(p, entry) }, icon('trash', { size: 14 })),
      ),
      permToggle(PERM_OF_GROUP[entry.group], (perm) => setEntryGroup(p, entry, GROUP_OF_PERM[perm])),
    ),
  );
}

function moveRule(perms, raw, to) {
  for (const g of ['allow', 'ask', 'deny']) perms[g] = (perms[g] || []).filter((x) => x !== raw);
  (perms[to] = perms[to] || []).push(raw);
}

function setEntryGroup(p, entry, to) {
  if (entry.group === to) return;
  for (const raw of entry.raws) moveRule(p.json.permissions, raw, to);
  markDirty(p.name); render();
}

function setCategoryMaster(p, cat, to) {
  for (const r of cat.rules) moveRule(p.json.permissions, r.rule, to);
  markDirty(p.name); render();
}

function removeEntry(p, entry) {
  const perms = p.json.permissions;
  const set = new Set(entry.raws);
  for (const g of ['allow', 'ask', 'deny']) perms[g] = (perms[g] || []).filter((x) => !set.has(x));
  markDirty(p.name); render();
}

// Save / discard are driven by the shell's floating pill (see main.js). Only the
// profiles you actually changed get written. Save throws on error so the shell
// can react to STALE the same way it does for the board.
export async function saveProfiles() {
  for (const name of [...state.dirty]) {
    const p = state.profiles.find((x) => x.name === name);
    if (!p) { state.dirty.delete(name); continue; }
    const res = await put('/api/profiles/' + encodeURIComponent(p.name), { json: p.json, baseHash: p.baseHash });
    p.baseHash = res.newHash;
    state.dirty.delete(name);
  }
  emit();
  toast('Saved', 'Permissions updated. Projects use them on their next session.');
  render();
}

export async function discardProfiles() {
  const f = await get('/api/profiles');
  state.profiles = f.profiles;
  state.dirty.clear();
  emit();
  render();
}
