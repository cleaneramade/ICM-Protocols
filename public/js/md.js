// Minimal, SAFE markdown → DOM renderer. Builds every node with
// createElement + textContent — never innerHTML with file content — so
// nothing in a brain file can inject markup. Supports headings, paragraphs,
// bullet/numbered lists, code fences, inline `code` + **bold**, blockquotes,
// horizontal rules, and pipe tables (the board files use those).

function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

// Split a line into inline nodes: **bold**, `code`, and plain text.
function appendInline(parent, text) {
  let rest = String(text);
  // bold ** ** first, then `code`, then *italic* / _italic_
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/;
  let m;
  while ((m = re.exec(rest))) {
    if (m.index > 0) parent.append(document.createTextNode(rest.slice(0, m.index)));
    if (m[1] != null) { const s = el('strong'); s.textContent = m[1]; parent.append(s); }
    else if (m[2] != null) { const c = el('code', 'md-code'); c.textContent = m[2]; parent.append(c); }
    else { const em = el('em'); em.textContent = m[3] != null ? m[3] : m[4]; parent.append(em); }
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) parent.append(document.createTextNode(rest));
}

function splitCells(line) {
  const cells = []; let cur = ''; let started = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') { if (!started) { started = true; continue; } cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  return cells;
}

export function renderMarkdown(text) {
  const root = el('div', 'md');
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const code = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
      i++;
      const pre = el('pre', 'md-pre'); pre.textContent = code.join('\n'); root.append(pre); continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const node = el('h' + Math.min(h[1].length, 6), 'md-h md-h' + h[1].length); appendInline(node, h[2]); root.append(node); i++; continue; }

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const table = el('table', 'md-table');
      const thead = el('thead'); const htr = el('tr');
      for (const c of splitCells(line)) { const th = el('th'); appendInline(th, c); htr.append(th); }
      thead.append(htr); table.append(thead);
      i += 2;
      const tbody = el('tbody');
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const tr = el('tr');
        for (const c of splitCells(lines[i])) { const td = el('td'); appendInline(td, c); tr.append(td); }
        tbody.append(tr); i++;
      }
      table.append(tbody);
      const wrap = el('div', 'md-table-wrap'); wrap.append(table); root.append(wrap); continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const ul = el('ul', 'md-ul');
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { const li = el('li'); appendInline(li, lines[i].replace(/^\s*[-*]\s+/, '')); ul.append(li); i++; }
      root.append(ul); continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const ol = el('ol', 'md-ol');
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { const li = el('li'); appendInline(li, lines[i].replace(/^\s*\d+\.\s+/, '')); ol.append(li); i++; }
      root.append(ol); continue;
    }
    if (/^\s*(---|===)\s*$/.test(line)) { root.append(el('hr', 'md-hr')); i++; continue; }
    if (/^>\s?/.test(line)) { const bq = el('blockquote', 'md-bq'); appendInline(bq, line.replace(/^>\s?/, '')); root.append(bq); i++; continue; }
    if (line.trim() === '') { i++; continue; }

    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|\s*[-*]\s|\s*\d+\.\s|>|\s*\|)/.test(lines[i])) { para.push(lines[i]); i++; }
    const p = el('p', 'md-p'); appendInline(p, para.join(' ')); root.append(p);
  }
  return root;
}
