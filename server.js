// Plutus Protocols UI — local server. 127.0.0.1 only, zero dependencies.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { PORT, PATHS } from './server/config.js';
import { createRouter, sendJson } from './server/router.js';
import { serveStatic } from './server/static.js';
import { getBoard, saveBoard, listDeleted, restoreDeleted, purgeDeleted } from './server/board.js';
import { logActivity, logMemoryChange } from './server/logbook.js';
import { listUserSkills, listPluginSkills, getSkill, createSkill, updateSkill, archiveSkill, revealSkill } from './server/skills.js';
import { listProjects, getEnv, putEnv, redactRaw, deleteProjectSecrets } from './server/envfiles.js';
import { lockStatus, setPassword, requirePassword } from './server/secretslock.js';
import { brainTree, getBrainFile, putBrainFile } from './server/brain.js';
import { listProfiles, putProfile } from './server/profiles.js';
import { getConfig, putConfig } from './server/appconfig.js';
import { securityRulebook, securityProjects, securityReport, securityHistory, securityTimeline } from './server/security.js';
import { listBackups } from './server/fsio.js';
import fs from 'node:fs/promises';

const router = createRouter();

router.add('GET', '/api/health', async (req, res) => {
  const checks = {};
  for (const [k, p] of Object.entries({ policy: PATHS.policy, brain: PATHS.brain, skills: PATHS.skillsDir, profiles: PATHS.profilesDir })) {
    checks[k] = await fs.access(p).then(() => true).catch(() => false);
  }
  sendJson(res, 200, { ok: true, version: '1.0.0', node: process.version, paths: checks });
});

router.add('GET', '/api/board', async (req, res) => {
  sendJson(res, 200, { ok: true, ...(await getBoard()) });
});

router.add('POST', '/api/board', async (req, res, params, body) => {
  if (!body || !body.sections) return sendJson(res, 400, { ok: false, code: 'BAD_BODY', error: 'sections required' });
  const result = await saveBoard(body.sections, body.baseHash);
  const bits = [];
  const added = Object.values(result.assignedIds || {}).flat();
  if (added.length) bits.push('added ' + added.join(', '));
  if (result.editedIds?.length) bits.push('edited ' + result.editedIds.join(', '));
  if (result.deletedIds?.length) bits.push('retired ' + result.deletedIds.join(', '));
  const note = bits.join('; ') || 'no row changes';
  const warnings = [];
  await logActivity('update', '00_system/APPROVAL_POLICY.md', note + (body.summary ? ` — ${body.summary}` : ''))
    .catch((e) => warnings.push('ACTIVITY_LOG append failed: ' + e.message));
  const ruleLines = [
    ...(result.addedRules || []).map((r) => 'Added ' + r),
    ...(result.editedIds || []).map((id) => 'Edited ' + id),
    ...(result.deletedIds || []).map((id) => 'Retired ' + id),
  ];
  if (ruleLines.length) {
    await logMemoryChange({
      title: 'Board updated via Protocols UI',
      color: 'Green (owner edit via Protocols UI)',
      trigger: 'Protocols UI save' + (body.summary ? ` — ${body.summary}` : ''),
      rules: ruleLines,
      files: '00_system/APPROVAL_POLICY.md',
    }).catch((e) => warnings.push('MEMORY_CHANGES append failed: ' + e.message));
  }
  sendJson(res, 200, { ok: true, newHash: result.newHash, assignedIds: result.assignedIds, deletedIds: result.deletedIds, editedIds: result.editedIds, warnings });
});

router.add('GET', '/api/deleted', async (req, res) => sendJson(res, 200, { ok: true, ...(await listDeleted()) }));
router.add('POST', '/api/deleted/restore', async (req, res, p, body) => {
  const out = await restoreDeleted(body?.recordId);
  await logActivity('restore', '00_system/APPROVAL_POLICY.md', `restored “${out.name}” as ${out.restoredId || 'new rule'}`).catch(() => {});
  sendJson(res, 200, { ok: true, ...out });
});
router.add('POST', '/api/deleted/purge', async (req, res, p, body) => sendJson(res, 200, { ok: true, ...(await purgeDeleted(body?.recordId)) }));

