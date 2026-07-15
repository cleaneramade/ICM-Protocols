// Secrets reveal lock. A single owner password gates revealing/editing real
// .env values in the UI. Only a salted scrypt HASH is stored — never the
// password, never the secret values. The real values are withheld from the
// browser entirely until this verifies (see /api/env redaction + reveal).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PATHS } from './config.js';
import { httpError } from './router.js';

async function readLock() {
  try { return JSON.parse(await fs.readFile(PATHS.secretsLock, 'utf8')); }
  catch { return null; }
}

function hashPw(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 64).toString('hex');
}

export async function lockStatus() {
  const l = await readLock();
  return { hasPassword: !!(l && l.hash && l.salt) };
}

// True when the password matches — or when no password is set at all (open).
export async function verifyPassword(pw) {
  const l = await readLock();
  if (!l || !l.hash) return true;
  const a = Buffer.from(hashPw(pw ?? '', l.salt), 'hex');
  const b = Buffer.from(l.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function setPassword(current, next) {
  const l = await readLock();
  // Verify the current password through the SAME brute-force backoff as the
  // reveal/save gate — otherwise change-password becomes an unthrottled oracle
  // to guess the password and then unlock every secret.
  if (l && l.hash) await requirePassword(current);
  if (!next || String(next).length < 8) throw httpError(400, 'WEAK', 'Password must be at least 8 characters');
  const salt = crypto.randomBytes(16).toString('hex');
  await fs.mkdir(path.dirname(PATHS.secretsLock), { recursive: true });
  await fs.writeFile(PATHS.secretsLock, JSON.stringify({ salt, hash: hashPw(next, salt), updatedAt: new Date().toISOString() }, null, 2));
  return { ok: true };
}

// Brute-force backoff for the reveal/save gate. After a handful of wrong tries
// the gate locks for a growing window (capped at 60s), so a small password
// guarding real .env values can't be ground down guess-by-guess.
let failCount = 0;
let lockedUntil = 0;

// Guard used by reveal/save: throws 403 if a password is set and wrong, or 429
// while locked out after repeated failures.
export async function requirePassword(pw) {
  const now = Date.now();
  if (now < lockedUntil) {
    throw httpError(429, 'LOCKED', `Too many attempts — wait ${Math.ceil((lockedUntil - now) / 1000)}s and try again.`);
  }
  if (!(await verifyPassword(pw))) {
    failCount++;
    if (failCount >= 5) lockedUntil = now + Math.min(60_000, 1000 * 2 ** (failCount - 5));
    throw httpError(403, 'BAD_PASSWORD', 'Wrong password');
  }
  failCount = 0;
  lockedUntil = 0;
}
