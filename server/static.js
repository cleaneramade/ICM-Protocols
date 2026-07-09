// Static file serving from public\ only. Extension whitelist, traversal guard.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from './config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

export async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const abs = path.resolve(PATHS.publicDir, '.' + rel);
  if (!abs.startsWith(PATHS.publicDir + path.sep) && abs !== PATHS.publicDir) return notFound(res);
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return notFound(res);
  try {
    // index.html: stamp local css/js links with the asset's mtime so a refresh
    // can never serve a stale stylesheet/module even from the browser's memory cache.
    if (ext === '.html') {
      const html = await bustAssetUrls(await fs.readFile(abs, 'utf8'));
      const buf = Buffer.from(html, 'utf8');
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      return res.end(buf);
    }
    const buf = await fs.readFile(abs);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch {
    notFound(res);
  }
}

// Append ?v=<mtimeMs> to same-origin /*.css and /*.js references.
async function bustAssetUrls(html) {
  const refs = new Set();
  html.replace(/(?:href|src)="(\/[^"?]+\.(?:css|js))"/g, (_, p) => { refs.add(p); return _; });
  const versions = {};
  await Promise.all([...refs].map(async (p) => {
    try { const st = await fs.stat(path.join(PATHS.publicDir, p)); versions[p] = Math.floor(st.mtimeMs); }
    catch { versions[p] = null; }
  }));
  return html.replace(/((?:href|src)=")(\/[^"?]+\.(?:css|js))(")/g, (m, a, p, b) =>
    versions[p] != null ? `${a}${p}?v=${versions[p]}${b}` : m);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('not found');
}
