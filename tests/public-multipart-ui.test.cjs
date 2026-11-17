const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../site-oficial/script.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Node {
  constructor() { this.dataset = {}; this.attrs = {}; this.events = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.open = false; this.disabled = false; this.isConnected = true; }
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; } getAttribute(k) { return this.attrs[k]; }
  addEventListener(k, fn) { (this.events[k] ||= []).push(fn); }
  async emit(k) { for (const fn of this.events[k] || []) await fn({ type: k, preventDefault() {} }); }
  querySelector() { return null; } querySelectorAll() { return []; } reportValidity() { return true; }
  focus() {} getClientRects() { return [1]; } getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 100 }; }
  showModal() { this.open = true; } close() { this.open = false; return this.emit('close'); } click() {} remove() {}
}
function harness() {
  const ids = Object.fromEntries(['download-status', 'download-retry', 'download-cancel', 'download-lock', 'download-password-dialog', 'download-password-form', 'download-password', 'download-password-status', 'download-password-submit', 'download-password-description', 'notice-dialog', 'notice-title', 'notice-copy'].map(id => [id, new Node()]));
  const links = ['windows', 'macos', 'android'].map(platform => { const link = new Node(); link.dataset.download = platform; return link; });
  const calls = [], helperCalls = [], windowEvents = {};
  let grant = false, mode = 'success', assertStarting = () => {};
  const state = { visibility: 'public', version: '1.1.0', platforms: [{ platform: 'windows', available: true }] };
  const result = { kind: 'multipart', ticket: 'a'.repeat(64), fileName: 'INVOX.exe', size: 10, accessMethod: 'universal', parts: [{ index: 0, size: 10, sha256: 'b'.repeat(64) }] };
  const api = { publicState: async () => state, hasDownloadSession: () => grant,
    download: async (platform, password = '', options = {}) => { calls.push(['download', platform, password]); if (password || options.accessCode) grant = true; return result; },
    downloadPart: async (ticket, index) => { calls.push(['part', ticket, index]); return {}; }, lockDownloads: async () => { grant = false; } };
  const multipart = { async start(manifest, options) {
    helperCalls.push({ manifest, options }); assertStarting();
    if (mode === 'integrity') throw { code: 'download_integrity' };
    if (mode === 'save' && !options.preferFileSystem) throw { code: 'save_location_required' };
    if (mode === 'wait') return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
      options.onProgress({ receivedBytes: 10, totalBytes: 10, stage: 'verified' }); reject({ code: 'download_cancelled' });
    }, { once: true }));
    await options.getPart(manifest.ticket, 0);
    options.onProgress({ receivedBytes: 5, totalBytes: 10, stage: 'receiving' });
    options.onProgress({ receivedBytes: 10, totalBytes: 10, stage: 'verified' });
    return { verified: true };
  } };
  const document = { visibilityState: 'visible', activeElement: null, body: { append() {} },
    getElementById: id => ids[id], querySelector: () => null,
    querySelectorAll: key => key === '[data-download]' ? links : key === 'dialog' ? [ids['download-password-dialog'], ids['notice-dialog']] : [],
    createElement: () => new Node(), addEventListener() {} };
  const window = { InvoxBackend: api, InvoxMultipartDownloads: multipart, addEventListener: (key, fn) => (windowEvents[key] ||= []).push(fn) };
  vm.runInNewContext(source, { window, document, HTMLDialogElement: Node, HTMLElement: Node, Element: Node, URL, AbortController, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto });
  return { ids, links, calls, helperCalls, state, setMode: value => mode = value, assertStarting: fn => assertStarting = fn,
    focus: async () => { for (const fn of windowEvents.focus || []) await fn({}); } };
}
(async () => {
  const success = harness(); await tick(); await success.links[0].emit('click');
  assert.equal(success.calls.filter(call => call[0] === 'download').length, 1);
  assert.equal(success.calls.filter(call => call[0] === 'part').length, 1);
  assert.match(success.ids['download-status'].textContent, /Arquivo verificado/);
  assert.equal(success.ids['download-cancel'].hidden, true); assert.equal(success.links[0].attrs['aria-disabled'], 'false');
  const cancel = harness(); await tick(); cancel.setMode('wait');
  const running = cancel.links[0].emit('click'); await tick();
  assert.equal(cancel.ids['download-cancel'].hidden, false); assert.equal(cancel.links[0].attrs['aria-busy'], 'true');
  assert.equal(cancel.links[0].attrs['aria-disabled'], 'true');
  await cancel.ids['download-cancel'].emit('click'); await running;
  assert.match(cancel.ids['download-status'].textContent, /Download cancelado/);
  assert.equal(cancel.ids['download-cancel'].hidden, true); assert.equal(cancel.links[0].attrs['aria-disabled'], 'false');
  const integrity = harness(); await tick(); integrity.setMode('integrity'); await integrity.links[0].emit('click');
  assert.match(integrity.ids['download-status'].textContent, /verificação.*falhou/);
  assert(!integrity.ids['download-status'].textContent.includes('Arquivo verificado'));
  assert.equal(integrity.ids['download-retry'].hidden, false);
  const save = harness(); await tick(); save.setMode('save'); await save.links[0].emit('click');
  assert.equal(save.ids['download-retry'].textContent, 'Escolher onde salvar');
  await save.focus(); assert.equal(save.helperCalls.length, 1, 'focus cannot reopen a file picker without a user gesture');
  await save.ids['download-retry'].emit('click');
  assert.equal(save.helperCalls.length, 2); assert.equal(save.helperCalls[1].options.preferFileSystem, true);
  assert.equal(save.calls.filter(call => call[0] === 'download').length, 1, 'FSA retry reuses the in-memory ticket instead of counting/authorizing twice');
  assert.match(save.ids['download-status'].textContent, /Arquivo verificado/);
  const password = harness(); await tick(); password.state.visibility = 'private'; await password.links[0].emit('click');
  assert.equal(password.ids['download-password-dialog'].open, true);
  password.assertStarting(() => {
    assert.equal(password.ids['download-password-dialog'].open, false, 'authorization dialog closes before transferring the file');
    assert.equal(password.ids['download-password'].value, '');
  });
  password.ids['download-password'].value = 'fixture-password'; await password.ids['download-password-form'].emit('submit');
  assert.equal(password.ids['download-lock'].hidden, false); assert.match(password.ids['download-status'].textContent, /Arquivo verificado/);
  console.log('PASS multipart public UI: progress/cancel, integrity errors, FSA gesture retry without duplicate authorization, password clearing and legacy controls.');
})().catch(error => { console.error(error); process.exitCode = 1; });
