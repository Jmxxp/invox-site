const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { MessageChannel } = require('node:worker_threads');
const root = path.resolve(__dirname, '../site-oficial');
const hashwasm = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/vendor/sha256.umd.min.js'), 'utf8'),
  { exports: hashwasm, module: { exports: hashwasm }, Buffer, Uint8Array, ArrayBuffer, DataView, TextEncoder, WebAssembly });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const bytes = [Buffer.from('original executable\0'), Buffer.from([255, 4, 6, 8, 10])];
const manifest = { kind: 'multipart', ticket: 'a'.repeat(64), fileName: 'INVOX teste.exe', size: Buffer.concat(bytes).length,
  sha256: sha(Buffer.concat(bytes)), expiresAt: new Date(Date.now() + 3600000).toISOString(),
  parts: bytes.map((value, index) => ({ index, size: value.length, sha256: sha(value) })) };
const scope = 'https://invox.test/invox-site/';
const events = {}, messages = [], downloads = [];
const workerSelf = { registration: { scope }, location: { origin: 'https://invox.test' },
  addEventListener: (key, callback) => { events[key] = callback; },
  skipWaiting: async () => {}, clients: { claim: async () => {} } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'download-worker.js'), 'utf8'), { self: workerSelf, URL, Response });
const owner = { type: 'window', id: 'owner', url: scope + 'index.html' };
const worker = { postMessage(data, transfer = []) {
  messages.push(data.type);
  if (data.type === 'INVOX_DOWNLOAD_PREPARE') {
    assert.equal(data.ticket, undefined); assert.equal(data.url, undefined); assert.equal(data.accessSession, undefined);
    const envelope = structuredClone({ data, port: transfer[0] }, { transfer });
    queueMicrotask(() => events.message({ data: envelope.data, ports: [envelope.port], source: owner }));
  } else events.message({ data, ports: [], source: owner });
} };
let response, responseBytes;
const window = { document: { baseURI: scope + 'index.html', currentScript: { src: scope + 'download-multipart.js' },
  createElement: () => ({ setAttribute() {}, remove() { this.removed = true; } }),
  body: { append(frame) {
    downloads.push(frame);
    events.fetch({ request: new Request(frame.src), respondWith(value) {
      response = value; responseBytes = value.arrayBuffer().then(result => Buffer.from(result));
      responseBytes.catch(() => {});
    } });
  } } }, location: { href: scope + 'index.html' }, navigator: { serviceWorker: { register: async () => ({ active: worker, scope }) } },
  isSecureContext: true, hashwasm, AbortController, TransformStream, MessageChannel, crypto: crypto.webcrypto,
  setTimeout, clearTimeout, addEventListener() {},
  fetch: async url => new Response(new Uint8Array(bytes[Number(new URL(url).pathname.split('/').pop())])) };
vm.runInNewContext(fs.readFileSync(path.join(root, 'download-multipart.js'), 'utf8'), { window, URL, Uint8Array, ArrayBuffer, AbortController });
(async () => {
  const getPart = async (ticket, index) => ({ ...manifest.parts[index], expiresIn: 60,
    url: `https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/sign/invox-installers/${index}?token=fixture` });
  const result = await window.InvoxMultipartDownloads.start(manifest, { getPart });
  assert.equal(result.method, 'stream'); assert.equal(result.verified, true);
  assert.deepEqual(await responseBytes, Buffer.concat(bytes), 'native transferable stream preserves the original file');
  assert.equal(response.headers.get('Content-Length'), String(manifest.size));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.match(response.headers.get('Content-Disposition'), /attachment; filename=/);
  assert.equal(downloads.length, 1); assert(messages.includes('INVOX_DOWNLOAD_PREPARE'));
  let handled = false;
  events.fetch({ request: new Request(scope + 'index.html'), respondWith() { handled = true; } });
  events.fetch({ request: new Request('https://wsfdwyghqqaerivyrbil.supabase.co/rest/v1/settings'), respondWith() { handled = true; } });
  assert.equal(handled, false, 'worker does not intercept pages, auth, API or storage traffic');
  let used;
  events.fetch({ request: new Request(downloads[0].src), respondWith(value) { used = value; } });
  assert.equal(used.status, 404, 'attachment routes can only be consumed once');
  const notes = [], id = 'b'.repeat(48);
  const port = { postMessage: value => notes.push(value.type), close() {} };
  events.message({ data: { type: 'INVOX_DOWNLOAD_PREPARE', id, size: 1, fileName: 'test.exe', stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }) },
    source: owner, ports: [port] });
  let ranged;
  events.fetch({ request: new Request(scope + '__invox_download__/' + id, { headers: { Range: 'bytes=0-' } }), respondWith(value) { ranged = value; } });
  assert.equal(ranged.status, 416, 'a partial resume cannot silently produce a different file');
  events.message({ data: { type: 'INVOX_DOWNLOAD_DISCARD', id }, source: owner, ports: [] });
  let discarded;
  events.fetch({ request: new Request(scope + '__invox_download__/' + id), respondWith(value) { discarded = value; } });
  assert.equal(discarded.status, 404);
  assert(notes.includes('INVOX_DOWNLOAD_READY'));
  await assert.rejects(window.InvoxMultipartDownloads.start({ ...manifest, sha256: '0'.repeat(64) }, { getPart }), { code: 'download_integrity' });
  await assert.rejects(responseBytes, 'checksum failure errors the native download body instead of completing the Content-Length');
  console.log('PASS multipart native stream: transferable-stream download, original bytes, attachment headers, isolated one-use route and no credentials in worker.');
})().catch(error => { console.error(error); process.exitCode = 1; });
