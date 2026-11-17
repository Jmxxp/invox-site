const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
for (const page of ['site-oficial', 'painel-admin']) {
  const html = fs.readFileSync(path.join(root, page, 'index.html'), 'utf8');
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
  assert(policy, `${page} declares its policy`);
  const directives = Object.fromEntries(policy.split(';').map(value => value.trim().split(/\s+/)).map(([key, ...values]) => [key, values]));
  assert(directives['connect-src'].includes('wss://wsfdwyghqqaerivyrbil.supabase.co'), `${page} permits its Realtime connection`);
  assert(directives['connect-src'].includes('https://wsfdwyghqqaerivyrbil.supabase.co'));
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert(directives['script-src'].includes("'self'"));
  assert(!directives['script-src'].some(value => ["'unsafe-inline'", "'unsafe-eval'", '*'].includes(value)));
  assert(directives['script-src'].includes("'wasm-unsafe-eval'"), 'local streaming SHA-256 can compile its bundled WebAssembly');
  if (page === 'site-oficial') {
    assert.deepEqual(directives['worker-src'], ["'self'"], 'multipart streaming can register its local service worker');
    assert.deepEqual(directives['frame-src'], ["'self'"], 'multipart streaming can open its local download route');
    const data = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1].replace(/\r\n?/g, '\n');
    assert(directives['script-src'].includes(`'sha256-${createHash('sha256').update(data).digest('base64')}'`));
    assert(html.indexOf('shared/vendor/sha256.umd.min.js') < html.indexOf('download-multipart.js'));
    assert(html.indexOf('shared/vendor/supabase.js') < html.indexOf('shared/invox-client.js'));
  } else {
    assert.deepEqual(directives['worker-src'], ["'none'"]);
    assert.deepEqual(directives['frame-src'], ["'none'"]);
    assert(html.includes('announcements.js'));
    assert(html.includes('shared/vendor/sha256.umd.min.js'));
  }
}
console.log('PASS integration policy: Realtime and local multipart stream remain permitted; script restrictions and structured-data hash retained.');
