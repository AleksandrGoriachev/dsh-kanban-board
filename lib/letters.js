/**
 * lib/letters.js — письма dsh-exchange/1 (docs/PROTOCOL.md §6).
 *
 * Шапка — строки «Key: value» до первой пустой строки, тело — остаток.
 * Маркер берётся из префикса Subject: «[task-accept] …». Payload письма —
 * строка «Payload: {json}» в теле (формат payload протокол не фиксирует;
 * это соглашение плагина, чтобы мотор мог прочитать поля наряда).
 */
export const LETTER_FORMAT = 'dsh-exchange/1';

export const HEADER_ORDER = Object.freeze([
  'Format', 'From', 'To', 'Date', 'Thread', 'Status', 'Workspace', 'Session', 'Reply-To', 'Ref', 'Subject',
]);

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
