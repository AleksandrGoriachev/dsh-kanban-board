/**
 * test/api.test.mjs — маршруты панели и проверка/установка зависимостей.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKanbanRuntime, createWebHandler, ensureDependencies } from '../lib/api.js';
import { createEpic, createTask, loadCard } from '../lib/board.js';
import { parseLetter } from '../lib/letters.js';

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
    createTask(boardDir, { id: 'E1-1', title: 'наряд', epic: 'E1', workspace: 'console' });
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

test('GET /kanban/api/workspaces отдаёт зарегистрированные воркспейсы', async () => {
  const root = tmp('kanban-realm-');
  try {
    const runtime = createKanbanRuntime(
      { realm: path.join(root, 'realm.json'), boardDir: 'board' },
      { listWorkspaces: () => [{ path: root, title: 'arch' }] },
    );
    const result = await call(createWebHandler(runtime), 'GET', '/kanban/api/workspaces');
    assert.equal(result.status, 200);
    assert.equal(result.json.workspaces.length, 1);
    assert.equal(result.json.workspaces[0].path, root);
  } finally { cleanup(root); }
});

test('GET /kanban/api/realm до настройки → configured false', async () => {
  const root = tmp('kanban-realm-');
  try {
    const runtime = createKanbanRuntime({ realm: path.join(root, 'realm.json'), boardDir: 'board' });
    const result = await call(createWebHandler(runtime), 'GET', '/kanban/api/realm');
    assert.equal(result.status, 200);
    assert.equal(result.json.configured, false);
  } finally { cleanup(root); }
});

test('POST /kanban/api/realm сохраняет реалм из меню и включает доску', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = path.join(root, 'realm.json');
    const sub = path.join(root, 'sub');
    const runtime = createKanbanRuntime(
      { realm: realmFile, boardDir: 'board' },
      { listWorkspaces: () => [{ path: root, title: 'arch' }, { path: sub, title: 'sub' }] },
    );
    const handler = createWebHandler(runtime);
    const result = await call(handler, 'POST', '/kanban/api/realm', {
      confirm: true,
      architect: { root },
      workspaces: [{ root: sub }],
    });
    assert.equal(result.status, 200);
    assert.equal(result.json.realm.architect.root, root);
    assert.equal(result.json.realm.workspaces[0].exchange, path.join(sub, 'coordination'));
    assert.equal(runtime.boardDir, path.join(root, 'board'));
    assert.ok(fs.existsSync(realmFile));
    const status = await call(handler, 'GET', '/kanban/api/status');
    assert.equal(status.json.realm.configured, true);
  } finally { cleanup(root); }
});

test('apply регистрирует /kanban на webServer', async () => {
  const root = tmp('kanban-realm-');
  try {
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
    const runtime = apply(ctx, { realm: path.join(root, 'realm.json'), boardDir: 'board', dependencies: [] });
    assert.equal(runtime.boardDir, '');
    assert.equal(registered.length, 1);
    assert.equal(registered[0].kind, 'prefix');
    assert.equal(registered[0].path, '/kanban');
    assert.equal(typeof registered[0].handler, 'function');
  } finally { cleanup(root); }
});

test('POST /api/epic создаёт эпик, /api/board отдаёт допустимые переходы', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = path.join(root, 'realm.json');
    const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
    const handler = createWebHandler(runtime);
    await call(handler, 'POST', '/kanban/api/realm', { confirm: true, architect: { root }, workspaces: [] });
    const created = await call(handler, 'POST', '/kanban/api/epic', { confirm: true, id: 'E1', title: 'эпик', involved: ['tv2'] });
    assert.equal(created.status, 200);
    assert.equal(created.json.epic.status, 'draft');
    const boardResp = await call(handler, 'GET', '/kanban/api/board');
    assert.equal(boardResp.json.epics.length, 1);
    assert.deepEqual(boardResp.json.epics[0].allowed, ['agreeing']);
  } finally { cleanup(root); }
});

test('POST /api/transition двигает эпик draft → agreeing и отклоняет недопустимый', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = path.join(root, 'realm.json');
    const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
    const handler = createWebHandler(runtime);
    await call(handler, 'POST', '/kanban/api/realm', { confirm: true, architect: { root }, workspaces: [] });
    await call(handler, 'POST', '/kanban/api/epic', { confirm: true, id: 'E1', title: 'эпик', involved: [] });
    const move = await call(handler, 'POST', '/kanban/api/transition', { confirm: true, card: 'E1', from: 'draft', to: 'agreeing', by: 'architect', revision: 1 });
    assert.equal(move.status, 200);
    assert.equal(move.json.ok, true);
    assert.equal(loadCard(runtime.boardDir, 'E1').meta.status, 'agreeing');
    const invalid = await call(handler, 'POST', '/kanban/api/transition', { confirm: true, card: 'E1', from: 'agreeing', to: 'done', by: 'architect' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.code, 'invalid-transition');
  } finally { cleanup(root); }
});

test('POST /api/task создаёт наряд под эпиком', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = path.join(root, 'realm.json');
    const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
    const handler = createWebHandler(runtime);
    await call(handler, 'POST', '/kanban/api/realm', { confirm: true, architect: { root }, workspaces: [] });
    await call(handler, 'POST', '/kanban/api/epic', { confirm: true, id: 'E1', title: 'эпик', involved: [] });
    const task = await call(handler, 'POST', '/kanban/api/task', { confirm: true, id: 'E1-1', title: 'наряд', epic: 'E1', workspace: 'tv2' });
    assert.equal(task.status, 200);
    assert.equal(task.json.task.status, 'proposed');
    const boardResp = await call(handler, 'GET', '/kanban/api/board');
    assert.equal(boardResp.json.tasks.length, 1);
  } finally { cleanup(root); }
});

test('GET /api/card/<id> отдаёт карточку с телом и журналом; неизвестный id → 404', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = path.join(root, 'realm.json');
    const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
    const handler = createWebHandler(runtime);
    await call(handler, 'POST', '/kanban/api/realm', { confirm: true, architect: { root }, workspaces: [] });
    await call(handler, 'POST', '/kanban/api/epic', { confirm: true, id: 'E1', title: 'эпик', result: 'R' });
    const task = await call(handler, 'POST', '/kanban/api/task', { confirm: true, id: 'E1-1', title: 'наряд', epic: 'E1', workspace: 'tv2', spec: 'S' });
    assert.equal(task.status, 200);
    const card = await call(handler, 'GET', '/kanban/api/card/E1-1');
    assert.equal(card.status, 200);
    assert.equal(card.json.ok, true);
    assert.equal(card.json.card.meta.id, 'E1-1');
    assert.equal(card.json.card.meta.spec, 'S');
    assert.equal(typeof card.json.card.body, 'string');
    assert.ok(Array.isArray(card.json.journal));
    assert.equal(card.json.journal.length, 0);
    await call(handler, 'POST', '/kanban/api/transition', { confirm: true, card: 'E1-1', from: 'proposed', to: 'agreed', by: 'architect' });
    const after = await call(handler, 'GET', '/kanban/api/card/E1-1');
    assert.equal(after.json.journal.length, 1);
    assert.ok(after.json.journal.every((event) => event.card === 'E1-1'));
    const missing = await call(handler, 'GET', '/kanban/api/card/no-such-card');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.code, 'unknown-card');
  } finally { cleanup(root); }
});

test('POST /api/task: title доезжает до карточки, без title → 400 invalid-task', async () => {
  const root = tmp('kanban-realm-');
  try {
    const realmFile = path.join(root, 'realm.json');
    const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
    const handler = createWebHandler(runtime);
    await call(handler, 'POST', '/kanban/api/realm', { confirm: true, architect: { root }, workspaces: [] });
    await call(handler, 'POST', '/kanban/api/epic', { confirm: true, id: 'E1', title: 'эпик', involved: [] });
    const withTitle = await call(handler, 'POST', '/kanban/api/task', {
      confirm: true, epic: 'E1', workspace: 'tv2', title: 'наряд с заголовком', session: 'session-1',
    });
    assert.equal(withTitle.status, 200);
    assert.equal(withTitle.json.task.title, 'наряд с заголовком');
    assert.equal(loadCard(runtime.boardDir, withTitle.json.task.id).meta.title, 'наряд с заголовком');
    const withoutTitle = await call(handler, 'POST', '/kanban/api/task', { confirm: true, epic: 'E1', workspace: 'tv2' });
    assert.equal(withoutTitle.status, 400);
    assert.equal(withoutTitle.json.code, 'invalid-task');
    assert.throws(() => createTask(runtime.boardDir, { epic: 'E1', workspace: 'tv2' }), /title/);
    // Письмо-оффер: ветка совпадает с каталогом, Session — из запроса, Ref — id наряда.
    const threadPath = path.join(root, 'coordination', 'threads', 'kanban-E1');
    const letters = fs.existsSync(threadPath) ? fs.readdirSync(threadPath).filter((f) => f.endsWith('.md')) : [];
    assert.equal(letters.length, 1);
    const letter = parseLetter(fs.readFileSync(path.join(threadPath, letters[0]), 'utf8'));
    assert.equal(letter.headers.Thread, 'threads/kanban-E1');
    assert.equal(letter.headers.Session, 'session-1');
    assert.equal(letter.headers.Ref, withTitle.json.task.id);
  } finally { cleanup(root); }
});
