import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const fails = [];
// Различаем «файла нет» и «ошибку импорта» — иначе диагноз врёт.
if (!fs.existsSync(path.join(root, 'lib', 'motor.js'))) { console.error('FAIL subtask-legacy: нет lib/motor.js'); process.exit(1); }
const { createEpic, createTask, apply, loadCard, writeCard, readJournal } = await import('../../../../lib/board.js');
const { processLetter } = await import('../../../../lib/motor.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-0026-'));
const mk = (marker, cardId) => ({ marker, From: marker === 'subtask-plan' ? 'w' : 'architect', To: 'x', Subject: '[' + marker + '] ' + cardId, body: 'Payload: ' + JSON.stringify({ card: cardId }) });
const toInProgress = (id) => {
  const a = apply(tmp, { card: id, from: 'proposed', to: 'agreed', by: 'motor' });
  if (!a || a.ok !== true) return 'proposed->agreed: ' + JSON.stringify(a);
  const b = apply(tmp, { card: id, from: 'agreed', to: 'in-progress', by: 'motor', payload: { owner: 'w', lease_until: new Date(Date.now() + 600000).toISOString() } });
  if (!b || b.ok !== true) return 'agreed->in-progress: ' + JSON.stringify(b);
  return '';
};
try {
  const epic = createEpic(tmp, { title: 'E', result: 'R' });

  // Кейс 1: legacy-карточка БЕЗ поля subtasks — [subtask-done] не должен бросать.
  const legacy = createTask(tmp, { title: 'L', epic: epic.id, workspace: 'w', spec: 'S' });
  const prepErr = toInProgress(legacy.id);
  if (prepErr) fails.push('подготовка legacy: ' + prepErr);
  const loaded = loadCard(tmp, legacy.id);
  const metaNoSub = { ...loaded.meta };
  delete metaNoSub.subtasks;
  writeCard(tmp, { kind: 'task', meta: metaNoSub, body: loaded.body });
  let doneLegacy = null;
  try {
    doneLegacy = processLetter({ boardDir: tmp, letter: mk('subtask-done', legacy.id), workspace: 'w', file: 'legacy.md' });
  } catch (e) {
    fails.push('legacy-карточка без subtasks: [subtask-done] бросил ' + String(e && e.message ? e.message : e));
  }
  if (doneLegacy && doneLegacy.ok !== true) fails.push('legacy: [subtask-done] отклонён: ' + JSON.stringify(doneLegacy));
  const afterLegacy = loadCard(tmp, legacy.id).meta;
  if (!afterLegacy.subtasks || typeof afterLegacy.subtasks.done !== 'number' || typeof afterLegacy.subtasks.total !== 'number') fails.push('legacy: subtasks не содержит числовых done/total: ' + JSON.stringify(afterLegacy.subtasks));

  // Кейс 2: [subtask-approved] на карточке в proposed — обрабатывается веткой вердикта, а не generic-путём.
  const early = createTask(tmp, { title: 'P', epic: epic.id, workspace: 'w', spec: 'S' });
  const earlyRes = processLetter({ boardDir: tmp, letter: mk('subtask-approved', early.id), workspace: 'w', file: 'early.md' });
  if (!earlyRes || earlyRes.ok !== false) fails.push('вердикт на proposed не отклонён');
  else if (earlyRes.code !== 'from-mismatch') fails.push('вердикт на proposed дал код ' + earlyRes.code + ' вместо from-mismatch — маркер ушёл в generic-путь');

  // Кейс 3: порядок approve -> plan -> done фиксируется явно (новый план аннулирует вердикт).
  const ord = createTask(tmp, { title: 'O', epic: epic.id, workspace: 'w', spec: 'S' });
  const ordErr = toInProgress(ord.id);
  if (ordErr) fails.push('подготовка порядок: ' + ordErr);
  const appr = processLetter({ boardDir: tmp, letter: mk('subtask-approved', ord.id), workspace: 'w', file: 'o1.md' });
  if (!appr || appr.ok !== true) fails.push('порядок: [subtask-approved] не принят: ' + JSON.stringify(appr));
  if (loadCard(tmp, ord.id).meta.subtasks.approved !== true) fails.push('порядок: approved не выставлен');
  const plan = processLetter({ boardDir: tmp, letter: { marker: 'subtask-plan', From: 'w', To: 'x', Subject: '[subtask-plan] ' + ord.id, body: 'Payload: ' + JSON.stringify({ card: ord.id, total: 3 }) }, workspace: 'w', file: 'o2.md' });
  if (!plan || plan.ok !== true) fails.push('порядок: [subtask-plan] не принят: ' + JSON.stringify(plan));
  const afterPlan = loadCard(tmp, ord.id).meta.subtasks;
  if (afterPlan.total !== 3) fails.push('порядок: план не записал total: ' + JSON.stringify(afterPlan));
  if (afterPlan.approved === true) fails.push('порядок: новый план сохранил approved — поведение изменилось, нужно решение постановщика');
  const doneOrd = processLetter({ boardDir: tmp, letter: mk('subtask-done', ord.id), workspace: 'w', file: 'o3.md' });
  if (!doneOrd || doneOrd.ok !== true) fails.push('порядок: [subtask-done] не принят: ' + JSON.stringify(doneOrd));
  const afterDoneOrd = loadCard(tmp, ord.id).meta.subtasks;
  if (afterDoneOrd.done !== 1 || afterDoneOrd.total !== 3) fails.push('порядок: счётчик после done неверен: ' + JSON.stringify(afterDoneOrd));

  // Кейс 4: журнал фиксирует и вердикт, и отметки.
  const journal = readJournal(tmp);
  if (!journal.some((e) => e.kind === 'subtasks' && e.approved === true)) fails.push('в журнале нет события approved:true');
  if (!journal.some((e) => e.kind === 'subtasks' && typeof e.done === 'number')) fails.push('в журнале нет событий с done');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

const protocol = fs.readFileSync(path.join(root, 'docs', 'PROTOCOL.md'), 'utf8');
if (protocol.indexOf('аннулирует вердикт') < 0) fails.push('PROTOCOL.md не фиксирует: новый план аннулирует вердикт по прежнему плану');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const atLeast = (a, b) => { const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0; const y = pb[i] || 0; if (x !== y) return x > y; } return true; };
if (!atLeast(pkg.version, '0.4.8')) fails.push('версия ниже 0.4.8: ' + pkg.version);
if (fails.length) { console.error('FAIL subtask-legacy: ' + fails.join('; ')); process.exit(1); }
console.log('OK subtask-legacy: legacy без subtasks, маркер не в generic, порядок approve->plan фиксирован; 0.4.8');
