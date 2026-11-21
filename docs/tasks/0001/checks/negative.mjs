/**
 * checks/0001-negative.mjs — негативный случай задания 0001:
 * недопустимый переход архитектора отклоняется 400 с кодом invalid-transition.
 * На базе (без маршрута /api/transition) падает — доказанный красный.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKanbanRuntime, createWebHandler } from '../../../lib/api.js';
import { createEpic } from '../../../lib/board.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-neg-'));
try {
  const boardDir = path.join(root, 'board');
  createEpic(boardDir, { id: 'E1', title: 'x', involved: [] });
  const runtime = createKanbanRuntime({ realm: path.join(root, 'realm.json'), boardDir: 'board' });
  const handler = createWebHandler(runtime);

  function req(method, url, body) {
    return new Promise((resolve) => {
      const out = {
        statusCode: 0, text: '',
        setHeader() {},
        end(text) { this.text = String(text || ''); let json = {}; try { json = JSON.parse(this.text); } catch { json = {}; } resolve({ status: this.statusCode, json }); },
      };
      const listeners = {};
      const request = { method, url, socket: { remoteAddress: '127.0.0.1' }, on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); } };
      if (body !== undefined) setTimeout(() => { for (const fn of listeners.data || []) fn(Buffer.from(JSON.stringify(body))); for (const fn of listeners.end || []) fn(); }, 0);
      handler(request, out);
    });
  }

  await req('POST', '/kanban/api/realm', { confirm: true, architect: { root }, workspaces: [] });
  const bad = await req('POST', '/kanban/api/transition', { confirm: true, card: 'E1', from: 'draft', to: 'done', by: 'architect' });
  if (bad.status !== 400) {
    console.error('FAIL board-actions-negative: transition route returned ' + bad.status + ' (ожидался 400)');
    process.exit(1);
  }
  assert.equal(bad.json.code, 'invalid-transition');
  console.log('OK board-actions-negative: недопустимый переход отклонён 400 invalid-transition');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
