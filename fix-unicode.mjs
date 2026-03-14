import { readFileSync, writeFileSync } from 'fs';

let raw = readFileSync('src/assistant/data-makan/settings.json', 'utf8');

// Fix corrupted em dashes: â€" -> —
raw = raw.replaceAll('\u00e2\u20ac\u201c', '\u2014');  // â€" -> —
raw = raw.replaceAll('\u00e2\u20ac\u201d', '\u2014');   // â€" variant

// Fix corrupted rainbow emoji: Ã°ÂŸÅ'Ë† -> 🌈
raw = raw.replaceAll('\u00f0\u0178\u0152\u02c6', '\uD83C\uDF08');

// Also try the raw mojibake patterns
raw = raw.replaceAll('\u00e2\u0080\u0094', '\u2014');  // another em dash encoding

writeFileSync('src/assistant/data-makan/settings.json', raw, 'utf8');

// Verify
const data = JSON.parse(readFileSync('src/assistant/data-makan/settings.json', 'utf8'));
console.log('Contains corrupted char:', data.system_prompt.includes('\u00e2'));
const signoffIdx = data.system_prompt.indexOf('Sign off');
console.log('Sign-off:', data.system_prompt.substring(signoffIdx, signoffIdx + 60));
