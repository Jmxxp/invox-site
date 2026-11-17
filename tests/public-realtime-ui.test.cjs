const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../site-oficial/script.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class Element {
  constructor() { this.dataset = {}; this.attrs = {}; this.events = {}; this.textContent = ''; this.value = ''; this.hidden = false; this.open = false; this.disabled = false; this.isConnected = true; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  async emit(name) { for (const callback of this.events[name] || []) await callback({ preventDefault() {}, type: name }); }
  setAttribute(name, value) { this.attrs[name] = value; } removeAttribute(name) { delete this.attrs[name]; } getAttribute(name) { return this.attrs[name]; }
  querySelector() { return null; } querySelectorAll() { return []; } reportValidity() { return true; }
  showModal() { this.open = true; } close() { this.open = false; return this.emit('close'); }
  focus() {} getClientRects() { return [1]; } getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 100 }; }
  click() {} remove() {}
}
function harness() {
  const ids = Object.fromEntries(['download-status', 'download-retry', 'download-cancel', 'download-lock', 'download-password-dialog', 'download-password-form', 'download-password', 'download-password-status', 'download-password-submit', 'download-password-description', 'notice-dialog', 'notice-title', 'notice-copy'].map(id => [id, new Element()]));
  const links = ['windows', 'macos', 'android'].map(platform => { const link = new Element(); link.dataset.download = platform; return link; });
  const versions = links.map(link => { const element = new Element(); element.dataset.platformVersion = link.dataset.download; return element; });
  const state = { visibility: 'public', version: '1.1.0', platforms: [{ platform: 'windows', available: true, version: '1.1.0' }] };
  const events = {}, windowEvents = {}, subscriptions = [], requests = [], stateQueue = [], timers = new Map();
  let nextTimer = 0, stopped = 0, helperMode = 'success', helperGate = null, now = 1000;
  const api = {
    publicState: async () => { requests.push('state'); return stateQueue.length ? stateQueue.shift() : structuredClone(state); },
    subscribeChanges: callbacks => { subscriptions.push(callbacks); return () => { stopped++; }; },
    hasDownloadSession: () => false,
    download: async () => ({ kind: 'multipart', ticket: 'a'.repeat(64), size: 1, fileName: 'INVOX.exe', parts: [] }),
    downloadPart: async () => ({}), lockDownloads: async () => {}
  };
  const multipart = { async start(value, options) {
    if (helperMode === 'save' && !options.preferFileSystem) throw { code: 'save_location_required' };
    options.onProgress({ receivedBytes: 4, totalBytes: 10, stage: 'receiving' });
    if (helperGate) await helperGate.promise;
    return { verified: true };
  } };
  const document = { visibilityState: 'visible', activeElement: null, body: { append() {} },
    getElementById: id => ids[id], querySelector: () => null,
    querySelectorAll: selector => selector === '[data-download]' ? links : selector === '[data-platform-version]' ? versions : selector === 'dialog' ? [ids['download-password-dialog'], ids['notice-dialog']] : [],
    createElement: () => new Element(), addEventListener: (name, callback) => (events[name] ||= []).push(callback)
  };
  const window = { InvoxBackend: api, InvoxMultipartDownloads: multipart, addEventListener: (name, callback) => (windowEvents[name] ||= []).push(callback) };
  vm.runInNewContext(source, { window, document, URL, HTMLDialogElement: Element, HTMLElement: Element, Element, AbortController,
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; }, clearTimeout: id => timers.delete(id)
  });
  return { ids, links, versions, state, requests, stateQueue, subscriptions, timers, document,
    stopped: () => stopped, gate: value => { helperGate = value; }, mode: value => { helperMode = value; },
    async runTimers() { const batch = [...timers.values()]; timers.clear(); now += Math.max(0, ...batch.map(item => item.delay)); batch.forEach(item => item.callback()); await tick(); },
    change(scope) { subscriptions.at(-1).onChange({ scope }); },
    status(value) { subscriptions.at(-1).onStatus(value); },
    async windowEvent(name) { for (const callback of windowEvents[name] || []) await callback({}); },
    async visibility(value) { document.visibilityState = value; for (const callback of events.visibilitychange || []) await callback({}); }
  };
}
(async () => {
  const h = harness(); await tick(); assert.equal(h.subscriptions.length, 1); assert.equal(h.subscriptions[0].audience, 'public');
  h.change('feedback'); assert.equal(h.timers.size, 0, 'private/unrecognized invalidations are ignored');
  h.state.version = '1.2.0'; h.state.platforms = [{ platform: 'macos', available: true, version: '1.2.0' }];
  h.change('settings'); h.change('installers'); h.change('all'); assert.equal(h.timers.size, 1); await h.runTimers();
  assert.equal(h.requests.length, 2, 'burst events share one API refresh'); assert.equal(h.links[0].attrs['aria-disabled'], 'true'); assert.equal(h.links[1].attrs['aria-disabled'], 'false');
  assert.equal(h.versions[1].textContent, 'Versão 1.2.0');
  const inFlight = deferred(); h.stateQueue.push(inFlight.promise); h.change('installers'); assert([...h.timers.values()].every(item => item.delay >= 2000), 'event storms respect a two-second cooldown'); await h.runTimers();
  h.state.version = '1.2.1'; h.change('settings'); assert.equal(h.timers.size, 0, 'a request in flight holds the dirty flag');
  inFlight.resolve({ visibility: 'public', version: '1.2.0', platforms: [] }); await tick(); assert.equal(h.timers.size, 1); await h.runTimers();
  assert.match(h.versions[1].textContent, /1.2.0/); assert.match(h.ids['download-status'].textContent, /1.2.1/);
  h.status('SUBSCRIBED'); await h.runTimers(); const afterReconnect = h.requests.length;
  await h.windowEvent('online'); assert.equal(h.requests.length, afterReconnect + 1, 'online catches missed events');
  await h.visibility('hidden'); const hiddenRequests = h.requests.length; h.change('installers'); assert.equal(h.timers.size, 0);
  await h.visibility('visible'); assert.equal(h.requests.length, hiddenRequests + 1, 'visibility catches up without dropping invalidations');
  await h.windowEvent('pagehide'); assert.equal(h.stopped(), 1); const old = h.subscriptions[0]; old.onChange({ scope: 'all' }); assert.equal(h.timers.size, 0);
  await h.windowEvent('pageshow'); assert.equal(h.subscriptions.length, 2); assert.equal(h.stopped(), 1); await h.windowEvent('focus'); assert.equal(h.subscriptions.length, 2, 'focus cannot duplicate a subscription');

  const password = harness(); await tick(); password.state.visibility = 'private'; await password.links[0].emit('click');
  password.ids['download-password'].value = 'unfinished secret'; password.ids['download-password-status'].textContent = 'feedback da senha';
  const passwordRequests = password.requests.length; password.change('settings'); await password.runTimers(); await password.windowEvent('focus');
  assert.equal(password.requests.length, passwordRequests, 'password entry defers background refresh'); assert.equal(password.ids['download-password'].value, 'unfinished secret'); assert.equal(password.ids['download-password-status'].textContent, 'feedback da senha');
  await password.ids['download-password-dialog'].close(); await password.runTimers(); assert.equal(password.requests.length, passwordRequests + 1);

  const active = harness(); await tick(); const transfer = deferred(); active.gate(transfer); const downloading = active.links[0].emit('click'); await tick();
  const progress = active.ids['download-status'].textContent; const activeRequests = active.requests.length; active.state.version = '1.3.0'; active.change('installers'); await active.runTimers(); await active.windowEvent('online');
  assert.equal(active.requests.length, activeRequests); assert.equal(active.ids['download-status'].textContent, progress, 'realtime cannot overwrite transfer progress');
  transfer.resolve(); await downloading; const completed = active.ids['download-status'].textContent; await active.runTimers();
  assert.equal(active.requests.length, activeRequests + 1); assert.equal(active.ids['download-status'].textContent, completed, 'a queued refresh preserves the verified-file message');

  const raced = harness(); await tick(); const stale = deferred(); raced.stateQueue.push(stale.promise); raced.change('installers'); await raced.runTimers();
  const downloadingGate = deferred(); raced.gate(downloadingGate); const racedDownload = raced.links[0].emit('click'); await tick(); const racedProgress = raced.ids['download-status'].textContent;
  stale.resolve({ visibility: 'private', version: '0.0.1', platforms: [] }); await tick(); assert.equal(raced.ids['download-status'].textContent, racedProgress); assert(!raced.versions[0].textContent.includes('0.0.1'));
  downloadingGate.resolve(); await racedDownload; await raced.runTimers(); assert.equal(raced.links[0].attrs['aria-disabled'], 'false', 'a late background response cannot disable the new current installer');

  const save = harness(); await tick(); save.mode('save'); await save.links[0].emit('click'); const saveRequests = save.requests.length;
  save.change('settings'); await save.runTimers(); await save.windowEvent('focus'); assert.equal(save.requests.length, saveRequests); assert.equal(save.ids['download-retry'].textContent, 'Escolher onde salvar');
  await save.ids['download-retry'].emit('click'); await save.runTimers(); assert.equal(save.requests.length, saveRequests + 1);
  console.log('PASS public realtime: coalesced invalidations, in-flight dirty queue, reconnect/lifecycle/focus catch-up, stale-response protection, password/transfer/FSA preservation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
