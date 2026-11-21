/**
 * lib/motor.js — обход папок обмена (PROTOCOL §9.2). Читает НОВЫЕ письма из
 * outbox каждого воркспейса реалма, разбирает маркер и вызывает apply();
 * ответы архитектора пишет в его outbox (§6.3). Память прочтения и уже
 * обработанные письма — в board/.sweep.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { apply, appendJournal, journalFile, loadCard } from './board.js';
import { parseLetter, renderLetter, payloadOf } from './letters.js';

function stateFile(boardDir) {
  return path.join(boardDir, '.sweep.json');
}

function loadState(boardDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(boardDir), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { letters: {} };
    if (!parsed.letters || typeof parsed.letters !== 'object') parsed.letters = {};
    return parsed;
  } catch {
    return { letters: {} };
  }
}

function saveState(boardDir, state) {
  fs.mkdirSync(boardDir, { recursive: true });
  fs.writeFileSync(stateFile(boardDir), JSON.stringify(state, null, 2) + '\n');
}

/** Маркер → допустимый мотору переход. Остальные маркеры распоряжается архитектор. */
export const MOTOR_MARKERS = Object.freeze({
  'task-accept': { from: 'agreed', to: 'in-progress' },
  'stage-ready': { from: 'in-progress', to: 'integration' },
  blocked: { from: '*', to: 'blocked' },
});

export function processLetter({ boardDir, letter, workspace, now = new Date(), file }) {
  const payload = payloadOf(letter.body);
  const cardId = String(payload.card || payload.task || payload.epic || '');
  const base = { workspace, letter: file || '', marker: letter.marker, card: cardId };
  if (!cardId) {
    return { ...base, ok: false, code: 'no-card', marker: '[transition-rejected]', reason: 'в письме нет Payload.card' };
  }
  const loaded = loadCard(boardDir, cardId);
  if (!loaded) {
    return { ...base, ok: false, code: 'unknown-card', marker: '[unknown-card]', reason: 'карточки «' + cardId + '» нет' };
  }
  const spec = MOTOR_MARKERS[letter.marker];
  if (!spec) {
    return { ...base, ok: false, code: 'unknown-marker', marker: '[transition-rejected]', reason: 'маркер «' + letter.marker + '» мотором не применяется' };
  }
  const from = spec.from === '*' ? loaded.meta.status : spec.from;
  const result = apply(boardDir, {
    card: cardId, from, to: spec.to, by: 'motor',
    marker: '[' + letter.marker + ']', letter: file || '',
    payload: { ...payload, owner: payload.owner || payload.session || null },
    now,
  });
  return { ...base, ...result };
}

/**
 * Один обход: новые письма из outbox воркспейсов → apply; ответы — в outbox
 * архитектора. Возвращает результаты; повторный проход те же письма не берёт.
 */
export function sweepOutboxes({ realm, boardDir, now = new Date() }) {
  const state = loadState(boardDir);
  const seen = state.letters;
  const results = [];
  const workspaces = Array.isArray(realm && realm.workspaces) ? realm.workspaces : [];
  for (const workspace of workspaces) {
    const outbox = path.join(workspace.exchange, 'outbox');
    if (!fs.existsSync(outbox)) continue;
    for (const name of fs.readdirSync(outbox).filter((file) => file.endsWith('.md')).sort()) {
      const key = workspace.id + '/' + name;
      if (seen[key]) continue;
      const text = fs.readFileSync(path.join(outbox, name), 'utf8');
      const letter = parseLetter(text);
      if (!letter.headers.Session) {
        /* §12: письмо без Session не обрабатывается — сторону не определить. */
        seen[key] = { at: now.toISOString(), skipped: 'no-session' };
        continue;
      }
      const result = processLetter({ boardDir, letter, workspace: workspace.id, now, file: name });
      seen[key] = { at: now.toISOString(), marker: letter.marker, code: result.code };
      results.push(result);
    }
  }
  state.letters = seen;
  saveState(boardDir, state);

  const applied = results.filter((item) => item.ok).length;
  const rejected = results.length - applied;
  if (results.length > 0) {
    appendJournal(boardDir, { at: now.toISOString(), kind: 'sweep', summary: { applied, rejected, expired: 0 } });
    writeResponses({ realm, results, now });
  }
  return { results, applied, rejected };
}

/** §6.3: каждый переход — ответное письмо в outbox архитектора. */
function writeResponses({ realm, results, now }) {
  const architect = realm && realm.architect && typeof realm.architect === 'object' ? realm.architect : null;
  const exchange = architect && typeof architect.exchange === 'string' ? architect.exchange : '';
  if (!exchange) return [];
  const outbox = path.join(exchange, 'outbox');
  fs.mkdirSync(outbox, { recursive: true });
  const written = [];
  const stamp = now.toISOString().replace(/[:.]/gu, '-');
  let seq = 1;
  for (const result of results) {
    const marker = result.ok ? '[transition-applied]' : (result.marker || '[transition-rejected]');
    const name = stamp + '--architect--' + String(seq).padStart(2, '0') + '.md';
    seq += 1;
    const letter = renderLetter({
      Format: 'dsh-exchange/1',
      From: 'architect',
      To: result.workspace,
      Date: now.toISOString(),
      Thread: 'threads/kanban-' + (result.card ? String(result.card).split('-')[0] : 'unknown'),
      Status: 'answer',
      Workspace: 'architect',
      Session: 'motor',
      'Reply-To': result.letter,
      Subject: marker + ' ' + (result.card || '') + (result.ok ? '' : ' — ' + (result.reason || result.code)),
      body: 'Payload: ' + JSON.stringify({
        card: result.card, ok: Boolean(result.ok), code: result.code,
        from: result.from, to: result.to, allowed: result.allowed || [],
      }) + '\n',
    });
    fs.writeFileSync(path.join(outbox, name), letter);
    written.push(name);
  }
  return written;
}
