import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const pkgFile = path.join(root, 'package.json');
const fails = [];

// Модуль импортируется ДО подмены package.json: его версия — версия загруженного кода.
const { createKanbanRuntime, createWebHandler } = await import('../../../../lib/api.js');
const original = fs.readFileSync(pkgFile, 'utf8');
const loadedVersion = JSON.parse(original).version;

function mockRes() { return { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(t) { this.body = String(t || ''); } }; }
function mockReq(method, url) { const handlers = {}; return { method, url, socket: { remoteAddress: '127.0.0.1' }, on(e, fn) { (handlers[e] = handlers[e] || []).push(fn); } }; }
async function call(handler, method, url) { const res = mockRes(); await handler(mockReq(method, url), res); return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }; }

try {
  // Подменяем файл на диске: загруженный модуль не должен это увидеть.
  const probe = { ...JSON.parse(original), version: '0.0.0-probe' };
  fs.writeFileSync(pkgFile, JSON.stringify(probe, null, 2) + '\n');
  const runtime = createKanbanRuntime({ realm: path.join(root, 'no-such-realm.json'), boardDir: 'board' });
  const handler = createWebHandler(runtime);
  const res = await call(handler, 'GET', '/kanban/api/status');
  const got = res.json && res.json.version;
  if (got === '0.0.0-probe') fails.push('/api/status вернул версию с диска (0.0.0-probe) вместо загруженной (' + loadedVersion + ')');
  if (got !== loadedVersion) fails.push('/api/status вернул «' + got + '», ожидалась загруженная «' + loadedVersion + '»');
} finally {
  fs.writeFileSync(pkgFile, original);
}

const restored = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version;
if (restored !== loadedVersion) fails.push('package.json не восстановлен: ' + restored);
const atLeast = (a, b) => { const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0; const y = pb[i] || 0; if (x !== y) return x > y; } return true; };
if (!atLeast(loadedVersion, '0.4.14')) fails.push('версия ниже 0.4.14: ' + loadedVersion);
if (fails.length) { console.error('FAIL status-loaded-version: ' + fails.join('; ')); process.exit(1); }
console.log('OK status-loaded-version: /api/status отдаёт версию загруженного модуля; 0.4.14');
