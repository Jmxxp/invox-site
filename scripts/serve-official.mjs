import './build-official.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');
const mime = { '.webm': 'video/webm', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.xml': 'application/xml' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let name = decodeURIComponent(url.pathname);
    if (name === '/invox-site') { res.writeHead(302, { Location: '/invox-site/' }); return res.end(); }
    if (name.startsWith('/invox-site/')) name = name.slice('/invox-site'.length);
    let target = path.resolve(output, `.${name}`);
    if (!target.startsWith(output + path.sep) && target !== output) throw new Error('path');
    if ((await fs.stat(target)).isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(302, { Location: url.pathname + '/' }); return res.end(); }
      target = path.join(target, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await fs.readFile(target));
  } catch { res.writeHead(404); res.end('Página não encontrada.'); }
}).listen(4173, '127.0.0.1', () => console.log('Site: http://localhost:4173/invox-site/ | Painel: http://localhost:4173/invox-site/admin/'));
