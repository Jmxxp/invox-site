import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = (await fs.readdir(path.join(root, 'tests'))).filter(file => file.endsWith('.test.cjs')).sort();
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(root, 'tests', test)], {
    cwd: root, env: process.env, encoding: 'utf8', timeout: 60000, windowsHide: true
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw result.error || new Error(`Falha: ${test}`);
  }
  console.log(`PASS ${test}`);
}
console.log(`${tests.length} testes da integração passaram.`);
