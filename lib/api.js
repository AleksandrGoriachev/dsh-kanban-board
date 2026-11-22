/**
 * lib/api.js — маршруты панели «Канбан», конфиг реалма через меню и
 * проверка/установка зависимостей.
 *
 * Реалм задаётся НЕ ручным JSON: клиент показывает список воркспейсов
 * (GET /kanban/api/workspaces) и сохраняет выбор (POST /kanban/api/realm).
 * Плагин пишет реалм сам (по умолчанию ~/.dsh/kanban/realm.json) и читает его.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as board from './board.js';
import { sweepOutboxes } from './motor.js';
import { renderLetter } from './letters.js';
import { loadRealm, validateRealm } from './realm.js';

export const API_PREFIX = '/kanban';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Версия пакета из его корня: /api/status отдаёт её, чтобы живой хост было видно. */
function packageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '';
  } catch {
    return '';
  }
}

function defaultStatePath() {
  return path.join(os.homedir(), '.dsh', 'kanban', 'realm.json');
}

export function createKanbanRuntime(config = {}, services = {}) {
  const explicitRealm = typeof config.realm === 'string' && config.realm.trim() ? config.realm.trim() : '';
  const runtime = {
    explicitRealm,
    statePath: explicitRealm || defaultStatePath(),
    boardDirName: typeof config.boardDir === 'string' && config.boardDir.trim() ? config.boardDir.trim() : 'board',
    realm: null,
    realmPath: '',
    realmError: null,
    boardDir: '',
    dependencies: (Array.isArray(config.dependencies) ? config.dependencies : [])
      .filter((dep) => dep && typeof dep.id === 'string' && dep.id.trim())
      .map((dep) => ({
        id: dep.id.trim(),
        installSpec: typeof dep.installSpec === 'string' ? dep.installSpec.trim() : '',
        optional: dep.optional === true,
      })),
    getPluginManager: services.getPluginManager,
    listWorkspaces: services.listWorkspaces,
  };
  reloadRealm(runtime);
  return runtime;
}

export function reloadRealm(runtime) {
  runtime.realm = null;
  runtime.realmPath = '';
  runtime.realmError = null;
  runtime.boardDir = '';
  const file = runtime.explicitRealm || runtime.statePath;
  if (!file || !fs.existsSync(file)) return { ok: false, code: 'not-configured' };
  try {
    const realm = loadRealm(file);
    runtime.realm = realm;
    runtime.realmPath = file;
    const root = realm.architect && typeof realm.architect.root === 'string' ? realm.architect.root : '';
    runtime.boardDir = root ? path.join(root, runtime.boardDirName) : '';
    return { ok: true, realm };
  } catch (error) {
    runtime.realmError = error && error.message ? error.message : String(error);
    return { ok: false, code: 'invalid-realm', error: runtime.realmError };
  }
}

/** Собрать реалм из выбора в меню: корень архитектора + воркспейсы. */
export function buildRealmFromInput(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const architect = source.architect && typeof source.architect === 'object' ? source.architect : {};
  const architectRoot = String(architect.root || '').trim();
  if (!architectRoot) throw new Error('realm: не выбран корень архитектора');
  const architectExchange = String(architect.exchange || '').trim() || path.join(architectRoot, 'coordination');
  const workspaces = (Array.isArray(source.workspaces) ? source.workspaces : [])
    .filter((item) => item && typeof item.root === 'string' && item.root.trim())
    .map((item) => {
      const root = item.root.trim();
      const id = String(item.id || path.basename(root)).trim();
      const exchange = String(item.exchange || '').trim() || path.join(root, 'coordination');
      return { id, root, exchange };
    });
  const realm = {
    version: 1,
    name: String(source.name || 'realm').trim() || 'realm',
    agreeTimeoutMinutes: Number(source.agreeTimeoutMinutes) || 15,
    architect: { root: architectRoot, exchange: architectExchange },
    workspaces,
  };
  const check = validateRealm(realm);
  if (!check.ok) {
    const error = new Error('realm: ' + check.errors.join('; '));
    error.errors = check.errors;
    throw error;
  }
  return realm;
}

