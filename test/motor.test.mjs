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
  createTask(dir, { id: 'E1-1', epic: 'E1', workspace: 'console' });
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
    const responses = fs.readdirSync(path.join(archExchange, 'outbox'));
    assert.equal(responses.length, 1);
    const answer = parseLetter(fs.readFileSync(path.join(archExchange, 'outbox', responses[0]), 'utf8'));
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
