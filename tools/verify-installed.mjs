#!/usr/bin/env node
/**
 * tools/verify-installed.mjs — проверка УСТАНОВЛЕННОГО артефакта из релиза.
 *
 * Импортирует плагин из профиля DSH (node_modules/dsh-kanban-board), вызывает
 * apply с mock ctx (inject webServer), проверяет регистрацию /kanban и ответы
 * status/board. Не трогает запущенный хост и его сессии.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE = process.env.DSH_PROFILE_DIR
  || 'C:\\Users\\Goryachev\\.dsh\\profiles\\desktop';
const pluginDir = path.join(PROFILE, 'node_modules', 'dsh-kanban-board');
const indexPath = path.join(pluginDir, 'lib', 'index.js');
const boardPath = path.join(pluginDir, 'lib', 'board.js');

const index = await import(pathToFileURL(indexPath).href);
const board = await import(pathToFileURL(boardPath).href);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-verify-'));
const boardDir = path.join(root, 'board');
fs.mkdirSync(path.join(boardDir, 'epics'), { recursive: true });
board.createEpic(boardDir, { id: 'E1', title: 'проверка установки', involved: [] });
const realmFile = path.join(root, 'realm.json');
fs.writeFileSync(realmFile, JSON.stringify({ version: 1, architect: { root, exchange: path.join(root, 'exchange') }, workspaces: [] }));

const registered = [];
const ctx = {
  get: () => null,
  inject: (services, callback) => callback({ webServer: { register: (route) => registered.push(route) }, effect: (fn) => fn() }),
  effect: (fn) => fn(),
};

const runtime = index.apply(ctx, { realm: realmFile, boardDir: 'board', dependencies: [] });

async function call(method, url) {
  const res = { statusCode: 0, body: '', setHeader() {}, end(text) { this.body = String(text); } };
  await registered[0].handler({ method, url, socket: { remoteAddress: '127.0.0.1' }, on() {} }, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

const status = await call('GET', '/kanban/api/status');
const boardResp = await call('GET', '/kanban/api/board');

const result = {
  installed: pluginDir,
  name: index.name,
  apply: typeof index.apply,
  route: registered[0] && registered[0].path,
  runtimeRealm: runtime.realmPath,
  status: { code: status.status, configured: status.json && status.json.realm.configured, dependencies: status.json && status.json.dependencies.length },
  board: { code: boardResp.status, epics: boardResp.json && boardResp.json.epics.length },
};
console.log(JSON.stringify(result, null, 2));

try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
const ok = index.name === 'dsh-kanban-board' && typeof index.apply === 'function'
  && registered.length === 1 && registered[0].path === '/kanban'
  && status.status === 200 && status.json.realm.configured === true
  && boardResp.status === 200 && boardResp.json.epics.length === 1;
process.exit(ok ? 0 : 1);
