/**
 * lib/letters.js — письма dsh-exchange/1 (docs/PROTOCOL.md §6).
 *
 * Шапка — строки «Key: value» до первой пустой строки, тело — остаток.
 * Маркер берётся из префикса Subject: «[task-accept] …». Payload письма —
 * строка «Payload: {json}» в теле (формат payload протокол не фиксирует;
 * это соглашение плагина, чтобы мотор мог прочитать поля наряда).
 */
import fs from 'node:fs';
import path from 'node:path';

export const LETTER_FORMAT = 'dsh-exchange/1';

/** Заглушка Session: письмо написано вне контекста запроса (B2). */
export const SESSION_UNKNOWN = 'session-unknown';

export const HEADER_ORDER = Object.freeze([
  'Format', 'From', 'To', 'Date', 'Thread', 'Status', 'Workspace', 'Session', 'Session-Source', 'Reply-To', 'Ref', 'Subject',
]);

/**
 * B2: Session — реальная сессия породившего запроса. Если контекста нет,
 * подставляется заглушка и явный признак источника, чтобы получатель видел,
 * что сессия не настоящая, а не принимал 'motor' за идентификатор сессии.
 */
export function sessionHeaders(session) {
  const value = String(session === undefined || session === null ? '' : session).trim();
  return value ? { Session: value } : { Session: SESSION_UNKNOWN, 'Session-Source': 'absent' };
}

/**
 * B4: Thread письма — это и есть каталог, где лежит файл: <exchange>/threads/<thread без 'threads/'>.
 * Имя файла не меняется; каталог создаётся по требованию.
 */
export function threadDir(exchange, thread) {
  const relative = String(thread || '').trim().replace(/^threads\//u, '');
  const name = path.basename(relative);
  if (!exchange || !name) throw new Error('threadDir: не задан Thread или exchange');
  const dir = path.join(exchange, 'threads', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function markerOf(subject) {
  const match = /\[([a-z][a-z-]*)\]/u.exec(String(subject || ''));
  return match ? match[1] : '';
}

export function parseLetter(text) {
  const source = String(text || '');
  const lines = source.split(/\r?\n/);
  const headers = {};
  let index = 0;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') { index += 1; break; }
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s?(.*)$/u.exec(line);
    if (!match) break;
    headers[match[1]] = match[2].trim();
  }
  const body = lines.slice(index).join('\n').replace(/^\n+/u, '');
  return { headers, body, marker: markerOf(headers.Subject) };
}

export function payloadOf(body) {
  const match = /^Payload:\s*(\{[\s\S]*?\})\s*$/mu.exec(String(body || ''));
  if (!match) return {};
  try {
    const payload = JSON.parse(match[1]);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
}

export function renderLetter(letter) {
  const rows = [];
  const source = { ...letter, Format: letter.Format || LETTER_FORMAT };
  for (const key of HEADER_ORDER) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') rows.push(key + ': ' + value);
  }
  for (const key of Object.keys(source)) {
    if (HEADER_ORDER.includes(key) || key === 'body') continue;
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') rows.push(key + ': ' + value);
  }
  const body = String(letter.body || '');
  return rows.join('\n') + '\n\n' + body + (body && !body.endsWith('\n') ? '\n' : '');
}
