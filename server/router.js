// Minimal method+pattern router with JSON body reading.
// Patterns: '/api/skills/:name' — segments starting with ':' capture params.
const MAX_BODY = 1024 * 1024; // 1 MB

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const segs = pattern.split('/').filter(Boolean);
    routes.push({ method, segs, handler });
  }

  async function dispatch(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean);
    for (const r of routes) {
      if (r.method !== req.method || r.segs.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < r.segs.length; i++) {
        const s = r.segs[i];
        if (s.startsWith(':')) {
          // Malformed %-sequences (hand-crafted URLs) must 404, not crash to 500.
          try { params[s.slice(1)] = decodeURIComponent(parts[i]); }
          catch { ok = false; break; }
        } else if (s !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      let body = null;
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
        try { body = await readJson(req); }
        catch (e) { sendJson(res, 400, { ok: false, code: 'BAD_BODY', error: e.message }); return true; }
      }
      try {
        await r.handler(req, res, params, body, url);
      } catch (e) {
        const status = e.httpStatus || 500;
        sendJson(res, status, { ok: false, code: e.code || 'ERROR', error: e.message });
      }
      return true;
    }
    return false;
  }

  return { add, dispatch };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

export function sendJson(res, status, obj) {
  if (res.headersSent) return; // never double-send (would crash the process)
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
  res.end(buf);
}

export function httpError(status, code, message) {
  const e = new Error(message);
  e.httpStatus = status;
  e.code = code;
  return e;
}
