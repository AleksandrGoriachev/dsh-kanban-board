import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const fails = [];

const tasksDir = path.join(root, 'docs', 'tasks');
const checkFiles = [];
for (const d of fs.readdirSync(tasksDir)) {
  if (d === '0028') continue;
  const dir = path.join(tasksDir, d, 'checks');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.mjs')) checkFiles.push({ id: d, file: path.join(dir, f) });
}
if (checkFiles.length === 0) fails.push('не найдено ни одного check-файла');

// 1. Ни одна проверка не привязана к точной версии.
const pinned = [];
for (const c of checkFiles) {
  const t = fs.readFileSync(c.file, 'utf8');
  if (/version\s*!==\s*'/.test(t)) pinned.push(c.id + '/' + path.basename(c.file));
}
if (pinned.length) fails.push('проверки с жёстким равенством версии: ' + pinned.join(', '));

// 2. Каждая проверка, которая вообще смотрит на версию, сравнивает «не ниже».
const usesVersion = checkFiles.filter((c) => /pkg\.version|package\.json/.test(fs.readFileSync(c.file, 'utf8')));
const noAtLeast = [];
for (const c of usesVersion) {
  const t = fs.readFileSync(c.file, 'utf8');
  if (!/atLeast|compareVersions|versionAtLeast/.test(t)) noAtLeast.push(c.id + '/' + path.basename(c.file));
}
if (noAtLeast.length) fails.push('проверки без сравнения «не ниже»: ' + noAtLeast.join(', '));

// 3. Устаревшее утверждение 0021 снято: fallback workspaces[0].path разрешён решением 0022.
const old21 = path.join(tasksDir, '0021', 'checks', 'realm-form.mjs');
if (fs.existsSync(old21)) {
  const t = fs.readFileSync(old21, 'utf8');
  if (/workspaces\\\[0\\\]\.path/.test(t) && /fails\.push/.test(t)) {
    const line = t.split('\n').find((l) => /workspaces\\\[0\\\]\.path/.test(l) && /fails\.push/.test(l));
    if (line) fails.push('0021 всё ещё запрещает workspaces[0].path: ' + line.trim().slice(0, 80));
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '0.4.10') fails.push('ожидалась версия 0.4.10, сейчас ' + pkg.version);
if (fails.length) { console.error('FAIL checks-version: ' + fails.join('; ')); process.exit(1); }
console.log('OK checks-version: ' + checkFiles.length + ' проверок без жёсткой версии, «не ниже» есть, 0021 снята; 0.4.10');
