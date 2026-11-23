import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKanbanRuntime, createWebHandler } from '../../../../lib/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const fails = [];

// C1a: API сохраняет реалм с воркспейсом, у которого id содержит пробел (TV Kanban)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-realm-'));
const runtime = createKanbanRuntime({ realm: path.join(tmp, 'realm.json'), boardDir: 'board' });
const handler = createWebHandler(runtime);
function req(method, url, body) {
  return new Promise((resolve) => {
    const out = { statusCode: 0, text: '', setHeader() {}, end(text) { this.text = String(text || ''); let json = {}; try { json = JSON.parse(this.text); } catch { json = {}; } resolve({ status: this.statusCode, json }); } };
    const listeners = {};
    const request = { method, url, socket: { remoteAddress: '127.0.0.1' }, on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); } };
    if (body !== undefined) setTimeout(() => { for (const fn of listeners.data || []) fn(Buffer.from(JSON.stringify(body))); for (const fn of listeners.end || []) fn(); }, 0);
    handler(request, out);
  });
}
try {
  const post = await req('POST', '/kanban/api/realm', { confirm: true, architect: { root: path.join(tmp, 'arch') }, workspaces: [{ id: 'TV Kanban', root: path.join(tmp, 'TV Kanban') }] });
  if (!post.json || post.json.ok !== true) fails.push('POST /api/realm не ok: ' + post.status + ' ' + JSON.stringify(post.json).slice(0, 200));
  const get = await req('GET', '/kanban/api/realm');
  const ids = (get.json.realm && Array.isArray(get.json.realm.workspaces)) ? get.json.realm.workspaces.map((w) => w.id) : [];
  if (get.json.configured !== true) fails.push('GET /api/realm: configured != true');
  if (!ids.includes('TV Kanban')) fails.push('GET /api/realm: нет воркспейса TV Kanban, есть ' + JSON.stringify(ids));

  // C1b: клиент сбрасывает saving в finally, а не только в catch
  const client = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');
  const formStart = client.indexOf('function RealmForm');
  const formEnd = client.indexOf('function EpicForm');
  const form = (formStart >= 0 && formEnd > formStart) ? client.slice(formStart, formEnd) : '';
  if (!form) fails.push('клиент: не найден RealmForm');
  else {
    if (!/finallys*{[sS]{0,200}?setSaving(false)/.test(form)) fails.push('клиент: RealmForm.save не сбрасывает setSaving(false) в finally — кнопка зависает на «Сохраняю…»');
    if (!/setSaving(true)/.test(form)) fails.push('клиент: RealmForm.save не ставит setSaving(true)');
  }
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
if (fails.length) { console.error('FAIL realm-save: ' + fails.join('; ')); process.exit(1); }
console.log('OK realm-save: API сохраняет TV Kanban, клиент сбрасывает saving в finally');
