const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const hashwasm = {};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../site-oficial/shared/vendor/sha256.umd.min.js'), 'utf8'),
  { exports: hashwasm, module: { exports: hashwasm }, Buffer, Uint8Array, ArrayBuffer, DataView, TextEncoder, WebAssembly });
const source = fs.readFileSync(path.resolve(__dirname, '../site-oficial/download-multipart.js'), 'utf8');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(chunks = [Buffer.from('INVOX original\0'), Buffer.from([0, 1, 255, 4, 8])]) {
  return { chunks, manifest: { kind: 'multipart', ticket: 'a'.repeat(64), fileName: 'INVOX-1.1.0.exe',
    size: chunks.reduce((size, chunk) => size + chunk.length, 0), sha256: sha(Buffer.concat(chunks)),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), parts: chunks.map((chunk, index) => ({ index, size: chunk.length, sha256: sha(chunk) })) } };
}
function harness(f, behavior = {}) {
  const writes = [], parts = [], fetches = [], progress = [];
  let closed = false, aborted = false, pickers = 0;
  const writer = new WritableStream({ write(chunk) { writes.push(Buffer.from(chunk)); return behavior.onWrite?.(); }, close() { closed = true; }, abort() { aborted = true; } });
  const window = { document: { baseURI: 'https://invox.test/site/index.html' }, location: { href: 'https://invox.test/site/index.html' },
    navigator: {}, hashwasm, AbortController, setTimeout, clearTimeout, addEventListener() {},
    showSaveFilePicker: async () => { pickers++; if (behavior.pickerError) throw behavior.pickerError; return { createWritable: async () => writer }; },
    fetch: async (url, options) => {
      fetches.push({ url, options });
      if (behavior.networkOnce && fetches.length === 1) throw new TypeError('offline');
      const index = Number(new URL(url).pathname.split('/').pop());
      const data = behavior.bytes?.(index) || f.chunks[index];
      return new Response(new Uint8Array(data), { headers: behavior.omitLength ? {} : { 'Content-Length': String(data.length) } });
    }
  };
  vm.runInNewContext(source, { window, URL, Uint8Array, ArrayBuffer, AbortController });
  const getPart = async (ticket, index) => {
    parts.push({ ticket, index });
    return { ...f.manifest.parts[index], expiresIn: 60,
      url: `${behavior.origin || 'https://wsfdwyghqqaerivyrbil.supabase.co'}/storage/v1/object/sign/invox-installers/${index}?token=fresh-${parts.length}` };
  };
  return { start: extra => window.InvoxMultipartDownloads.start(f.manifest, { getPart, onProgress: value => progress.push(value), ...extra }),
    writes, parts, fetches, progress, window, state: () => ({ closed, aborted, pickers }) };
}
(async () => {
  const f = fixture(), h = harness(f);
  const result = await h.start();
  assert.equal(result.verified, true); assert.equal(result.method, 'file-system');
  assert.deepEqual(Buffer.concat(h.writes), Buffer.concat(f.chunks), 'file bytes and order match the original');
  assert.deepEqual(h.parts.map(part => part.index), [0, 1]); assert(h.parts.every(part => part.ticket === f.manifest.ticket));
  assert(h.fetches.every(call => call.options.cache === 'no-store' && call.options.credentials === 'omit' && call.options.referrerPolicy === 'no-referrer'));
  assert.equal(h.state().closed, true); assert.equal(h.progress.at(-1).stage, 'verified');
  const corrupt = harness(fixture(), { bytes: index => index === 0 ? Buffer.from('X'.repeat(f.chunks[0].length)) : f.chunks[index] });
  await assert.rejects(corrupt.start(), { code: 'download_integrity' });
  assert.equal(corrupt.writes.length, 0); assert.equal(corrupt.state().closed, false); assert.equal(corrupt.state().aborted, true);
  assert(!corrupt.progress.some(value => value.stage === 'verified'));
  const wrongWhole = fixture(); wrongWhole.manifest.sha256 = '0'.repeat(64);
  const checksum = harness(wrongWhole);
  await assert.rejects(checksum.start(), { code: 'download_integrity' });
  assert.deepEqual(Buffer.concat(checksum.writes), wrongWhole.chunks[0], 'the final part is withheld on whole-file mismatch');
  assert.equal(checksum.state().closed, false); assert.equal(checksum.state().aborted, true);
  const oversized = harness(fixture(), { bytes: index => Buffer.concat([f.chunks[index], Buffer.from([3])]), omitLength: true });
  await assert.rejects(oversized.start(), { code: 'download_integrity' }); assert.equal(oversized.writes.length, 0);
  const untrusted = harness(fixture(), { origin: 'https://untrusted.test' });
  await assert.rejects(untrusted.start(), { code: 'download_integrity' }); assert.equal(untrusted.fetches.length, 0);
  const network = harness(fixture(), { networkOnce: true });
  await network.start(); assert.deepEqual(network.parts.map(part => part.index), [0, 0, 1], 'retry requests a fresh signed URL only for the failed part');
  assert.deepEqual(Buffer.concat(network.writes), Buffer.concat(f.chunks));
  const controller = new AbortController(), cancellation = harness(fixture());
  await assert.rejects(cancellation.start({ signal: controller.signal, onProgress: () => controller.abort() }), { code: 'download_cancelled' });
  assert.equal(cancellation.state().aborted, true); assert.equal(cancellation.state().closed, false);
  let releaseWrite;
  const pressureController = new AbortController();
  const stalled = harness(fixture(), { onWrite() {
    pressureController.abort();
    return new Promise(resolve => { releaseWrite = resolve; });
  } });
  let cancelTimer;
  await Promise.race([
    assert.rejects(stalled.start({ signal: pressureController.signal }), { code: 'download_cancelled' }),
    new Promise((resolve, reject) => { cancelTimer = setTimeout(() => reject(new Error('cancel waited on a stalled writer')), 200); })
  ]).finally(() => clearTimeout(cancelTimer));
  assert.equal(stalled.parts.length, 1, 'cancellation with backpressure does not request the next part');
  assert.equal(stalled.state().closed, false); releaseWrite();
  const malformed = fixture(); malformed.manifest.parts[1].index = 2;
  const invalid = harness(malformed); await assert.rejects(invalid.start(), { code: 'download_invalid' });
  assert.equal(invalid.state().pickers, 0); assert.equal(invalid.parts.length, 0);
  const denied = harness(fixture(), { pickerError: Object.assign(new Error(), { name: 'SecurityError' }) });
  await assert.rejects(denied.start(), { code: 'save_location_required' }); assert.equal(denied.parts.length, 0);
  const large = { kind: 'multipart', ticket: 'a'.repeat(64), fileName: 'INVOX.exe', size: 1610612736, sha256: 'b'.repeat(64),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), parts: [] };
  let left = large.size;
  while (left) { const size = Math.min(left, 20 * 1024 * 1024); large.parts.push({ index: large.parts.length, size, sha256: 'b'.repeat(64) }); left -= size; }
  const unsupported = harness({ manifest: large, chunks: [] }); delete unsupported.window.showSaveFilePicker;
  await assert.rejects(unsupported.start(), { code: 'download_unsupported' });
  assert.equal(unsupported.parts.length, 0, 'unsupported browsers never fetch a 1.5GB file or allocate a whole-file Blob');
  console.log('PASS multipart file saving: original bytes/order, bounded part reader, checksums before final bytes, cancellation and no-store JIT requests.');
})().catch(error => { console.error(error); process.exitCode = 1; });
