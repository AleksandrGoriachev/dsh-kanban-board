/**
 * lib/motor.js — обход папок обмена (PROTOCOL §9.2). Читает НОВЫЕ письма из
 * outbox каждого воркспейса реалма, разбирает маркер и вызывает apply();
 * ответы архитектора пишет в его outbox (§6.3). Память прочтения и уже
 * обработанные письма — в board/.sweep.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { apply, appendJournal, journalFile, loadCard, writeCard } from './board.js';
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
  'interface-agreed': { from: 'proposed', to: 'agreed' },
  'stage-ready': { from: 'in-progress', to: 'integration' },
  'result-failed': { from: 'accepted', to: 'rework' },
  blocked: { from: '*', to: 'blocked' },
  // [subtask-approved] — вердикт архитектора по плану: обрабатывается в processLetter
  // (approveSubtasks), фиксация без перехода статуса.
});

function agreeEpic({ boardDir, letter, workspace, now, file, payload }) {
  const epicId = String(payload.epic || payload.card || '');
  const base = { workspace, letter: file || '', marker: letter.marker, card: epicId };
  if (!epicId) return { ...base, ok: false, code: 'no-card', marker: '[transition-rejected]', reason: 'в письме нет Payload.epic' };
  const loaded = loadCard(boardDir, epicId);
  if (!loaded || loaded.kind !== 'epic') return { ...base, ok: false, code: 'unknown-card', marker: '[unknown-card]', reason: 'эпика «' + epicId + '» нет' };
  const involved = Array.isArray(loaded.meta.involved) ? loaded.meta.involved : [];
  if (involved.length > 0 && !involved.includes(workspace)) {
    return { ...base, ok: false, code: 'not-involved', marker: '[transition-rejected]', reason: 'воркспейс «' + workspace + '» не участник эпика' };
  }
  if (loaded.meta.status !== 'agreeing') {
    return { ...base, ok: false, code: 'from-mismatch', marker: '[transition-rejected]', reason: 'эпик в статусе «' + loaded.meta.status + '», согласие принимается только в agreeing' };
  }
  const agreed = loaded.meta.agreed && typeof loaded.meta.agreed === 'object' ? loaded.meta.agreed : {};
  if (agreed[workspace]) return { ...base, ok: true, code: 'duplicate', marker: '[duplicate]' };
  const criteria = payload.criteria == null ? '' : String(payload.criteria);
  const next = { ...loaded.meta, agreed: { ...agreed, [workspace]: { at: now.toISOString(), criteria } }, revision: Number(loaded.meta.revision) + 1, updated: now.toISOString() };
  writeCard(boardDir, { kind: 'epic', meta: next, body: loaded.body });
  appendJournal(boardDir, { at: now.toISOString(), kind: 'agree', epic: epicId, workspace, criteria, letter: file || '' });
  const total = involved.length;
  const done = involved.filter((id) => next.agreed[id]).length;
  if (total > 0 && done >= total) {
    const result = apply(boardDir, { card: epicId, from: 'agreeing', to: 'agreed', by: 'motor', marker: '[agree-epic]', letter: file || '', now });
    return { ...base, ...result, agreed: done, total };
  }
  return { ...base, ok: true, code: 'agreed-recorded', marker: '[agree-epic]', agreed: done, total };
}

function planSubtasks({ boardDir, letter, workspace, now, file, payload }) {
  const taskId = String(payload.task || payload.card || '');
  const base = { workspace, letter: file || '', marker: letter.marker, card: taskId };
  const loaded = loadCard(boardDir, taskId);
  if (!loaded || loaded.kind !== 'task') return { ...base, ok: false, code: 'unknown-card', marker: '[unknown-card]', reason: 'наряда «' + taskId + '» нет' };
  if (loaded.meta.status !== 'in-progress') {
    return { ...base, ok: false, code: 'from-mismatch', marker: '[transition-rejected]', reason: 'наряд в статусе «' + loaded.meta.status + '», план подзадач принимается только в in-progress' };
  }
  const meta = loaded.meta;
  const next = { ...meta, subtasks: { total: Math.max(0, Number(payload.total) || 0), done: 0 }, revision: Number(meta.revision) + 1, updated: now.toISOString() };
  writeCard(boardDir, { kind: 'task', meta: next, body: loaded.body });
  appendJournal(boardDir, { at: now.toISOString(), kind: 'subtasks', epic: meta.epic, card: meta.id, workspace, total: next.subtasks.total, plan: Array.isArray(payload.subtasks) ? payload.subtasks : [], letter: file || '' });
  return { ok: true, code: 'subtasks-planned', marker: '[subtask-plan]', card: meta.id, workspace };
}

function approveSubtasks({ boardDir, letter, workspace, now, file, payload }) {
  const taskId = String(payload.task || payload.card || '');
  const base = { workspace, letter: file || '', marker: letter.marker, card: taskId };
  const loaded = loadCard(boardDir, taskId);
  if (!loaded || loaded.kind !== 'task') return { ...base, ok: false, code: 'unknown-card', marker: '[unknown-card]', reason: 'наряда «' + taskId + '» нет' };
  if (loaded.meta.status !== 'in-progress') {
    return { ...base, ok: false, code: 'from-mismatch', marker: '[transition-rejected]', reason: 'наряд в статусе «' + loaded.meta.status + '», вердикт по плану принимается только в in-progress' };
  }
  const meta = loaded.meta;
  const next = { ...meta, subtasks: { ...meta.subtasks, approved: true }, revision: Number(meta.revision) + 1, updated: now.toISOString() };
  writeCard(boardDir, { kind: 'task', meta: next, body: loaded.body });
  appendJournal(boardDir, { at: now.toISOString(), kind: 'subtasks', epic: meta.epic, card: meta.id, workspace, approved: true, letter: file || '' });
  return { ok: true, code: 'subtasks-approved', marker: '[subtask-approved]', card: meta.id, workspace };
}

function doneSubtask({ boardDir, letter, workspace, now, file, payload }) {
  const taskId = String(payload.task || payload.card || '');
  const base = { workspace, letter: file || '', marker: letter.marker, card: taskId };
  const loaded = loadCard(boardDir, taskId);
  if (!loaded || loaded.kind !== 'task') return { ...base, ok: false, code: 'unknown-card', marker: '[unknown-card]', reason: 'наряда «' + taskId + '» нет' };
  if (loaded.meta.status !== 'in-progress') {
    return { ...base, ok: false, code: 'from-mismatch', marker: '[transition-rejected]', reason: 'наряд в статусе «' + loaded.meta.status + '», отметка подзадачи принимается только в in-progress' };
  }
  const meta = loaded.meta;
  /* [subtask-approved] может прийти раньше [subtask-plan]: без плана счётчик не теряется,
     approved и прочие поля сохраняются, done не сбрасывается в ноль. */
  const state = (meta.subtasks && typeof meta.subtasks === 'object') ? meta.subtasks : {};
  const total = Number(state.total) || 0;
  const done = Math.min(total, (Number(state.done) || 0) + 1);
  const next = { ...meta, subtasks: { ...state, done, total }, revision: Number(meta.revision) + 1, updated: now.toISOString() };
  writeCard(boardDir, { kind: 'task', meta: next, body: loaded.body });
  appendJournal(boardDir, { at: now.toISOString(), kind: 'subtasks', epic: meta.epic, card: meta.id, workspace, done, total, subtask: payload.subtask || '', letter: file || '' });
  return { ok: true, code: 'subtask-done', marker: '[subtask-done]', done, total };
}

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
  if (letter.marker === 'agree-epic') {
    return agreeEpic({ boardDir, letter, workspace, now, file, payload });
  }
  if (letter.marker === 'subtask-plan') {
    return planSubtasks({ boardDir, letter, workspace, now, file, payload });
  }
  if (letter.marker === 'subtask-done') {
    return doneSubtask({ boardDir, letter, workspace, now, file, payload });
  }
  if (letter.marker === 'subtask-approved') {
    return approveSubtasks({ boardDir, letter, workspace, now, file, payload });
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
