import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const { createEpic, createTask, apply, loadCard, allowedTransitions, sweep, writeCard } = await import('../../../../lib/board.js');

const fails = [];
const fail = (m) => fails.push(m);
const guard = (label, fn) => { try { fn(); } catch (e) { fail(label + ': ' + String(e && e.message ? e.message : e)); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-0030-'));
const lease = () => new Date(Date.now() + 600000).toISOString();
const move = (card, from, to, by, extra) => { const r = apply(tmp, Object.assign({ card, from, to, by }, extra || {})); if (!r || r.ok !== true) throw new Error(from + '->' + to + ': ' + JSON.stringify(r)); return r; };

try {
  // K1: вердикт архитектора выражается из needs-decision.
  const allowed = allowedTransitions('epic', 'needs-decision', 'architect').map((t) => t.to || t);
  for (const target of ['agreeing', 'decomposed', 'accepted', 'done']) {
    if (!allowed.includes(target)) fail('K1: из needs-decision нет перехода в ' + target + ' (есть: ' + allowed.join(',') + ')');
  }

  // K2: наш случай — needs-decision -> accepted -> done.
  guard('K2', () => {
  const e1 = createEpic(tmp, { title: 'E1', result: 'R1' });
  move(e1.id, 'draft', 'agreeing', 'architect');
  move(e1.id, 'agreeing', 'needs-decision', 'motor', { payload: { reason: 'таймаут согласования' } });
  if (loadCard(tmp, e1.id).meta.status !== 'needs-decision') fail('K2: подготовка не дала needs-decision');
  move(e1.id, 'needs-decision', 'accepted', 'architect');
  move(e1.id, 'accepted', 'done', 'architect');
  if (loadCard(tmp, e1.id).meta.status !== 'done') fail('K2: needs-decision -> accepted -> done не закрывает эпик');
  });

  // K3: авто-переход in-progress -> accepted, когда все наряды accepted.
  guard('K3', () => {
  const e2 = createEpic(tmp, { title: 'E2', result: 'R2' });
  move(e2.id, 'draft', 'agreeing', 'architect');
  move(e2.id, 'agreeing', 'agreed', 'motor');
  move(e2.id, 'agreed', 'decomposed', 'architect');
  move(e2.id, 'decomposed', 'in-progress', 'motor');
  const t1 = createTask(tmp, { title: 'T1', epic: e2.id, workspace: 'w', spec: 'S1' });
  const t2 = createTask(tmp, { title: 'T2', epic: e2.id, workspace: 'w', spec: 'S2' });
  for (const t of [t1, t2]) {
    move(t.id, 'proposed', 'agreed', 'motor');
    move(t.id, 'agreed', 'in-progress', 'motor', { payload: { owner: 'w', lease_until: lease() } });
    move(t.id, 'in-progress', 'integration', 'motor', { payload: { evidence: ['e'] } });
  }
  move(t1.id, 'integration', 'accepted', 'architect');
  const beforeSweep = sweep(tmp, { now: new Date() });
  if (loadCard(tmp, e2.id).meta.status === 'accepted') fail('K3: эпик принят, хотя один наряд не принят');
  move(t2.id, 'integration', 'accepted', 'architect');
  sweep(tmp, { now: new Date() });
  const e2meta = loadCard(tmp, e2.id).meta;
  if (e2meta.status !== 'accepted') fail('K3: все наряды accepted, а эпик в ' + e2meta.status);
  move(e2.id, 'accepted', 'done', 'architect');
  if (loadCard(tmp, e2.id).meta.status !== 'done') fail('K3: эпик не закрылся после accepted');
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const atLeast = (a, b) => { const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0; const y = pb[i] || 0; if (x !== y) return x > y; } return true; };
if (!atLeast(pkg.version, '0.4.12')) fail('версия ниже 0.4.12: ' + pkg.version);
if (fails.length) { console.error('FAIL epic-lifecycle: ' + fails.join('; ')); process.exit(1); }
console.log('OK epic-lifecycle: вердикт из needs-decision, авто-accepted по нарядам; 0.4.12');
