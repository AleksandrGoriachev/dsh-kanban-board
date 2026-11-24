import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const fails = [];

// 1) Поведение [subtask-plan] -> [subtask-approved] -> [subtask-done] на временной доске.
const { createEpic, createTask, apply, loadCard, readJournal } = await import('../../../../lib/board.js');
const { processLetter } = await import('../../../../lib/motor.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-0025-'));
try {
  const epic = createEpic(tmp, { title: 'E', result: 'R' });
  const task = createTask(tmp, { title: 'T', epic: epic.id, workspace: 'w', spec: 'S' });
  const r1 = apply(tmp, { card: task.id, from: 'proposed', to: 'agreed', by: 'motor' });
  if (!r1 || r1.ok !== true) fails.push('подготовка: proposed->agreed не выполнен: ' + JSON.stringify(r1));
  const lease = new Date(Date.now() + 600000).toISOString();
  const r2 = apply(tmp, { card: task.id, from: 'agreed', to: 'in-progress', by: 'motor', payload: { owner: 'w', lease_until: lease } });
  if (!r2 || r2.ok !== true) fails.push('подготовка: agreed->in-progress не выполнен: ' + JSON.stringify(r2));
  const mk = (marker, payload) => ({ marker, From: marker === 'subtask-plan' ? 'w' : 'architect', To: 'x', Subject: '[' + marker + '] ' + task.id, body: 'Payload: ' + JSON.stringify(Object.assign({ card: task.id }, payload)) });
  const plan = processLetter({ boardDir: tmp, letter: mk('subtask-plan', { total: 3, subtasks: [] }), workspace: 'w', file: 'plan.md' });
  if (!plan || plan.ok !== true) fails.push('[subtask-plan] не принят: ' + JSON.stringify(plan));
  const approve = processLetter({ boardDir: tmp, letter: mk('subtask-approved', {}), workspace: 'w', file: 'approve.md' });
  if (!approve || approve.ok !== true) fails.push('[subtask-approved] не принят: ' + JSON.stringify(approve));
  const afterApprove = loadCard(tmp, task.id).meta;
  if (afterApprove.status !== 'in-progress') fails.push('после [subtask-approved] статус изменился: ' + afterApprove.status);
  if (!afterApprove.subtasks || afterApprove.subtasks.approved !== true) fails.push('meta.subtasks.approved не выставлен');
  if (afterApprove.subtasks.total !== 3) fails.push('план подзадач потерян: total=' + afterApprove.subtasks.total);
  const done = processLetter({ boardDir: tmp, letter: mk('subtask-done', { subtask: 'x' }), workspace: 'w', file: 'done.md' });
  if (!done || done.ok !== true) fails.push('[subtask-done] не принят: ' + JSON.stringify(done));
  const afterDone = loadCard(tmp, task.id).meta;
  if (afterDone.subtasks.approved !== true) fails.push('[subtask-done] стёр approved');
  if (afterDone.subtasks.done !== 1) fails.push('[subtask-done] не увеличил done: ' + afterDone.subtasks.done);
  const journal = readJournal(tmp);
  if (!journal.some((e) => e.kind === 'subtasks' && e.approved === true)) fails.push('в журнале нет события approved:true');
  // 2) Без плана вердикт не должен молча терять счётчик.
  const task2 = createTask(tmp, { title: 'T2', epic: epic.id, workspace: 'w', spec: 'S2' });
  apply(tmp, { card: task2.id, from: 'proposed', to: 'agreed', by: 'motor' });
  apply(tmp, { card: task2.id, from: 'agreed', to: 'in-progress', by: 'motor', payload: { owner: 'w', lease_until: new Date(Date.now() + 600000).toISOString() } });
  processLetter({ boardDir: tmp, letter: { marker: 'subtask-approved', From: 'architect', To: 'x', Subject: '[subtask-approved] ' + task2.id, body: 'Payload: ' + JSON.stringify({ card: task2.id }) }, workspace: 'w', file: 'a2.md' });
  const d2 = processLetter({ boardDir: tmp, letter: { marker: 'subtask-done', From: 'w', To: 'x', Subject: '[subtask-done] ' + task2.id, body: 'Payload: ' + JSON.stringify({ card: task2.id }) }, workspace: 'w', file: 'd2.md' });
  if (!d2 || typeof d2.total !== 'number') fails.push('[subtask-done] без плана упал: ' + JSON.stringify(d2));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

// 3) Мотор: мёртвой записи в MOTOR_MARKERS быть не должно.
const motor = fs.readFileSync(path.join(root, 'lib', 'motor.js'), 'utf8');
if (/'subtask-approved':\s*\{\s*from:\s*'\*'/.test(motor)) fails.push('в MOTOR_MARKERS осталась мёртвая запись subtask-approved');
if (!/typeof meta\.subtasks === 'object'|meta\.subtasks &&/.test(motor)) fails.push('[subtask-done] не защищает meta.subtasks');

// 4) Проверка хелперов: различать отсутствие файла и ошибку импорта.
const check = fs.readFileSync(path.join(root, 'docs', 'tasks', '0025', 'checks', 'subtask-approved.mjs'), 'utf8');
if (!/existsSync/.test(check)) fails.push('проверка не различает отсутствие файла и ошибку импорта');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '0.4.7') fails.push('ожидалась версия 0.4.7, сейчас ' + pkg.version);
if (fails.length) { console.error('FAIL subtask-approved: ' + fails.join('; ')); process.exit(1); }
console.log('OK subtask-approved: план->вердикт->done, статус не меняется, журнал; 0.4.7');
