import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, serializeBoard, applyEdits, splitCells, renderRow, SECTIONS } from '../server/board.js';

function fixture() {
  return [
    '# Policy',
    '',
    'Some prose with | a pipe outside tables.',
    '',
    '## Legacy tier mapping',
    '',
    '| Old tier | New color | Behavior |',
    '| --- | --- | --- |',
    '| Low impact | Green | Act |',
    '',
    '## GREEN — always allowed (act, then report)',
    '',
    '| ID | Rule | Scope / details | Notes |',
    '| --- | --- | --- | --- |',
    '| G-01 | Edit files | The project tree | Reversible |',
    '| G-02 | Local git | init, status | hand  aligned   spacing |',
    '',
    '## YELLOW — ask first (prepare, show, wait for a yes)',
    '',
    '| ID | Rule | Scope / details | Notes |',
    '| --- | --- | --- | --- |',
    '| Y-01 | Push | any remote | escaped \\| pipe inside |',
    '',
    'Prose between tables stays.',
    '',
    '## RED — never do (only a recorded standing decision can move these)',
    '',
    '| ID | Rule | Scope / details | Notes |',
    '| --- | --- | --- | --- |',
    '| R-01 | Secrets | never | behavioral |',
    '',
    '## Path zones',
    '',
    '| ID | Zone | Paths | What\'s allowed |',
    '| --- | --- | --- | --- |',
    '| Z-01 | Editable | project | full |',
    '',
    '## Integrations — permission overlays',
    '',
    '| ID | Integration | Green (free use) | Yellow (ask first) | Red (never) |',
    '| --- | --- | --- | --- | --- |',
    '| I-01 | Gmail | read | compose, send | delete |',
    '',
    '## Worked examples',
    '',
    'The end.',
  ].join('\n');
}

test('splitCells honors escaped pipes', () => {
  assert.deepEqual(splitCells('| a | b \\| c | d |'), ['a', 'b | c', 'd']);
});

test('renderRow escapes pipes', () => {
  assert.equal(renderRow(['A', 'x | y']), '| A | x \\| y |');
});

test('zero-edit round-trip is byte-identical on fixture', () => {
  const text = fixture();
  const model = parseBoard(text);
  const rows = {};
  for (const def of SECTIONS) rows[def.key] = model.sections[def.key].rows;
  assert.equal(serializeBoard(model, rows), text);
});

test('legacy mapping table and prose are untouched by edits', () => {
  const text = fixture();
  const model = parseBoard(text);
  const retired = { G: [], Y: [], R: [], Z: [], I: [] };
  const edited = { yellow: { rows: [
    { id: 'Y-01', cells: ['Y-01', 'Push', 'any remote', 'escaped | pipe inside'] },
    { id: null, cells: ['', 'New rule', 'scope', 'notes'] },
  ] } };
  const { newRowsBySection, assignedIds } = applyEdits(model, edited, retired);
  const out = serializeBoard(model, newRowsBySection);
  assert.match(out, /\| Low impact \| Green \| Act \|/);
  assert.match(out, /Prose between tables stays\./);
  assert.match(out, /\| Y-02 \| New rule \| scope \| notes \|/);
  assert.deepEqual(assignedIds.yellow, ['Y-02']);
  // unmodified row keeps its exact raw line (hand-aligned spacing preserved)
  assert.match(out, /\| G-02 \| Local git \| init, status \| hand {2}aligned {3}spacing \|/);
});

test('deleting a row retires its ID and it is never reused', () => {
  const text = fixture();
  const model = parseBoard(text);
  const retired = { G: [], Y: [], R: [], Z: [], I: [] };
  const edited = { green: { rows: [{ id: 'G-01', cells: ['G-01', 'Edit files', 'The project tree', 'Reversible'] }] } };
  const { newRowsBySection, deletedIds } = applyEdits(model, edited, retired);
  assert.deepEqual(deletedIds, ['G-02']);
  assert.deepEqual(retired.G, ['G-02']);
  const out = serializeBoard(model, newRowsBySection);
  const model2 = parseBoard(out);
  const edited2 = { green: { rows: [...model2.sections.green.rows, { id: null, cells: ['', 'Another', 's', 'n'] }] } };
  const r2 = applyEdits(model2, edited2, retired);
  assert.deepEqual(r2.assignedIds.green, ['G-03']); // not G-02
});

test('validation: wrong cell count, unknown id, dup id, newline in cell', () => {
  const model = parseBoard(fixture());
  const retired = { G: [], Y: [], R: [], Z: [], I: [] };
  assert.throws(() => applyEdits(model, { red: { rows: [{ id: 'R-01', cells: ['R-01', 'x'] }] } }, retired), /BAD_CELLS|cells/);
  assert.throws(() => applyEdits(model, { red: { rows: [{ id: 'R-99', cells: ['R-99', 'a', 'b', 'c'] }] } }, retired), /UNKNOWN_ID|does not exist/);
  assert.throws(() => applyEdits(model, { green: { rows: [
    { id: 'G-01', cells: ['G-01', 'a', 'b', 'c'] },
    { id: 'G-01', cells: ['G-01', 'a', 'b', 'c'] },
  ] } }, retired), /DUP_ID|duplicate/);
  assert.throws(() => applyEdits(model, { green: { rows: [{ id: 'G-01', cells: ['G-01', 'a\nb', 'b', 'c'] }] } }, retired), /line breaks/);
});

test('missing section or bad alignment row → loud 422', () => {
  assert.throws(() => parseBoard('# nothing here'), /SECTION_MISSING|not found/);
  const bad = fixture().replace('| --- | --- | --- | --- |\n| G-01', '| G-01');
  assert.throws(() => parseBoard(bad), /BAD_TABLE|alignment|BAD_ROW/);
});
