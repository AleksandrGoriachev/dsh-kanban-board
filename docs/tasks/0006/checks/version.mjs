import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', '..', 'package.json'), 'utf8'));
if (pkg.version !== '0.1.6') { console.error('FAIL version: ожидалось 0.1.6, сейчас ' + pkg.version); process.exit(1); }
console.log('OK version: ' + pkg.name + '@' + pkg.version);
