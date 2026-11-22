/**
 * test/board.test.mjs — проверки ядра доски по docs/PROTOCOL.md.
 * Отрицательные кейсы §12: недопустимый переход, повтор письма, просроченный
 * лиз, stale revision, stage-ready без evidence, расхождение журнала.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  apply, createEpic, createTask, loadCard, parseCardText, readJournal, renderCardText, replay, sweep,
} from '../lib/board.js';

function board() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-'));
}
function cleanup(dir) {
  /*
   * Windows: rmSync иногда ловит ENOTEMPTY/EPERM/EBUSY из-за ещё открытого
   * handle (антивирус, отложенное закрытие). Повторяем; если не вышло —
   * каталог остаётся в %TEMP%, это безвредно, тест из-за уборки не валим.
   */
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 19) return;
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); } catch { /* ignore */ }
    }
  }
}
function future(ms = 600000) {
  return new Date(Date.now() + ms).toISOString();
}
function past(ms = 600000) {
  return new Date(Date.now() - ms).toISOString();
}

test('карточка: parse ↔ render сохраняет мета и тело', () => {
  const text = renderCardText({ id: 'E1', title: 'эпик', status: 'draft', revision: 1 }, '# E1\n\nтело\n');
  const { meta, body } = parseCardText(text);
  assert.equal(meta.id, 'E1');
  assert.equal(meta.status, 'draft');
  assert.equal(body.trim(), '# E1\n\nтело');
});

test('эпик: draft → agreeing разрешён архитектору', () => {
  const dir = board();
  try {
    createEpic(dir, { id: 'E1', title: 'эпик', involved: ['console'] });
    const r = apply(dir, { card: 'E1', from: 'draft', to: 'agreeing', by: 'architect' });
    assert.equal(r.ok, true);
    assert.equal(r.marker, '[transition-applied]');
    const card = loadCard(dir, 'E1');
    assert.equal(card.meta.status, 'agreeing');
    assert.equal(card.meta.revision, 2);
    assert.equal(readJournal(dir).length, 1);
  } finally { cleanup(dir); }
});

