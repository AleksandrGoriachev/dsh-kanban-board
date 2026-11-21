import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const files = ['lib/api.js', 'lib/board.js', 'lib/client.js', 'lib/motor.js', 'docs/PROTOCOL.md', 'test/board.test.mjs', 'test/api.test.mjs', 'test/motor.test.mjs'];
const leftovers = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const hits = text.match(/contracts|scenario|эталон/gi);
  if (hits) leftovers.push(file + ': ' + hits.length);
}
if (leftovers.length) {
  console.error('FAIL cleanup: остались следы старой модели — ' + leftovers.join('; '));
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '0.1.8') {
  console.error('FAIL cleanup: ожидалась версия 0.1.8, сейчас ' + pkg.version);
  process.exit(1);
}
console.log('OK cleanup: следов contracts/scenario/эталон нет; версия 0.1.8');
