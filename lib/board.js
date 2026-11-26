/**
 * lib/board.js — императивное ядро канбан-доски (docs/PROTOCOL.md v1.0).
 *
 * Здесь только код по §10 протокола: валидация переходов и revision, проверка
 * payload/evidence, идемпотентность, запись карточки и журнала, обход, лизы,
 * таймаут согласования, счётчик подзадач, сверка/починка. Суждения модели
 * (приёмка стыка, закрытие эпика) сюда не входят — приходят через apply().
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROTOCOL_VERSION = 1;

export const EPIC_STATUSES = Object.freeze([
  'draft', 'agreeing', 'agreed', 'decomposed', 'in-progress', 'accepted', 'done', 'blocked', 'needs-decision',
]);
export const TASK_STATUSES = Object.freeze([
  'proposed', 'agreed', 'in-progress', 'integration', 'accepted', 'rework', 'blocked', 'needs-decision',
]);

/** §5.1: кто и когда двигает эпик. */
export const EPIC_TRANSITIONS = Object.freeze([
  { from: 'draft', to: 'agreeing', by: 'architect' },
  { from: 'agreeing', to: 'agreed', by: 'motor' },
  { from: 'agreeing', to: 'needs-decision', by: 'motor' },
  { from: 'agreed', to: 'decomposed', by: 'architect' },
  { from: 'decomposed', to: 'in-progress', by: 'motor' },
  { from: 'in-progress', to: 'accepted', by: 'motor' },
  { from: 'accepted', to: 'done', by: 'architect' },
  { from: 'accepted', to: 'rework', by: 'architect' },
  { from: 'blocked', to: 'needs-decision', by: 'architect' },
  /*
   * §5.1: вердикт архитектора по эскалации. Эпик попал в needs-decision
   * (таймаут согласования, цикл blocked_by, ручная эскалация), и архитектор
   * решает его судьбу: вернуть в согласование, разложить на наряды, принять
   * результат или закрыть. Без этих рёбер needs-decision был тупиком.
   */
  { from: 'needs-decision', to: 'agreeing', by: 'architect' },
  { from: 'needs-decision', to: 'decomposed', by: 'architect' },
  { from: 'needs-decision', to: 'accepted', by: 'architect' },
  { from: 'needs-decision', to: 'done', by: 'architect' },
  { from: '*', to: 'blocked', by: 'motor' },
]);

/** §5.2: кто и когда двигает наряд. */
export const TASK_TRANSITIONS = Object.freeze([
  { from: 'proposed', to: 'agreed', by: 'architect' },
  { from: 'proposed', to: 'agreed', by: 'motor' },
  { from: 'agreed', to: 'in-progress', by: 'motor' },
  { from: 'in-progress', to: 'integration', by: 'motor' },
  { from: 'integration', to: 'accepted', by: 'architect' },
  { from: 'integration', to: 'rework', by: 'architect' },
  { from: 'accepted', to: 'rework', by: 'architect' },
  { from: 'accepted', to: 'rework', by: 'motor' },
  { from: 'in-progress', to: 'agreed', by: 'motor' },
  { from: 'blocked', to: 'agreed', by: 'architect' },
  { from: 'needs-decision', to: 'agreed', by: 'architect' },
  { from: '*', to: 'blocked', by: 'motor' },
  { from: '*', to: 'needs-decision', by: 'motor' },
]);

export function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/** Каноническая форма для идемпотентности: ключи по алфавиту, без пробелов. */
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/* ---------- карточки: мета-блок JSON в HTML-комментарии ---------- */

export function parseCardText(text) {
  const source = String(text || '');
  const match = /^\s*<!--\s*([\s\S]*?)\s*-->/.exec(source);
  if (!match) throw new Error('карточка без мета-блока <!-- { ... } -->');
  const meta = JSON.parse(match[1]);
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error('мета-блок карточки — не JSON-объект');
  }
  const body = source.slice(match[0].length).replace(/^\r?\n/, '');
  return { meta, body };
}

export function renderCardText(meta, body) {
  const rest = String(body || '');
  return '<!--\n' + JSON.stringify(meta, null, 2) + '\n-->\n' + rest + (rest && !rest.endsWith('\n') ? '\n' : '');
}

export function cardDir(boardDir, kind) {
  return path.join(boardDir, kind === 'epic' ? 'epics' : 'tasks');
}

