import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const { createKanbanRuntime, createWebHandler } = await import('../../../../lib/api.js');
const { createEpic } = await import('../../../../lib/board.js');

const fails = [];
const fail = (m) => fails.push(m);
function mockRes() { return { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(t) { this.body = String(t || ''); } }; }
function mockReq(method, url, bodyObj) {
  const handlers = {};
  const req = { method, url, socket: { remoteAddress: '127.0.0.1' }, on(e, fn) { (handlers[e] = handlers[e] || []).push(fn); } };
  if (bodyObj !== undefined) setTimeout(() => { for (const fn of handlers.data || []) fn(Buffer.from(JSON.stringify(bodyObj))); for (const fn of handlers.end || []) fn(); }, 0);
  return req;
}
async function call(handler, method, url, body) { const res = mockRes(); await handler(mockReq(method, url, body), res); return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }; }
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, acc); else if (name.endsWith('.md')) acc.push(full);
  }
  return acc;
}
const head = (file) => { const out = {}; for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { if (!line.trim()) break; const m = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line); if (m) out[m[1]] = m[2]; } return out; };

// Корень архитектора назван меткой воркспейса (как TV Kanban в реальном реалме).
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-0031-'));
const architectRoot = path.join(base, 'Realm Architect');
const exchange = path.join(architectRoot, 'coordination');
const boardDir = path.join(architectRoot, 'board');
fs.mkdirSync(exchange, { recursive: true });
const realm = { version: 1, architect: { root: architectRoot, exchange }, workspaces: [{ id: 'ws-one', root: path.join(base, 'ws-one'), exchange: path.join(base, 'ws-one', 'coordination') }] };
const realmFile = path.join(base, 'realm.json');
fs.writeFileSync(realmFile, JSON.stringify(realm));
fs.mkdirSync(path.join(base, 'ws-one', 'coordination'), { recursive: true });
const SESSION = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

try {
  const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
  const handler = createWebHandler(runtime);
  const epicId = createEpic(boardDir, { title: 'E', result: 'R', involved: ['ws-one'] }).id;
  await call(handler, 'POST', '/kanban/api/transition', { confirm: true, card: epicId, to: 'agreeing', session: SESSION });
  await call(handler, 'POST', '/kanban/api/task', { confirm: true, epic: epicId, workspace: 'ws-one', title: 'T', spec: 'S', session: SESSION });

  const letters = walk(exchange);
  if (letters.length === 0) fail('письма не созданы');
  const expected = path.basename(architectRoot);
  for (const file of letters) {
    const h = head(file);
    const rel = path.relative(exchange, file).split(path.sep).join('/');
    if (h.From === 'architect') fail('From=architect (псевдоним) в ' + rel);
    if (h.Workspace === 'architect') fail('Workspace=architect (псевдоним) в ' + rel);
    if (h.From !== expected) fail('From «' + h.From + '» не равен метке «' + expected + '» в ' + rel);
    if (h.Workspace !== expected) fail('Workspace «' + h.Workspace + '» не равен метке «' + expected + '» в ' + rel);
    if (h.To !== 'ws-one') fail('To «' + h.To + '» не метка воркспейса в ' + rel);
    if (!h.Session || !/^session-/.test(h.Session)) fail('Session не session-… в ' + rel);
  }
} finally { fs.rmSync(base, { recursive: true, force: true }); }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const atLeast = (a, b) => { const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0; const y = pb[i] || 0; if (x !== y) return x > y; } return true; };
if (!atLeast(pkg.version, '0.4.13')) fail('версия ниже 0.4.13: ' + pkg.version);
if (fails.length) { console.error('FAIL letters-addressing: ' + fails.join('; ')); process.exit(1); }
console.log('OK letters-addressing: From/Workspace = метка воркспейса, To = метка исполнителя; 0.4.13');
