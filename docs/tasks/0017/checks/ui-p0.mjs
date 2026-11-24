import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..', '..');
const client = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');
const tokens = ['HAIRLINE_SOFT', 'HAIRLINE_STRONG', 'SURFACE_1', 'SURFACE_2', 'SURFACE_3', 'SURFACE_4', 'DOT_RING', 'RING_SELECTED', 'MONO', 'EASE'];
const missing = tokens.filter((t) => !client.includes(t));
if (missing.length) {
  console.error('FAIL ui-p0: нет токенов ' + missing.join(', '));
  process.exit(1);
}
if (!client.includes('color-mix(in srgb, currentColor 16%, transparent)')) {
  console.error('FAIL ui-p0: HAIRLINE не 16%');
  process.exit(1);
}
if (!/opacity:s*0?.66/.test(client)) {
  console.error('FAIL ui-p0: нет tertiary opacity 0.66 (D2)');
  process.exit(1);
}
if (!/width:s*208/.test(client)) {
  console.error('FAIL ui-p0: колонка не 208 px (D1)');
  process.exit(1);
}
if (!client.includes('styles.textarea') && !client.includes('textarea:')) {
  console.error('FAIL ui-p0: нет стиля textarea (D7)');
  process.exit(1);
}
if (!client.includes('aria-label')) {
  console.error('FAIL ui-p0: нет aria-label (D5)');
  process.exit(1);
}
if (!client.includes('RING_SELECTED') && !client.includes('ringSelected')) {
  console.error('FAIL ui-p0: нет кольца выбранной карточки (P1)');
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const atLeast = (a, b) => { const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0; const y = pb[i] || 0; if (x !== y) return x > y; } return true; };
if (!atLeast(pkg.version, '0.4.0')) {
  console.error('FAIL ui-p0: версия ниже 0.4.0, сейчас ' + pkg.version);
  process.exit(1);
}
console.log('OK ui-p0: токены, HAIRLINE 16%, 0.66, колонка 208, textarea, aria, кольцо; 0.4.0');