router.add('GET', '/api/skills', async (req, res) => {
  const [user, plugins] = await Promise.all([listUserSkills(), listPluginSkills()]);
  sendJson(res, 200, { ok: true, user, plugins });
});
router.add('GET', '/api/skills/:name', async (req, res, p) => sendJson(res, 200, { ok: true, ...(await getSkill(p.name)) }));
router.add('POST', '/api/skills', async (req, res, p, body) => sendJson(res, 200, { ok: true, ...(await createSkill(body || {})) }));
router.add('PUT', '/api/skills/:name', async (req, res, p, body) => sendJson(res, 200, { ok: true, ...(await updateSkill(p.name, body || {})) }));
router.add('DELETE', '/api/skills/:name', async (req, res, p) => sendJson(res, 200, { ok: true, ...(await archiveSkill(p.name)) }));
router.add('POST', '/api/skills/:name/reveal', async (req, res, p) => sendJson(res, 200, { ok: true, ...revealSkill(p.name) }));

router.add('GET', '/api/projects', async (req, res) => sendJson(res, 200, { ok: true, projects: await listProjects() }));

// Secrets reveal lock (owner password). Only the has-password flag is public.
router.add('GET', '/api/secrets-lock', async (req, res) => sendJson(res, 200, { ok: true, ...(await lockStatus()) }));
router.add('PUT', '/api/secrets-lock', async (req, res, p, body) => {
  await setPassword(body?.current, body?.next);
  sendJson(res, 200, { ok: true });
});

// Default GET NEVER returns real values when a password is set — it redacts
// them server-side, so the browser (and DevTools) only ever sees blank values.
router.add('GET', '/api/env', async (req, res, p, b, url) => {
  const out = await getEnv(url.searchParams.get('project'), url.searchParams.get('file'));
  const { hasPassword } = await lockStatus();
  // Redact when a lock is set OR whenever the request arrived over the tunnel —
  // real values must never cross the public preview URL, lock or no lock.
  const redact = hasPassword || req.icmRemote;
  sendJson(res, 200, { ok: true, raw: redact ? redactRaw(out.raw) : out.raw, baseHash: out.baseHash, hasPassword });
});
// Real values are handed out ONLY here, and only after the password verifies.
router.add('POST', '/api/env/reveal', async (req, res, p, body) => {
  await requirePassword(body?.password);
  const out = await getEnv(body?.project, body?.file);
  sendJson(res, 200, { ok: true, raw: out.raw, baseHash: out.baseHash });
});
router.add('PUT', '/api/env', async (req, res, p, body) => {
  await requirePassword(body?.password); // writing real values also needs the password when set
  const out = await putEnv(body?.project, body?.file, body?.raw ?? '', body?.baseHash);
  sendJson(res, 200, { ok: true, ...out });
});
// Delete a project's .env secret files (backed up first). Gated by the password
// when one is set — you can't wipe locked secrets without it.
router.add('DELETE', '/api/env', async (req, res, p, body) => {
  await requirePassword(body?.password);
  const out = await deleteProjectSecrets(body?.project);
  sendJson(res, 200, { ok: true, ...out });
});

router.add('GET', '/api/brain/tree', async (req, res) => sendJson(res, 200, { ok: true, tree: await brainTree() }));
router.add('GET', '/api/brain/file', async (req, res, p, b, url) => {
  sendJson(res, 200, { ok: true, ...(await getBrainFile(url.searchParams.get('path'))) });
});
router.add('PUT', '/api/brain/file', async (req, res, p, body) => {
  sendJson(res, 200, { ok: true, ...(await putBrainFile(body?.path, body?.raw ?? '', body?.baseHash, body?.confirmSystem)) });
});

router.add('GET', '/api/profiles', async (req, res) => sendJson(res, 200, { ok: true, profiles: await listProfiles() }));
router.add('PUT', '/api/profiles/:name', async (req, res, p, body) => {
  sendJson(res, 200, { ok: true, ...(await putProfile(p.name, body?.json, body?.baseHash)) });
});

router.add('GET', '/api/config', async (req, res) => sendJson(res, 200, { ok: true, config: await getConfig() }));
router.add('PUT', '/api/config', async (req, res, p, body) => sendJson(res, 200, { ok: true, config: await putConfig(body || {}) }));

router.add('GET', '/api/backups', async (req, res, p, b, url) => {
  sendJson(res, 200, { ok: true, backups: await listBackups(url.searchParams.get('path') || '') });
});

