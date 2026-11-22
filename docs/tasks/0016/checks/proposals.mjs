import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const docPath = path.join(root, 'docs', 'DESIGN-PROPOSALS.md');
if (!fs.existsSync(docPath)) {
  console.error('FAIL proposals: нет docs/DESIGN-PROPOSALS.md');
  process.exit(1);
}
const doc = fs.readFileSync(docPath, 'utf8');
const required = ['Палитра', 'Токены', 'Экраны', 'Правки'];
const missing = required.filter((s) => !doc.includes(s));
if (missing.length) {
  console.error('FAIL proposals: в документе нет разделов ' + missing.join(', '));
  process.exit(1);
}
if (!doc.includes('светл') || !doc.includes('тёмн')) {
  console.error('FAIL proposals: не описаны обе темы (светлая и тёмная)');
  process.exit(1);
}
if (doc.length < 1500) {
  console.error('FAIL proposals: документ слишком короткий (' + doc.length + ' символов), нужно решение, а не заглушка');
  process.exit(1);
}
console.log('OK proposals: предложения дизайнера на месте (палитра/токены/экраны/правки, обе темы, ' + doc.length + ' символов)');
