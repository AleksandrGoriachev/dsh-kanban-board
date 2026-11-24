import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKanbanRuntime, createWebHandler } from '../../../../lib/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ui-'));
const realmFile = path.join(root, 'realm.json');
const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
const handler = createWebHandler(runtime);
function req(method, url, body) {
  return new Promise((resolve) => {
    const out = {
      statusCode: 0, text: '', setHeader() {},
      end(text) { this.text = String(text || ''); let json = {}; try { json = JSON.parse(this.text); } catch { json = {}; } resolve({ status: this.statusCode, json }); },
    };
    const listeners = {};
    const request = { method, url, socket: { remoteAddress: '127.0.0.1' }, on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); } };
    if (body !== undefined) setTimeout(() => { for (const fn of listeners.data || []) fn(Buffer.from(JSON.stringify(body))); for (const fn of listeners.end || []) fn(); }, 0);
    handler(request, out);
  });
}
try {
  await req('POST', '/kanban/api/realm', { confirm: true, architect: { root }, workspaces: [] });
  const epic = await req('POST', '/kanban/api/epic', { confirm: true, title: 'эпик', result: 'R' });
  const task = await req('POST', '/kanban/api/task', { confirm: true, epic: epic.json.epic.id, title: 'наряд', workspace: 'tv2', spec: 'S' });
  const card = await req('GET', '/kanban/api/card/' + task.json.task.id);
  if (!card.json || !card.json.card || typeof card.json.card.body !== 'string' || !Array.isArray(card.json.journal)) {
    console.error('FAIL ui-details: /api/card/:id не отдаёт карточку с телом и журналом (status ' + card.status + ')');
    process.exit(1);
  }
  const client = fs.readFileSync(path.join(here, '..', '..', '..', '..', 'lib', 'client.js'), 'utf8');
  for (const marker of ['cardDetails', 'onDragStart', 'journalFor']) {
    if (!client.includes(marker)) {
      console.error('FAIL ui-details: в клиенте нет ' + marker);
      process.exit(1);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', '..', 'package.json'), 'utf8'));
  const atLeast = (a, b) => { const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0; const y = pb[i] || 0; if (x !== y) return x > y; } return true; };
  if (!atLeast(pkg.version, '0.3.0')) {
    console.error('FAIL ui-details: версия ниже 0.3.0, сейчас ' + pkg.version);
    process.exit(1);
  }
  console.log('OK ui-details: /api/card/:id, панель деталей, drag&drop, журнал; версия 0.3.0');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
