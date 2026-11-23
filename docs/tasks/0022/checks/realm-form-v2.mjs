import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const fails = [];
let helpers = null;
try { helpers = await import('../../../../lib/realm-helpers.js'); } catch { helpers = null; }
if (!helpers) fails.push('нет lib/realm-helpers.js с realmHasWorkspace/currentWorkspaceRoot');
else {
  const { realmHasWorkspace, currentWorkspaceRoot } = helpers;
  const realm = { architect: { root: 'C:\\ws\\arch' }, workspaces: [{ id: 'tv', root: 'C:\\ws\\tv' }] };
  if (realmHasWorkspace(realm, 'C:\\ws\\tv') !== true) fails.push('realmHasWorkspace не находит сохранённый воркспейс по root');
  if (realmHasWorkspace(realm, 'C:\\ws\\other') !== false) fails.push('realmHasWorkspace находит чужой root');
  if (realmHasWorkspace(null, 'C:\\ws\\tv') !== false) fails.push('realmHasWorkspace не переносит пустой realm');
  const items = [{ root: 'C:\\ws\\a', sessionIds: ['s1'] }, { root: 'C:\\ws\\b', sessionIds: ['s2'] }];
  if (currentWorkspaceRoot(items, 's2') !== 'C:\\ws\\b') fails.push('currentWorkspaceRoot не находит текущий по sessionId');
  if (currentWorkspaceRoot(items, 'sX') !== '') fails.push('currentWorkspaceRoot не возвращает пусто для чужой сессии');
  if (currentWorkspaceRoot(null, 's1') !== '') fails.push('currentWorkspaceRoot не переносит пустой список');
}
const client = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');
if (/setArchitect\(prev => prev \? prev :/.test(client)) fails.push('client хранит авто-дефолт (setArchitect prev ? prev)');
if (!/currentRoot\s*\|\|\s*[a-zA-Z]+Root/.test(client)) fails.push('client не использует приоритет currentRoot || savedRoot');
if (!/state\.note|setState\(\(prev\) => \(\{ \.\.\.prev, note/.test(client)) fails.push('заметка не поднята на уровень View (state.note)');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '0.4.4') fails.push('ожидалась версия 0.4.4, сейчас ' + pkg.version);
if (fails.length) { console.error('FAIL realm-form-v2: ' + fails.join('; ')); process.exit(1); }
console.log('OK realm-form-v2: приоритет текущего, заметка во View, хелперы; 0.4.4');
