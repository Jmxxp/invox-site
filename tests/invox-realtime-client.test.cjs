const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../site-oficial/shared/invox-client.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const session = (id = 'admin-a', token = 'token-a') => ({ user: { id }, access_token: token });
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function harness(options = {}) {
  const state = { session: options.session ?? null, getSessions: [], getCalls: 0, setAuthCalls: [], setAuthGate: null,
    listeners: new Set(), subscriptions: [], channels: [], removed: [], fetches: 0 };
  const auth = {
    async getSession() {
      state.getCalls++;
      const value = state.getSessions.length ? await state.getSessions.shift() : state.session;
      return { data: { session: value }, error: null };
    },
    onAuthStateChange(callback) {
      const record = { callback, active: true, unsubscribes: 0 };
      state.listeners.add(callback); state.subscriptions.push(record);
      options.onRegister?.(callback, state);
      return { data: { subscription: { unsubscribe() { record.unsubscribes++; record.active = false; state.listeners.delete(callback); } } } };
    }
  };
  const sdk = {
    auth,
    realtime: { async setAuth(...args) { state.setAuthCalls.push(args); if (state.setAuthGate) await state.setAuthGate.promise; } },
    channel(topic, config) {
      if (options.channelError) throw Error('channel unavailable');
      const channel = { topic, config, onCalls: [], handler: null, status: null,
        on(type, filter, callback) { this.onCalls.push({ type, filter }); this.handler = callback; return this; },
        subscribe(callback) { this.status = callback; return this; }
      };
      state.channels.push(channel); return channel;
    },
    removeChannel(channel) { state.removed.push(channel); return Promise.resolve('ok'); }
  };
  const window = { localStorage: storage(), sessionStorage: storage(), supabase: { createClient: () => sdk } };
  vm.runInNewContext(source, { window, URL, AbortController, setTimeout, clearTimeout, fetch: async () => { state.fetches++; throw Error('Unexpected API fetch'); } });
  return { api: window.InvoxBackend, state,
    emitAuth(event, value) { state.session = value; for (const callback of [...state.listeners]) callback(event, value); },
    payload(value, index = state.channels.length - 1) { state.channels[index].handler(value); }
  };
}
const json = value => JSON.parse(JSON.stringify(value));