export function cardFile(boardDir, kind, id) {
  return path.join(cardDir(boardDir, kind), String(id) + '.md');
}

export function readCardFile(file, kind) {
  const { meta, body } = parseCardText(fs.readFileSync(file, 'utf8'));
  return { kind, file, meta, body };
}

export function loadCard(boardDir, id) {
  for (const kind of ['epic', 'task']) {
    const file = cardFile(boardDir, kind, id);
    if (fs.existsSync(file)) return readCardFile(file, kind);
  }
  return null;
}

export function listCards(boardDir, kind) {
  const dir = cardDir(boardDir, kind);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort()
    .map((name) => readCardFile(path.join(dir, name), kind));
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ }
}

/**
 * Запись карточки по §8: временный файл + rename. На Windows rename поверх
 * существующего файла иногда даёт EPERM/EBUSY (антивирус/открытый handle) —
 * повторяем коротко, а не падаем; иначе один сбой ломал бы переход.
 */
export function writeCard(boardDir, card) {
  const file = cardFile(boardDir, card.kind, card.meta.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, renderCardText(card.meta, card.body));
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tmp, file);
      break;
    } catch (error) {
      const retryable = error && (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES');
      if (attempt < 20 && retryable) { sleepSync(20); continue; }
      throw error;
    }
  }
  return file;
}

/* ---------- журнал: append-only, одна строка JSON на событие ---------- */

export function journalFile(boardDir) {
  return path.join(boardDir, 'journal.jsonl');
}

export function appendJournal(boardDir, event) {
  fs.mkdirSync(boardDir, { recursive: true });
  fs.appendFileSync(journalFile(boardDir), JSON.stringify(event) + '\n');
}

export function readJournal(boardDir) {
  const file = journalFile(boardDir);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const events = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new Error('journal.jsonl: строка ' + (i + 1) + ' — не JSON');
    }
  }
  return events;
}

/* ---------- допустимые переходы ---------- */

function transitionsFor(kind) {
  return kind === 'epic' ? EPIC_TRANSITIONS : TASK_TRANSITIONS;
}

export function findTransition(kind, from, to, by) {
  return transitionsFor(kind).find((item) => item.to === to && item.by === by
    && (item.from === from || item.from === '*')) || null;
}

export function allowedTransitions(kind, from, by) {
  return transitionsFor(kind)
    .filter((item) => item.by === by && (item.from === from || item.from === '*'))
    .map((item) => item.to);
}

/**
 * §12: цикл blocked_by (A ждёт B, B ждёт A) — детект циклов DFS по карточкам.
 * Возвращает массив циклов, каждый цикл — массив id; дубли по составу схлопываются.
 */
