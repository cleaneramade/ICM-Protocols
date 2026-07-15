import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readFileTracked, backupThenAtomicWrite, sha256 } from '../server/fsio.js';

const BOM = String.fromCharCode(0xfeff);

async function tmpFile(content) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'icm-fsio-'));
  const p = path.join(dir, 'x.md');
  await fs.writeFile(p, content);
  return p;
}

test('BOM and CRLF are detected and preserved', async () => {
  const p = await tmpFile(BOM + 'a\r\nb\r\n');
  const t = await readFileTracked(p);
  assert.equal(t.bom, true);
  assert.equal(t.eol, '\r\n');
  assert.equal(t.trailingNL, true);
  await backupThenAtomicWrite(p, 'a\nb\nc\n', { bom: t.bom, eol: t.eol, expectedHash: t.hash });
  const raw = await fs.readFile(p);
  assert.equal(raw.toString('utf8'), BOM + 'a\r\nb\r\nc\r\n');
});

test('LF-only file stays LF', async () => {
  const p = await tmpFile('one\ntwo\n');
  const t = await readFileTracked(p);
  assert.equal(t.eol, '\n');
  await backupThenAtomicWrite(p, 'one\ntwo\nthree\n', { bom: t.bom, eol: t.eol, expectedHash: t.hash });
  assert.equal((await fs.readFile(p)).toString('utf8'), 'one\ntwo\nthree\n');
});

test('stale hash → 409-style error, file untouched', async () => {
  const p = await tmpFile('v1\n');
  const t = await readFileTracked(p);
  await fs.writeFile(p, 'v2 external change\n');
  await assert.rejects(
    backupThenAtomicWrite(p, 'v3\n', { expectedHash: t.hash }),
    (e) => e.code === 'STALE' && e.httpStatus === 409,
  );
  assert.equal((await fs.readFile(p)).toString('utf8'), 'v2 external change\n');
});

test('write is atomic-ish: content is complete and hash returned matches', async () => {
  const p = await tmpFile('start\n');
  const h = await backupThenAtomicWrite(p, 'final content\n', {});
  const raw = await fs.readFile(p);
  assert.equal(sha256(raw), h);
});
