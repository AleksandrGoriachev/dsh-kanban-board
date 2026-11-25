/**
 * test/motor.test.mjs — письма dsh-exchange/1 и обход outbox (§6, §9.2).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, createEpic, createTask, loadCard } from '../lib/board.js';
import { markerOf, parseLetter, payloadOf, renderLetter } from '../lib/letters.js';
import { processLetter, sweepOutboxes } from '../lib/motor.js';
import { offerTask } from '../lib/api.js';

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function cleanup(dir) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; }
    catch { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); } catch { /* ignore */ } }
  }
}
function letterFor(marker, body) {
  return parseLetter(renderLetter({
    From: 'console', To: 'architect', Date: '2026-11-21T15:00+03:00', Thread: 'threads/kanban-E1',
    Status: 'request', Workspace: 'console', Session: 'session-1',
    Subject: '[' + marker + '] наряд E1-1', body,
  }));
}
function agreedTask(dir) {
  createTask(dir, { id: 'E1-1', title: 'наряд', epic: 'E1', workspace: 'console' });
  assert.equal(apply(dir, { card: 'E1-1', from: 'proposed', to: 'agreed', by: 'architect' }).ok, true);
}
function inProgressTask(dir) {
  agreedTask(dir);
  assert.equal(apply(dir, { card: 'E1-1', from: 'agreed', to: 'in-progress', by: 'motor', payload: { lease_until: '2099-01-01T00:00:00Z', owner: 's1' } }).ok, true);
}

test('маркер и payload читаются из Subject и тела', () => {
  const letter = letterFor('task-accept', 'Payload: ' + JSON.stringify({ card: 'E1-1', lease_until: '2099-01-01T00:00:00Z', owner: 'session-1' }) + '\n');
  assert.equal(letter.marker, 'task-accept');
  assert.equal(letter.headers.Session, 'session-1');
  assert.equal(letter.headers.Format, 'dsh-exchange/1');
  const payload = payloadOf(letter.body);
  assert.equal(payload.card, 'E1-1');
  assert.equal(payload.owner, 'session-1');
  assert.equal(markerOf('без маркера'), '');
});

test('renderLetter: шапка идёт в фиксированном порядке, тело отделено пустой строкой', () => {
  const text = renderLetter({ From: 'a', To: 'b', Session: 's', Subject: 'x', body: 'тело\n' });
  assert.match(text, /^Format: dsh-exchange\/1\nFrom: a\nTo: b\n/);
  assert.match(text, /\n\nтело\n$/);
});

test('processLetter: [task-accept] переводит agreed → in-progress', () => {
  const dir = tmp('kanban-');
  try {
    agreedTask(dir);
    const letter = letterFor('task-accept', 'Payload: ' + JSON.stringify({ card: 'E1-1', lease_until: '2099-01-01T00:00:00Z', owner: 'session-1' }) + '\n');
    const r = processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l1.md' });
    assert.equal(r.ok, true);
    assert.equal(r.marker, '[transition-applied]');
    const card = loadCard(dir, 'E1-1');
    assert.equal(card.meta.status, 'in-progress');
    assert.equal(card.meta.lease_until, '2099-01-01T00:00:00Z');
  } finally { cleanup(dir); }
});

test('processLetter: [stage-ready] без evidence → [transition-rejected]', () => {
  const dir = tmp('kanban-');
  try {
    inProgressTask(dir);
    const letter = letterFor('stage-ready', 'Payload: ' + JSON.stringify({ card: 'E1-1' }) + '\n');
    const r = processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l2.md' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'evidence-empty');
    assert.equal(loadCard(dir, 'E1-1').meta.status, 'in-progress');
  } finally { cleanup(dir); }
});

test('processLetter: [stage-ready] с evidence → integration', () => {
  const dir = tmp('kanban-');
  try {
    inProgressTask(dir);
    const letter = letterFor('stage-ready', 'Payload: ' + JSON.stringify({ card: 'E1-1', evidence: ['stage.log'] }) + '\n');
    const r = processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l3.md' });
    assert.equal(r.ok, true);
    assert.equal(loadCard(dir, 'E1-1').meta.status, 'integration');
  } finally { cleanup(dir); }
});

test('processLetter: [blocked] → blocked', () => {
  const dir = tmp('kanban-');
  try {
    inProgressTask(dir);
    const letter = letterFor('blocked', 'Payload: ' + JSON.stringify({ card: 'E1-1', reason: 'стык не сходится' }) + '\n');
    const r = processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l4.md' });
    assert.equal(r.ok, true);
    assert.equal(loadCard(dir, 'E1-1').meta.status, 'blocked');
  } finally { cleanup(dir); }
});

