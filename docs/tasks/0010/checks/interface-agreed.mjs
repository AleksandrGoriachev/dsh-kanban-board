import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEpic, createTask, loadCard } from '../../../../lib/board.js';
import { processLetter } from '../../../../lib/motor.js';
import { parseLetter } from '../../../../lib/letters.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ifag-'));
try {
  const epic = createEpic(root, { title: 'эпик', result: 'R' });
  const task = createTask(root, { epic: epic.id, title: 'наряд', workspace: 'tv2', spec: 'S' });
  if (task.status !== 'proposed') {
    console.error('FAIL interface-agreed: наряд не в proposed');
    process.exit(1);
  }
  const letter = parseLetter([
    'Format: dsh-exchange/1', 'From: tv2', 'To: architect',
    'Date: 2026-01-01T00:00:00.000Z', 'Status: request', 'Session: s1',
    'Subject: [interface-agreed] ' + task.id, '',
    'Payload: ' + JSON.stringify({ task: task.id, spec: 'S' }), '',
  ].join('
'));
  const result = processLetter({ boardDir: root, letter, workspace: 'tv2', file: 'i1.md' });
  if (!result.ok) {
    console.error('FAIL interface-agreed: письмо не принято: ' + (result.code || result.reason));
    process.exit(1);
  }
  const after = loadCard(root, task.id).meta.status;
  if (after !== 'agreed') {
    console.error('FAIL interface-agreed: наряд не переведён в agreed (' + after + ')');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', '..', 'package.json'), 'utf8'));
  if (pkg.version !== '0.1.9') {
    console.error('FAIL interface-agreed: ожидалась версия 0.1.9, сейчас ' + pkg.version);
    process.exit(1);
  }
  console.log('OK interface-agreed: наряд proposed→agreed по письму; версия 0.1.9');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
