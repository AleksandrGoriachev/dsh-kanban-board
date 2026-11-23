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
  if (realmHasWorkspace(null, 'x') !== false) fails.push('realmHasWorkspace(null) не false');
  if (realmHasWorkspace(undefined, 'x') !== false) fails.push('realmHasWorkspace(undefined) не false');
  if (realmHasWorkspace({ workspaces: [{ root: 'a' }] }, undefined) !== false) fails.push('realmHasWorkspace(root=undefined) не false — нет typeof-защиты');
  if (realmHasWorkspace({ workspaces: [{ root: 'a' }] }, 'a') !== true) fails.push('realmHasWorkspace(a) не true');
  if (currentWorkspaceRoot(null, 's') !== '') fails.push('currentWorkspaceRoot(null) не пусто');
  if (currentWorkspaceRoot([{ root: 123, sessionIds: ['s'] }], 's') !== '') fails.push('currentWorkspaceRoot нестроковый root не отсечён');
  if (currentWorkspaceRoot([{ root: 'a', sessionIds: ['s'] }], undefined) !== '') fails.push('currentWorkspaceRoot(sessionId=undefined) не пусто');
}
const client = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');
if (/setArchitect\s*\(/.test(client)) fails.push('в client остался setArchitect — авто-дефолт хранится');
if (!/const\s+effective\s*=/.test(client)) fails.push('нет const effective = ... — приоритет не вычисляется на рендере');
if (!/props\.onNote/.test(client)) fails.push('RealmForm не пробрасывает props.onNote');
if (client.indexOf('Реалм сохранён') < 0) fails.push('нет заметки «Реалм сохранён»');
if (!/notify\(\s*'Реалм сохранён'/.test(client) && !/onNote\(\s*'Реалм сохранён'/.test(client)) fails.push('заметка не отправляется через notify/onNote');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '0.4.5') fails.push('ожидалась версия 0.4.5, сейчас ' + pkg.version);
if (fails.length) { console.error('FAIL realm-form-v3: ' + fails.join('; ')); process.exit(1); }
console.log('OK realm-form-v3: typeof-защита, effective, onNote, нет setArchitect; 0.4.5');