test('processLetter: неизвестный маркер не применяется', () => {
  const dir = tmp('kanban-');
  try {
    agreedTask(dir);
    const letter = letterFor('unknown-marker', 'Payload: ' + JSON.stringify({ card: 'E1-1' }) + '\n');
    const r = processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l5.md' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'unknown-marker');
    assert.equal(loadCard(dir, 'E1-1').meta.status, 'agreed');
  } finally { cleanup(dir); }
});

test('sweepOutboxes: читает новое письмо, пишет ответ, повторно не берёт', () => {
  const dir = tmp('kanban-');
  const realmDir = tmp('realm-');
  try {
    agreedTask(dir);
    const exchange = path.join(realmDir, 'console', 'exchange');
    const outbox = path.join(exchange, 'outbox');
    fs.mkdirSync(outbox, { recursive: true });
    const archExchange = path.join(realmDir, 'architect', 'exchange');
    fs.mkdirSync(path.join(archExchange, 'outbox'), { recursive: true });
    fs.writeFileSync(path.join(outbox, '2026-11-21T15-00--console--01.md'), renderLetter({
      From: 'console', To: 'architect', Date: '2026-11-21T15:00+03:00', Thread: 'threads/kanban-E1',
      Status: 'request', Workspace: 'console', Session: 'session-1', Subject: '[task-accept] наряд E1-1',
      body: 'Payload: ' + JSON.stringify({ card: 'E1-1', lease_until: '2099-01-01T00:00:00Z' }) + '\n',
    }));
    const realm = {
      version: 1,
      architect: { root: path.join(realmDir, 'architect'), exchange: archExchange },
      workspaces: [{ id: 'console', root: path.join(realmDir, 'console'), exchange }],
    };
    const first = sweepOutboxes({ realm, boardDir: dir });
    assert.equal(first.applied, 1);
    assert.equal(first.rejected, 0);
    assert.equal(loadCard(dir, 'E1-1').meta.status, 'in-progress');
    // B4: ответ архитектора лежит в каталоге своей ветки; Thread = каталог.
    const answerDir = path.join(archExchange, 'threads', 'kanban-E1');
    const responses = fs.readdirSync(answerDir);
    assert.equal(responses.length, 1);
    const answer = parseLetter(fs.readFileSync(path.join(answerDir, responses[0]), 'utf8'));
    assert.equal(answer.headers.Thread, 'threads/kanban-E1');
    assert.notEqual(answer.headers.Session, 'motor');
    assert.equal(answer.marker, 'transition-applied');
    const second = sweepOutboxes({ realm, boardDir: dir });
    assert.equal(second.results.length, 0);
  } finally { cleanup(dir); cleanup(realmDir); }
});

test('sweepOutboxes: письмо без Session не обрабатывается', () => {
  const dir = tmp('kanban-');
  const realmDir = tmp('realm-');
  try {
    agreedTask(dir);
    const exchange = path.join(realmDir, 'console', 'exchange');
    const outbox = path.join(exchange, 'outbox');
    fs.mkdirSync(outbox, { recursive: true });
    fs.writeFileSync(path.join(outbox, '2026-11-21T15-01--console--02.md'), renderLetter({
      From: 'console', To: 'architect', Subject: '[task-accept] наряд E1-1',
      body: 'Payload: ' + JSON.stringify({ card: 'E1-1', lease_until: '2099-01-01T00:00:00Z' }) + '\n',
    }));
    const realm = { version: 1, architect: { root: path.join(realmDir, 'architect'), exchange: path.join(realmDir, 'architect', 'exchange') }, workspaces: [{ id: 'console', root: path.join(realmDir, 'console'), exchange }] };
    const result = sweepOutboxes({ realm, boardDir: dir });
    assert.equal(result.results.length, 0);
    assert.equal(loadCard(dir, 'E1-1').meta.status, 'agreed');
  } finally { cleanup(dir); cleanup(realmDir); }
});

test('processLetter: [agree-epic] вне agreeing отклоняется', () => {
  const dir = tmp('kanban-');
  try {
    createEpic(dir, { id: 'E2', title: 'эпик', involved: ['console'] });
    const letter = letterFor('agree-epic', 'Payload: ' + JSON.stringify({ epic: 'E2' }) + '\n');
    const r = processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l6.md' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'from-mismatch');
    assert.equal(loadCard(dir, 'E2').meta.status, 'draft');
  } finally { cleanup(dir); }
});

