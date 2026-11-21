/**
 * checks/client-design.mjs — приёмочная проверка задания 0002:
 * клиент доски несёт дизайн из VictorKozachek/dsh-kanban (тема через
 * currentColor/color-mix, колонки с цветной точкой, карточка с левой гранью).
 * На базе (старый клиент) маркеров нет — это доказанный красный.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientFile = path.join(here, '..', '..', '..', '..', 'lib', 'client.js');
const text = fs.readFileSync(clientFile, 'utf8');

const marks = [
  ['HAIRLINE (тема)', 'color-mix(in srgb, currentColor 12%, transparent)'],
  ['карточка (data-атрибут)', 'data-kanban-card'],
  ['цвет колонки', '#94a3b8'],
  ['левая грань карточки', 'borderLeftWidth: 3'],
  ['каркас стилей', 'styles.card'],
  ['колонка-контейнер', 'styles.column'],
];
const missing = marks.filter(([, marker]) => !text.includes(marker));
if (missing.length) {
  console.error('FAIL client-design: нет маркеров дизайна: ' + missing.map(([name]) => name).join(', '));
  process.exit(1);
}
console.log('OK client-design: маркеры дизайна на месте (' + marks.map(([name]) => name).join(', ') + ')');
