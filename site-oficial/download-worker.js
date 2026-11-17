'use strict';
// Only one-use attachment routes. No network, caches, tickets or signed URLs.
const pending = new Map();
const route = new URL('__invox_download__/', self.registration.scope);
const ids = /^[a-f0-9]{48}$/;
const MAX_FILE_BYTES = 1610612736;
function dispose(entry) { entry?.stream.cancel().catch(() => {}); entry?.port.close(); }
function expire() {
  for (const [id, entry] of pending) if (entry.expiresAt <= Date.now()) { pending.delete(id); dispose(entry); }
}
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  const data = event.data;
  if (!data || !ids.test(data.id || '')) return;
  let source;
  try { source = new URL(event.source?.url); } catch { return; }
  if (event.source?.type !== 'window' || source.origin !== self.location.origin || !source.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  expire();
  if (data.type === 'INVOX_DOWNLOAD_DISCARD') {
    const entry = pending.get(data.id);
    if (entry?.clientId === event.source.id) { pending.delete(data.id); dispose(entry); }
    return;
  }
  if (data.type !== 'INVOX_DOWNLOAD_PREPARE') return;
  const port = event.ports[0];
  if (!port || typeof data.stream?.getReader !== 'function' || !Number.isSafeInteger(data.size)
    || data.size < 1 || data.size > MAX_FILE_BYTES || typeof data.fileName !== 'string' || !data.fileName.trim()
    || pending.has(data.id) || pending.size >= 16) {
    port?.postMessage({ type: 'INVOX_DOWNLOAD_ERROR' }); port?.close(); return;
  }
  const fileName = data.fileName.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 180);
  pending.set(data.id, { stream: data.stream, fileName, size: data.size, port, clientId: event.source.id, expiresAt: Date.now() + 60000 });
  port.postMessage({ type: 'INVOX_DOWNLOAD_READY' });
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== route.origin || !url.pathname.startsWith(route.pathname)) return;
  const id = url.pathname.slice(route.pathname.length);
  if (!ids.test(id) || url.search) return;
  expire();
  const entry = pending.get(id);
  if (event.request.method !== 'GET' || !entry) {
    event.respondWith(new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })); return;
  }
  if (event.request.headers.has('Range')) {
    event.respondWith(new Response(null, { status: 416, headers: { 'Cache-Control': 'no-store', 'Content-Range': 'bytes */' + entry.size } })); return;
  }
  pending.delete(id);
  const fallback = entry.fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(entry.fileName).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  const extension = entry.fileName.split('.').pop().toLowerCase();
  const type = extension === 'apk' ? 'application/vnd.android.package-archive' : extension === 'zip' ? 'application/zip' : 'application/octet-stream';
  event.respondWith(new Response(entry.stream, { headers: {
    'Content-Type': type, 'Content-Length': String(entry.size),
    'Content-Disposition': 'attachment; filename="' + fallback + '"; filename*=UTF-8\'\'' + encoded,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'"
  } }));
  entry.port.postMessage({ type: 'INVOX_DOWNLOAD_STARTED' }); entry.port.close();
  // Native transferred streams apply backpressure outside worker JS. Do not
  // pin a multi-hour fetch with waitUntil: Chromium limits event lifetimes.
});
