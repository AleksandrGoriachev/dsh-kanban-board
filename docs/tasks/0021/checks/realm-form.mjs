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
  if (/workspaces\[0\]\.path/.test(form)) fails.push('корень архитектора = workspaces[0].path, а не текущий воркспейс');
  if (!/useWorkspaces/.test(form)) fails.push('RealmForm не использует useWorkspaces для текущего воркспейса');
  if (form.indexOf('Реалм сохранён') < 0) fails.push('после сохранения нет заметки «Реалм сохранён»');
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '0.4.3') fails.push('ожидалась версия 0.4.3, сейчас ' + pkg.version);
if (fails.length) { console.error('FAIL realm-form: ' + fails.join('; ')); process.exit(1); }
console.log('OK realm-form: галочки из реалма, текущий воркспейс, заметка; 0.4.3');
