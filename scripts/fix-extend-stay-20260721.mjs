// OUT-3: "stay one more night / extend" must hit extend_stay (extension_request
// workflow), not late_checkout_request. The legacy late_checkout pattern owned
// "extend|stay (longer|more)" — remove those and give extend_stay an override.

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const f = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assistant', 'data', 'intents.json');
const its = JSON.parse(await readFile(f, 'utf8'));

const ov = its.categories.find((c) => c.phase === 'overrides');
if (!ov.intents.some((i) => i.category === 'extend_stay')) {
  ov.intents.push({
    category: 'extend_stay',
    enabled: true,
    patterns: [
      "\\b(stay|extend)\\b[^.?!]{0,30}\\b(one\\s?more|another|extra)\\s?night\\b",
      "\\bextend\\s?(my\\s?)?(stay|booking|reservation)?\\b",
      "\\btambah\\s?(satu\\s?)?malam\\b|(多住|再住|续住|加住)",
    ],
  });
}

for (const c of its.categories) {
  if (c.phase === 'overrides') continue;
  for (const it of c.intents || []) {
    if (it.category === 'late_checkout_request') {
      it.patterns = it.patterns.map((p) =>
        p.replace('late\\s?check[\\s-]?out|extend|stay\\s?(longer|more)|lewat\\s?keluar', 'late\\s?check[\\s-]?out|lewat\\s?keluar')
      );
    }
  }
}
await writeFile(f, JSON.stringify(its, null, 2) + '\n', 'utf8');
console.log('extend_stay override added, legacy late_checkout pattern narrowed');
