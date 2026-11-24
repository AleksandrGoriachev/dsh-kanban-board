import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const fails = [];
const fail = (m) => fails.push(m);
if (!fs.existsSync(path.join(root, 'lib', 'motor.js'))) fail('нет lib/motor.js');
const board = await import('../../../../lib/board.js');
const motor = await import('../../../../lib/motor.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-0027-'));
const mk = (marker, cardId, extra) => ({ marker, From: 'architect', To: 'x', Subject: '[' + marker + '] ' + cardId, body: 'Payload: ' + JSON.stringify(Object.assign({ card: cardId }, extra || {})) });
const guard = (label, fn) => { try { fn(); } catch (e) { fail(label + ': бросил ' + String(e && e.message ? e.message : e)); } };
const toInProgress = (id) => {
  const a = board.apply(tmp, { card: id, from: 'proposed', to: 'agreed', by: 'motor' });
  if (!a || a.ok !== true) throw new Error('proposed->agreed ' + JSON.stringify(a));
  const b = board.apply(tmp, { card: id, from: 'agreed', to: 'in-progress', by: 'motor', payload: { owner: 'w', lease_until: new Date(Date.now() + 600000).toISOString() } });
  if (!b || b.ok !== true) throw new Error('agreed->in-progress ' + JSON.stringify(b));
};
try {
  const epic = board.createEpic(tmp, { title: 'E', result: 'R' });

  // К1: legacy-карточка без subtasks — точные значения {done:0,total:0}, не только typeof.
  guard('К1 legacy', () => {
    const t = board.createTask(tmp, { title: 'L', epic: epic.id, workspace: 'w', spec: 'S' });
    toInProgress(t.id);
    const loaded = board.loadCard(tmp, t.id);
    const meta = { ...loaded.meta };
    delete meta.subtasks;
    board.writeCard(tmp, { kind: 'task', meta, body: loaded.body });
    const res = motor.processLetter({ boardDir: tmp, letter: mk('subtask-done', t.id), workspace: 'w', file: 'l.md' });
    if (!res || res.ok !== true) fail('К1: [subtask-done] отклонён: ' + JSON.stringify(res));
    const s = board.loadCard(tmp, t.id).meta.subtasks;
    if (!s || s.done !== 0 || s.total !== 0) fail('К1: ожидалось {done:0,total:0}, получено ' + JSON.stringify(s));
  });

  // К2 (M5): approve -> done без нового плана — approved обязан сохраниться.
  guard('К2 M5', () => {
    const t = board.createTask(tmp, { title: 'A', epic: epic.id, workspace: 'w', spec: 'S' });
    toInProgress(t.id);
    const a1 = motor.processLetter({ boardDir: tmp, letter: mk('subtask-approved', t.id), workspace: 'w', file: 'a1.md' });
    if (!a1 || a1.ok !== true) fail('К2: вердикт не принят: ' + JSON.stringify(a1));
    const p1 = motor.processLetter({ boardDir: tmp, letter: mk('subtask-plan', t.id, { total: 2 }), workspace: 'w', file: 'a2.md' });
    if (!p1 || p1.ok !== true) fail('К2: план не принят: ' + JSON.stringify(p1));
    const a2 = motor.processLetter({ boardDir: tmp, letter: mk('subtask-approved', t.id), workspace: 'w', file: 'a3.md' });
    if (!a2 || a2.ok !== true) fail('К2: повторный вердикт не принят: ' + JSON.stringify(a2));
    const d = motor.processLetter({ boardDir: tmp, letter: mk('subtask-done', t.id), workspace: 'w', file: 'a4.md' });
    if (!d || d.ok !== true) fail('К2: [subtask-done] не принят: ' + JSON.stringify(d));
    const s = board.loadCard(tmp, t.id).meta.subtasks;
    if (!s || s.approved !== true) fail('К2: [subtask-done] стёр approved');
    if (!s || s.done !== 1 || s.total !== 2) fail('К2: счётчик неверен: ' + JSON.stringify(s));
  });

  // К3: новый план аннулирует вердикт.
  guard('К3 план', () => {
    const t = board.createTask(tmp, { title: 'P', epic: epic.id, workspace: 'w', spec: 'S' });
    toInProgress(t.id);
    motor.processLetter({ boardDir: tmp, letter: mk('subtask-approved', t.id), workspace: 'w', file: 'p1.md' });
    motor.processLetter({ boardDir: tmp, letter: mk('subtask-plan', t.id, { total: 4 }), workspace: 'w', file: 'p2.md' });
    const s = board.loadCard(tmp, t.id).meta.subtasks;
    if (s.approved === true) fail('К3: новый план не аннулировал вердикт');
    if (s.total !== 4) fail('К3: total не обновлён: ' + JSON.stringify(s));
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

// Д1: PROTOCOL — нормативное утверждение, а не подстрока.
const protocol = fs.readFileSync(path.join(root, 'docs', 'PROTOCOL.md'), 'utf8');
if (/не\s+аннулирует/i.test(protocol)) fail('PROTOCOL содержит отрицание «не аннулирует»');
if (!/\[subtask-plan\][^.]{0,300}аннулирует вердикт/i.test(protocol)) fail('PROTOCOL не содержит нормативного утверждения об аннулировании вердикта');
// Д2: PROTOCOL не описывает несуществующий маркер.
if (protocol.indexOf('[subtask-rejected]') >= 0) fail('PROTOCOL упоминает [subtask-rejected], которого нет в моторе');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '0.4.9') fail('ожидалась версия 0.4.9, сейчас ' + pkg.version);
if (fails.length) { console.error('FAIL subtask-verdict: ' + fails.join('; ')); process.exit(1); }
console.log('OK subtask-verdict: точные значения, approved переживает done, план аннулирует вердикт, PROTOCOL без несуществующего маркера; 0.4.9');
