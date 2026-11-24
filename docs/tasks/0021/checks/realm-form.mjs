import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const client = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');
const start = client.indexOf('function RealmForm');
const end = client.indexOf('function EpicForm');
const form = (start >= 0 && end > start) ? client.slice(start, end) : '';
const fails = [];
if (!form) fails.push('не найден RealmForm');
else {
  if (!/props\.realm/.test(form)) fails.push('RealmForm не получает props.realm — галочки не предзаполняются');
  if (!/useEffect\(/.test(form)) fails.push('в RealmForm нет useEffect — selected не инициализируется');
  if (!/useWorkspaces/.test(form)) fails.push('RealmForm не использует useWorkspaces для текущего воркспейса');
  if (form.indexOf('Реалм сохранён') < 0) fails.push('после сохранения нет заметки «Реалм сохранён»');
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const atLeast = (a, b) => { const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0; const y = pb[i] || 0; if (x !== y) return x > y; } return true; };
if (!atLeast(pkg.version, '0.4.3')) fails.push('версия ниже 0.4.3: ' + pkg.version);
if (fails.length) { console.error('FAIL realm-form: ' + fails.join('; ')); process.exit(1); }
console.log('OK realm-form: галочки из реалма, текущий воркспейс, заметка; 0.4.3');