// Security dashboard — read-only. Rulebook + per-project audit scores + reports.
router.add('GET', '/api/security/rulebook', async (req, res) => sendJson(res, 200, { ok: true, ...(await securityRulebook()) }));
router.add('GET', '/api/security/projects', async (req, res) => sendJson(res, 200, { ok: true, ...(await securityProjects()) }));
router.add('GET', '/api/security/report', async (req, res, p, b, url) => {
  sendJson(res, 200, { ok: true, ...(await securityReport(url.searchParams.get('slug'), url.searchParams.get('stamp'))) });
});
router.add('GET', '/api/security/history', async (req, res, p, b, url) => {
  sendJson(res, 200, { ok: true, ...(await securityHistory(url.searchParams.get('slug'))) });
});
router.add('GET', '/api/security/timeline', async (req, res, p, b, url) => {
  sendJson(res, 200, { ok: true, ...(await securityTimeline(url.searchParams.get('slug'))) });
});

// Remote-work escape hatch (rule 36 / G-10): when the owner runs a Cloudflare
// quick tunnel, remote requests carry the *.trycloudflare.com host and would
// otherwise be blocked. Two opt-ins, both off by default (localhost only):
//   ICM_TUNNEL_HOST=<host>  → allow that one exact host.
//   ICM_ALLOW_TUNNEL=1      → allow ANY *.trycloudflare.com host, so the tunnel
//                             can restart with a new URL without restarting the
//                             server. Safe from DNS-rebinding: trycloudflare.com
//                             is Cloudflare-controlled and can't resolve to
//                             127.0.0.1, and real traffic arrives via the
//                             tunnel's own outbound connection.
const TUNNEL_HOST = (process.env.ICM_TUNNEL_HOST || '').toLowerCase().trim();
const ALLOW_ANY_TUNNEL = /^(1|true|yes|on)$/i.test(process.env.ICM_ALLOW_TUNNEL || '');
const isTrycloudflare = (h) => /^[a-z0-9-]+\.trycloudflare\.com$/.test(h);

// Which door did the request come in? 'local' = loopback browser, 'tunnel' =
// the owner's Cloudflare quick-tunnel, null = an unrecognised host (blocked).
// cloudflared proxies from localhost, so the socket address can't tell tunnel
// from local — the Host header is the only reliable signal.
function hostKind(req, port) {
  const host = (req.headers.host || '').toLowerCase();
  if (host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === '127.0.0.1' || host === 'localhost') return 'local';
  if (TUNNEL_HOST && host === TUNNEL_HOST) return 'tunnel';
  if (ALLOW_ANY_TUNNEL && isTrycloudflare(host)) return 'tunnel';
  return null;
}

function originOk(req, port) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (TUNNEL_HOST && origin === `https://${TUNNEL_HOST}`) return true;
  if (ALLOW_ANY_TUNNEL) {
    try { if (isTrycloudflare(new URL(origin).hostname.toLowerCase())) return true; } catch { /* not a URL */ }
  }
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function makeServer(port) {
  return http.createServer(async (req, res) => {
    const kind = hostKind(req, port);
    if (!kind) { res.writeHead(403); return res.end('forbidden'); }
    req.icmRemote = kind === 'tunnel';
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (mutating && !originOk(req, port)) {
      res.writeHead(403); return res.end('forbidden origin');
    }
    // Remote tunnel is view-only: never let the ephemeral public URL rewrite the
    // foundation, mint skills, change permissions, reveal secrets, or edit .env.
    // Editing the panel happens locally on the machine. (GET reads still redact
    // every secret value over the tunnel — see /api/env below.)
    if (req.icmRemote && mutating) {
      return sendJson(res, 403, { ok: false, code: 'REMOTE_READONLY', error: 'This panel is read-only over the remote preview tunnel. Make changes locally on the machine.' });
    }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/api/')) {
      const handled = await router.dispatch(req, res, url).catch((e) => {
        sendJson(res, e.httpStatus || 500, { ok: false, code: e.code || 'ERROR', error: e.message });
        return true;
      });
      if (!handled) sendJson(res, 404, { ok: false, code: 'NO_ROUTE', error: 'unknown API route' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    await serveStatic(req, res, url);
  });
}

function listen(port, attempt = 0) {
  const server = makeServer(port);
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempt < 10) {
      console.log(`port ${port} in use, trying ${port + 1}…`);
      listen(port + 1, attempt + 1);
    } else {
      console.error('server error:', e.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`\nICM Protocols UI  →  ${url}\n`);
    if (!process.argv.includes('--no-open')) {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    }
  });
}

listen(PORT);
