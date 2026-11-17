const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'painel-admin/index.html'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  let now = 100000, sequence = 0;
  const timers = new Map();
  return {
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay = 0) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
      }
      now = target; await flush();
    }
  };
}
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.events = {}; this.attrs = {}; this.style = {}; this.dataset = {};
    this.hidden = false; this.disabled = false; this.textContent = ''; this.value = ''; this.clientWidth = 620; this.clientHeight = 265;
    this.classes = new Set(); this.classList = {
      add: key => this.classes.add(key), remove: key => this.classes.delete(key), contains: key => this.classes.has(key),
      toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key)
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  emit(name, event = {}) { return Promise.all((this.events[name] || []).map(callback => callback({ preventDefault() {}, ...event }))); }
  querySelectorAll() { return this.children; }
  focus() {}
  reportValidity() { return true; }
}
function dom() {
  const nodes = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const events = {}, windowEvents = {}, dispatched = [];
  const document = {
    hidden: false, body: new Element(), getElementById: id => nodes[id], querySelector: selector => nodes[selector.slice(1)],
    createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag),
    addEventListener: (name, callback) => (events[name] ||= []).push(callback),
    dispatchEvent(event) { dispatched.push(event); (events[event.type] || []).forEach(callback => callback(event)); }
  };
  const fire = (name, detail, extra = {}) => document.dispatchEvent({ type: name, detail, ...extra });
  return { nodes, document, fire, dispatched, windowEvents, fireWindow: name => (windowEvents[name] || []).forEach(callback => callback()) };
}
const state = (version = '1.1.0', username = 'fixture') => ({ admin: { username, email: username + '@example.test' }, settings: { version }, feedbacks: [], installers: [] });
async function shellTest() {
  const d = dom(), c = clock(), requests = [], subscriptions = [];
  const nav = ['analytics', 'feedback', 'access', 'downloads'].map(panel => { const item = new Element('button'); item.dataset.panel = panel; return item; });
  d.document.querySelectorAll = selector => selector === '.admin-panel' ? nav.map(item => d.nodes['panel-' + item.dataset.panel]) : nav;
  d.nodes['admin-sidebar'].querySelector = () => nav.find(item => item.classes.has('is-active'));
  d.nodes['admin-shell'].hidden = true;
  let authChange, session = null;
  const api = {
    auth: { getSession: async () => ({ data: { session } }), onAuthStateChange: callback => { authChange = callback; }, signOut: async () => ({ error: null }) },
    signIn: async () => { session = { access_token: 'fixture', user: { id: 'first-admin' } }; },
    adminState: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    subscribeChanges(options) { const subscription = { options, stopped: 0 }; subscriptions.push(subscription); return () => { subscription.stopped++; }; }
  };
  const window = { InvoxBackend: api, innerWidth: 1200, addEventListener: (name, callback) => (d.windowEvents[name] ||= []).push(callback) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'painel-admin/admin.js'), 'utf8'), {
    document: d.document, window, location: { hash: '', protocol: 'https:' }, ...c,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  });
  await flush(); assert.equal(subscriptions.length, 0, 'no private channel before server authorization');
  d.nodes['login-password'].value = 'test-only'; await d.nodes['login-form'].emit('submit'); await flush();
  assert.equal(requests.length, 1); assert.equal(subscriptions.length, 0);
  requests[0].resolve(state()); await flush(); assert.equal(subscriptions.length, 1);
  const first = subscriptions[0]; assert.equal(first.options.audience, 'admin');
  authChange('TOKEN_REFRESHED', session); await c.advance(0); requests[1].resolve(state()); await flush();
  assert.equal(subscriptions.length, 1, 'token refresh does not duplicate channels');
  for (let i = 0; i < 30; i++) first.options.onChange({ scope: 'analytics' });
  await c.advance(299); assert.equal(requests.length, 2); await c.advance(1);
  assert.equal(requests.length, 2, 'analytics events do not reload feedback/settings');
  assert.equal(d.dispatched.filter(event => event.type === 'invox:admin-realtime').length, 1, 'event burst is grouped');
  first.options.onChange({ scope: 'feedback' }); first.options.onChange({ scope: 'settings' });
  await c.advance(300); assert.equal(requests.length, 3);
  first.options.onChange({ scope: 'installers' }); await c.advance(300); assert.equal(requests.length, 3, 'one state request at a time');
  requests[2].resolve(state('1.1.1')); await flush(); await c.advance(300); assert.equal(requests.length, 4, 'change during fetch gets a follow-up read');
  requests[3].resolve(state('1.1.2')); await flush();
  assert.equal(d.nodes['summary-version'].textContent, '1.1.2');
  assert.equal(d.dispatched.filter(event => event.type === 'invox:admin-state').at(-1).refreshAnalytics, false);
  first.options.onStatus('SUBSCRIBED'); first.options.onStatus('SUBSCRIBED'); await c.advance(300);
  assert.equal(requests.length, 5, 'reconnect catches up once'); requests[4].resolve(state()); await flush();
  d.document.hidden = true; first.options.onChange({ scope: 'feedback' }); await c.advance(1000); assert.equal(requests.length, 5);
  d.document.hidden = false; d.fire('visibilitychange'); await c.advance(300); assert.equal(requests.length, 6); requests[5].resolve(state()); await flush();
  d.fireWindow('pagehide'); assert.equal(first.stopped, 1); first.options.onChange({ scope: 'feedback' }); await c.advance(1000); assert.equal(requests.length, 6);
  d.fireWindow('pageshow'); assert.equal(subscriptions.length, 2); await c.advance(300); requests[6].resolve(state()); await flush();
  d.fireWindow('online'); await c.advance(300); assert.equal(requests.length, 8);
  await d.nodes['admin-signout'].emit('click'); assert.equal(subscriptions[1].stopped, 1);
  d.nodes['login-password'].value = 'test-only'; await d.nodes['login-form'].emit('submit'); await flush(); assert.equal(requests.length, 9);
  requests[7].resolve(state('9.9.9', 'stale')); await flush(); assert.equal(d.nodes['refresh-admin'].disabled, true, 'old completion cannot unlock a new session');
  requests[8].resolve(state('1.1.3')); await flush(); assert.equal(d.nodes['summary-version'].textContent, '1.1.3'); assert.equal(subscriptions.length, 3);
  first.options.onStatus('SUBSCRIBED'); first.options.onChange({ scope: 'feedback' }); await c.advance(500); assert.equal(requests.length, 9, 'late old channel events are ignored');
  session = { access_token: 'other', user: { id: 'second-admin' } }; authChange('SIGNED_IN', session); await c.advance(0);
  assert.equal(subscriptions[2].stopped, 1, 'switching identity closes the previous channel');
  requests[9].resolve(state('1.2.0', 'second')); await flush(); assert.equal(subscriptions.length, 4);
  d.fireWindow('focus'); await c.advance(300); assert.equal(requests.length, 11); requests[10].reject(Object.assign(new Error('offline'), { code: 'offline' })); await flush();
  assert.equal(d.nodes['admin-shell'].hidden, false, 'transient reconnect errors preserve the authenticated UI'); assert.equal(subscriptions[3].stopped, 0);
  d.fireWindow('focus'); await c.advance(300); assert.equal(requests.length, 12); requests[11].reject(Object.assign(new Error('forbidden'), { code: 'forbidden' })); await flush();
  assert.equal(d.nodes['admin-shell'].hidden, true); assert.equal(window.AdminUI.lastState, null); assert.equal(subscriptions[3].stopped, 1, 'server revocation closes the channel and clears private data');
  await c.advance(1000); assert.equal(requests.length, 12);
}
function report(period, views = 1) {
  return {
    period, generation: 1, timezone: 'America/Sao_Paulo', startedAt: '2026-11-17T10:00:00Z',
    range: { start: '2026-11-16T03:00:00Z', end: '2026-11-17T19:00:00Z' },
    series: [{ key: '2026-11-17T03:00:00Z', label: '17/11', views, downloads: 0 }],
    totals: { views, downloads: 0 }, allTime: { views, downloads: 0 },
    platforms: ['windows', 'macos', 'android'].map(platform => ({ platform, downloads: 0 }))
  };
}
async function analyticsTest() {
  const d = dom(), c = clock(), requests = [];
  const buttons = ['day', 'week', 'month', 'year'].map(period => { const button = new Element('button'); button.dataset.period = period; return button; });
  d.nodes['panel-analytics'].querySelectorAll = () => buttons;
  d.nodes['analytics-reset-confirmation'].hidden = true;
  const window = {
    AdminUI: { lastState: null, refresh() {} }, addEventListener(name, callback) { (d.windowEvents[name] ||= []).push(callback); },
    InvoxBackend: { analytics: period => new Promise((resolve, reject) => requests.push({ period, resolve, reject })) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'painel-admin/analytics.js'), 'utf8'), { document: d.document, window, Intl, ...c });
  const change = scope => d.fire('invox:admin-realtime', { scopes: [scope] });
  change('analytics'); await c.advance(2000); assert.equal(requests.length, 0, 'no realtime query while logged out');
  d.fire('invox:admin-state', state()); assert.equal(requests.length, 1); requests[0].resolve(report('week', 3)); await flush();
  d.fire('invox:admin-state', state(), { refreshAnalytics: false }); change('feedback'); await c.advance(0); assert.equal(requests.length, 1, 'feedback refresh leaves chart untouched');
  for (let i = 0; i < 100; i++) change('analytics');
  await c.advance(1499); assert.equal(requests.length, 1); await c.advance(1); assert.equal(requests.length, 2, 'traffic is throttled to one graph read per 1.5 seconds');
  for (let i = 0; i < 100; i++) change('analytics'); await c.advance(2000); assert.equal(requests.length, 2, 'no duplicate read while request is pending');
  requests[1].resolve(report('week', 8)); await flush(); await c.advance(250); assert.equal(requests.length, 3, 'inflight invalidation is not lost');
  requests[2].resolve(report('week', 9)); await flush(); assert.equal(d.nodes['analytics-views'].textContent, '9');
  d.nodes['panel-analytics'].hidden = true; change('analytics'); await c.advance(5000); assert.equal(requests.length, 3);
  d.nodes['panel-analytics'].hidden = false; d.fire('invox:panel-change', { panel: 'analytics' }); assert.equal(requests.length, 4); requests[3].resolve(report('week', 10)); await flush();
  d.document.hidden = true; change('all'); await c.advance(5000); assert.equal(requests.length, 4);
  d.document.hidden = false; d.fire('visibilitychange'); await c.advance(250); assert.equal(requests.length, 5); requests[4].resolve(report('week', 11)); await flush();
  change('analytics'); d.fire('invox:admin-clear'); await c.advance(2000); assert.equal(requests.length, 5, 'logout cancels scheduled graph reads');
  assert.equal(d.nodes['analytics-views'].textContent, '—');
}
(async () => {
  await shellTest(); await analyticsTest();
  console.log('PASS admin realtime: authorized single channel, grouped invalidations, inflight catch-up, bounded graph reads, reconnect/visibility, identity changes and logout cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