function workspaceRows(runtime) {
  if (typeof runtime.listWorkspaces !== 'function') return [];
  try {
    const rows = runtime.listWorkspaces();
    return (Array.isArray(rows) ? rows : []).map((item) => (typeof item === 'string'
      ? { path: item, title: path.basename(item) }
      : { path: String(item && item.path ? item.path : ''), title: String(item && item.title ? item.title : '') }))
      .filter((item) => item.path);
  } catch {
    return [];
  }
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

function inviteEpic({ runtime, cardId, now }) {
  const realm = runtime.realm;
  const exchange = realm && realm.architect && typeof realm.architect.exchange === 'string' ? realm.architect.exchange : '';
  if (!exchange || !runtime.boardDir) return [];
  const loaded = board.loadCard(runtime.boardDir, cardId);
  if (!loaded || loaded.kind !== 'epic') return [];
  const involved = Array.isArray(loaded.meta.involved) ? loaded.meta.involved : [];
  const outbox = path.join(exchange, 'outbox');
  fs.mkdirSync(outbox, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/gu, '-');
  const written = [];
  let seq = 1;
  for (const workspace of involved) {
    const name = stamp + '--architect--invite-' + String(seq).padStart(2, '0') + '.md';
    seq += 1;
    const letter = renderLetter({ Format: 'dsh-exchange/1', From: 'architect', To: String(workspace), Date: now.toISOString(), Thread: 'threads/kanban-' + cardId, Status: 'invitation', Workspace: 'architect', Session: 'motor', Subject: '[epic-invite] ' + cardId + ' — ' + String(loaded.meta.title || ''), body: 'Payload: ' + JSON.stringify({ epic: cardId, title: loaded.meta.title, result: loaded.meta.result, agree_until: loaded.meta.agree_until, involved }) + '\n' });
    fs.writeFileSync(path.join(outbox, name), letter);
    written.push(name);
  }
  return written;
}

export function offerTask({ runtime, cardId, now = new Date() }) {
  const realm = runtime && runtime.realm;
  const exchange = realm && realm.architect && typeof realm.architect.exchange === 'string' ? realm.architect.exchange : '';
  if (!exchange || !runtime.boardDir) return [];
  const loaded = board.loadCard(runtime.boardDir, cardId);
  if (!loaded || loaded.kind !== 'task') return [];
  const workspace = String(loaded.meta.workspace || '');
  if (!workspace) return [];
  const outbox = path.join(exchange, 'outbox');
  fs.mkdirSync(outbox, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/gu, '-');
  const name = stamp + '--architect--offer-' + String(cardId).slice(0, 8) + '.md';
  const letter = renderLetter({
    Format: 'dsh-exchange/1', From: 'architect', To: workspace, Date: now.toISOString(),
    Thread: 'threads/kanban-' + String(loaded.meta.epic || cardId), Status: 'offer', Workspace: 'architect', Session: 'motor',
    Subject: '[task-offer] ' + cardId + ' — ' + String(loaded.meta.title || ''),
    body: 'Payload: ' + JSON.stringify({ task: cardId, epic: loaded.meta.epic, workspace, title: loaded.meta.title, spec: loaded.meta.spec }) + '\n',
  });
  fs.writeFileSync(path.join(outbox, name), letter);
  return [name];
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
      const postOnly = new Set(['/api/sweep', '/api/deps/install', '/api/epic', '/api/task', '/api/transition']);
      const getOrPost = new Set(['/api/realm']);
      if (getOrPost.has(rel)) {
        if (method !== 'GET' && method !== 'POST') {
          if (typeof res.setHeader === 'function') res.setHeader('Allow', 'GET, POST');
          sendJson(res, 405, { ok: false, error: 'method ' + method + ' is not allowed' });
          return;
        }
      } else if (postOnly.has(rel) ? method !== 'POST' : method !== 'GET') {
        if (typeof res.setHeader === 'function') res.setHeader('Allow', postOnly.has(rel) ? 'POST' : 'GET');
        sendJson(res, 405, { ok: false, error: 'method ' + method + ' is not allowed' });
        return;
      }
      const body = (postOnly.has(rel) || (getOrPost.has(rel) && method === 'POST')) ? await readJsonBody(req) : {};

      if (rel === '/api/status') {
        const installed = await installedBundles(runtime);
        sendJson(res, 200, {
          ok: true,
          plugin: 'dsh-kanban-board',
          version: packageVersion(),
          realm: { path: runtime.realmPath || runtime.statePath, configured: Boolean(runtime.realm), error: runtime.realmError },
          boardDir: runtime.boardDir,
          dependencies: dependencyRows(runtime, installed),
        });
        return;
      }
      if (rel === '/api/workspaces') {
        sendJson(res, 200, { ok: true, workspaces: workspaceRows(runtime) });
        return;
      }
      if (rel === '/api/realm') {
        if (method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            configured: Boolean(runtime.realm),
            realm: runtime.realm,
            statePath: runtime.statePath,
            error: runtime.realmError,
          });
          return;
        }
        if (!body || body.confirm !== true) { sendJson(res, 400, { ok: false, code: 'confirm-required' }); return; }
        let realm;
        try { realm = buildRealmFromInput(body); }
        catch (error) {
          sendJson(res, 400, { ok: false, code: 'invalid-realm', error: error && error.message ? error.message : String(error), errors: error && error.errors ? error.errors : [] });
          return;
        }
        fs.mkdirSync(path.dirname(runtime.statePath), { recursive: true });
        fs.writeFileSync(runtime.statePath, JSON.stringify(realm, null, 2) + '\n');
        reloadRealm(runtime);
        sendJson(res, 200, { ok: true, realm: runtime.realm, boardDir: runtime.boardDir, statePath: runtime.statePath });
        return;
      }
      if (method === 'GET' && rel.startsWith('/api/card/')) {
        if (!runtime.boardDir) { sendJson(res, 409, { ok: false, code: 'realm-not-configured' }); return; }
        const id = decodeURIComponent(rel.replace(/^\/api\/card\//, ''));
        const loaded = board.loadCard(runtime.boardDir, id);
        if (!loaded) { sendJson(res, 404, { ok: false, code: 'unknown-card' }); return; }
        const events = board.readJournal(runtime.boardDir).filter((e) => e.card === id);
        sendJson(res, 200, { ok: true, card: { meta: loaded.meta, body: loaded.body }, journal: events });
        return;
      }
      if (rel === '/api/board') {
        if (!runtime.boardDir) { sendJson(res, 409, { ok: false, code: 'realm-not-configured' }); return; }
        const epics = board.listCards(runtime.boardDir, 'epic').map((card) => ({ ...card.meta, allowed: board.allowedTransitions('epic', card.meta.status, 'architect') }));
        const tasks = board.listCards(runtime.boardDir, 'task').map((card) => ({ ...card.meta, allowed: board.allowedTransitions('task', card.meta.status, 'architect') }));
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
      if (rel === '/api/epic') {
        if (!body || body.confirm !== true) { sendJson(res, 400, { ok: false, code: 'confirm-required' }); return; }
        if (!runtime.boardDir) { sendJson(res, 409, { ok: false, code: 'realm-not-configured' }); return; }
        try {
          const meta = board.createEpic(runtime.boardDir, {
            id: body.id, title: body.title, involved: body.involved,
            result: body.result, body: body.body,
          });
          sendJson(res, 200, { ok: true, epic: meta });
        } catch (error) {
          sendJson(res, 400, { ok: false, code: 'invalid-epic', error: error && error.message ? error.message : String(error) });
        }
        return;
      }
      if (rel === '/api/task') {
        if (!body || body.confirm !== true) { sendJson(res, 400, { ok: false, code: 'confirm-required' }); return; }
        if (!runtime.boardDir) { sendJson(res, 409, { ok: false, code: 'realm-not-configured' }); return; }
        try {
          const meta = board.createTask(runtime.boardDir, {
            id: body.id, epic: body.epic, workspace: body.workspace, role: body.role,
            spec: body.spec, blocked_by: body.blocked_by, body: body.body,
          });
          offerTask({ runtime, cardId: meta.id, now: new Date() });
          sendJson(res, 200, { ok: true, task: meta });
        } catch (error) {
          sendJson(res, 400, { ok: false, code: 'invalid-task', error: error && error.message ? error.message : String(error) });
        }
        return;
      }
      if (rel === '/api/transition') {
        if (!body || body.confirm !== true) { sendJson(res, 400, { ok: false, code: 'confirm-required' }); return; }
        if (!runtime.boardDir) { sendJson(res, 409, { ok: false, code: 'realm-not-configured' }); return; }
        const by = body.by === 'motor' ? 'motor' : 'architect';
        const result = board.apply(runtime.boardDir, {
          card: body.card, from: body.from, to: body.to, by,
          payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
          reason: typeof body.reason === 'string' ? body.reason : '',
          expectedRevision: body.revision,
          agreeTimeoutMinutes: Number(runtime.realm && runtime.realm.agreeTimeoutMinutes) || 15,
          now: new Date(),
        });
        if (result.ok && body.from === 'draft' && body.to === 'agreeing') {
          inviteEpic({ runtime, cardId: body.card, now: new Date() });
        }
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }
      sendJson(res, 404, { ok: false, error: 'unknown route' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error && error.message ? error.message : String(error) });
    }
  };
}

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
