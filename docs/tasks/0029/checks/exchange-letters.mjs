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
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc); else if (name.endsWith('.md')) acc.push(full);
  }
  return acc;
}
const head = (file) => { const out = {}; for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { if (!line.trim()) break; const m = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line); if (m) out[m[1]] = m[2]; } return out; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-0029-'));
const exchange = path.join(tmp, 'exchange');
const boardDir = path.join(tmp, 'board');
fs.mkdirSync(exchange, { recursive: true });
const realm = { version: 1, architect: { root: tmp, exchange }, workspaces: [{ id: 'ws', root: path.join(tmp, 'ws'), exchange: path.join(tmp, 'ws', 'exchange') }] };
const realmFile = path.join(tmp, 'realm.json');
fs.writeFileSync(realmFile, JSON.stringify(realm));
fs.mkdirSync(path.join(tmp, 'ws', 'exchange'), { recursive: true });

const SESSION = 'session-11111111-2222-3333-4444-555555555555';
try {
  const runtime = createKanbanRuntime({ realm: realmFile, boardDir: 'board' });
  const handler = createWebHandler(runtime);
  const epicId = createEpic(boardDir, { title: 'E', result: 'R', involved: ['ws'] }).id;

  // K1 (B1): title наряда доезжает и обязателен.
  const created = await call(handler, 'POST', '/kanban/api/task', { confirm: true, epic: epicId, workspace: 'ws', title: 'наряд с заголовком', spec: 'S', session: SESSION });
  if (created.status !== 200 || !created.json || !created.json.ok) fail('K1: POST /api/task не создал наряд: ' + JSON.stringify(created).slice(0, 200));
  else if (created.json.task.title !== 'наряд с заголовком') fail('K1: title потерян: ' + JSON.stringify(created.json.task.title));
  const noTitle = await call(handler, 'POST', '/kanban/api/task', { confirm: true, epic: epicId, workspace: 'ws', spec: 'S', session: SESSION });
  if (noTitle.status !== 400 || !noTitle.json || noTitle.json.code !== 'invalid-task') fail('K1: наряд без title не отклонён 400 invalid-task: ' + JSON.stringify(noTitle).slice(0, 160));

  // Письма эпика и наряда.
  await call(handler, 'POST', '/kanban/api/transition', { confirm: true, card: epicId, to: 'agreeing', session: SESSION });
  const letters = walk(exchange);
  if (letters.length === 0) fail('письма не созданы в ящике');
  for (const file of letters) {
    const h = head(file);
    const rel = path.relative(exchange, file).split(path.sep).join('/');
    if (h.Session === 'motor') fail('B2: Session=motor в ' + rel);
    if (!h.Session || !/^session-/.test(h.Session)) fail('B2: Session не формата session-… в ' + rel + ' (' + (h.Session || 'нет') + ')');
    if (!h.Thread) fail('B4: нет Thread в ' + rel);
    else {
      const threadDir = h.Thread.replace(/^threads\//, '');
      if (!rel.startsWith('threads/' + threadDir + '/')) fail('B4: Thread «' + h.Thread + '» не совпадает с каталогом файла ' + rel);
    }
    if (!h['Reply-To'] && !h.Ref) fail('B3: ни Reply-To, ни Ref в ' + rel);
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const atLeast = (a, b) => { const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0; const y = pb[i] || 0; if (x !== y) return x > y; } return true; };
if (!atLeast(pkg.version, '0.4.11')) fail('версия ниже 0.4.11: ' + pkg.version);
if (fails.length) { console.error('FAIL exchange-letters: ' + fails.join('; ')); process.exit(1); }
console.log('OK exchange-letters: title наряда, Session=session-…, Thread=каталог, Reply-To/Ref; 0.4.11');