test('эпик: draft → done запрещён, список допустимых назван', () => {
  const dir = board();
  try {
    createEpic(dir, { id: 'E1', title: 'эпик' });
    const r = apply(dir, { card: 'E1', from: 'draft', to: 'done', by: 'architect' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'invalid-transition');
    assert.deepEqual(r.allowed, ['agreeing']);
  } finally { cleanup(dir); }
});

test('несуществующая карточка → [unknown-card]', () => {
  const dir = board();
  try {
    const r = apply(dir, { card: 'E404', from: 'draft', to: 'agreeing', by: 'architect' });
    assert.equal(r.code, 'unknown-card');
    assert.equal(r.marker, '[unknown-card]');
  } finally { cleanup(dir); }
});

test('наряд: proposed → agreed → in-progress с будущим лизом', () => {
  const dir = board();
  try {
    createTask(dir, { id: 'E1-1', epic: 'E1', workspace: 'console' });
    assert.equal(apply(dir, { card: 'E1-1', from: 'proposed', to: 'agreed', by: 'architect' }).ok, true);
    const lease = future();
    const r = apply(dir, {
      card: 'E1-1', from: 'agreed', to: 'in-progress', by: 'motor',
      payload: { lease_until: lease, owner: 'session-1' },
    });
    assert.equal(r.ok, true);
    const card = loadCard(dir, 'E1-1');
    assert.equal(card.meta.status, 'in-progress');
    assert.equal(card.meta.owner, 'session-1');
    assert.equal(card.meta.lease_until, lease);
  } finally { cleanup(dir); }
});

test('task-accept с лизом в прошлом → [transition-rejected]', () => {
  const dir = board();
  try {
    createTask(dir, { id: 'E1-1', epic: 'E1', workspace: 'console' });
    apply(dir, { card: 'E1-1', from: 'proposed', to: 'agreed', by: 'architect' });
    const r = apply(dir, {
      card: 'E1-1', from: 'agreed', to: 'in-progress', by: 'motor',
      payload: { lease_until: past() },
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'lease-past');
    assert.equal(r.marker, '[transition-rejected]');
  } finally { cleanup(dir); }
});

test('stage-ready без evidence → отказ; с evidence → integration', () => {
  const dir = board();
  try {
    createTask(dir, { id: 'E1-1', epic: 'E1', workspace: 'console' });
    apply(dir, { card: 'E1-1', from: 'proposed', to: 'agreed', by: 'architect' });
    apply(dir, { card: 'E1-1', from: 'agreed', to: 'in-progress', by: 'motor', payload: { lease_until: future() } });
    const noEvidence = apply(dir, { card: 'E1-1', from: 'in-progress', to: 'integration', by: 'motor' });
    assert.equal(noEvidence.code, 'evidence-empty');
    const withEvidence = apply(dir, {
      card: 'E1-1', from: 'in-progress', to: 'integration', by: 'motor',
      payload: { evidence: ['threads/kanban-E1/stage.log'] },
    });
    assert.equal(withEvidence.ok, true);
    assert.deepEqual(loadCard(dir, 'E1-1').meta.evidence, ['threads/kanban-E1/stage.log']);
  } finally { cleanup(dir); }
});

test('повтор письма → [duplicate], состояние не меняется', () => {
  const dir = board();
  try {
    createTask(dir, { id: 'E1-1', epic: 'E1', workspace: 'console' });
    apply(dir, { card: 'E1-1', from: 'proposed', to: 'agreed', by: 'architect' });
    const request = {
      card: 'E1-1', from: 'agreed', to: 'in-progress', by: 'motor',
      payload: { lease_until: future(), owner: 'session-1' },
    };
    assert.equal(apply(dir, request).ok, true);
    const before = loadCard(dir, 'E1-1').meta;
    const again = apply(dir, request);
    assert.equal(again.code, 'duplicate');
    assert.equal(again.marker, '[duplicate]');
    const after = loadCard(dir, 'E1-1').meta;
    assert.equal(after.status, before.status);
    assert.equal(after.revision, before.revision);
  } finally { cleanup(dir); }
});

test('stale revision отклоняется', () => {
  const dir = board();
  try {
    createEpic(dir, { id: 'E1', title: 'эпик' });
    apply(dir, { card: 'E1', from: 'draft', to: 'agreeing', by: 'architect' });
    const r = apply(dir, { card: 'E1', from: 'agreeing', to: 'agreed', by: 'motor', expectedRevision: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'stale');
  } finally { cleanup(dir); }
});

test('sweep: истёкший лиз возвращает наряд в agreed и снимает owner/lease', () => {
  const dir = board();
  try {
    createTask(dir, { id: 'E1-1', epic: 'E1', workspace: 'console' });
    apply(dir, { card: 'E1-1', from: 'proposed', to: 'agreed', by: 'architect' });
    apply(dir, {
      card: 'E1-1', from: 'agreed', to: 'in-progress', by: 'motor',
      payload: { lease_until: new Date(Date.now() + 60000).toISOString(), owner: 'session-1' },
    });
    const result = sweep(dir, { now: new Date(Date.now() + 120000) });
    assert.equal(result.expired.length, 1);
    assert.equal(result.expired[0].marker, '[lease-expired]');
    const card = loadCard(dir, 'E1-1');
    assert.equal(card.meta.status, 'agreed');
    assert.equal(card.meta.owner, null);
    assert.equal(card.meta.lease_until, null);
  } finally { cleanup(dir); }
});

test('sweep: истёкший agree_until → needs-decision', () => {
  const dir = board();
  try {
    createEpic(dir, { id: 'E1', title: 'эпик', involved: ['console'], agree_until: new Date(Date.now() + 60000).toISOString() });
    apply(dir, { card: 'E1', from: 'draft', to: 'agreeing', by: 'architect' });
    const result = sweep(dir, { now: new Date(Date.now() + 120000) });
    assert.equal(result.expired.length, 1);
    assert.equal(loadCard(dir, 'E1').meta.status, 'needs-decision');
  } finally { cleanup(dir); }
});

test('replay: подменённый статус карточки восстанавливается из журнала', () => {
  const dir = board();
  try {
    createTask(dir, { id: 'E1-1', epic: 'E1', workspace: 'console' });
    apply(dir, { card: 'E1-1', from: 'proposed', to: 'agreed', by: 'architect' });
    apply(dir, { card: 'E1-1', from: 'agreed', to: 'in-progress', by: 'motor', payload: { lease_until: future() } });
    const card = loadCard(dir, 'E1-1');
    const tampered = { ...card.meta, status: 'accepted' };
    fs.writeFileSync(card.file, renderCardText(tampered, card.body));
    const result = replay(dir);
    assert.equal(result.repaired.length, 1);
    assert.equal(loadCard(dir, 'E1-1').meta.status, 'in-progress');
    assert.ok(readJournal(dir).some((event) => event.kind === 'repair'));
  } finally { cleanup(dir); }
});

test('журнал append-only: события только добавляются, порядок сохраняется', () => {
  const dir = board();
  try {
    createEpic(dir, { id: 'E1', title: 'эпик' });
    apply(dir, { card: 'E1', from: 'draft', to: 'agreeing', by: 'architect' });
    const first = readJournal(dir);
    apply(dir, { card: 'E1', from: 'agreeing', to: 'needs-decision', by: 'motor' });
    const second = readJournal(dir);
    assert.equal(second.length, first.length + 1);
    assert.equal(second[0].kind, 'transition');
    assert.equal(second[1].kind, 'transition');
  } finally { cleanup(dir); }
});

test('создание карточек без явного id — системный UUID', () => {
  const dir = board();
  try {
    const epic = createEpic(dir, { title: 'эпик' });
    assert.match(epic.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const task = createTask(dir, { epic: epic.id, title: 'наряд', workspace: 'tv2' });
    assert.match(task.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(task.epic, epic.id);
    assert.equal(task.title, 'наряд');
    assert.equal(loadCard(dir, task.id).meta.epic, epic.id);
  } finally { cleanup(dir); }
});

test('createEpic требует название, createTask — эпик', () => {
  const dir = board();
  try {
    assert.throws(() => createEpic(dir, {}), /название/);
    assert.throws(() => createTask(dir, { title: 'наряд', workspace: 'tv2' }), /эпик/);
  } finally { cleanup(dir); }
});

test('createEpic сохраняет Результат эпика', () => {
  const dir = board();
  try {
    const result = 'Результат: заказ проходит от создания до оплаты';
    const epic = createEpic(dir, { title: 'эпик', result });
    assert.equal(epic.result, result);
    assert.equal(loadCard(dir, epic.id).meta.result, result);
  } finally { cleanup(dir); }
});

test('createTask сохраняет спеку работы', () => {
  const dir = board();
  try {
    const spec = 'Сделай X; на выходе Y';
    const epic = createEpic(dir, { id: 'E1', title: 'эпик' });
    const task = createTask(dir, { epic: epic.id, title: 'наряд', workspace: 'tv2', spec });
    assert.equal(task.spec, spec);
    assert.equal(loadCard(dir, task.id).meta.spec, spec);
  } finally { cleanup(dir); }
});

test('sweep: цикл blocked_by → оба наряда в needs-decision', () => {
  const dir = board();
  try {
    const epic = createEpic(dir, { id: 'E1', title: 'эпик', result: 'R' });
    createTask(dir, { id: 'A', epic: epic.id, title: 'A', workspace: 'tv2', blocked_by: ['B'] });
    createTask(dir, { id: 'B', epic: epic.id, title: 'B', workspace: 'tv2', blocked_by: ['A'] });
    const result = sweep(dir, { now: new Date() });
    assert.equal(result.failed.length, 0);
    assert.equal(loadCard(dir, 'A').meta.status, 'needs-decision');
    assert.equal(loadCard(dir, 'B').meta.status, 'needs-decision');
  } finally { cleanup(dir); }
});

test('sweep: линейный blocked_by без цикла не меняет статусы', () => {
  const dir = board();
  try {
    const epic = createEpic(dir, { id: 'E1', title: 'эпик', result: 'R' });
    createTask(dir, { id: 'A', epic: epic.id, title: 'A', workspace: 'tv2', blocked_by: ['B'] });
    createTask(dir, { id: 'B', epic: epic.id, title: 'B', workspace: 'tv2' });
    sweep(dir, { now: new Date() });
    assert.equal(loadCard(dir, 'A').meta.status, 'proposed');
    assert.equal(loadCard(dir, 'B').meta.status, 'proposed');
  } finally { cleanup(dir); }
});
