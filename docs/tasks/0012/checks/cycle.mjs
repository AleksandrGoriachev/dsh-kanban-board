import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEpic, createTask, loadCard, sweep, writeCard } from '../../../../lib/board.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-cycle-'));
try {
  const epic = createEpic(root, { title: 'эпик', result: 'R' });
  const a = createTask(root, { epic: epic.id, title: 'A', workspace: 'tv2', spec: 'A' });
  const b = createTask(root, { epic: epic.id, title: 'B', workspace: 'tv2', spec: 'B' });
  const aLoaded = loadCard(root, a.id);
  writeCard(root, { kind: 'task', meta: { ...aLoaded.meta, blocked_by: [b.id], revision: aLoaded.meta.revision + 1 }, body: aLoaded.body });
  const bLoaded = loadCard(root, b.id);
  writeCard(root, { kind: 'task', meta: { ...bLoaded.meta, blocked_by: [a.id], revision: bLoaded.meta.revision + 1 }, body: bLoaded.body });
  const result = sweep(root, { now: new Date() });
  const aAfter = loadCard(root, a.id).meta.status;
  const bAfter = loadCard(root, b.id).meta.status;
  if (aAfter !== 'needs-decision' || bAfter !== 'needs-decision') {
    console.error('FAIL cycle: цикл blocked_by не обнаружен (A=' + aAfter + ', B=' + bAfter + ')');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'package.json'), 'utf8'));
  if (pkg.version !== '0.2.1') {
    console.error('FAIL cycle: ожидалась версия 0.2.1, сейчас ' + pkg.version);
    process.exit(1);
  }
  console.log('OK cycle: цикл A↔B переведён в needs-decision; версия 0.2.1');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
