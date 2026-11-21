/**
 * lib/realm.js — конфиг реалма (PROTOCOL §3).
 */
import fs from 'node:fs';

export const REALM_VERSION = 1;

export function validateRealm(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['realm: корень — не JSON-объект'] };
  }
  const errors = [];
  if (Number(raw.version) !== REALM_VERSION) errors.push('realm: version должен быть ' + REALM_VERSION);
  const architect = raw.architect && typeof raw.architect === 'object' ? raw.architect : null;
  if (!architect) {
    errors.push('realm: architect — объект { root, exchange }');
  } else {
    if (typeof architect.root !== 'string' || !architect.root.trim()) errors.push('realm: architect.root обязателен');
    if (typeof architect.exchange !== 'string' || !architect.exchange.trim()) errors.push('realm: architect.exchange обязателен');
  }
  const workspaces = Array.isArray(raw.workspaces) ? raw.workspaces : null;
  if (!workspaces) {
    errors.push('realm: workspaces — массив исполнителей');
  } else {
    const ids = new Set();
    workspaces.forEach((item, index) => {
      const at = 'realm.workspaces[' + index + ']';
      if (!item || typeof item !== 'object') { errors.push(at + ': не объект'); return; }
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!id) errors.push(at + '.id обязателен');
      else if (ids.has(id)) errors.push(at + '.id «' + id + '» повторяется');
      else ids.add(id);
      if (typeof item.root !== 'string' || !item.root.trim()) errors.push(at + '.root обязателен');
      if (typeof item.exchange !== 'string' || !item.exchange.trim()) errors.push(at + '.exchange обязателен');
    });
  }
  return { ok: errors.length === 0, errors };
}

export function loadRealm(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const check = validateRealm(raw);
  if (!check.ok) {
    const error = new Error('realm: ' + check.errors.join('; '));
    error.errors = check.errors;
    throw error;
  }
  return raw;
}
