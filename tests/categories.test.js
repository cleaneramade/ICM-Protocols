// Regression guard for the "rule vanishes into Other" bug: a rule moved to a
// different color loses its ID (re-ids on save), so its category must travel
// with the row explicitly — resolved from the sidecar or the built-in map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { RULE_ID_TO_CAT, RULE_CATEGORIES, groupRules } from '../public/js/categories.js';
import { parseBoard } from '../server/board.js';
import { readFileTracked } from '../server/fsio.js';
import { PATHS } from '../server/config.js';

test('RULE_ID_TO_CAT maps every id listed in RULE_CATEGORIES', () => {
  for (const c of RULE_CATEGORIES) {
    for (const id of c.ids) assert.equal(RULE_ID_TO_CAT[id], c.key, `${id} should map to ${c.key}`);
  }
});

test('groupRules: built-in row without explicit category resolves via the map', () => {
  const sections = {
    green: { rows: [{ id: 'G-01', cells: ['G-01', 'Edit files', ''] }] },
    yellow: { rows: [] },
    red: { rows: [] },
  };
  const cats = groupRules(sections);
  const files = cats.find((c) => c.key === 'files');
  assert.ok(files, 'files category should be present');
  assert.equal(files.green.length, 1);
  assert.ok(!cats.some((c) => c.key === 'other'), 'nothing should fall into Other');
});

test('groupRules: a moved row (id null) with a pinned category stays put', () => {
  // This is the exact shape setRuleColor produces after moving G-01 to yellow.
  const sections = {
    green: { rows: [] },
    yellow: { rows: [{ id: null, cells: ['', 'Edit files', ''], category: 'files' }] },
    red: { rows: [] },
  };
  const cats = groupRules(sections);
  const files = cats.find((c) => c.key === 'files');
  assert.ok(files, 'files category should be present');
  assert.equal(files.yellow.length, 1, 'moved rule should appear in its category, not Other');
  assert.ok(!cats.some((c) => c.key === 'other'), 'nothing should fall into Other');
});

// Real-data guard (read-only, skips on a fresh machine): every live rule must
// resolve to a category through the sidecar or the built-in map — an orphan
// here means it renders under "Other" and looks deleted to the user.
test('REAL policy: every live rule resolves to a category', async (t) => {
  let tracked;
  try { tracked = await readFileTracked(PATHS.policy); }
  catch (e) {
    if (e.code === 'ENOENT') { t.skip('no policy file on this machine yet'); return; }
    throw e;
  }
  const sidecar = await fs.readFile(PATHS.ruleCat, 'utf8').then(JSON.parse).catch(() => ({}));
  const model = parseBoard(tracked.text);
  const orphans = [];
  for (const key of ['green', 'yellow', 'red']) {
    for (const row of model.sections[key].rows) {
      if (!sidecar[row.id] && !RULE_ID_TO_CAT[row.id]) orphans.push(`${row.id} (${row.cells[1]})`);
    }
  }
  assert.deepEqual(orphans, [], `rules with no category (would show under "Other"): ${orphans.join(', ')}`);
});
