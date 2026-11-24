import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const protocol = fs.readFileSync(path.join(root, 'docs', 'PROTOCOL.md'), 'utf8');
const banned = ['контракт обмена', 'контракты стыка', 'версия контракта обмена', 'читатель контракта'];
const found = banned.filter((term) => protocol.includes(term));
if (found.length) {
  console.error('FAIL reframe: остались старые формулировки: ' + found.join(', '));
  process.exit(1);
}
if (!protocol.includes('Результат')) {
  console.error('FAIL reframe: в протоколе нет понятия Результат');
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const atLeast = (a, b) => { const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0; const y = pb[i] || 0; if (x !== y) return x > y; } return true; };
if (!atLeast(pkg.version, '0.3.1')) {
  console.error('FAIL reframe: версия ниже 0.3.1, сейчас ' + pkg.version);
  process.exit(1);
}
console.log('OK reframe: старые формулировки убраны, Результат в протоколе; версия 0.3.1');
