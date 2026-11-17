const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('site-oficial/script.js', 'utf8');
const tick = () => new Promise(setImmediate);
class Element {
  constructor() { this.dataset = {}; this.events = {}; this.attrs = {}; this.value = ''; this.textContent = ''; this.disabled = false; this.open = false; this.hidden = false; this.isConnected = true; }
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; } getAttribute(k) { return this.attrs[k]; }
  addEventListener(k, fn) { (this.events[k] ||= []).push(fn); }
  async emit(k) { for (const fn of this.events[k] || []) await fn({ preventDefault() {}, type: k }); }
  querySelector() { return null; } querySelectorAll() { return []; } reportValidity() { return true; }
  showModal() { this.open = true; } close() { this.open = false; return this.emit('close'); }
  focus() {} getClientRects() { return [1]; } getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 100 }; }
  click() {} remove() {}
}
function harness({ universal = false, grant = false } = {}) {
  const ids = Object.fromEntries(['download-status', 'download-retry', 'download-cancel', 'download-lock', 'download-password-dialog', 'download-password-form', 'download-password', 'download-password-status', 'download-password-submit', 'download-password-description', 'download-access-label', 'download-code-cancel', 'notice-dialog', 'notice-title', 'notice-copy'].map(id => [id, new Element()]));
  const links = ['windows', 'macos', 'android'].map(platform => { const n = new Element(); n.dataset.download = platform; return n; });
  const state = { visibility: 'private', universalEnabled: universal, version: '1.1.0', platforms: [{ platform: 'windows', available: true }] };
  const calls = [], queue = [], files = [], helperCalls = [], events = {};
  let mode = 'success';
  const direct = { url: 'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/sign/invox-installers/fixture.exe?token=fixture', fileName: 'INVOX.exe' };
  const multipart = { kind: 'multipart', ticket: 'a'.repeat(64), fileName: 'INVOX.exe', size: 10, parts: [], accessMethod: 'code' };
  const api = {
    publicState: async () => structuredClone(state), hasDownloadSession: () => grant,
    async download(platform, password = '', options) {
      calls.push({ platform, password, options: options ? { ...options } : null });
      const response = queue.length ? await queue.shift() : direct;
      if (response?.error) throw response.error;
      const method = response?.accessMethod || (options?.accessCode === 'universal-fixture' ? 'universal' : 'code');
      if (method === 'universal') grant = true;
      return response === direct ? { ...response, accessMethod: method } : response;
    },
    downloadPart: async () => ({}), lockDownloads: async () => { grant = false; }
  };
  const helper = { async start(manifest, options) {
    helperCalls.push({ manifest, options });
    if (mode === 'network') throw { code: 'download_network' };
    if (mode === 'expired') throw { code: 'download_expired', status: 401 };
    if (mode === 'save' && !options.preferFileSystem) throw { code: 'save_location_required' };
    if (mode === 'wait') return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject({ code: 'download_cancelled' }), { once: true }));
    return { verified: true };
  } };
  const document = { activeElement: null, visibilityState: 'visible', body: { append: file => files.push(file) },
    getElementById: id => ids[id], querySelector: () => null,
    querySelectorAll: key => key === '[data-download]' ? links : key === 'dialog' ? [ids['notice-dialog'], ids['download-password-dialog']] : [],
    createElement: () => new Element(), addEventListener() {} };
  const window = { InvoxBackend: api, InvoxMultipartDownloads: helper, addEventListener: (key, fn) => (events[key] ||= []).push(fn) };
  vm.runInNewContext(source, { window, document, HTMLDialogElement: Element, HTMLElement: Element, Element, URL, AbortController, crypto: webcrypto, setTimeout, clearTimeout });
  return { ids, links, state, calls, queue, files, helperCalls, multipart, mode: value => mode = value, grant: () => grant,
    async enter(code = 'fixture-code') { ids['download-password'].value = code; return ids['download-password-form'].emit('submit'); } };
}
(async () => {
  const h = harness({ grant: true }); await tick(); await h.links[0].emit('click');
  assert.equal(h.calls.length, 0, 'disabled universal ignores an old persistent grant');
  assert.equal(h.ids['download-password'].type, 'password'); assert.equal(h.ids['download-password'].placeholder, 'Digite seu código de acesso');
  assert.equal(h.ids['download-lock'].hidden, true);
  await h.enter(); assert.equal(h.calls[0].password, ''); assert.equal(h.calls[0].options.accessCode, 'fixture-code');
  assert.match(h.calls[0].options.requestId, /^[a-f0-9-]{36}$/); assert.equal(h.ids['download-password'].value, '');
  assert.equal(h.ids['download-password-dialog'].open, false);
  await h.links[0].emit('click'); assert.equal(h.ids['download-password-dialog'].open, true);
  await h.enter(); assert.notEqual(h.calls[1].options.requestId, h.calls[0].options.requestId, 'each new explicit download gets a new attempt');
  const lost = harness(); await tick(); await lost.links[0].emit('click');
  lost.queue.push({ error: { code: 'offline', status: 0 } }); await lost.enter('recover-fixture');
  assert.equal(lost.ids['download-password-dialog'].open, true); assert.equal(lost.ids['download-password'].value, '');
  assert.equal(lost.ids['download-password'].disabled, true); assert.equal(lost.ids['download-code-cancel'].hidden, false);
  assert.equal(lost.ids['download-password-submit'].textContent, 'RECUPERAR DOWNLOAD');
  await lost.enter('ignored-new-value');
  assert.deepEqual(lost.calls[0].options, lost.calls[1].options, 'lost response retries exactly the same code and UUID');
  assert.equal(lost.grant(), false, 'code success never creates a permanent UI unlock');
  const cancelled = harness(); await tick(); await cancelled.links[0].emit('click');
  cancelled.queue.push({ error: { code: 'offline', status: 503 } }); await cancelled.enter('cancel-fixture');
  await cancelled.ids['download-code-cancel'].emit('click');
  await cancelled.links[0].emit('click'); await cancelled.enter('fresh-fixture');
  assert.notEqual(cancelled.calls[0].options.requestId, cancelled.calls[1].options.requestId);
  assert.equal(cancelled.calls[1].options.accessCode, 'fresh-fixture');
  const late = harness(); let finishLate; await tick(); await late.links[0].emit('click');
  late.queue.push(new Promise(resolve => { finishLate = resolve; })); const pendingLate = late.enter('late-fixture'); await tick();
  await late.ids['download-password-dialog'].close(); finishLate({ error: { code: 'offline', status: 0 } }); await pendingLate;
  await late.links[0].emit('click'); await late.enter('next-fixture');
  assert.notEqual(late.calls[0].options.requestId, late.calls[1].options.requestId, 'a cancelled late response cannot restore the old attempt');
  assert.equal(late.calls[1].options.accessCode, 'next-fixture');
  for (const [code, status] of [['invalid_code', 403], ['code_exhausted', 403], ['code_revoked', 403], ['code_expired', 403], ['download_expired', 401], ['download_changed', 409]]) {
    const terminal = harness(); await tick(); await terminal.links[0].emit('click');
    terminal.queue.push({ error: { code, status } }); await terminal.enter();
    assert.equal(terminal.ids['download-password-dialog'].open, true, code);
    assert.equal(terminal.ids['download-password'].disabled, false, code);
    assert.equal(terminal.ids['download-code-cancel'].hidden, true, code);
    assert(terminal.ids['download-password-status'].textContent.length > 10, code);
    assert.equal(terminal.grant(), false, code);
  }
  const normal = harness({ universal: true }); await tick(); await normal.links[0].emit('click');
  assert.equal(normal.ids['download-password'].type, 'password');
  await normal.enter('universal-fixture'); assert.equal(normal.calls[0].options.accessCode, 'universal-fixture'); assert.equal(normal.calls[0].password, ''); assert.equal(normal.grant(), true);
  const universalRecovery = harness({ universal: true }); await tick(); await universalRecovery.links[0].emit('click');
  universalRecovery.queue.push({ error: { code: 'offline', status: 0 } }); await universalRecovery.enter('universal-fixture'); await universalRecovery.enter();
  assert.deepEqual(universalRecovery.calls[0].options, universalRecovery.calls[1].options, 'universal credentials keep the same recovery UUID too');
  assert.equal(universalRecovery.grant(), true);
  const looksLikeToken = harness({ universal: true }); await tick(); await looksLikeToken.links[0].emit('click');
  looksLikeToken.queue.push({ url: 'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/sign/invox-installers/fixture.exe?token=fixture', accessMethod: 'universal' });
  await looksLikeToken.enter('INVOX-FIXTURE-UNIVERSAL'); assert.equal(looksLikeToken.grant(), true, 'only the server result determines the access method');
  assert.equal(looksLikeToken.calls[0].options.accessCode, 'INVOX-FIXTURE-UNIVERSAL');
  const shortToken = harness({ universal: true }); await tick(); await shortToken.links[0].emit('click');
  shortToken.queue.push({ error: { code: 'offline', status: 0 } }); await shortToken.enter('AB3D7K');
  assert.equal(shortToken.calls[0].options.accessCode, 'AB3D7K', 'a six-character code is forwarded exactly');
  assert.match(shortToken.calls[0].options.requestId, /^[a-f0-9-]{36}$/);
  await shortToken.enter();
  assert.deepEqual(shortToken.calls[0].options, shortToken.calls[1].options, 'six-character recovery preserves both code and request UUID');
  assert.equal(shortToken.grant(), false, 'six characters do not imply universal access');
  const shortUniversal = harness({ universal: true }); await tick(); await shortUniversal.links[0].emit('click');
  shortUniversal.queue.push({ url: 'https://wsfdwyghqqaerivyrbil.supabase.co/storage/v1/object/sign/invox-installers/fixture.exe?token=fixture', accessMethod: 'universal' });
  await shortUniversal.enter('AB3D7K');
  assert.equal(shortUniversal.calls[0].options.accessCode, 'AB3D7K');
  assert.equal(shortUniversal.grant(), true, 'the same length can be universal only when selected by the server');
  const raw = harness({ universal: true }); await tick(); await raw.links[0].emit('click'); await raw.enter(' credential with spaces ');
  assert.equal(raw.calls[0].options.accessCode, ' credential with spaces ', 'the UI does not normalize a potentially exact universal credential');
  const choose = harness({ universal: true }); await tick(); await choose.links[0].emit('click');
  await choose.enter();
  assert.equal(choose.calls[0].password, ''); assert.equal(choose.calls[0].options.accessCode, 'fixture-code'); assert.equal(choose.grant(), false);
  for (const mode of ['network', 'save']) {
    const retry = harness(); await tick(); await retry.links[0].emit('click'); retry.queue.push(retry.multipart); retry.mode(mode); await retry.enter();
    assert.equal(retry.ids['download-password-dialog'].open, false); assert.equal(retry.calls.length, 1);
    assert.equal(retry.ids['download-retry'].hidden, false); retry.mode('success'); await retry.ids['download-retry'].emit('click');
    assert.equal(retry.calls.length, 1, 'authorized multipart/FSA retry never redeems the code again');
    assert.equal(retry.helperCalls.length, 2); assert.equal(retry.helperCalls[0].manifest, retry.helperCalls[1].manifest);
    assert.equal(retry.ids['download-cancel'].hidden, true); assert.equal(retry.grant(), false);
  }
  const active = harness(); await tick(); await active.links[0].emit('click'); active.queue.push(active.multipart); active.mode('wait');
  const activeTransfer = active.enter(); await tick(); await active.ids['download-cancel'].emit('click'); await activeTransfer;
  assert.equal(active.ids['download-cancel'].hidden, true); await active.ids['download-retry'].emit('click');
  assert.equal(active.calls.length, 1); assert.equal(active.helperCalls.length, 1, 'cancel clears the authorized retry ticket');
  const deniedUniversal = harness({ universal: true }); await tick(); await deniedUniversal.links[0].emit('click');
  deniedUniversal.queue.push({ error: { code: 'universal_disabled', status: 401 } }); await deniedUniversal.enter('old-key');
  assert.equal(deniedUniversal.ids['download-password'].type, 'password'); assert.match(deniedUniversal.ids['download-password-status'].textContent, /código de acesso/);
  const html = fs.readFileSync('site-oficial/index.html', 'utf8');
  assert.match(html, /CÓDIGO DE ACESSO:/); assert.match(html, /placeholder="Digite seu código de acesso"/);
  assert(!/download-access-choices|download-access-universal|download-access-code|Chave universal/.test(html), 'only one access field is presented');
  assert(!/localStorage|sessionStorage/.test(source), 'access codes are not persisted by the UI');
  console.log('PASS unified public access: single field, server-selected method, per-attempt UUID for both credential types, lost-response recovery, cancellation and ticket-only multipart/FSA retries.');
})().catch(error => { console.error(error); process.exitCode = 1; });
