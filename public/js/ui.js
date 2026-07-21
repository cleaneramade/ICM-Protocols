// DOM helpers + shared components. All dynamic text goes through textContent
// (el() children as strings become text nodes) — file-derived content is
// never injected as HTML. Only icons.js injects markup, from its static set.
import { icon } from './icons.js';

export { icon };

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    // Boolean attrs (disabled, hidden, …): presence-based — false must remove it.
    else if (typeof v === 'boolean') node.toggleAttribute(k, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/* ── Toasts ── */
export function toast(title, body = '', kind = 'ok', ms = 5200) {
  const box = document.getElementById('toasts');
  const t = el('div', { class: 'toast', 'data-kind': kind },
    el('span', { class: 'toast-icon' }, icon(kind === 'err' ? 'x' : 'check-circle', { size: 18 })),
    el('div', { class: 'toast-text' },
      el('div', { class: 'toast-title', text: title }),
      body ? el('div', { class: 'toast-body', text: body }) : null,
    ),
  );
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

/* ── Dialog ── */
export function dialog({ title, iconName = 'settings', body, actions, actionsInHeader = false, onDismiss }) {
  const overlay = document.getElementById('overlay');
  clear(overlay);
  overlay.hidden = false;
  const close = () => { overlay.hidden = true; clear(overlay); };
  // Backdrop / Escape close paths — callers awaiting a result (confirmDialog)
  // need these to settle their promise, not leave it pending forever.
  const dismiss = () => { close(); onDismiss?.(); };
  const makeBtn = (a) => el('button', {
    class: 'btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger-soft' : 'btn-ghost'),
    type: 'button',
    onclick: async (e) => {
      const btn = e.currentTarget; // capture before await — currentTarget is null afterwards
      btn.disabled = true;
      try { const keep = await a.onClick?.(close); if (keep !== true) close(); }
      catch (err) { toast('Failed', err.message, 'err'); btn.disabled = false; return; }
    },
  }, a.label);
  const btns = actions.map(makeBtn);
  const head = el('div', { class: 'dialog-head' + (actionsInHeader ? ' has-actions' : '') },
    el('div', { class: 'dialog-head-main' }, icon(iconName, { size: 20 }), el('h2', { class: 'cm-h2', text: title })),
    actionsInHeader ? el('div', { class: 'dialog-head-actions' }, btns) : null,
  );
  const foot = actionsInHeader ? null : el('div', { class: 'dialog-foot' }, btns);
  const box = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
    head,
    el('div', { class: 'dialog-body scrolly' }, body),
    foot,
  );
  overlay.append(box);
  overlay.onclick = (e) => { if (e.target === overlay) dismiss(); };
  document.onkeydown = (e) => { if (e.key === 'Escape' && !overlay.hidden) dismiss(); };
  return { close };
}

/* ── Action sheet (mobile bottom sheet) ── groups actions behind one button ── */
export function actionSheet({ title, actions }) {
  const overlay = document.getElementById('overlay');
  clear(overlay);
  overlay.hidden = false;
  overlay.classList.add('sheet-overlay');
  const close = () => { overlay.hidden = true; overlay.classList.remove('sheet-overlay'); clear(overlay); };
  const sheet = el('div', { class: 'action-sheet', role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'sheet-handle' }),
    title ? el('div', { class: 'sheet-title mono', text: title }) : null,
    el('div', { class: 'sheet-actions' },
      ...actions.map((a) => el('button', {
        class: 'sheet-action' + (a.kind ? ' ' + a.kind : ''), type: 'button',
        onclick: async () => { close(); await a.onClick?.(); },
      }, el('span', { class: 'sheet-action-icon' }, icon(a.icon, { size: 18 })), el('span', { text: a.label }))),
    ),
    el('button', { class: 'sheet-cancel', type: 'button', onclick: close }, 'Cancel'),
  );
  overlay.append(sheet);
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.onkeydown = (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); };
  return { close };
}

export function confirmDialog(title, message, confirmLabel = 'Confirm', kind = 'primary') {
  return new Promise((resolve) => {
    dialog({
      title,
      iconName: 'shield',
      body: el('p', { class: 'cm-body', text: message }),
      onDismiss: () => resolve(false),
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: () => resolve(false) },
        { label: confirmLabel, kind, onClick: () => resolve(true) },
      ],
    });
  });
}

export function field(labelText, control) {
  return el('div', { class: 'field' }, el('label', { text: labelText }), control);
}

export function input(props = {}) { return el('input', { class: 'input', type: 'text', ...props }); }
export function textarea(props = {}) { return el('textarea', { class: 'textarea', ...props }); }

// 3-state permission toggle (connector-style): allow / ask / block.
export const PERM_STATES = [
  { key: 'allow', icon: 'check-circle', color: 'green', title: 'Always allow' },
  { key: 'ask', icon: 'question-circle', color: 'yellow', title: 'Needs approval' },
  { key: 'block', icon: 'ban', color: 'red', title: 'Block' },
];
export function permToggle(current, onChange) {
  const wrap = el('div', { class: 'perm-toggle' });
  for (const s of PERM_STATES) {
    wrap.append(el('button', {
      class: 'perm-tgl-btn', type: 'button', dataset: { color: s.color },
      'aria-pressed': String(current === s.key), title: s.title,
      onclick: (e) => { e.stopPropagation(); onChange(s.key); },
    }, icon(s.icon, { size: 17 })));
  }
  return wrap;
}

export function emptyState(iconName, title, body) {
  return el('div', { class: 'empty-state cm-soft-card' },
    icon(iconName, { size: 28 }),
    el('div', { class: 'cm-h3', text: title }),
    el('div', { class: 'cm-body-sm', text: body }),
  );
}
