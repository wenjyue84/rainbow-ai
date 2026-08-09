// Repair the mangled availability override pattern (shell-escaping casualty).
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const f = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assistant', 'data', 'intents.json');
const its = JSON.parse(await readFile(f, 'utf8'));
const ov = its.categories.find((c) => c.phase === 'overrides');
const entry = ov.intents.find((i) => i.category === 'availability');
const patterns = ['\\bfully\\s?booked\\b|\\bsold\\s?out\\b|(满房|客满|滿房)'];
if (entry) entry.patterns = patterns;
else ov.intents.push({ category: 'availability', enabled: true, patterns });
await writeFile(f, JSON.stringify(its, null, 2) + '\n', 'utf8');
console.log('availability pattern repaired:', JSON.stringify(patterns));
