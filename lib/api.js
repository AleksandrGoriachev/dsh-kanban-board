/**
 * lib/api.js — маршруты панели «Канбан» и проверка/установка зависимостей.
 *
 * Чтение — board/epics, board/tasks, board/journal.jsonl. Запись — только
 * POST /kanban/api/sweep (обход обмена) и POST /kanban/api/deps/install
 * (установка зависимости через службу pluginManager); оба требуют confirm.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as board from './board.js';
import { sweepOutboxes } from './motor.js';
import { loadRealm } from './realm.js';

export const API_PREFIX = '/kanban';

export function createKanbanRuntime(config = {}, services = {}) {
  const realmPath = typeof config.realm === 'string' ? config.realm.trim() : '';
  let realm = null;
  let realmError = null;
  if (realmPath) {
    try { realm = loadRealm(realmPath); }
    catch (error) { realmError = error && error.message ? error.message : String(error); }
  }
  const architectRoot = realm && realm.architect && typeof realm.architect.root === 'string' ? realm.architect.root : '';
  const boardDir = architectRoot ? path.join(architectRoot, config.boardDir || 'board') : '';
  const dependencies = (Array.isArray(config.dependencies) ? config.dependencies : [])
    .filter((dep) => dep && typeof dep.id === 'string' && dep.id.trim())
    .map((dep) => ({
      id: dep.id.trim(),
      installSpec: typeof dep.installSpec === 'string' ? dep.installSpec.trim() : '',
      optional: dep.optional === true,
    }));
  return {
    realmPath,
    realm,
    realmError,
    boardDir,
    dependencies,
    getPluginManager: services.getPluginManager,
  };
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  if (typeof res.setHeader === 'function') res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(text);
}

function isLoopback(req) {
  const address = req && req.socket && typeof req.socket.remoteAddress === 'string' ? req.socket.remoteAddress : '';
  return address === '' || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    if (!req || typeof req.on !== 'function') { resolve({}); return; }
    let text = '';
    req.on('data', (chunk) => { text += String(chunk); });
    req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function installedBundles(runtime) {
  const manager = runtime.getPluginManager && runtime.getPluginManager();
  if (!manager || typeof manager.listBundles !== 'function') return null;
  try {
    const rows = await manager.listBundles();
    return (Array.isArray(rows) ? rows : []).map((row) => (typeof row === 'string' ? row : (row && (row.name || row.id)) || ''));
  } catch {
    return null;
  }
}

function dependencyRows(runtime, installed) {
  return runtime.dependencies.map((dep) => ({
    id: dep.id,
    optional: dep.optional,
    installSpec: dep.installSpec,
    installed: installed === null ? null : installed.includes(dep.id),
  }));
}

export function createWebHandler(runtime) {
  return async (req, res) => {
    try {
      const method = String((req && req.method) || 'GET').toUpperCase();
      const url = new URL(String((req && req.url) || '/'), 'http://localhost');
      const pathname = url.pathname;
      if (pathname !== API_PREFIX && !pathname.startsWith(API_PREFIX + '/')) {
        sendJson(res, 404, { ok: false, error: 'Not found' });
        return;
      }
      if (!isLoopback(req)) {
        sendJson(res, 403, { ok: false, error: 'loopback only' });
        return;
      }
      const rel = pathname.slice(API_PREFIX.length) || '/';
      const postRoutes = new Set(['/api/sweep', '/api/deps/install']);
      const isPost = postRoutes.has(rel);
      if (isPost ? method !== 'POST' : method !== 'GET') {
        if (typeof res.setHeader === 'function') res.setHeader('Allow', isPost ? 'POST' : 'GET');
        sendJson(res, 405, { ok: false, error: 'method ' + method + ' is not allowed' });
        return;
      }
      const body = isPost ? await readJsonBody(req) : {};

      if (rel === '/api/status') {
        const installed = await installedBundles(runtime);
        sendJson(res, 200, {
          ok: true,
          plugin: 'dsh-kanban-board',
          realm: { path: runtime.realmPath, configured: Boolean(runtime.realm), error: runtime.realmError },
          boardDir: runtime.boardDir,
          dependencies: dependencyRows(runtime, installed),
        });
        return;
      }
      if (rel === '/api/board') {
        if (!runtime.boardDir) { sendJson(res, 409, { ok: false, code: 'realm-not-configured' }); return; }
        const epics = board.listCards(runtime.boardDir, 'epic').map((card) => card.meta);
        const tasks = board.listCards(runtime.boardDir, 'task').map((card) => card.meta);
        const journal = board.readJournal(runtime.boardDir);
        sendJson(res, 200, { ok: true, epics, tasks, journal: { count: journal.length, last: journal[journal.length - 1] || null } });
        return;
      }
      if (rel === '/api/journal') {
        if (!runtime.boardDir) { sendJson(res, 409, { ok: false, code: 'realm-not-configured' }); return; }
        const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit')) || 100));
        const events = board.readJournal(runtime.boardDir).slice(-limit);
        sendJson(res, 200, { ok: true, events });
        return;
      }
      if (rel === '/api/sweep') {
        if (!runtime.boardDir || !runtime.realm) { sendJson(res, 409, { ok: false, code: 'realm-not-configured' }); return; }
        if (!body || body.confirm !== true) { sendJson(res, 400, { ok: false, code: 'confirm-required' }); return; }
        const now = new Date();
        const outbox = sweepOutboxes({ realm: runtime.realm, boardDir: runtime.boardDir, now });
        const leases = board.sweep(runtime.boardDir, { now });
        sendJson(res, 200, { ok: true, outbox, leases });
        return;
      }
      if (rel === '/api/deps/install') {
        if (!body || body.confirm !== true) { sendJson(res, 400, { ok: false, code: 'confirm-required' }); return; }
        const dep = runtime.dependencies.find((item) => item.id === String(body.id || ''));
        if (!dep) { sendJson(res, 404, { ok: false, code: 'unknown-dependency' }); return; }
        if (!dep.installSpec) { sendJson(res, 409, { ok: false, code: 'no-install-spec' }); return; }
        const manager = runtime.getPluginManager && runtime.getPluginManager();
        if (!manager || typeof manager.installBundle !== 'function') { sendJson(res, 503, { ok: false, code: 'no-manager' }); return; }
        const result = await manager.installBundle(dep.installSpec);
        sendJson(res, 200, { ok: true, id: dep.id, result });
        return;
      }
      sendJson(res, 404, { ok: false, error: 'unknown route' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error && error.message ? error.message : String(error) });
    }
  };
}

/**
 * Предварительная проверка зависимостей и установка недостающих через
 * pluginManager (installBundle). Вызывается при активации плагина.
 */
export async function ensureDependencies(runtime) {
  const manager = runtime.getPluginManager && runtime.getPluginManager();
  if (!manager || typeof manager.listBundles !== 'function' || typeof manager.installBundle !== 'function') {
    return { ok: false, code: 'no-manager', installed: [], installedNow: [] };
  }
  let rows;
  try { rows = await manager.listBundles(); }
  catch { return { ok: false, code: 'list-failed', installed: [], installedNow: [] }; }
  const installed = (Array.isArray(rows) ? rows : []).map((row) => (typeof row === 'string' ? row : (row && (row.name || row.id)) || ''));
  const installedNow = [];
  for (const dep of runtime.dependencies) {
    if (installed.includes(dep.id)) continue;
    if (!dep.installSpec) continue;
    try { await manager.installBundle(dep.installSpec); installedNow.push(dep.id); }
    catch { /* причина видна в /api/status */ }
  }
  return { ok: true, installed, installedNow };
}

export function registerKanbanWeb(ctx, runtime) {
  const handler = createWebHandler(runtime);
  try {
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }));
  } catch {
    /* маршрут не зарегистрирован — панель недоступна, плагин работает */
  }
}
