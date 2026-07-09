// The gate: parse + serialize of the REAL APPROVAL_POLICY.md with zero edits
// must reproduce the file byte-for-byte. Read-only — never writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileTracked } from '../server/fsio.js';
import { parseBoard, serializeBoard, SECTIONS } from '../server/board.js';
import { PATHS } from '../server/config.js';

// Skips cleanly when no brain exists yet (fresh machine before init-brain) —
// the fixture-based suites still cover the round-trip logic.
async function readPolicyOrSkip(t) {
  try { return await readFileTracked(PATHS.policy); }
  catch (e) {
    if (e.code === 'ENOENT') { t.skip('no policy file on this machine yet — run node tools/init-brain.mjs'); return null; }
    throw e;
  }
}

test('REAL policy file: zero-edit round-trip is byte-identical', async (tt) => {
  const t = await readPolicyOrSkip(tt);
  if (!t) return;
  const model = parseBoard(t.text);
  const rows = {};
  for (const def of SECTIONS) rows[def.key] = model.sections[def.key].rows;
  let out = serializeBoard(model, rows);
  if (t.eol === '\r\n') out = out.replace(/\r?\n/g, '\r\n');
  if (t.bom) out = String.fromCharCode(0xfeff) + out;
  const outBuf = Buffer.from(out, 'utf8');
  assert.ok(outBuf.equals(t.buf), 'serialized output differs from the on-disk file');
});

test('REAL policy file: all five sections parse with at least one row', async (tt) => {
  const t = await readPolicyOrSkip(tt);
  if (!t) return;
  const model = parseBoard(t.text);
  for (const def of SECTIONS) {
    assert.ok(model.sections[def.key].rows.length >= 1, `${def.key} section has no rows`);
  }
});