export function detectBlockedCycles(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const byId = new Map();
  for (const card of list) {
    if (card && card.meta && card.meta.id) byId.set(String(card.meta.id), card);
  }
  const color = new Map();
  const stack = [];
  const cycles = [];
  const seen = new Set();
  const visit = (id) => {
    const state = color.get(id) || 0;
    if (state === 1) {
      const start = stack.indexOf(id);
      if (start >= 0) {
        const cycle = stack.slice(start);
        const key = cycle.slice().sort().join(',');
        if (!seen.has(key)) { seen.add(key); cycles.push(cycle); }
      }
      return;
    }
    if (state === 2) return;
    color.set(id, 1);
    stack.push(id);
    const card = byId.get(id);
    const deps = card && Array.isArray(card.meta.blocked_by) ? card.meta.blocked_by.map(String) : [];
    for (const dep of deps) {
      if (byId.has(dep)) visit(dep);
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const id of byId.keys()) visit(id);
  return cycles;
}

/* ---------- состояние обхода (.sweep.json): память прочтения и идемпотентность ---------- */

export function sweepFile(boardDir) {
  return path.join(boardDir, '.sweep.json');
}

function loadSweep(boardDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(sweepFile(boardDir), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { seen: {}, letters: {} };
    if (!parsed.seen || typeof parsed.seen !== 'object') parsed.seen = {};
    if (!parsed.letters || typeof parsed.letters !== 'object') parsed.letters = {};
    return parsed;
  } catch {
    return { seen: {}, letters: {} };
  }
}

function saveSweep(boardDir, state) {
  fs.mkdirSync(boardDir, { recursive: true });
  fs.writeFileSync(sweepFile(boardDir), JSON.stringify(state, null, 2) + '\n');
}

/* ---------- создание карточек ---------- */

export function createEpic(boardDir, fields = {}, now = new Date()) {
  /* Идентификатор сущности — системный UUID; пользователь его не вводит. */
  const id = String(fields.id || '').trim() || crypto.randomUUID();
  const file = cardFile(boardDir, 'epic', id);
  if (fs.existsSync(file)) throw new Error('createEpic: эпик уже существует: ' + id);
  const title = String(fields.title || '').trim();
  if (!title) throw new Error('createEpic: пустое название');
  const meta = {
    id,
    title,
    status: 'draft',
    involved: Array.isArray(fields.involved) ? fields.involved.slice() : [],
    agreed: fields.agreed && typeof fields.agreed === 'object' ? fields.agreed : {},
    agree_until: fields.agree_until || null,
    result: String(fields.result || '').trim(),
    created: now.toISOString(),
    updated: now.toISOString(),
    revision: 1,
  };
  writeCard(boardDir, { kind: 'epic', meta, body: fields.body || ('# ' + meta.title + '\n') });
  return meta;
}

export function createTask(boardDir, fields = {}, now = new Date()) {
  /* Идентификатор наряда — системный UUID; пользователь его не вводит. */
  const id = String(fields.id || '').trim() || crypto.randomUUID();
  const epic = String(fields.epic || '').trim();
  if (!epic) throw new Error('createTask: не указан эпик');
  const file = cardFile(boardDir, 'task', id);
  if (fs.existsSync(file)) throw new Error('createTask: наряд уже существует: ' + id);
  /* B1: заголовок наряда обязателен так же, как название эпика: письмо-оффер
     и карточка без него теряют смысл. Маршрут /api/task вернёт 400 invalid-task. */
  const title = String(fields.title || '').trim();
  if (!title) throw new Error('createTask: не указан title');
  const meta = {
    id,
    title,
    epic,
    workspace: String(fields.workspace || ''),
    role: fields.role || null,
    status: 'proposed',
    owner: null,
    lease_until: null,
    blocked_by: Array.isArray(fields.blocked_by) ? fields.blocked_by.slice() : [],
    spec: String(fields.spec || '').trim(),
    evidence: [],
    subtasks: fields.subtasks && typeof fields.subtasks === 'object'
      ? { done: Number(fields.subtasks.done) || 0, total: Number(fields.subtasks.total) || 0 }
      : { done: 0, total: 0 },
    created: now.toISOString(),
    updated: now.toISOString(),
    revision: 1,
  };
  writeCard(boardDir, { kind: 'task', meta, body: fields.body || ('# ' + (meta.title || meta.id) + '\n') });
  return meta;
}

/* ---------- §9.1 apply(card, from, to, reason, letter) ---------- */

export function apply(boardDir, request = {}) {
  const now = request.now instanceof Date ? request.now : new Date();
  const card = String(request.card || '').trim();
  const from = String(request.from || '');
  const to = String(request.to || '');
  const by = request.by === 'architect' ? 'architect' : request.by === 'motor' ? 'motor' : '';
  const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
  const marker = typeof request.marker === 'string' ? request.marker : '';
  const letter = request.letter == null ? null : String(request.letter);
  const reason = typeof request.reason === 'string' ? request.reason : '';
  const base = { card, from, to, by };

  if (!card || !from || !to || !by) {
    return { ok: false, code: 'bad-request', marker: '[transition-rejected]', reason: 'нужны card, from, to, by', ...base };
  }
  const loaded = loadCard(boardDir, card);
  if (!loaded) {
    return { ok: false, code: 'unknown-card', marker: '[unknown-card]', reason: 'карточки «' + card + '» нет', ...base };
  }
  const { kind, meta, body } = loaded;

  if (!transitionsFor(kind).length) {
    return { ok: false, code: 'unknown-kind', marker: '[transition-rejected]', reason: 'тип карточки не определён', ...base };
  }
  /*
   * Идемпотентность проверяется до сверки статуса: §12 требует «повтор письма →
   * [duplicate], состояние не меняется», а после первого применения карточка уже
   * стоит в to, и проверка from дала бы transition-rejected вместо duplicate.
   */
  const idemKey = card + ':' + from + ':' + to + ':' + sha256Hex(canonical({ marker, payload }));
  const sweepState = loadSweep(boardDir);
  if (sweepState.seen[idemKey]) {
    return { ok: false, code: 'duplicate', marker: '[duplicate]', reason: 'письмо уже обработано', ...base };
  }
  if (meta.status !== from) {
    return {
      ok: false, code: 'from-mismatch', marker: '[transition-rejected]',
      reason: 'карточка в статусе «' + meta.status + '», ожидался «' + from + '»',
      allowed: allowedTransitions(kind, meta.status, by), ...base,
    };
  }
  if (request.expectedRevision !== undefined && request.expectedRevision !== null) {
    const expected = Number(request.expectedRevision);
    if (!Number.isFinite(expected) || expected !== Number(meta.revision)) {
      return {
        ok: false, code: expected < meta.revision ? 'stale' : 'revision-mismatch',
        marker: '[transition-rejected]',
        reason: 'revision ' + request.expectedRevision + ' не равен текущему ' + meta.revision,
        allowed: allowedTransitions(kind, meta.status, by), ...base,
      };
    }
  }
  const transition = findTransition(kind, from, to, by);
  if (!transition) {
    return {
      ok: false, code: 'invalid-transition', marker: '[transition-rejected]',
      reason: 'переход ' + from + ' → ' + to + ' (' + by + ') недопустим',
      allowed: allowedTransitions(kind, meta.status, by), ...base,
    };
  }
  if (kind === 'task' && to === 'integration') {
    const evidence = Array.isArray(payload.evidence) ? payload.evidence.filter((item) => typeof item === 'string' && item.trim()) : [];
    if (evidence.length === 0) {
      return { ok: false, code: 'evidence-empty', marker: '[transition-rejected]', reason: 'stage-ready без непустого evidence', ...base };
    }
  }
  if (kind === 'task' && from === 'agreed' && to === 'in-progress') {
    const lease = payload.lease_until ? Date.parse(String(payload.lease_until)) : NaN;
    if (!Number.isFinite(lease) || lease <= now.getTime()) {
      return { ok: false, code: 'lease-past', marker: '[transition-rejected]', reason: 'task-accept без lease_until в будущем', ...base };
    }
  }

  const next = { ...meta, status: to, revision: Number(meta.revision) + 1, updated: now.toISOString() };
  if (kind === 'epic' && from === 'draft' && to === 'agreeing' && !next.agree_until) {
    const minutes = Number(request.agreeTimeoutMinutes) > 0 ? Number(request.agreeTimeoutMinutes) : 15;
    next.agree_until = new Date(now.getTime() + minutes * 60000).toISOString();
  }
  if (kind === 'task') {
    if (from === 'agreed' && to === 'in-progress') {
      next.owner = payload.owner == null ? null : String(payload.owner);
      next.lease_until = payload.lease_until ? String(payload.lease_until) : null;
    }
    if (to === 'integration') next.evidence = (payload.evidence || []).map(String);
    if (from === 'in-progress' && to === 'agreed') { next.owner = null; next.lease_until = null; }
    if (payload.delta_done !== undefined) {
      const total = Number(next.subtasks && next.subtasks.total) || 0;
      const done = Number(next.subtasks && next.subtasks.done) || 0;
      const delta = Math.max(0, Number(payload.delta_done) || 0);
      next.subtasks = { done: Math.min(total, done + delta), total };
    }
  }
  writeCard(boardDir, { kind, meta: next, body });

  const epic = kind === 'epic' ? next.id : next.epic;
  const event = {
    at: now.toISOString(), kind: 'transition', epic, card, from, to, by,
    letter: letter || null,
    proof: reason || null,
    revision: next.revision,
  };
  if (next.lease_until) event.lease_until = next.lease_until;
  appendJournal(boardDir, event);

  sweepState.seen[idemKey] = now.toISOString();
  saveSweep(boardDir, sweepState);

  return { ok: true, code: 'applied', marker: '[transition-applied]', meta: next, event };
}

/* ---------- §9.2 sweep ---------- */

export function sweep(boardDir, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const expired = [];
  const failed = [];

  for (const card of listCards(boardDir, 'task')) {
    if (card.meta.status !== 'in-progress') continue;
    const lease = card.meta.lease_until ? Date.parse(String(card.meta.lease_until)) : NaN;
    if (Number.isFinite(lease) && lease < now.getTime()) {
      const result = apply(boardDir, {
        card: card.meta.id, from: 'in-progress', to: 'agreed', by: 'motor',
        marker: '[lease-expired]', reason: 'lease_until ' + card.meta.lease_until + ' истёк', now,
      });
      if (result.ok) expired.push({ card: card.meta.id, marker: '[lease-expired]', to: 'agreed' });
      else failed.push({ card: card.meta.id, code: result.code });
    }
  }

  /*
   * R8: эпик, у которого ВСЕ наряды (meta.epic === эпик) в accepted, сам
   * переходит in-progress → accepted. Нарядов ноль — не двигаем: принимать
   * нечего, вердикт за архитектором. Двигаем только через apply(), иначе
   * карточка и журнал разошлись бы; тип перехода пишет apply().
   */
  const allTasks = listCards(boardDir, 'task');
  for (const card of listCards(boardDir, 'epic')) {
    if (card.meta.status !== 'in-progress') continue;
    const own = allTasks.filter((task) => String(task.meta.epic) === String(card.meta.id));
    if (own.length === 0) continue;
    if (!own.every((task) => task.meta.status === 'accepted')) continue;
    const result = apply(boardDir, {
      card: card.meta.id, from: 'in-progress', to: 'accepted', by: 'motor',
      marker: '[epic-accepted]', reason: 'все наряды приняты',
      payload: { reason: 'все наряды приняты' }, now,
    });
    if (result.ok) expired.push({ card: card.meta.id, marker: '[epic-accepted]', to: 'accepted' });
    else failed.push({ card: card.meta.id, code: result.code });
  }

  for (const card of listCards(boardDir, 'epic')) {
    if (card.meta.status !== 'agreeing') continue;
    const fallbackMinutes = Number(options.agreeTimeoutMinutes) > 0 ? Number(options.agreeTimeoutMinutes) : 15;
    const createdMs = Date.parse(String(card.meta.created));
    const until = card.meta.agree_until
      ? Date.parse(String(card.meta.agree_until))
      : (Number.isFinite(createdMs) ? createdMs + fallbackMinutes * 60000 : NaN);
    if (Number.isFinite(until) && until < now.getTime()) {
      const result = apply(boardDir, {
        card: card.meta.id, from: 'agreeing', to: 'needs-decision', by: 'motor',
        marker: '[agree-timeout]', reason: 'agree_until ' + card.meta.agree_until + ' истёк', now,
      });
      if (result.ok) expired.push({ card: card.meta.id, marker: 'needs-decision', to: 'needs-decision' });
      else failed.push({ card: card.meta.id, code: result.code });
    }
  }

  const cycles = detectBlockedCycles(listCards(boardDir, 'task'));
  for (const cycle of cycles) {
    for (const id of cycle) {
      const card = loadCard(boardDir, id);
      if (!card || card.meta.status === 'needs-decision') continue;
      const res = apply(boardDir, {
        card: id, from: card.meta.status, to: 'needs-decision', by: 'motor',
        marker: '[cycle]', reason: 'цикл blocked_by', now,
      });
      if (res.ok) expired.push({ card: id, marker: 'needs-decision', to: 'needs-decision' });
      else failed.push({ card: id, code: res.code });
    }
  }

  appendJournal(boardDir, {
    at: now.toISOString(), kind: 'sweep',
    summary: { applied: expired.length, rejected: failed.length, expired: expired.length, cycles: cycles.length },
  });
  return { expired, failed };
}

/* ---------- §9.3 replay / reconcile ---------- */

export function replay(boardDir, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const repaired = [];
  const last = new Map();
  for (const event of readJournal(boardDir)) {
    if (event && event.kind === 'transition' && event.card) last.set(String(event.card), event);
  }
  for (const card of [...listCards(boardDir, 'epic'), ...listCards(boardDir, 'task')]) {
    const event = last.get(card.meta.id);
    if (!event) continue;
    if (card.meta.status === event.to) continue;
    const next = {
      ...card.meta,
      status: event.to,
      revision: Math.max(Number(card.meta.revision) || 0, Number(event.revision) || 0),
      updated: now.toISOString(),
    };
    writeCard(boardDir, { kind: card.kind, meta: next, body: card.body });
    appendJournal(boardDir, {
      at: now.toISOString(), kind: 'repair',
      epic: card.kind === 'epic' ? card.meta.id : card.meta.epic,
      card: card.meta.id, from: card.meta.status, to: event.to,
      reason: 'journal — источник правды',
    });
    repaired.push({ card: card.meta.id, from: card.meta.status, to: event.to, marker: '[board-repaired]' });
  }
  return { repaired };
}
