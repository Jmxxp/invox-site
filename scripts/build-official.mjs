import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, 'out');
if (path.dirname(output) !== root || path.basename(output) !== 'out') throw new Error('Destino de build inválido.');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await fs.cp(path.join(root, 'site-oficial'), output, {
  recursive: true,
  filter: source => path.basename(source) !== 'README.md'
});
await fs.cp(path.join(root, 'painel-admin'), path.join(output, 'admin'), {
  recursive: true,
  filter: source => path.basename(source) !== 'README.md'
});
const adminFile = path.join(output, 'admin/index.html');
const adminHtml = (await fs.readFile(adminFile, 'utf8'))
  .replaceAll('../site-oficial/shared/', '../shared/')
  .replaceAll('../site-oficial/index.html', '../index.html');
await fs.writeFile(adminFile, adminHtml);
await fs.writeFile(path.join(output, '.nojekyll'), '');
console.log('Site oficial e painel gerados em out/ (painel: out/admin/).');