(async () => {
  const publicClient = harness({ session: session() }), changes = [], statuses = [];
  const stopPublic = publicClient.api.subscribeChanges({ audience: 'public', onChange: value => changes.push(json(value)), onStatus: value => statuses.push(value) });
  await tick();
  assert.equal(publicClient.state.channels.length, 1);
  const publicChannel = publicClient.state.channels[0];
  assert.equal(publicChannel.topic, 'invox:site');
  assert.deepEqual(json(publicChannel.config), { config: { private: false, broadcast: { self: false, ack: false } } });
  assert.deepEqual(json(publicChannel.onCalls), [{ type: 'broadcast', filter: { event: 'invalidate' } }]);
  assert.equal(publicClient.state.getCalls, 0); assert.equal(publicClient.state.listeners.size, 0); assert.equal(publicClient.state.setAuthCalls.length, 0, 'public subscriptions never create an admin auth lifecycle');
  publicChannel.status('SUBSCRIBED');
  for (const scope of ['settings', 'installers', 'all']) publicClient.payload({ payload: { scope, name: 'private name', contact: 'private@example.test', access_token: 'never forward me' }, secret: 'outer payload' });
  for (const payload of [{ scope: 'feedback' }, { scope: 'analytics' }, { scope: 'unknown' }, {}, null, 'settings']) publicClient.payload({ payload });
  assert.deepEqual(changes, [{ scope: 'settings' }, { scope: 'installers' }, { scope: 'all' }], 'callbacks receive an allowlisted scope only, never record data');
  stopPublic(); stopPublic(); await tick();
  assert.equal(publicClient.state.removed.length, 1); assert.deepEqual(statuses, ['SUBSCRIBED', 'CLOSED']);
  publicClient.payload({ payload: { scope: 'settings' } }); publicChannel.status('SUBSCRIBED');
  assert.equal(changes.length, 3); assert.equal(statuses.length, 2, 'stale callbacks cannot revive a disposed subscription');

  const admin = harness({ session: session() }), adminChanges = [];
  const stopAdmin = admin.api.subscribeChanges({ audience: 'admin', onChange: value => adminChanges.push(json(value)) }); await tick();
  assert.equal(admin.state.channels.length, 1); assert.equal(admin.state.channels[0].topic, 'invox:admin');
  assert.equal(admin.state.channels[0].config.config.private, true); assert.equal(admin.state.listeners.size, 1);
  assert.deepEqual(admin.state.setAuthCalls, [[]], 'Realtime resolves the current SDK session instead of retaining a separate JWT');
  for (const scope of ['feedback', 'analytics', 'settings', 'installers', 'all']) admin.payload({ payload: { scope, note: 'private note' } });
  admin.payload({ payload: { scope: '__proto__' } });
  assert.deepEqual(adminChanges, ['feedback', 'analytics', 'settings', 'installers', 'all'].map(scope => ({ scope })));
  admin.emitAuth('TOKEN_REFRESHED', session('admin-a', 'token-a-refreshed')); await tick();
  assert.equal(admin.state.channels.length, 1); assert.equal(admin.state.removed.length, 0); assert.equal(admin.state.listeners.size, 1);
  admin.emitAuth('SIGNED_OUT', null); await tick();
  assert.equal(admin.state.removed.length, 1); assert.equal(admin.state.listeners.size, 0); assert.equal(admin.state.subscriptions[0].unsubscribes, 1);
  stopAdmin(); assert.equal(admin.state.removed.length, 1, 'logout and explicit disposal are idempotent');
  const beforeOldEvent = adminChanges.length; admin.payload({ payload: { scope: 'feedback' } }); assert.equal(adminChanges.length, beforeOldEvent);

  const switched = harness({ session: session() }); switched.api.subscribeChanges({ audience: 'admin' }); await tick();
  switched.emitAuth('SIGNED_IN', session('admin-b', 'token-b')); await tick();
  assert.equal(switched.state.removed.length, 1); assert.equal(switched.state.listeners.size, 0, 'changing identities removes the old private channel');

  for (const value of [null, { access_token: 'no-user' }, { user: { id: 'no-token' } }]) {
    const denied = harness({ session: value }), deniedStatuses = [];
    const stopDenied = denied.api.subscribeChanges({ audience: 'admin', onStatus: status => deniedStatuses.push(status) }); await tick();
    assert.equal(denied.state.channels.length, 0); assert.equal(denied.state.listeners.size, 0); assert.equal(denied.state.setAuthCalls.length, 0);
    assert.deepEqual(deniedStatuses, ['CHANNEL_ERROR']); stopDenied();
  }
  const invalid = harness({ session: session() }), invalidStatuses = [];
  invalid.api.subscribeChanges({ audience: 'other', onStatus: value => invalidStatuses.push(value) }); await tick();
  assert.equal(invalid.state.channels.length, 0); assert.equal(invalid.state.listeners.size, 0); assert.deepEqual(invalidStatuses, ['CHANNEL_ERROR']);

  const immediate = harness({ session: session() }); const immediateStop = immediate.api.subscribeChanges({ audience: 'admin' }); immediateStop(); await tick();
  assert.equal(immediate.state.subscriptions.length, 0); assert.equal(immediate.state.channels.length, 0, 'stop before the setup microtask cannot leak an auth listener');
  const registerLogout = harness({ session: session(), onRegister(callback) { callback('SIGNED_OUT', null); } });
  registerLogout.api.subscribeChanges({ audience: 'admin' }); await tick();
  assert.equal(registerLogout.state.listeners.size, 0); assert.equal(registerLogout.state.subscriptions[0].unsubscribes, 1); assert.equal(registerLogout.state.channels.length, 0, 'logout during listener registration is cleaned after registration returns');

  const pendingSession = harness({ session: session() }), firstSession = deferred(); pendingSession.state.getSessions.push(firstSession.promise);
  const pendingStop = pendingSession.api.subscribeChanges({ audience: 'admin' }); await tick(); assert.equal(pendingSession.state.listeners.size, 1);
  pendingStop(); firstSession.resolve(session()); await tick();
  assert.equal(pendingSession.state.listeners.size, 0); assert.equal(pendingSession.state.channels.length, 0); assert.equal(pendingSession.state.setAuthCalls.length, 0);

  const duringSetAuth = harness({ session: session() }), setAuth = deferred(); duringSetAuth.state.setAuthGate = setAuth;
  duringSetAuth.api.subscribeChanges({ audience: 'admin' }); await tick(); assert.equal(duringSetAuth.state.setAuthCalls.length, 1);
  duringSetAuth.emitAuth('SIGNED_OUT', null); setAuth.resolve(); await tick();
  assert.equal(duringSetAuth.state.channels.length, 0); assert.equal(duringSetAuth.state.listeners.size, 0, 'logout while awaiting setAuth cannot join afterward');

  const recheck = harness({ session: session() }), recheckAuth = deferred(); recheck.state.setAuthGate = recheckAuth;
  recheck.api.subscribeChanges({ audience: 'admin' }); await tick();
  recheck.state.session = session('admin-b', 'token-b'); recheckAuth.resolve(); await tick();
  assert.equal(recheck.state.getCalls, 2); assert.equal(recheck.state.channels.length, 0); assert.equal(recheck.state.listeners.size, 0, 'identity is rechecked after setAuth even without an Auth event');

  const setupFailure = harness({ session: session(), channelError: true }), failureStatuses = [];
  setupFailure.api.subscribeChanges({ audience: 'admin', onStatus: value => failureStatuses.push(value) }); await tick();
  assert.equal(setupFailure.state.listeners.size, 0); assert.deepEqual(failureStatuses, ['CHANNEL_ERROR']);
  const callbackFailure = harness(); const callbackStop = callbackFailure.api.subscribeChanges({ audience: 'public', onChange() { throw Error('UI'); }, onStatus() { throw Error('UI'); } }); await tick();
  assert.doesNotThrow(() => callbackFailure.payload({ payload: { scope: 'all' } })); assert.doesNotThrow(callbackStop);
  assert.equal(callbackFailure.state.removed.length, 1);
  for (const client of [publicClient, admin, switched, invalid, immediate, registerLogout, pendingSession, duringSetAuth, recheck, setupFailure, callbackFailure]) assert.equal(client.state.fetches, 0, 'event transport never queries or trusts private state payloads');
  console.log('PASS realtime client: public/private topics, scope-only hints, auth/token lifecycle, immediate stop, logout/setup races, identity recheck and cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
