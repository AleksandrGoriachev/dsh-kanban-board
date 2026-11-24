import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const fails = [];
let helpers = null;
try { helpers = await import('../../../../lib/realm-helpers.js'); } catch { helpers = null; }
if (!helpers) fails.push('нет lib/realm-helpers.js');
else {
  const { realmHasWorkspace, currentWorkspaceRoot } = helpers;
  if (realmHasWorkspace({ workspaces: [{ root: 'a' }] }, 'a') !== true) fails.push('совпадающий root не найден');
  if (realmHasWorkspace({ workspaces: [{ root: 'a' }] }, '') !== false) fails.push('пустой rootPath не отсечён');
  if (realmHasWorkspace({ workspaces: [{ root: 'a' }] }, 123) !== false) fails.push('числовой rootPath не отсечён');
  if (realmHasWorkspace({ workspaces: [{ root: '' }] }, '') !== false) fails.push('вхождение с пустым root совпало с пустым rootPath');
  if (realmHasWorkspace({ workspaces: [{ root: 123 }] }, 123) !== false) fails.push('нестроковый root вхождения совпал с rootPath');
  if (realmHasWorkspace(null, 'a') !== false) fails.push('null realm не false');
  if (currentWorkspaceRoot([{ root: 'a', sessionIds: ['s'] }], 's') !== 'a') fails.push('текущий не найден');
  if (currentWorkspaceRoot([{ root: 123, sessionIds: ['s'] }], 's') !== '') fails.push('нестроковый root не отсечён');
  if (currentWorkspaceRoot([{ root: 'a', sessionIds: ['s'] }], '') !== '') fails.push('пустой sessionId не отсечён');
}
const client = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');
const ws = client.indexOf('__DSH_KANBAN_REALM_HELPERS__');
if (ws < 0) fails.push('в client нет блока регистрации хелперов');
const fnBody = (src, name) => {
  const i = src.indexOf('function ' + name);
  if (i < 0) return '';
  let depth = 0, j = src.indexOf('{', i);
  const start = j;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) break; } }
  return src.slice(start, j + 1).replace(/\s+/g, '');
};
const moduleSrc = fs.readFileSync(path.join(root, 'lib', 'realm-helpers.js'), 'utf8');
for (const name of ['realmHasWorkspace', 'currentWorkspaceRoot']) {
  const a = fnBody(client, name);
  const b = fnBody(moduleSrc, name);
  if (!a || !a) fails.push('функция ' + name + ' не найдена в ' + (!a ? 'client' : 'module'));
  else if (a !== b) fails.push('копия ' + name + ' в client расходится с модулем');
}
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
if (!/board\/journal\.jsonl/.test(gitignore)) fails.push('.gitignore не игнорирует board/journal.jsonl');
const motor = fs.readFileSync(path.join(root, 'lib', 'motor.js'), 'utf8');
if (!/subtask-approved/.test(motor)) fails.push('мотор не обрабатывает [subtask-approved]');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const atLeast = (a, b) => { const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0; const y = pb[i] || 0; if (x !== y) return x > y; } return true; };
if (!atLeast(pkg.version, '0.4.6')) fails.push('версия ниже 0.4.6: ' + pkg.version);
if (fails.length) { console.error('FAIL realm-checks-v4: ' + fails.join('; ')); process.exit(1); }
console.log('OK realm-checks-v4: пустой/числовой root, parity копий, .gitignore, subtask-approved; 0.4.6');
