#!/usr/bin/env node
/**
 * Миграция docs/anchors.json v1 -> v3 (appliesTo.roles, sides) и перевыпуск
 * docs/anchors.approval.json в формате 0.3 (вложенная подпись hash+by+at).
 * Только в своём воркспейсе: docs/, .wf-keys/. Валидация — кодом плагина структуры.
 *
 * Запуск: node tools/anchors-approve.mjs <root> <private.pem> <keyId>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2] || 'C:\\Users\\Goryachev\\Documents\\deepseek-harness\\dsh-kanban-board';
const KEY = process.argv[3] || 'C:\\Users\\Goryachev\\.wf-keys\\anchors\\human-owner.key.pem';
const KEY_ID = process.argv[4] || 'human-owner';

const ROLE_MAP = {
  P1: ['координатор'], P2: ['координатор'], P3: ['координатор'], P4: ['координатор'],
  P5: ['координатор'], P6: ['координатор', 'исполнитель'], P7: ['координатор'], P8: ['координатор'],
};

const anchorsFile = path.join(ROOT, 'docs', 'anchors.json');
const approvalFile = path.join(ROOT, 'docs', 'anchors.approval.json');
const keysDir = path.join(ROOT, '.wf-keys');

const doc = JSON.parse(fs.readFileSync(anchorsFile, 'utf8'));
doc.version = 3;
for (const a of doc.anchors) {
  if (!a.sides) a.sides = 'project';
  const roles = ROLE_MAP[a.id];
  if (roles) a.appliesTo = { roles };
}
fs.writeFileSync(anchorsFile, JSON.stringify(doc, null, 2) + '\n');

const bytes = fs.readFileSync(anchorsFile);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');

const at = new Date().toISOString();
const record = {
  version: 2,
  anchors: 'docs/anchors.json',
  algo: 'sha256',
  hash,
  bytes: bytes.length,
  layer: 'project',
  sides: 'project',
  enforcedBy: 'nodes',
  by: ['owner'],
  at,
  note: 'Проектные якоря dsh-kanban-board (v3): утверждение владельца.',
};

const fields = { hash: record.hash, by: record.by, at: record.at };
const keys = Object.keys(fields).sort();
const body = '{' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(fields[k])).join(',') + '}';

const privatePem = fs.readFileSync(KEY, 'utf8');
const privateKey = crypto.createPrivateKey(privatePem);
const value = crypto.sign(null, Buffer.from(body, 'utf8'), privateKey).toString('base64');
const pubPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
const der = crypto.createPublicKey(privatePem).export({ type: 'spki', format: 'der' });
const fingerprint = crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);

record.signature = { keyId: KEY_ID, algo: 'ed25519', covers: 'hash+by+at', value };
record.publicKeyFingerprint = fingerprint;
fs.writeFileSync(approvalFile, JSON.stringify(record, null, 2) + '\n');

fs.mkdirSync(keysDir, { recursive: true });
fs.writeFileSync(path.join(keysDir, KEY_ID + '.pub.pem'), pubPem);

const mod = await import(pathToFileURL('C:\\Users\\Goryachev\\Documents\\deepseek-harness\\dsh-project-graph\\lib\\anchors.js').href);
const anchorsText = fs.readFileSync(anchorsFile, 'utf8');
const vDoc = mod.validateAnchorsDoc(doc);
const vAppr = mod.validateApproval(record, anchorsText, { root: ROOT });
const vSig = mod.verifyApprovalSignature(record, { root: ROOT });

console.log(JSON.stringify({
  version: doc.version,
  anchors: doc.anchors.length,
  roles: Object.fromEntries(doc.anchors.map((a) => [a.id, a.appliesTo && a.appliesTo.roles])),
  hash,
  bytes: bytes.length,
  at,
  keyId: KEY_ID,
  validateAnchorsDoc: vDoc,
  validateApproval: vAppr,
  verifyApprovalSignature: vSig,
}, null, 2));
