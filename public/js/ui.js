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
export function dialog({ title, iconName = 'settings', body, actions, actionsInHeader = false }) {
  const overlay = document.getElementById('overlay');
  clear(overlay);
  overlay.hidden = false;
  const close = () => { overlay.hidden = true; clear(overlay); };
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
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.onkeydown = (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); };
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
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: () => resolve(false) },
        { label: confirmLabel, kind, onClick: () => resolve(true) },
      ],
    });
  });
}

/* ── Custom dropdown (styled open state — never native) ── */
export function dropdown({ items, value, onSelect, label, width }) {
  let open = false;
  const wrap = el('div', { class: 'dd' });
  const labelSpan = el('span', { class: 'dd-label', text: labelFor(value) });
  const btn = el('button', { class: 'dd-btn', type: 'button', style: width ? `width:${width}` : null },
    labelSpan, icon('chevron-down', { size: 14 }));
  const panel = el('div', { class: 'dd-panel', role: 'listbox' });
  panel.hidden = true;

  function labelFor(v) {
    const it = items.find((i) => i.value === v);
    return it ? it.label : (label || 'Select…');
  }
  function render() {
    clear(panel);
    for (const it of items) {
      panel.append(el('button', {
        class: 'dd-item', type: 'button', role: 'option',
        'aria-selected': String(it.value === value),
        onclick: () => { value = it.value; labelSpan.textContent = it.label; toggle(false); onSelect?.(it.value, it); },
      }, it.label, it.sub ? el('span', { class: 'dd-sub', text: it.sub }) : null));
    }
  }
  function toggle(state) {
    open = state ?? !open;
    panel.hidden = !open;
    if (open) render();
  }
  btn.onclick = () => toggle();
  document.addEventListener('click', (e) => { if (open && !wrap.contains(e.target)) toggle(false); });
  wrap.append(btn, panel);
  wrap.setValue = (v) => { value = v; labelSpan.textContent = labelFor(v); };
  wrap.setItems = (next) => { items = next; render(); };
  return wrap;
}

/* ── Segmented control ── */
export function segmented(options, activeValue, onChange) {
  const wrap = el('div', { class: 'segmented', role: 'tablist' });
  const render = (val) => {
    clear(wrap);
    for (const o of options) {
      wrap.append(el('button', {
        type: 'button', 'aria-pressed': String(o.value === val),
        onclick: () => { render(o.value); onChange(o.value); },
      }, o.label));
    }
  };
  render(activeValue);
  return wrap;
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
