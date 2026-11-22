import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, createEpic, createTask, loadCard } from '../../../../lib/board.js';
import { processLetter } from '../../../../lib/motor.js';
import { parseLetter } from '../../../../lib/letters.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const NL = String.fromCharCode(10);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-stage3-'));
function letter(from, marker, payload) {
  return parseLetter([
    'Format: dsh-exchange/1', 'From: ' + from, 'To: architect',
    'Date: 2026-01-01T00:00:00.000Z', 'Status: request', 'Session: s1',
    'Subject: ' + marker + ' task', '',
    'Payload: ' + JSON.stringify(payload), '',
  ].join(NL));
}
try {
  const epic = createEpic(root, { title: 'эпик', result: 'R' });
  const task = createTask(root, { epic: epic.id, title: 'наряд', workspace: 'tv2', spec: 'S' });
  apply(root, { card: task.id, from: 'proposed', to: 'agreed', by: 'architect' });
  const future = new Date(Date.now() + 3600000).toISOString();
  const start = apply(root, { card: task.id, from: 'agreed', to: 'in-progress', by: 'motor', payload: { lease_until: future } });
  if (!start.ok) {
    console.error('FAIL stage3: наряд не взят в работу: ' + (start.code || start.reason));
    process.exit(1);
  }
  const plan = processLetter({ boardDir: root, letter: letter('tv2', '[subtask-plan]', { task: task.id, total: 3, subtasks: ['a', 'b', 'c'] }), workspace: 'tv2', file: 'p1.md' });
  if (!plan.ok) {
    console.error('FAIL stage3: [subtask-plan] не принят: ' + (plan.code || plan.reason));
    process.exit(1);
  }
  if (loadCard(root, task.id).meta.subtasks.total !== 3) {
    console.error('FAIL stage3: план подзадач не записан');
    process.exit(1);
  }
  const d1 = processLetter({ boardDir: root, letter: letter('tv2', '[subtask-done]', { task: task.id, subtask: 'a' }), workspace: 'tv2', file: 'd1.md' });
  if (!d1.ok) {
    console.error('FAIL stage3: [subtask-done] не принят: ' + (d1.code || d1.reason));
    process.exit(1);
  }
  if (loadCard(root, task.id).meta.subtasks.done !== 1) {
    console.error('FAIL stage3: подзадача не зачтена');
    process.exit(1);
  }
  apply(root, { card: task.id, from: 'in-progress', to: 'integration', by: 'motor', payload: { evidence: ['e1'] } });
  apply(root, { card: task.id, from: 'integration', to: 'accepted', by: 'architect' });
  const rf = processLetter({ boardDir: root, letter: letter('tv2', '[result-failed]', { task: task.id, reason: 'не тот результат' }), workspace: 'tv2', file: 'rf.md' });
  if (!rf.ok) {
    console.error('FAIL stage3: [result-failed] не принят: ' + (rf.code || rf.reason));
    process.exit(1);
  }
  if (loadCard(root, task.id).meta.status !== 'rework') {
    console.error('FAIL stage3: наряд не в rework');
    process.exit(1);
  }
  console.log('OK stage3: план подзадач, счётчик, [result-failed] → rework');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
