/**
 * checks/result-model.mjs — приёмочная проверка задания 0007:
 * у эпика есть Результат (спека совокупности спек), у наряда — спека,
 * согласие [agree-epic] принимается без версий, координатор пишет
 * уведомление [task-offer] указанному в наряде воркспейсу.
 * На базе результата нет — доказанный красный.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, createEpic, createTask } from '../../../../lib/board.js';
import { processLetter } from '../../../../lib/motor.js';
import { parseLetter } from '../../../../lib/letters.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-result-'));
try {
  const result = 'Результат: заказ проходит от создания до оплаты';
  const epic = createEpic(root, { title: 'эпик', result });
  if (epic.result !== result) {
    console.error('FAIL result-model: результат эпика не сохранён');
    process.exit(1);
  }
  const spec = 'Сделай X; на выходе Y';
  const task = createTask(root, { epic: epic.id, title: 'наряд', workspace: 'tv2', spec });
  if (task.spec !== spec) {
    console.error('FAIL result-model: спека наряда не сохранена');
    process.exit(1);
  }
  apply(root, { card: epic.id, from: 'draft', to: 'agreeing', by: 'architect', agreeTimeoutMinutes: 30 });
  const letter = parseLetter([
    'Format: dsh-exchange/1', 'From: tv2', 'To: architect',
    'Date: 2026-01-01T00:00:00.000Z', 'Status: request', 'Session: s1',
    'Subject: [agree-epic] epic', '',
    'Payload: ' + JSON.stringify({ epic: epic.id, criteria: 'выход Y' }), '',
  ].join('\n'));
  const agreed = processLetter({ boardDir: root, letter, workspace: 'tv2', file: 'a1.md' });
  if (!agreed.ok) {
    console.error('FAIL result-model: согласие без версий не принято: ' + (agreed.code || agreed.reason));
    process.exit(1);
  }
  let offerTask;
  try { ({ offerTask } = await import('../../../../lib/api.js')); } catch { offerTask = undefined; }
  if (typeof offerTask !== 'function') {
    console.error('FAIL result-model: нет offerTask в api.js — координатор не уведомляет воркспейс');
    process.exit(1);
  }
  const exchange = path.join(root, 'coord');
  const realm = {
    version: 1, name: 't', agreeTimeoutMinutes: 15,
    architect: { root, exchange },
    workspaces: [{ id: 'tv2', root, exchange }],
  };
  const written = offerTask({ runtime: { realm, boardDir: root }, cardId: task.id, now: new Date() });
  if (!Array.isArray(written) || written.length !== 1) {
    console.error('FAIL result-model: уведомление [task-offer] не записано');
    process.exit(1);
  }
  const text = fs.readFileSync(path.join(exchange, 'outbox', written[0]), 'utf8');
  if (!text.includes('[task-offer]') || !text.includes('tv2')) {
    console.error('FAIL result-model: письмо [task-offer] без маркера или адресата');
    process.exit(1);
  }
  console.log('OK result-model: Результат эпика, спека наряда, согласие без версий, [task-offer] воркспейсу');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
