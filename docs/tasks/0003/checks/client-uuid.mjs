/**
 * checks/client-uuid.mjs — приёмочная проверка задания 0003:
 * идентификаторы эпика/наряда генерирует система (UUID), пользователь их не вводит;
 * протокол это описывает. На базе createEpic без id падает — доказанный красный.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEpic, createTask } from '../../../../lib/board.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-uuid-'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
try {
  let epic;
  try {
    epic = createEpic(root, { title: 'эпик' });
  } catch (error) {
    console.error('FAIL client-uuid: id эпика не системный: ' + String(error && error.message ? error.message : error));
    process.exit(1);
  }
  if (!UUID.test(epic.id)) { console.error('FAIL client-uuid: id эпика не UUID: ' + epic.id); process.exit(1); }
  let task;
  try {
    task = createTask(root, { epic: epic.id, title: 'наряд', workspace: 'tv2' });
  } catch (error) {
    console.error('FAIL client-uuid: id наряда не системный: ' + String(error && error.message ? error.message : error));
    process.exit(1);
  }
  if (!UUID.test(task.id)) { console.error('FAIL client-uuid: id наряда не UUID: ' + task.id); process.exit(1); }
  if (task.epic !== epic.id) { console.error('FAIL client-uuid: наряд не привязан к эпику'); process.exit(1); }
  const client = fs.readFileSync(path.join(here, '..', '..', '..', '..', 'lib', 'client.js'), 'utf8');
  if (client.includes("'id (E1)'") || client.includes("'id (E1-1)'")) {
    console.error('FAIL client-uuid: в форме остался ручной ввод id');
    process.exit(1);
  }
  const protocol = fs.readFileSync(path.join(here, '..', '..', '..', '..', 'docs', 'PROTOCOL.md'), 'utf8');
  if (!protocol.includes('системный UUID')) {
    console.error('FAIL client-uuid: протокол не описывает системный UUID');
    process.exit(1);
  }
  console.log('OK client-uuid: id — системный UUID, ручного ввода в форме нет, протокол обновлён');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
