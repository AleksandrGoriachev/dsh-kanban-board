/**
 * test/api.test.mjs — маршруты панели и проверка/установка зависимостей.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKanbanRuntime, createWebHandler, ensureDependencies } from '../lib/api.js';
import { createEpic, createTask } from '../lib/board.js';

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function cleanup(dir) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; }
    catch { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); } catch { /* ignore */ } }
  }
}
function mockRes() {
  return {
    statusCode: 0, headers: {}, body: '',
    setHeader(key, value) { this.headers[key] = value; },
    end(text) { this.body = String(text || ''); },
  };
}
function mockReq(method, url, bodyObj, address = '127.0.0.1') {
  const handlers = {};
  const req = {
    method, url, socket: { remoteAddress: address },
    on(event, fn) { (handlers[event] = handlers[event] || []).push(fn); },
  };
  if (bodyObj !== undefined) {
    setTimeout(() => {
      for (const fn of handlers.data || []) fn(Buffer.from(JSON.stringify(bodyObj)));
      for (const fn of handlers.end || []) fn();
    }, 0);
  }
  return req;
}
function makeRealm(root, workspaces = []) {
  const realm = { version: 1, architect: { root, exchange: path.join(root, 'exchange') }, workspaces };
  const file = path.join(root, 'realm.json');
  fs.writeFileSync(file, JSON.stringify(realm));
  return file;
}
async function call(handler, method, url, body, address) {
  const res = mockRes();
  await handler(mockReq(method, url, body, address), res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

test('GET /kanban/api/board отдаёт эпики, наряды и журнал', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = makeRealm(root);
    const boardDir = path.join(root, 'board');
    createEpic(boardDir, { id: 'E1', title: 'эпик', involved: [] });
    createTask(boardDir, { id: 'E1-1', epic: 'E1', workspace: 'console' });
    const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
    const handler = createWebHandler(runtime);
    const result = await call(handler, 'GET', '/kanban/api/board');
    assert.equal(result.status, 200);
    assert.equal(result.json.epics.length, 1);
    assert.equal(result.json.tasks.length, 1);
    assert.equal(result.json.journal.count, 0);
  } finally { cleanup(root); }
});

test('GET /kanban/api/status: реалм и зависимость установлена', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = makeRealm(root);
    const runtime = createKanbanRuntime(
      { realm: realmFile, boardDir: 'board', dependencies: [{ id: 'dsh-project-graph', installSpec: 'https://example/dpg.tgz' }] },
      { getPluginManager: () => ({ listBundles: async () => ['dsh-project-graph'] }) },
    );
    const result = await call(createWebHandler(runtime), 'GET', '/kanban/api/status');
    assert.equal(result.status, 200);
    assert.equal(result.json.realm.configured, true);
    assert.equal(result.json.dependencies[0].installed, true);
  } finally { cleanup(root); }
});

test('POST /kanban/api/sweep без confirm → 400', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = makeRealm(root);
    const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
    const result = await call(createWebHandler(runtime), 'POST', '/kanban/api/sweep', {});
    assert.equal(result.status, 400);
    assert.equal(result.json.code, 'confirm-required');
  } finally { cleanup(root); }
});

test('POST /kanban/api/deps/install вызывает installBundle', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = makeRealm(root);
    const calls = [];
    const runtime = createKanbanRuntime(
      { realm: realmFile, boardDir: 'board', dependencies: [{ id: 'dsh-project-graph', installSpec: 'https://example/dpg.tgz' }] },
      { getPluginManager: () => ({ installBundle: async (spec) => { calls.push(spec); return { status: 'applied' }; } }) },
    );
    const result = await call(createWebHandler(runtime), 'POST', '/kanban/api/deps/install', { confirm: true, id: 'dsh-project-graph' });
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    assert.deepEqual(calls, ['https://example/dpg.tgz']);
  } finally { cleanup(root); }
});

test('не-loopback запрос → 403', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = makeRealm(root);
    const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
    const result = await call(createWebHandler(runtime), 'GET', '/kanban/api/status', undefined, '10.1.2.3');
    assert.equal(result.status, 403);
  } finally { cleanup(root); }
});

test('путь вне /kanban → 404', async () => {
  const root = tmp('kanban-realm-');
  try {
    const runtime = createKanbanRuntime({ realm: makeRealm(root), boardDir: 'board' });
    const result = await call(createWebHandler(runtime), 'GET', '/other/api/status');
    assert.equal(result.status, 404);
  } finally { cleanup(root); }
});

test('ensureDependencies ставит недостающую зависимость', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = makeRealm(root);
    const calls = [];
    const installed = [];
    const runtime = createKanbanRuntime(
      { realm: realmFile, boardDir: 'board', dependencies: [{ id: 'dsh-project-graph', installSpec: 'https://example/dpg.tgz' }] },
      { getPluginManager: () => ({
        listBundles: async () => installed.slice(),
        installBundle: async (spec) => { calls.push(spec); installed.push('dsh-project-graph'); return { status: 'applied' }; },
      }) },
    );
    const result = await ensureDependencies(runtime);
    assert.deepEqual(result.installedNow, ['dsh-project-graph']);
    assert.deepEqual(calls, ['https://example/dpg.tgz']);
    const second = await ensureDependencies(runtime);
    assert.deepEqual(second.installedNow, []);
  } finally { cleanup(root); }
});

test('apply регистрирует /kanban на webServer', async () => {
  const registered = [];
  const ctx = {
    get: () => null,
    inject: (services, callback) => callback({
      webServer: { register: (route) => registered.push(route) },
      effect: (fn) => fn(),
    }),
    effect: (fn) => fn(),
  };
  const { apply } = await import('../lib/index.js');
  const runtime = apply(ctx, { realm: '', boardDir: 'board', dependencies: [] });
  assert.equal(runtime.boardDir, '');
  assert.equal(registered.length, 1);
  assert.equal(registered[0].kind, 'prefix');
  assert.equal(registered[0].path, '/kanban');
  assert.equal(typeof registered[0].handler, 'function');
});
