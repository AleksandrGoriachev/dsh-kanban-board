import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKanbanRuntime, createWebHandler } from '../../../../lib/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-status-'));
const runtime = createKanbanRuntime({ realm: path.join(root, 'realm.json'), boardDir: 'board' });
const handler = createWebHandler(runtime);
function req(method, url) {
  return new Promise((resolve) => {
    const out = { statusCode: 0, text: '', setHeader() {}, end(text) { this.text = String(text || ''); let json = {}; try { json = JSON.parse(this.text); } catch { json = {}; } resolve({ status: this.statusCode, json }); } };
    handler({ method, url, socket: { remoteAddress: '127.0.0.1' }, on() {} }, out);
  });
}
try {
  const status = await req('GET', '/kanban/api/status');
  if (!status.json || !status.json.version) {
    console.error('FAIL status-version: /api/status не отдаёт version');
    process.exit(1);
  }
  if (status.json.version !== '0.4.1') {
    console.error('FAIL status-version: version=' + status.json.version + ', ожидалась 0.4.1');
    process.exit(1);
  }
  console.log('OK status-version: /api/status отдаёт version=' + status.json.version);
} finally {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* temp */ }
}
