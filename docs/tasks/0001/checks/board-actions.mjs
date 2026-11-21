/**
 * checks/0001-board-actions.mjs — приёмочная проверка задания 0001:
 * доска позволяет создать эпик и наряд и перевести карточку.
 * На базе (без маршрутов /api/epic|task|transition) падает — это доказанный красный.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKanbanRuntime, createWebHandler } from '../../../lib/api.js';
import { loadCard } from '../../../lib/board.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-check-'));
try {
  const realmFile = path.join(root, 'realm.json');
  const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
  const handler = createWebHandler(runtime);

  function req(method, url, body) {
    return new Promise((resolve) => {
      const headers = {};
      const out = {
        statusCode: 0,
        text: '',
        setHeader(key, value) { headers[key] = value; },
        end(text) {
          this.text = String(text || '');
          let json = {};
          try { json = JSON.parse(this.text); } catch { json = {}; }
          resolve({ status: this.statusCode, json });
        },
      };
      const listeners = {};
      const request = {
        method, url, socket: { remoteAddress: '127.0.0.1' },
        on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
      };
      if (body !== undefined) {
        setTimeout(() => {
          for (const fn of listeners.data || []) fn(Buffer.from(JSON.stringify(body)));
          for (const fn of listeners.end || []) fn();
        }, 0);
      }
      handler(request, out);
    });
  }

  const realm = await req('POST', '/kanban/api/realm', { confirm: true, architect: { root }, workspaces: [] });
  assert.equal(realm.status, 200, 'realm route');

  const epic = await req('POST', '/kanban/api/epic', { confirm: true, id: 'E1', title: 'проверка', involved: ['tv2'] });
  if (epic.status !== 200) {
    console.error('FAIL board-actions: epic create route returned ' + epic.status + ' (' + (epic.json && (epic.json.error || epic.json.code)) + ')');
    process.exit(1);
  }

  const board = await req('GET', '/kanban/api/board');
  assert.equal(board.json.epics.length, 1, 'epic listed');
  assert.deepEqual(board.json.epics[0].allowed, ['agreeing'], 'architect action listed');

  const move = await req('POST', '/kanban/api/transition', { confirm: true, card: 'E1', from: 'draft', to: 'agreeing', by: 'architect', revision: 1 });
  if (move.status !== 200) {
    console.error('FAIL board-actions: transition route returned ' + move.status);
    process.exit(1);
  }
  assert.equal(loadCard(runtime.boardDir, 'E1').meta.status, 'agreeing', 'epic moved');

  const task = await req('POST', '/kanban/api/task', { confirm: true, id: 'E1-1', epic: 'E1', workspace: 'tv2' });
  if (task.status !== 200) {
    console.error('FAIL board-actions: task create route returned ' + task.status);
    process.exit(1);
  }
  console.log('OK board-actions: эпик, наряд созданы, переход draft→agreeing применён');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
