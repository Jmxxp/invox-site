import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out');
async function walk(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(path.join(folder, e.name)) : [path.join(folder, e.name)]))).flat();
}
const files = await walk(out);
let references = 0;
async function verifyRef(value, owner) {
  if (/^(?:#|https?:|data:|mailto:)/.test(value)) return;
  const target = path.resolve(path.dirname(owner), value.split(/[?#]/)[0]);
  assert(target.startsWith(out + path.sep), `Referência fora da publicação: ${value}`);
  assert((await fs.stat(target)).isFile(), `Recurso ausente: ${value}`);
  references++;
}
for (const file of files) {
  if (file.endsWith('.html')) {
    const html = await fs.readFile(file, 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length, new Set(ids).size, 'IDs únicos');
    for (const tag of html.matchAll(/<(?:script|link|img|a|video|source)\b[^>]*>/g)) {
      for (const ref of tag[0].matchAll(/\b(?:src|href|poster)="([^"]+)"/g)) await verifyRef(ref[1], file);
    }
    for (const attr of html.matchAll(/\b(?:for|aria-controls|aria-labelledby|aria-describedby)="([^"]+)"/g)) {
      for (const id of attr[1].split(/\s+/)) assert(ids.includes(id), `Referência acessível ausente: ${id}`);
    }
  }
  if (file.endsWith('.css')) {
    for (const ref of (await fs.readFile(file, 'utf8')).matchAll(/url\(\s*["']?([^\s"')]+)["']?\)/g)) await verifyRef(ref[1], file);
  }
  if (file.endsWith('.js')) new vm.Script(await fs.readFile(file, 'utf8'), { filename: file });
}
const publicHtml = await fs.readFile(path.join(out, 'index.html'), 'utf8');
const adminHtml = await fs.readFile(path.join(out, 'admin/index.html'), 'utf8');
assert.match(publicHtml, /INVOX.*Sua voz\. Suas regras\./);
assert.match(publicHtml, /1\.1\.0/);
assert.match(publicHtml, /shared\/invox-client\.js/);
assert.match(adminHtml, /\.\.\/shared\/invox-client\.js/);
assert(!adminHtml.includes('../site-oficial/'), 'Links publicados do painel');
assert.match(adminHtml, /name="robots" content="noindex,nofollow"/);
for (const name of ['config.js', 'script.js', 'shared/invox-client.js']) {
  const source = await fs.readFile(path.join(out, name), 'utf8');
  assert(!source.includes('mediafire.com'), 'Sem desvio por link externo de instalador');
  assert(!/sb_secret_[A-Za-z0-9_-]{20,}/.test(source), 'Sem chave secreta no cliente');
}
const manifest = JSON.parse(await fs.readFile(path.join(out, 'shared/vendor/manifest.json'), 'utf8'));
assert.equal(createHash('sha256').update(await fs.readFile(path.join(out, 'shared/vendor/supabase.js'))).digest('hex'), manifest.sha256, 'Integridade do SDK');
await fs.access(path.join(out, '.nojekyll'));
console.log(JSON.stringify({ passed: true, files: files.length, references, sdk: manifest.version, adminPath: '/invox-site/admin/' }, null, 2));
