#!/usr/bin/env node
/**
 * Проверка применимости проектных якорей к каждому узлу и закрепление (consumes)
 * по роли узла. Использует код плагина structure (dsh-project-graph/lib/anchors.js):
 * nodeAnchorApplicability (0299) и resyncAnchorRefs (0301).
 *
 * Запуск: node tools/anchors-assign.mjs <root> <store/graph.json>
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2] || 'C:\\Users\\Goryachev\\Documents\\deepseek-harness\\dsh-kanban-board';
const STORE = process.argv[3] || 'C:\\Users\\Goryachev\\.dsh\\project-graph\\dsh-kanban-board-934d448d\\graph.json';

const anchorsFile = path.join(ROOT, 'docs', 'anchors.json');
const anchorsDoc = JSON.parse(fs.readFileSync(anchorsFile, 'utf8'));
const graph = JSON.parse(fs.readFileSync(STORE, 'utf8'));

const mod = await import(pathToFileURL('C:\\Users\\Goryachev\\Documents\\deepseek-harness\\dsh-project-graph\\lib\\anchors.js').href);

const table = graph.nodes.map((node) => {
  const r = mod.nodeAnchorApplicability(anchorsDoc, node);
  return {
    node: node.id,
    role: node.role,
    applicable: r.ok ? r.applicable.map((i) => i.id) : [],
    notApplicable: r.ok ? r.notApplicable.map((i) => i.id + ':' + i.reason) : r.errors,
    source: node.anchors && node.anchors.source,
  };
});

const res = mod.resyncAnchorRefs(graph, anchorsDoc);
if (!res.ok) {
  console.error('resync failed: ' + JSON.stringify(res.errors));
  process.exit(1);
}

const backup = STORE + '.bak-' + Date.now();
fs.copyFileSync(STORE, backup);
fs.writeFileSync(STORE, JSON.stringify(res.graph, null, 2) + '\n');

console.log(JSON.stringify({
  table,
  changes: res.changes,
  skipped: res.skipped,
  consumesNow: res.graph.nodes.map((n) => ({ id: n.id, consumes: (n.anchors && n.anchors.consumes) || [] })),
  backup,
}, null, 2));
