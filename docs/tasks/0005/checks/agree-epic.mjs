/**
 * checks/agree-epic.mjs — приёмочная проверка задания 0004:
 * [agree-epic] фиксирует согласие воркспейса, дубль отклоняется, когда согласны
 * все involved — эпик переходит в agreed; старт согласования выставляет agree_until.
 * На базе мотор отвечает unknown-marker — доказанный красный.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, createEpic, loadCard } from '../../../../lib/board.js';
import { processLetter } from '../../../../lib/motor.js';
import { parseLetter } from '../../../../lib/letters.js';

function letter(from, session, marker, payload) {
  return parseLetter([
    'Format: dsh-exchange/1',
    'From: ' + from,
    'To: architect',
    'Date: 2026-01-01T00:00:00.000Z',
    'Status: request',
    'Session: ' + session,
    'Subject: ' + marker + ' epic',
    '',
    'Payload: ' + JSON.stringify(payload),
    '',
  ].join('\n'));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-agree-'));
try {
  const epic = createEpic(root, { title: 'эпик', involved: ['tv2', 'px'] });
  const early = processLetter({ boardDir: root, letter: letter('tv2', 's1', '[agree-epic]', { epic: epic.id }), workspace: 'tv2', file: 'e0.md' });
  assert.equal(early.ok, false, 'согласие вне agreeing отклоняется');

  const start = apply(root, { card: epic.id, from: 'draft', to: 'agreeing', by: 'architect', agreeTimeoutMinutes: 30 });
  assert.equal(start.ok, true, 'старт согласования');
  const card = loadCard(root, epic.id);
  assert.ok(card.meta.agree_until, 'agree_until выставлен');
  const delta = Date.parse(card.meta.agree_until) - Date.parse(card.meta.created);
  assert.ok(delta > 25 * 60000 && delta < 35 * 60000, 'срок ~30 мин: ' + delta);

  const first = processLetter({ boardDir: root, letter: letter('tv2', 's1', '[agree-epic]', { epic: epic.id, contracts: ['1.0'], criteria: 'стык ок' }), workspace: 'tv2', file: 'e1.md' });
  if (!first.ok) {
    console.error('FAIL agree-epic: согласие tv2 не принято: ' + (first.code || first.reason));
    process.exit(1);
  }
  assert.equal(loadCard(root, epic.id).meta.status, 'agreeing', 'один голос — ещё согласование');
  assert.ok(loadCard(root, epic.id).meta.agreed.tv2, 'согласие записано');

  const dup = processLetter({ boardDir: root, letter: letter('tv2', 's1', '[agree-epic]', { epic: epic.id, contracts: ['1.0'], criteria: 'стык ок' }), workspace: 'tv2', file: 'e1.md' });
  assert.equal(dup.code, 'duplicate', 'повтор — duplicate');

  const second = processLetter({ boardDir: root, letter: letter('px', 's2', '[agree-epic]', { epic: epic.id }), workspace: 'px', file: 'e2.md' });
  if (!second.ok) {
    console.error('FAIL agree-epic: полное согласие не перевело эпик: ' + (second.code || second.reason));
    process.exit(1);
  }
  assert.equal(loadCard(root, epic.id).meta.status, 'agreed', 'все согласны → agreed');
  console.log('OK agree-epic: согласие фиксируется, дубль отклоняется, все согласны → agreed');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
