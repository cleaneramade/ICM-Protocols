// Fetch the extra Solar icons we need (outline + bold) from the Iconify API
// (same Solar set the nav uses) and write tools/solar-extra.json for
// extract-icons.mjs to merge. Run: node tools/fetch-solar-icons.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// our icon name -> Solar base name (Iconify solar:<base>-outline / -bold)
const MAP = {
  pencil: 'pen',
  trash: 'trash-bin-trash',
  'check-circle': 'check-circle',
  'question-circle': 'question-circle',
  ban: 'forbidden-circle',
  eye: 'eye',
  book: 'book-2',
  'shield-check': 'shield-check',
};

const req = [];
for (const base of Object.values(MAP)) { req.push(base + '-outline', base + '-bold'); }
const url = `https://api.iconify.design/solar.json?icons=${req.join(',')}`;

const res = await fetch(url);
if (!res.ok) { console.error('fetch failed', res.status); process.exit(1); }
const data = await res.json();
const icons = data.icons || {};

const out = {};
for (const [name, base] of Object.entries(MAP)) {
  const o = icons[base + '-outline']?.body;
  const b = icons[base + '-bold']?.body;
  if (!o && !b) { console.warn('missing', base); continue; }
  out[name] = { o: o || b, b: b || o };
}

await fs.writeFile(path.join(here, 'solar-extra.json'), JSON.stringify(out, null, 1), 'utf8');
console.log('wrote solar-extra.json with', Object.keys(out).length, 'icons:', Object.keys(out).join(', '));
