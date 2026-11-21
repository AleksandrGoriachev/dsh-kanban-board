#!/usr/bin/env node
/**
 * tools/pack-plugin.mjs — tarball плагина для GitHub-релиза.
 *
 * npm pack в dist/; стабильное имя dsh-kanban-board.tgz (для установки из
 * релиза) + версионная копия dsh-kanban-board-<версия>.tgz; .sha256 для обоих.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const out = execFileSync(process.execPath, [npmCli, 'pack', '--pack-destination', dist], { cwd: root, encoding: 'utf8' });
const produced = out.trim().split(/\r?\n/u).filter(Boolean).pop();
const src = path.join(dist, produced);
const stable = path.join(dist, 'dsh-kanban-board.tgz');
const versioned = path.join(dist, 'dsh-kanban-board-' + pkg.version + '.tgz');
fs.copyFileSync(src, stable);
fs.copyFileSync(src, versioned);
for (const file of [stable, versioned]) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(file + '.sha256', hash + '  ' + path.basename(file) + '\n');
}
console.log(JSON.stringify({ version: pkg.version, stable, versioned, files: fs.readdirSync(dist) }, null, 2));