test('processLetter: [agree-epic] частичное согласие фиксируется', () => {
  const dir = tmp('kanban-');
  try {
    createEpic(dir, { id: 'E2', title: 'эпик', involved: ['console', 'proxy'] });
    assert.equal(apply(dir, { card: 'E2', from: 'draft', to: 'agreeing', by: 'architect' }).ok, true);
    const letter = letterFor('agree-epic', 'Payload: ' + JSON.stringify({ epic: 'E2', criteria: 'стык ок' }) + '\n');
    const r = processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l6.md' });
    assert.equal(r.ok, true);
    assert.equal(r.code, 'agreed-recorded');
    const card = loadCard(dir, 'E2');
    assert.equal(card.meta.status, 'agreeing');
    assert.ok(card.meta.agreed.console);
  } finally { cleanup(dir); }
});

test('processLetter: повтор [agree-epic] → duplicate', () => {
  const dir = tmp('kanban-');
  try {
    createEpic(dir, { id: 'E2', title: 'эпик', involved: ['console', 'proxy'] });
    assert.equal(apply(dir, { card: 'E2', from: 'draft', to: 'agreeing', by: 'architect' }).ok, true);
    const letter = letterFor('agree-epic', 'Payload: ' + JSON.stringify({ epic: 'E2' }) + '\n');
    assert.equal(processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l6.md' }).ok, true);
    const dup = processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l6.md' });
    assert.equal(dup.code, 'duplicate');
    assert.equal(loadCard(dir, 'E2').meta.status, 'agreeing');
  } finally { cleanup(dir); }
});

test('processLetter: все involved согласны → эпик agreed', () => {
  const dir = tmp('kanban-');
  try {
    createEpic(dir, { id: 'E2', title: 'эпик', involved: ['console', 'proxy'] });
    assert.equal(apply(dir, { card: 'E2', from: 'draft', to: 'agreeing', by: 'architect' }).ok, true);
    const first = letterFor('agree-epic', 'Payload: ' + JSON.stringify({ epic: 'E2' }) + '\n');
    assert.equal(processLetter({ boardDir: dir, letter: first, workspace: 'console', file: 'l6.md' }).ok, true);
    const second = letterFor('agree-epic', 'Payload: ' + JSON.stringify({ epic: 'E2' }) + '\n');
    const r = processLetter({ boardDir: dir, letter: second, workspace: 'proxy', file: 'l7.md' });
    assert.equal(r.ok, true);
    assert.equal(loadCard(dir, 'E2').meta.status, 'agreed');
  } finally { cleanup(dir); }
});

test('processLetter: [agree-epic] без версий принимается', () => {
  const dir = tmp('kanban-');
  try {
    createEpic(dir, { id: 'E2', title: 'эпик', involved: ['console'] });
    assert.equal(apply(dir, { card: 'E2', from: 'draft', to: 'agreeing', by: 'architect' }).ok, true);
    const letter = letterFor('agree-epic', 'Payload: ' + JSON.stringify({ epic: 'E2', criteria: 'выход Y' }) + '\n');
    const r = processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l8.md' });
    assert.equal(r.ok, true);
    const card = loadCard(dir, 'E2');
    assert.ok(card.meta.agreed.console);
    assert.deepEqual(Object.keys(card.meta.agreed.console).sort(), ['at', 'criteria']);
    assert.equal(card.meta.status, 'agreed');
  } finally { cleanup(dir); }
});

test('offerTask пишет письмо [task-offer] адресату в каталог ветки', () => {
  const dir = tmp('kanban-');
  const realmDir = tmp('realm-');
  try {
    const epic = createEpic(dir, { id: 'E2', title: 'эпик', result: 'результат' });
    const task = createTask(dir, { id: 'E2-1', epic: epic.id, title: 'наряд', workspace: 'console', spec: 'сделать X' });
    const exchange = path.join(realmDir, 'architect', 'exchange');
    const realm = { version: 1, architect: { root: path.join(realmDir, 'architect'), exchange }, workspaces: [] };
    const written = offerTask({ runtime: { realm, boardDir: dir }, cardId: task.id, now: new Date('2026-01-01T00:00:00.000Z') });
    assert.equal(written.length, 1);
    // B4: письмо лежит в каталоге своей ветки, и Thread шапки — ровно этот каталог.
    const threadPath = path.join(exchange, 'threads', 'kanban-E2');
    assert.ok(fs.existsSync(path.join(threadPath, written[0])), 'письмо оффера не в каталоге ветки');
    const letter = parseLetter(fs.readFileSync(path.join(threadPath, written[0]), 'utf8'));
    assert.equal(letter.marker, 'task-offer');
    assert.equal(letter.headers.To, 'console');
    assert.equal(letter.headers.Thread, 'threads/kanban-E2');
    assert.equal(letter.headers.Ref, task.id);
    const payload = payloadOf(letter.body);
    assert.equal(payload.task, task.id);
    assert.equal(payload.spec, 'сделать X');
  } finally { cleanup(dir); cleanup(realmDir); }
});

test('processLetter: [interface-agreed] переводит наряд proposed → agreed, повтор не ломает', () => {
  const dir = tmp('kanban-');
  try {
    const epic = createEpic(dir, { id: 'E1', title: 'эпик', result: 'R' });
    const task = createTask(dir, { id: 'E1-1', epic: epic.id, title: 'наряд', workspace: 'console', spec: 'S' });
    const letter = letterFor('interface-agreed', 'Payload: ' + JSON.stringify({ task: task.id, spec: 'S' }) + '\n');
    const first = processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l9.md' });
    assert.equal(first.ok, true);
    assert.equal(first.marker, '[transition-applied]');
    assert.equal(loadCard(dir, task.id).meta.status, 'agreed');
    const dup = processLetter({ boardDir: dir, letter, workspace: 'console', file: 'l9.md' });
    assert.equal(dup.code, 'duplicate');
    assert.equal(loadCard(dir, task.id).meta.status, 'agreed');
  } finally { cleanup(dir); }
});

test('processLetter: [subtask-plan] ставит total и done=0', () => {
  const dir = tmp('kanban-');
  try {
    inProgressTask(dir);
    const letter = letterFor('subtask-plan', 'Payload: ' + JSON.stringify({ task: 'E1-1', total: 3, subtasks: ['a', 'b', 'c'] }) + '\n');
    const r = processLetter({ boardDir: dir, letter, workspace: 'console', file: 's1.md' });
    assert.equal(r.ok, true);
    assert.equal(r.code, 'subtasks-planned');
    const card = loadCard(dir, 'E1-1');
    assert.deepEqual(card.meta.subtasks, { total: 3, done: 0 });
  } finally { cleanup(dir); }
});

test('processLetter: [subtask-done] увеличивает done', () => {
  const dir = tmp('kanban-');
  try {
    inProgressTask(dir);
    const plan = letterFor('subtask-plan', 'Payload: ' + JSON.stringify({ task: 'E1-1', total: 3, subtasks: ['a', 'b', 'c'] }) + '\n');
    assert.equal(processLetter({ boardDir: dir, letter: plan, workspace: 'console', file: 's2.md' }).ok, true);
    const first = letterFor('subtask-done', 'Payload: ' + JSON.stringify({ task: 'E1-1', subtask: 'a' }) + '\n');
    assert.equal(processLetter({ boardDir: dir, letter: first, workspace: 'console', file: 's3.md' }).ok, true);
    assert.deepEqual(loadCard(dir, 'E1-1').meta.subtasks, { done: 1, total: 3 });
    const second = letterFor('subtask-done', 'Payload: ' + JSON.stringify({ task: 'E1-1', subtask: 'b' }) + '\n');
    assert.equal(processLetter({ boardDir: dir, letter: second, workspace: 'console', file: 's4.md' }).ok, true);
    assert.deepEqual(loadCard(dir, 'E1-1').meta.subtasks, { done: 2, total: 3 });
  } finally { cleanup(dir); }
});

test('processLetter: [result-failed] переводит accepted → rework', () => {
  const dir = tmp('kanban-');
  try {
    inProgressTask(dir);
    assert.equal(apply(dir, { card: 'E1-1', from: 'in-progress', to: 'integration', by: 'motor', payload: { evidence: ['e1'] } }).ok, true);
    assert.equal(apply(dir, { card: 'E1-1', from: 'integration', to: 'accepted', by: 'architect' }).ok, true);
    const letter = letterFor('result-failed', 'Payload: ' + JSON.stringify({ task: 'E1-1', reason: 'не тот результат' }) + '\n');
    const r = processLetter({ boardDir: dir, letter, workspace: 'console', file: 's5.md' });
    assert.equal(r.ok, true);
    assert.equal(loadCard(dir, 'E1-1').meta.status, 'rework');
  } finally { cleanup(dir); }
});
