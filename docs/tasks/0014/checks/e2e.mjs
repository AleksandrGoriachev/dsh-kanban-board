import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, createEpic, createTask, loadCard, readJournal } from '../../../../lib/board.js';
import { processLetter } from '../../../../lib/motor.js';
import { parseLetter } from '../../../../lib/letters.js';

const NL = String.fromCharCode(10);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-e2e-'));
function letter(marker, payload) {
  return parseLetter([
    'Format: dsh-exchange/1', 'From: tv2', 'To: architect',
    'Date: 2026-01-01T00:00:00.000Z', 'Status: request', 'Session: s1',
    'Subject: ' + marker + ' e2e', '',
    'Payload: ' + JSON.stringify(payload), '',
  ].join(NL));
}
const fails = [];
function step(name, cond) { if (!cond) fails.push(name); }
function send(marker, payload) {
  return processLetter({ boardDir: root, letter: letter(marker, payload), workspace: 'tv2', file: marker.replace(/[^w]/g, '') + '-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.md' });
}
try {
  const epic = createEpic(root, { title: 'эпик', result: 'R', involved: ['tv2'] });
  step('создан draft', epic.status === 'draft');
  apply(root, { card: epic.id, from: 'draft', to: 'agreeing', by: 'architect', agreeTimeoutMinutes: 30 });
  step('согласие принято', send('[agree-epic]', { epic: epic.id, criteria: 'ОК' }).ok);
  step('эпик agreed', loadCard(root, epic.id).meta.status === 'agreed');
  apply(root, { card: epic.id, from: 'agreed', to: 'decomposed', by: 'architect' });
  const t1 = createTask(root, { epic: epic.id, title: 't1', workspace: 'tv2', spec: 's1' });
  const t2 = createTask(root, { epic: epic.id, title: 't2', workspace: 'tv2', spec: 's2' });
  step('наряды proposed', t1.status === 'proposed' && t2.status === 'proposed');
  for (const t of [t1, t2]) step('interface-agreed ' + t.id, send('[interface-agreed]', { task: t.id }).ok);
  step('наряды agreed', [t1, t2].every((t) => loadCard(root, t.id).meta.status === 'agreed'));
  const future = new Date(Date.now() + 3600000).toISOString();
  for (const t of [t1, t2]) step('task-accept ' + t.id, send('[task-accept]', { task: t.id, lease_until: future }).ok);
  step('наряды in-progress', [t1, t2].every((t) => loadCard(root, t.id).meta.status === 'in-progress'));
  step('subtask-plan', send('[subtask-plan]', { task: t1.id, total: 2 }).ok);
  step('subtask-done', send('[subtask-done]', { task: t1.id }).ok);
  step('подзадачи 1/2', loadCard(root, t1.id).meta.subtasks.done === 1);
  for (const t of [t1, t2]) step('stage-ready ' + t.id, send('[stage-ready]', { task: t.id, evidence: ['e1'] }).ok);
  step('наряды integration', [t1, t2].every((t) => loadCard(root, t.id).meta.status === 'integration'));
  for (const t of [t1, t2]) apply(root, { card: t.id, from: 'integration', to: 'accepted', by: 'architect' });
  step('наряды accepted', [t1, t2].every((t) => loadCard(root, t.id).meta.status === 'accepted'));
  apply(root, { card: epic.id, from: 'decomposed', to: 'in-progress', by: 'motor' });
  apply(root, { card: epic.id, from: 'in-progress', to: 'accepted', by: 'motor' });
  apply(root, { card: epic.id, from: 'accepted', to: 'done', by: 'architect' });
  step('эпик done', loadCard(root, epic.id).meta.status === 'done');
  const journal = readJournal(root);
  step('журнал > 10 событий', journal.length > 10);
  if (fails.length) {
    console.error('FAIL e2e: ' + fails.join(', '));
    process.exit(1);
  }
  console.log('OK e2e: эпик от draft до done; событий журнала ' + journal.length);
} finally {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
